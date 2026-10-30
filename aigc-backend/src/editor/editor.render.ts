import { BadRequestException } from '@nestjs/common';
import type { AigcEditorMedia } from '@prisma/client';
import { mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AIGCTimeline } from './timeline.types';
import { TIMELINE_TRANSITIONS } from './timeline.types';
import { normalizeTimeline, timelineDuration, timelineOutputDuration } from './timeline.logic';
import { copyEditorMedia, ffmpeg, localMediaPath, EDITOR_ROOT } from './editor.media';
import { StorageService } from '../storage/storage.service';
import type { ExportEditorDto } from './editor.dto';

export function validateTimeline(input: AIGCTimeline, media: AigcEditorMedia[], exporting = false) {
  const invalid = (message = '时间轴参数无效') => { throw new BadRequestException(message); };
  if (!input || input.version !== 1 || input.fps !== 30 || !Array.isArray(input.clips) || !Array.isArray(input.audio_tracks) || input.clips.length > 100 || input.audio_tracks.length > 32 || exporting && !input.clips.length) invalid();
  const byId = new Map(media.map(item => [item.id, item]));
  const ids = new Set<string>();
  const finite = (value: unknown, min: number, max: number, integer = true) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
  const base = (item: any, source: AigcEditorMedia | undefined) => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) invalid();
    ids.add(item.id);
    if (!source) invalid('时间轴中的素材已删除或不属于当前集');
    if (!finite(item.source_start, 0, 54000) || !finite(item.duration, 1, 54000) || item.source_start + item.duration > source!.duration + 1 || !finite(item.speed ?? 1, 0.5, 2, false) || !finite(item.volume, 0, 1, false) || typeof item.muted !== 'boolean') invalid('片段裁切范围、倍速或音量无效');
  };
  for (const clip of input.clips) {
    if (!clip || typeof clip.shot_id !== 'string') invalid();
    const source = byId.get(clip.shot_id);
    base(clip, source);
    if (source?.kind !== 'video' || !finite(clip.gap_before, 0, 54000) || !(TIMELINE_TRANSITIONS as readonly string[]).includes(clip.transition) || !finite(clip.transition_duration, 0, 48) || clip.effect) invalid('视频片段或转场设置无效');
  }
  for (const track of input.audio_tracks) {
    if (!track || typeof track.media_id !== 'string') invalid();
    const source = byId.get(track.media_id || '');
    base(track, source);
    if (track.source !== 'upload' || !source?.hasAudio || !finite(track.start, 0, 54000) || !finite(track.fade_in, 0, 54000) || !finite(track.fade_out, 0, 54000)) invalid('音轨参数无效');
  }
  if (input.subtitles != null && (!Array.isArray(input.subtitles) || input.subtitles.length > 500)) invalid('字幕数量无效');
  if (input.subtitles?.some(cue => !cue || typeof cue !== 'object')) invalid('字幕参数无效');
  const normalized = normalizeTimeline(structuredClone(input));
  const total = timelineDuration(normalized);
  if (total > 54000) invalid('成片最长支持 30 分钟');
  let previousEnd = 0;
  for (const cue of [...input.subtitles || []].sort((a, b) => a.start - b.start)) {
    if (!cue || typeof cue.id !== 'string' || ids.has(cue.id) || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 200 || !finite(cue.start, 0, total) || !finite(cue.duration, 1, total) || cue.start < previousEnd || cue.start + cue.duration > total) invalid('字幕时间范围重叠、超出成片或文本过长');
    ids.add(cue.id); previousEnd = cue.start + cue.duration;
  }
  return normalized;
}

