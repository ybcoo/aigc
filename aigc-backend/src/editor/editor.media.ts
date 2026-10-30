import { BadRequestException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, realpath, stat, unlink } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';

export const EDITOR_ROOT = resolve(process.cwd(), 'uploads', 'aigc');
export const MEDIA_LIMIT = 100 * 1024 * 1024;

export function runMediaCommand(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-1024 * 1024); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    let failure: Error | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    child.on('error', error => { failure = error; if (signal?.aborted) timer = setTimeout(() => child.kill('SIGKILL'), 2000); });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (failure || code !== 0) reject(failure || new Error(`${command} 执行失败：${stderr.slice(-1500)}`));
      else resolve(stdout);
    });
  });
}

export const ffmpeg = (args: string[], signal: AbortSignal) => runMediaCommand('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-filter_complex_threads', '1', '-filter_threads', '1', ...args], signal);

export async function localMediaPath(url: string) {
  if (!url.startsWith('/uploads/aigc/')) throw new BadRequestException('素材路径无效');
  const path = await realpath(resolve(process.cwd(), `.${url}`));
  const root = await realpath(EDITOR_ROOT);
  if (!path.startsWith(`${root}/`)) throw new BadRequestException('素材路径无效');
  return path;
}

function publicAddress(address: string) {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
  }
  return isIP(value) === 6 && !/^(::|fc|fd|fe[89ab]|ff)/.test(value);
}

async function download(url: string, path: string, signal: AbortSignal, redirects = 0): Promise<void> {
  if (redirects > 3) throw new BadRequestException('素材地址重定向过多');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new BadRequestException('素材地址无效');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new BadRequestException('不能下载内网或保留地址的素材');
  const address = addresses[0];
  // Pin the validated DNS result so the subsequent connection cannot resolve a private address.
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(parsed, { signal, lookup: ((_host, options, callback) => {
      if (typeof options === 'object' && options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    }) as import('node:net').LookupFunction }, resolve);
    request.on('error', reject);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
    response.resume();
    return download(new URL(response.headers.location, parsed).href, path, signal, redirects + 1);
  }
  if (response.statusCode !== 200) { response.resume(); throw new BadRequestException(`下载素材失败：HTTP ${response.statusCode}`); }
  if (Number(response.headers['content-length']) > MEDIA_LIMIT) { response.destroy(); throw new BadRequestException('素材超过 100 MB'); }
  let bytes = 0;
  await pipeline(response, new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > MEDIA_LIMIT ? new Error('素材超过 100 MB') : null, chunk);
  } }), createWriteStream(path), { signal });
}

export async function copyEditorMedia(url: string, kind: string, signal: AbortSignal, directory = EDITOR_ROOT, storage?: StorageService) {
  await mkdir(directory, { recursive: true });
  const extension = extname(new URL(url, 'http://local').pathname).toLowerCase();
  const safeExtension = /^\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|ogg|flac)$/.test(extension) ? extension : kind === 'video' ? '.mp4' : '.m4a';
  const name = `editor-media-${randomUUID()}${safeExtension}`;
  const path = join(directory, name);
  try {
    if (url.startsWith('/uploads/aigc/')) await copyFile(await localMediaPath(url), path);
    else if (storage?.isObjectUrl(url)) await storage.readObjectTo(url, path, signal);
    else await download(url, path, signal);
    if ((await stat(path)).size > MEDIA_LIMIT) throw new BadRequestException('素材超过 100 MB');
    return { path, url: `/uploads/aigc/${name}` };
  } catch (error) { await unlink(path).catch(() => {}); throw error; }
}

export async function probeMedia(path: string, kind: string, signal: AbortSignal) {
  const raw = await runMediaCommand('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,mp3,wav,ogg,flac,aac,avi', '-show_format', '-show_streams', '-of', 'json', path], signal);
  const data = JSON.parse(raw);
  const video = data.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const audio = data.streams?.some(stream => stream.codec_type === 'audio');
  const seconds = Number(data.format?.duration || video?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1800 || kind === 'video' && !video || kind === 'audio' && !audio) throw new BadRequestException('素材格式或时长无效，最长支持 30 分钟');
  return { duration: Math.max(1, Math.floor(seconds * 30)), width: Number(video?.width || 0), height: Number(video?.height || 0), hasAudio: Boolean(audio) };
}
