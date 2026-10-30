import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

export const STORAGE_ROOT = resolve(process.cwd(), 'uploads', 'aigc');
const MAX_BYTES = 100 * 1024 * 1024;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private client?: S3Client;
  get driver(): 'local' | 'oss' {
    const value = process.env.STORAGE_DRIVER?.trim() || 'local';
    if (value !== 'local' && value !== 'oss') throw new Error('STORAGE_DRIVER 只允许 local 或 oss');
    return value;
  }
  private settings() {
    const required = ['R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL'];
    const missing = required.filter(key => !process.env[key]?.trim());
    const endpoint = process.env.R2_ENDPOINT?.trim() || (process.env.R2_ACCOUNT_ID?.trim() ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : '');
    if (!endpoint) missing.push('R2_ENDPOINT 或 R2_ACCOUNT_ID');
    if (missing.length) throw new Error(`OSS 配置缺少：${missing.join('、')}`);
    const publicBase = process.env.R2_PUBLIC_BASE_URL!.trim().replace(/\/+$/, '');
    for (const value of [endpoint, publicBase]) {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('R2_ENDPOINT 和 R2_PUBLIC_BASE_URL 必须是无认证参数的 HTTPS 地址');
    }
    return { endpoint, publicBase, bucket: process.env.R2_BUCKET!.trim(), region: process.env.R2_REGION?.trim() || 'auto', accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim() };
  }
  private s3() {
    if (!this.client) {
      const config = this.settings();
      this.client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', requestHandler: { connectionTimeout: 10000, requestTimeout: 120000 }, maxAttempts: 3 });
    }
    return this.client;
  }
  private name(value: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,240}$/.test(value) || value.includes('..')) throw new Error('存储文件名无效');
    return value;
  }
  private objectKey(url: string): string | undefined {
    const base = process.env.R2_PUBLIC_BASE_URL?.trim();
    if (!base) return undefined;
    try {
      const root = new URL(`${base.replace(/\/+$/, '')}/`), parsed = new URL(url);
      if (parsed.origin !== root.origin || !parsed.pathname.startsWith(`${root.pathname}aigc/`)) return undefined;
      const key = decodeURIComponent(parsed.pathname.slice(root.pathname.length));
      if (!/^aigc\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,240}$/.test(key) || key.includes('..')) return undefined;
      return key;
    } catch { return undefined; }
  }
  isObjectUrl(url: string) { return Boolean(this.objectKey(url)); }
  private publicUrl(key: string) { return `${this.settings().publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`; }
  private error(error: unknown): never {
    const code = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    throw new ServiceUnavailableException(`对象存储操作失败${code ? `（HTTP ${code}）` : ''}，请检查 R2 凭证、桶权限及网络`);
  }
  private async upload(name: string, body: Buffer | Readable, size: number, signal?: AbortSignal) {
    const key = `aigc/${this.name(name)}`;
    const config = this.settings();
    try {
      signal?.throwIfAborted();
      await this.s3().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentLength: size, ContentType: MIME[extname(name).toLowerCase()] || 'application/octet-stream', CacheControl: 'public, max-age=31536000, immutable' }), { abortSignal: signal });
      signal?.throwIfAborted();
      return this.publicUrl(key);
    } catch (error) {
      // An interrupted upload may already have reached R2; remove only this newly named object.
      if (signal?.aborted) { await this.s3().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(15000) }).catch(() => {}); throw signal.reason; }
      this.error(error);
    }
  }
  async putBuffer(bytes: Buffer, name: string, signal?: AbortSignal) {
    this.name(name);
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('媒体文件不能为空或超过 100 MB');
    if (this.driver === 'oss') return this.upload(name, bytes, bytes.length, signal);
    await mkdir(STORAGE_ROOT, { recursive: true });
    const path = join(STORAGE_ROOT, name);
    try { signal?.throwIfAborted(); await writeFile(path, bytes, { signal }); signal?.throwIfAborted(); return `/uploads/aigc/${name}`; }
    catch (error) { await unlink(path).catch(() => {}); throw error; }
  }
  async publishFile(path: string, signal?: AbortSignal, outputName = basename(path)) {
    const name = this.name(outputName), metadata = await stat(path);
    if (!metadata.isFile() || !metadata.size || metadata.size > 5 * 1024 ** 3) throw new Error('媒体文件不能为空或超过 5 GB');
    signal?.throwIfAborted();
    if (this.driver === 'oss') {
      const stream = createReadStream(path);
      try { return await this.upload(name, stream, metadata.size, signal); } finally { stream.destroy(); }
    }
    await mkdir(STORAGE_ROOT, { recursive: true });
    const target = join(STORAGE_ROOT, name);
    if (resolve(path) !== target) await copyFile(path, target);
    return `/uploads/aigc/${name}`;
  }
  async readObjectTo(url: string, path: string, signal: AbortSignal) {
    const key = this.objectKey(url);
    if (!key) throw new Error('不属于当前 R2 存储的文件');
    try {
      const object = await this.s3().send(new GetObjectCommand({ Bucket: this.settings().bucket, Key: key }), { abortSignal: signal });
      const body = object.Body as Readable;
      if (!body) throw new Error('对象存储返回空文件');
      if (Number(object.ContentLength) > MAX_BYTES) { body.destroy(); throw new Error('素材超过 100 MB'); }
      let bytes = 0;
      await pipeline(body, new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > MAX_BYTES ? new Error('素材超过 100 MB') : null, chunk); } }), createWriteStream(path), { signal });
    } catch (error) { await unlink(path).catch(() => {}); if (signal.aborted) throw signal.reason; this.error(error); }
  }
  async remove(url: string) {
    if (url.startsWith('/uploads/aigc/')) {
      const path = await this.localPath(url).catch(() => undefined);
      if (path) await unlink(path).catch(() => {});
      return;
    }
    const key = this.objectKey(url);
    if (!key) return;
    try { await this.s3().send(new DeleteObjectCommand({ Bucket: this.settings().bucket, Key: key }), { abortSignal: AbortSignal.timeout(15000) }); } catch (error) { this.error(error); }
  }
  async localPath(url: string) {
    if (!url.startsWith('/uploads/aigc/')) throw new Error('本地文件地址无效');
    const root = await realpath(STORAGE_ROOT), path = await realpath(resolve(process.cwd(), `.${url}`));
    if (!path.startsWith(`${root}/`)) throw new Error('本地文件地址无效');
    return path;
  }
  async providerReference(url: string, signal: AbortSignal) {
    if (/^https?:\/\//.test(url)) return url;
    if (this.driver === 'oss') { const path = await this.localPath(url); return this.publishFile(path, signal, `reference-${randomUUID()}${extname(path)}`); }
    if (process.env.PUBLIC_ASSET_BASE_URL?.trim()) return new URL(url, process.env.PUBLIC_ASSET_BASE_URL).href;
    return undefined;
  }
  onModuleInit() { if (this.driver === 'oss') this.settings(); }
  onModuleDestroy() { this.client?.destroy(); }
}