export function subtitleSrt(timeline: AIGCTimeline) {
  const time = (frame: number) => {
    const ms = Math.round(frame / 30 * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return (timeline.subtitles || []).map((cue, index) => `${index + 1}\n${time(cue.start)} --> ${time(cue.start + cue.duration)}\n${cue.text.replace(/\r/g, '').replace(/\n\n+/g, '\n')}\n`).join('\n');
}

export async function renderTimeline(timeline: AIGCTimeline, media: AigcEditorMedia[], aspect: string, options: ExportEditorDto, signal: AbortSignal, progress: (value: number) => Promise<void>, storage: StorageService = new StorageService()) {
  const directory = await mkdtemp(join(tmpdir(), 'aigc-editor-'));
  const name = `editor-export-${randomUUID()}.${options.outputFormat}`;
  const output = join(EDITOR_ROOT, name);
  const seconds = (frames: number) => (frames / 30).toFixed(6);
  const encode = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-threads', '2', '-movflags', '+faststart'];
  try {
    await mkdir(EDITOR_ROOT, { recursive: true });
    const [aw, ah] = aspect.split(':').map(Number);
    const ratio = aw > 0 && ah > 0 ? aw / ah : 16 / 9;
    const size = { '480p': 480, '720p': 720, '1080p': 1080 }[options.resolution];
    const width = Math.round((ratio >= 1 ? size * ratio : size) / 2) * 2;
    const height = Math.round((ratio >= 1 ? size : size / ratio) / 2) * 2;
    const byId = new Map(media.map(item => [item.id, item]));
    const files = new Map<string, string>();
    for (const item of media) files.set(item.id, item.url.startsWith('/uploads/aigc/') ? await localMediaPath(item.url) : (await copyEditorMedia(item.url, item.kind, signal, directory, storage)).path);
    const segments: Array<{ path: string, frames: number, transition: string, overlap: number }> = [];
    for (let index = 0; index < timeline.clips.length; index++) {
      signal.throwIfAborted();
      const clip = timeline.clips[index];
      if (clip.gap_before > 0) {
        const gap = join(directory, `gap-${index}.mp4`);
        await ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=30`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', seconds(clip.gap_before), ...encode, gap], signal);
        segments.push({ path: gap, frames: clip.gap_before, transition: 'cut', overlap: 0 });
      }
      const source = byId.get(clip.shot_id)!;
      const frames = timelineOutputDuration(clip);
      const path = join(directory, `clip-${index}.mp4`);
      const speed = clip.speed || 1;
      const args = ['-ss', seconds(clip.source_start), '-t', seconds(clip.duration), '-i', files.get(source.id)!];
      if (!source.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      args.push('-map', '0:v:0', '-map', source.hasAudio ? '0:a:0' : '1:a:0', '-vf', `setpts=(PTS-STARTPTS)/${speed},fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`, '-af', `asetpts=PTS-STARTPTS,atempo=${speed},volume=${clip.muted ? 0 : clip.volume},aresample=48000,apad,atrim=duration=${seconds(frames)}`, '-t', seconds(frames), ...encode, path);
      await ffmpeg(args, signal);
      segments.push({ path, frames, transition: clip.transition, overlap: clip.transition_duration });
      await progress(5 + Math.round((index + 1) / timeline.clips.length * 60));
    }
    const joined = join(directory, 'joined.mp4');
    const args: string[] = [];
    const filters: string[] = [];
    segments.forEach((segment, index) => { args.push('-i', segment.path); filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`, `[${index}:a]asetpts=PTS-STARTPTS[a${index}]`); });
    let video = 'v0', audio = 'a0', currentFrames = segments[0].frames;
    for (let index = 1; index < segments.length; index++) {
      const previous = segments[index - 1];
      if (previous.overlap > 0 && previous.transition !== 'cut') {
        filters.push(`[${video}][v${index}]xfade=transition=${previous.transition}:duration=${seconds(previous.overlap)}:offset=${seconds(currentFrames - previous.overlap)}[cv${index}]`, `[${audio}][a${index}]acrossfade=d=${seconds(previous.overlap)}:c1=tri:c2=tri[ca${index}]`);
      } else filters.push(`[${video}][${audio}][v${index}][a${index}]concat=n=2:v=1:a=1[cv${index}][ca${index}]`);
      currentFrames += segments[index].frames - previous.overlap;
      video = `cv${index}`; audio = `ca${index}`;
    }
    await ffmpeg([...args, '-filter_complex', filters.join(';'), '-map', `[${video}]`, '-map', `[${audio}]`, ...encode, joined], signal);
    await progress(80);
    const total = timelineDuration(timeline);
    const mixArgs = ['-i', joined];
    const mixFilters = [`[0:a]apad,atrim=duration=${seconds(total)}[baseaudio]`];
    const labels = ['[baseaudio]'];
    timeline.audio_tracks.forEach((track, index) => {
      mixArgs.push('-i', files.get(track.media_id || '')!);
      const duration = timelineOutputDuration(track);
      mixFilters.push(`[${index + 1}:a]atrim=start=${seconds(track.source_start)}:duration=${seconds(track.duration)},asetpts=PTS-STARTPTS,atempo=${track.speed || 1},volume=${track.muted ? 0 : track.volume},afade=t=in:st=0:d=${seconds(track.fade_in)},afade=t=out:st=${seconds(Math.max(0, duration - track.fade_out))}:d=${seconds(track.fade_out)},adelay=${Math.round(track.start / 30 * 1000)}:all=1[m${index}]`);
      labels.push(`[m${index}]`);
    });
    mixFilters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.95,atrim=duration=${seconds(total)}[aout]`);
    if (options.outputFormat === 'mp4') {
      const vf = [`tpad=stop_mode=add:stop_duration=${seconds(Math.max(0, total - currentFrames))}`, `trim=duration=${seconds(total)}`];
      if (options.burnSubtitles && timeline.subtitles?.length) {
        const path = join(directory, 'captions.srt');
        await writeFile(path, subtitleSrt(timeline));
        vf.push(`subtitles=filename='${path}':force_style='FontName=Arial,FontSize=24'`);
      }
      if (options.watermark?.trim()) {
        const path = join(directory, 'watermark.txt');
        await writeFile(path, options.watermark.trim());
        vf.push(`drawtext=textfile='${path}':expansion=none:fontcolor=white@0.7:fontsize=${Math.max(16, Math.round(height / 28))}:x=w-tw-20:y=h-th-20`);
      }
      mixFilters.push(`[0:v]${vf.join(',')}[vout]`);
      await ffmpeg([...mixArgs, '-filter_complex', mixFilters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', seconds(total), ...encode, output], signal);
    } else await ffmpeg([...mixArgs, '-filter_complex', mixFilters.join(';'), '-map', '[aout]', '-vn', '-t', seconds(total), '-c:a', 'libmp3lame', '-b:a', '192k', output], signal);
    signal.throwIfAborted();
    return `/uploads/aigc/${name}`;
  } catch (error) { await unlink(output).catch(() => {}); throw error; }
  finally { await rm(directory, { recursive: true, force: true }); }
}
