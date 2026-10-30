// Ported from aiedu-lab's existing timeline implementation.
import type { TimelineShot as AIGCShot } from './timeline.types';
const uuid = (): string => crypto.randomUUID();
import type { AIGCTimeline, TimelineAudio, TimelineClip, TimelineEffect } from './timeline.types';
import { LEGACY_TIMELINE_EFFECTS, LEGACY_TIMELINE_FPS, TIMELINE_EFFECTS, TIMELINE_FPS as FPS, TIMELINE_SPEED_MAX, TIMELINE_SPEED_MIN } from './timeline.types';
import { dragSubtitle, MAX_TIMELINE_SUBTITLES, normalizeSubtitles } from './timeline.subtitles';

export const timelineID = (): string => uuid();
export const secondsToFrames = (seconds: number): number => Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * FPS));
export const frameTime = (frame: number): string => `${Math.floor(frame / FPS / 60).toString().padStart(2, '0')}:${Math.floor(frame / FPS % 60).toString().padStart(2, '0')}:${Math.floor(frame % FPS).toString().padStart(2, '0')}`;
export const timelineSpeed = (item: Pick<TimelineClip | TimelineAudio, 'speed'>): number => {
  const speed = item.speed || 1;
  return Number.isFinite(speed) ? Math.max(TIMELINE_SPEED_MIN, Math.min(TIMELINE_SPEED_MAX, speed)) : 1;
};
/** duration 保存源素材帧数；时间线显示/输出时长需要除以倍速。 */
export const timelineOutputDuration = (item: Pick<TimelineClip | TimelineAudio, 'duration' | 'speed'>): number => Math.max(1, Math.round(item.duration / timelineSpeed(item)));
export const timelineSourceDuration = (outputFrames: number, item: Pick<TimelineClip | TimelineAudio, 'speed'>): number => Math.max(1, Math.round(outputFrames * timelineSpeed(item)));

export function clipFromShot(shot: AIGCShot): TimelineClip {
  return { id: timelineID(), shot_id: shot.id, gap_before: 0, source_start: secondsToFrames(shot.trim_start), speed: 1, duration: Math.max(1, secondsToFrames(shot.duration || 5)), volume: 1, muted: shot.muted, transition: 'cut', transition_duration: 0, effect: '' };
}

export function initialTimeline(shots: AIGCShot[]): AIGCTimeline {
  const timeline: AIGCTimeline = { version: 1, fps: FPS, clips: shots.filter(s => s.video_url).slice(0, 100).map(clipFromShot), audio_tracks: [] };
  timeline.audio_tracks = timelineLayout(timeline).filter(row => shots.find(s => s.id === row.clip.shot_id)?.audio_url).slice(0, 32).map(row => ({
    id: timelineID(), shot_id: row.clip.shot_id, source: 'audio', start: row.start, source_start: 0, speed: 1, duration: row.clip.duration, volume: 1, muted: row.clip.muted, fade_in: 0, fade_out: 0,
  }));
  return timeline;
}

/** Drop legacy timeline clips whose source shot does not have a generated video. */
export function timelineWithAvailableVideos(timeline: AIGCTimeline, shots: AIGCShot[]): AIGCTimeline {
  const videoShotIDs = new Set(shots.filter(shot => shot.video_url).map(shot => shot.id));
  if (timeline.clips.every(clip => videoShotIDs.has(clip.shot_id))) return timeline;
  return normalizeTimeline({ ...timeline, clips: timeline.clips.filter(clip => videoShotIDs.has(clip.shot_id)) });
}

/**
 * 每个片段的绝对位置：起点 = 上一段结尾 + 本段空隙 − 上一段的转场重叠。
 * 空隙与转场互斥（normalizeTimeline 会保证），所以一段要么是首尾相接带重叠、要么中间隔一段黑场。
 */
export function timelineLayout(timeline: AIGCTimeline): { clip: TimelineClip; start: number; end: number }[] {
  const rows: { clip: TimelineClip; start: number; end: number }[] = [];
  let end = 0;
  timeline.clips.forEach((clip, index) => {
    const previous = timeline.clips[index - 1];
    const start = end + (clip.gap_before || 0) - (previous ? previous.transition_duration : 0);
    end = start + timelineOutputDuration(clip);
    rows.push({ clip, start, end });
  });
  return rows;
}

/** 新增音频优先对齐选中的视频片段；未选视频时才使用播放头。 */
export function timelineAudioInsertStart(timeline: AIGCTimeline, selectedID: string, playhead: number): number {
  const selected = timelineLayout(timeline).find(row => row.clip.id === selectedID);
  return Math.max(0, Math.min(TIMELINE_MAX_TOTAL_FRAMES - 1, selected?.start ?? playhead));
}

export function timelineVideoDuration(timeline: AIGCTimeline): number {
  return timeline.clips.reduce((sum, clip) => sum + (clip.gap_before || 0) + timelineOutputDuration(clip) - clip.transition_duration, 0);
}

/** 编辑时间线长度取视频主轨和音轨的最晚结束点。 */
export function timelineDuration(timeline: AIGCTimeline): number {
  return Math.max(timelineVideoDuration(timeline), ...timeline.audio_tracks.map(track => track.start + timelineOutputDuration(track)), 0);
}

/** 某个片段起点允许的最小值：贴着上一段（扣掉上一段转场重叠），空隙不能再小。 */
export function timelineClipStartFloor(timeline: AIGCTimeline, index: number): number {
  const previous = timeline.clips[index - 1];
  if (!previous) return 0;
  return timelineLayout(timeline)[index - 1].end - previous.transition_duration;
}

/**
 * 把 24fps 时代的时间线换算到当前帧率（30fps）并补齐 fps 字段；已是当前帧率时原样返回。
 *
 * 后端在读取草稿时也会换算，这里是给"浏览器里缓存的本地未保存版本"兜底：
 * 服务端与本地版本混用时不能出现两套帧号口径。
 */
export function timelineAtCurrentFPS(timeline: AIGCTimeline): AIGCTimeline {
  if (timeline.fps === FPS) return timeline;
  const scale = (value: number) => Math.max(0, Math.round((value || 0) * FPS / LEGACY_TIMELINE_FPS));
  const scaleDuration = (value: number) => Math.max(1, scale(value));
  return {
    ...timeline,
    fps: FPS,
    clips: timeline.clips.map(clip => ({ ...clip, gap_before: scale(clip.gap_before || 0), source_start: scale(clip.source_start), duration: scaleDuration(clip.duration), transition_duration: scale(clip.transition_duration) })),
    audio_tracks: timeline.audio_tracks.map(track => ({ ...track, start: scale(track.start), source_start: scale(track.source_start), duration: scaleDuration(track.duration), fade_in: scale(track.fade_in), fade_out: scale(track.fade_out) })),
    ...(timeline.subtitles == null ? {} : { subtitles: timeline.subtitles.map(cue => ({ ...cue, start: scale(cue.start), duration: scaleDuration(cue.duration) })) }),
  };
}

export function normalizeTimeline(input: AIGCTimeline): AIGCTimeline {
  const timeline = timelineAtCurrentFPS(input);
  const clips = timeline.clips.map((clip, i, all) => {
    const next = all[i + 1];
    const overlap = clip.transition === 'cut' || !next ? 0 : Math.min(48, clip.transition_duration, Math.floor(timelineOutputDuration(clip) / 2), Math.floor(timelineOutputDuration(next) / 2));
    return {
      ...clip,
      speed: timelineSpeed(clip),
      gap_before: Math.max(0, Math.min(TIMELINE_MAX_TOTAL_FRAMES, clip.gap_before || 0)),
      transition: overlap > 0 ? clip.transition : 'cut' as const,
      transition_duration: overlap,
      // 特效名只允许白名单内（老草稿没有该字段 → 空字符串；历史的 风雪/雨滴 归一化到 雨雪交加）
      effect: (TIMELINE_EFFECTS as readonly string[]).includes(clip.effect ? LEGACY_TIMELINE_EFFECTS[clip.effect] || clip.effect : '')
        ? ((LEGACY_TIMELINE_EFFECTS[clip.effect] || clip.effect) as TimelineEffect)
        : '' as const,
    };
  }).map((clip, i, all) => {
    // 空隙与转场互斥：下一段有空隙时，本段的转场没有重叠可言，收敛成硬切。
    const next = all[i + 1];
    return next && next.gap_before > 0 && clip.transition !== 'cut' ? { ...clip, transition: 'cut' as const, transition_duration: 0 } : clip;
  });
  const audio_tracks = timeline.audio_tracks.filter(a => a.start >= 0 && a.start < TIMELINE_MAX_TOTAL_FRAMES).map(a => {
    const speed = timelineSpeed(a);
    const maxSourceDuration = Math.max(1, Math.round((TIMELINE_MAX_TOTAL_FRAMES - a.start) * speed));
    const duration = Math.max(1, Math.min(a.duration, maxSourceDuration));
    const outputDuration = Math.max(1, Math.round(duration / speed));
    const fade_in = Math.min(a.fade_in, outputDuration);
    return { ...a, speed, duration, fade_in, fade_out: Math.min(a.fade_out, outputDuration - fade_in) };
  });
  const total = timelineDuration({ ...timeline, clips, audio_tracks });
  return { ...timeline, fps: FPS, clips, audio_tracks, ...(timeline.subtitles == null ? {} : { subtitles: normalizeSubtitles(timeline.subtitles, total) }) };
}

export function splitTimeline(timeline: AIGCTimeline, id: string, frame: number): AIGCTimeline {
  const row = timelineLayout(timeline).find(r => r.clip.id === id);
  if (row) {
    const offset = frame - row.start;
    const outputDuration = timelineOutputDuration(row.clip);
    if (offset < 1 || offset >= outputDuration || timeline.clips.length >= 100) return timeline;
    // Keep both neighboring overlaps intact; splitting inside a transition is ambiguous.
    const index = timeline.clips.findIndex(c => c.id === id);
    const incoming = timeline.clips[index - 1]?.transition_duration || 0;
    if (offset < incoming * 2 || outputDuration - offset < row.clip.transition_duration * 2) return timeline;
    const sourceOffset = Math.min(row.clip.duration - 1, timelineSourceDuration(offset, row.clip));
    return { ...timeline, clips: timeline.clips.flatMap(c => c.id !== id ? [c] : [
      { ...c, duration: sourceOffset, transition: 'cut', transition_duration: 0 },
      { ...c, id: timelineID(), gap_before: 0, source_start: c.source_start + sourceOffset, duration: c.duration - sourceOffset },
    ]) };
  }
  const subtitle = timeline.subtitles?.find(cue => cue.id === id);
  if (subtitle) {
    const offset = frame - subtitle.start;
    if (offset < 1 || offset >= subtitle.duration || (timeline.subtitles?.length || 0) >= MAX_TIMELINE_SUBTITLES) return timeline;
    return { ...timeline, subtitles: timeline.subtitles?.flatMap(cue => cue.id !== id ? [cue] : [
      { ...cue, duration: offset }, { ...cue, id: timelineID(), start: frame, duration: cue.duration - offset },
    ]) };
  }
  const audio = timeline.audio_tracks.find(a => a.id === id);
  if (!audio || timeline.audio_tracks.length >= 32) return timeline;
  const offset = frame - audio.start;
  const outputDuration = timelineOutputDuration(audio);
  if (offset < 1 || offset >= outputDuration) return timeline;
  const sourceOffset = Math.min(audio.duration - 1, timelineSourceDuration(offset, audio));
  return normalizeTimeline({ ...timeline, audio_tracks: timeline.audio_tracks.flatMap(a => a.id !== id ? [a] : [
    { ...a, duration: sourceOffset, fade_in: Math.min(a.fade_in, offset), fade_out: 0 },
    { ...a, id: timelineID(), start: frame, source_start: a.source_start + sourceOffset, duration: a.duration - sourceOffset, fade_in: 0, fade_out: Math.min(a.fade_out, outputDuration - offset) },
  ]) });
}

export function moveTimelineClip(timeline: AIGCTimeline, id: string, to: number): AIGCTimeline {
  const clips = [...timeline.clips];
  const from = clips.findIndex(c => c.id === id);
  if (from < 0 || to < 0 || to >= clips.length || from === to) return timeline;
  const [clip] = clips.splice(from, 1);
  clips.splice(to, 0, clip);
  return normalizeTimeline({ ...timeline, clips });
}

/** 设置视频/音频节点倍速；源素材范围不变，只改变它在时间线上的播放长度。 */
export function setTimelineItemSpeed(timeline: AIGCTimeline, id: string, speed: number): AIGCTimeline {
  const normalized = Math.max(TIMELINE_SPEED_MIN, Math.min(TIMELINE_SPEED_MAX, Math.round(speed * 100) / 100));
  const hasClip = timeline.clips.some(item => item.id === id);
  const hasAudio = timeline.audio_tracks.some(item => item.id === id);
  if (!hasClip && !hasAudio) return timeline;
  return normalizeTimeline({
    ...timeline,
    clips: timeline.clips.map(item => item.id === id ? { ...item, speed: normalized } : item),
    audio_tracks: timeline.audio_tracks.map(item => item.id === id ? { ...item, speed: normalized } : item),
  });
}

// ---------------------------------------------------------------------------
// 裁切（对齐剪映的两个白色把手）
//
// 视频轨是磁吸主轨：片段位置由「前一段时长 − 转场重叠」推导，所以
//   左把手 = 入点右移（source_start ↑、duration ↓，出点不动）→ 本段变短、后面整体左移；
//   右把手 = 调整时长，必要时回收裁掉的开头，范围不超过完整源素材。
// 音频轨是绝对定位：左把手连 start 一起改（出点不动），右把手只改时长，拖身体只改 start。
// 三个字段（source_start / duration / start）后端本来就支持，这里只做边界裁剪 + 吸附。
// ---------------------------------------------------------------------------

export type TimelineTrimEdge = 'head' | 'tail' | 'body';

/** 单节点时长上限：与后端 validateAIGCTimeline 的 14400 帧一致。 */
export const TIMELINE_MAX_CLIP_FRAMES = 14400;
/** 音轨/成片总长上限：30fps 下的 30 分钟。 */
export const TIMELINE_MAX_TOTAL_FRAMES = 30 * 60 * FPS;
/** 素材真实时长上限表：键见 shotSourceKey / mediaSourceKey，值是帧数；缺键表示还没探测到。 */
export type TimelineSourceFrames = Record<string, number>;

export const shotSourceKey = (shotId: string, kind: 'video' | 'audio'): string => `${shotId}:${kind}`;
export const mediaSourceKey = (mediaId: string): string => `media:${mediaId}`;

const clampFrames = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** 该视频片段的来源总帧数（实测优先，未探测到就用与后端一致的上限兜底）。 */
export function clipSourceFrames(clip: TimelineClip, sources: TimelineSourceFrames): number {
  return sources[shotSourceKey(clip.shot_id, 'video')] || TIMELINE_MAX_CLIP_FRAMES;
}

/** 该音轨的来源总帧数（上传音源用素材时长，分镜音源用实测时长）。 */
export function audioSourceFrames(track: TimelineAudio, sources: TimelineSourceFrames): number {
  const key = track.source === 'upload' ? mediaSourceKey(track.media_id || '') : shotSourceKey(track.shot_id, track.source);
  const fallback = track.source === 'upload' ? TIMELINE_MAX_TOTAL_FRAMES : TIMELINE_MAX_CLIP_FRAMES;
  return sources[key] || fallback;
}

/**
 * 把一个节点的一条边（或整体）拖 delta 帧（正数=向右）。
 *
 * 视频轨是磁吸主轨（位置由时长推导），裁切本身不产生空隙：
 *   裁头 = 入点右移 + 等量缩短 → 本段起点贴住上一段不动、结尾左移，后面的片段整体左移；
 *   裁尾 = 调整时长；尾部用完时回收裁掉的开头，最多恢复完整素材。
 *   （"拖动中首端跟手"是渲染层的临时预览，松手会按这里的结果闭合，见 TimelineTracks。）
 * 音频是绝对定位：裁头保住出点、裁尾保住入点、拖身体只改起点。
 * 结果已过 normalizeTimeline；没有实际变化时原样返回入参对象（便于按引用去重）。
 *
 * gap_before 仍然保留：面板里的「起点」可以刻意给某段前面留黑场（空隙），但裁切不会写它。
 */
export function dragTimelineNode(timeline: AIGCTimeline, id: string, edge: TimelineTrimEdge, delta: number, sources: TimelineSourceFrames): AIGCTimeline {
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  if (!step) return timeline;
  const index = timeline.clips.findIndex(item => item.id === id);
  if (index >= 0) {
    const clip = timeline.clips[index];
    const source = clipSourceFrames(clip, sources);
    const speed = timelineSpeed(clip);
    const outputDuration = timelineOutputDuration(clip);
    const replace = (change: Partial<TimelineClip>) => normalizeTimeline({
      ...timeline,
      clips: timeline.clips.map((item, i) => i === index ? { ...item, ...change } : item),
    });
    if (edge === 'head') {
      const outputShift = clampFrames(step, -Math.round(clip.source_start / speed), outputDuration - 1);
      const sourceShift = clampFrames(Math.round(outputShift * speed), -clip.source_start, clip.duration - 1);
      if (!sourceShift) return timeline;
      return replace({ source_start: clip.source_start + sourceShift, duration: clip.duration - sourceShift });
    }
    if (edge === 'tail') {
      const desiredOutput = Math.max(1, outputDuration + step);
      const duration = clampFrames(Math.round(desiredOutput * speed), 1, Math.max(1, Math.min(TIMELINE_MAX_CLIP_FRAMES, source)));
      // Extending beyond the source end restores the trimmed head, never synthetic frames.
      const source_start = Math.min(clip.source_start, source - duration);
      if (duration === clip.duration && source_start === clip.source_start) return timeline;
      return replace({ source_start, duration });
    }
    return timeline;
  }
  if (timeline.subtitles?.some(cue => cue.id === id)) {
    const subtitles = dragSubtitle(timeline.subtitles, id, edge, step, timelineDuration(timeline));
    return subtitles === timeline.subtitles ? timeline : { ...timeline, subtitles };
  }
  const track = timeline.audio_tracks.find(item => item.id === id);
  if (!track) return timeline;
  const source = audioSourceFrames(track, sources);
  const speed = timelineSpeed(track);
  const outputDuration = timelineOutputDuration(track);
  const replaceAudio = (change: Partial<TimelineAudio>) => normalizeTimeline({
    ...timeline,
    audio_tracks: timeline.audio_tracks.map(item => item.id === id ? { ...item, ...change } : item),
  });
  if (edge === 'body') {
    const start = clampFrames(track.start + step, 0, Math.max(0, TIMELINE_MAX_TOTAL_FRAMES - outputDuration));
    if (start === track.start) return timeline;
    return replaceAudio({ start });
  }
  if (edge === 'head') {
    // 出点不动：入点右移多少，起点就右移多少、时长就少多少。
    const outputShift = clampFrames(step, Math.max(-Math.round(track.source_start / speed), -track.start), outputDuration - 1);
    const sourceShift = clampFrames(Math.round(outputShift * speed), -track.source_start, track.duration - 1);
    if (!sourceShift) return timeline;
    const actualOutputShift = Math.round(sourceShift / speed);
    return replaceAudio({ start: track.start + actualOutputShift, source_start: track.source_start + sourceShift, duration: track.duration - sourceShift });
  }
  const maxOutputDuration = Math.max(1, Math.min(Math.round(source / speed), TIMELINE_MAX_TOTAL_FRAMES - track.start));
  const desiredOutput = clampFrames(outputDuration + step, 1, maxOutputDuration);
  const duration = clampFrames(Math.round(desiredOutput * speed), 1, Math.max(1, source));
  const source_start = Math.min(track.source_start, source - duration);
  if (duration === track.duration && source_start === track.source_start) return timeline;
  return replaceAudio({ source_start, duration });
}

/** 拖动时"会动的那条边"在时间线上的绝对帧：视频左把手动的是尾部（磁吸把左边贴住了）。 */
export function timelineDraggedEdgeFrame(timeline: AIGCTimeline, id: string, edge: TimelineTrimEdge): number | null {
  const row = timelineLayout(timeline).find(item => item.clip.id === id);
  // 磁吸轨：拖左把手时左边缘贴在上一段尾部，真正位移的是尾部。
  if (row) return row.end;
  const track = timeline.audio_tracks.find(item => item.id === id) || timeline.subtitles?.find(item => item.id === id);
  if (!track) return null;
  return edge === 'tail' ? track.start + ('text' in track ? track.duration : timelineOutputDuration(track)) : track.start;
}

/**
 * 吸附候选帧：0 点、播放头、以及（未被拖动的）其它节点首尾。
 * 磁吸轨上被拖片段之后的片段会跟着位移，所以只把「它之前」的片段边缘当目标。
 */
export function timelineSnapTargets(timeline: AIGCTimeline, frame: number, id: string, magneticVideo: boolean): number[] {
  const targets = [0, frame];
  const index = timeline.clips.findIndex(clip => clip.id === id);
  timelineLayout(timeline).forEach((row, i) => {
    if (row.clip.id === id) return;
    if (magneticVideo && index >= 0 && i > index) return;
    targets.push(row.start, row.end);
  });
  timeline.audio_tracks.forEach(track => {
    if (track.id === id) return;
    targets.push(track.start, track.start + timelineOutputDuration(track));
  });
  if (timeline.subtitles?.some(cue => cue.id === id)) {
    timeline.subtitles.forEach(cue => { if (cue.id !== id) targets.push(cue.start, cue.start + cue.duration); });
  }
  return targets;
}

/** 在阈值内找最近的吸附目标（阈值按像素给，换算成帧，缩放越小越容易吸）。 */
export function nearestSnapTarget(frame: number, targets: number[], zoom: number, thresholdPx = 8): number | null {
  const limit = Math.max(1, thresholdPx / Math.max(1, zoom) * FPS);
  let best: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  targets.forEach(target => {
    const current = Math.abs(target - frame);
    if (current <= limit && current < distance) { best = target; distance = current; }
  });
  return best;
}

/** 拖动 + 吸附：把"会动的边"吸到候选帧上，再按吸附后的位置重算 delta 落库。 */
export function dragTimelineNodeSnapped(
  timeline: AIGCTimeline, id: string, edge: TimelineTrimEdge, delta: number, sources: TimelineSourceFrames,
  options: { targets: number[]; zoom: number; thresholdPx?: number },
): { timeline: AIGCTimeline; snapped: number | null } {
  const dragged = dragTimelineNode(timeline, id, edge, delta, sources);
  const edgeFrame = timelineDraggedEdgeFrame(dragged, id, edge);
  if (edgeFrame === null) return { timeline: dragged, snapped: null };
  const hit = nearestSnapTarget(edgeFrame, options.targets, options.zoom, options.thresholdPx);
  if (hit === null) return { timeline: dragged, snapped: null };
  return { timeline: dragTimelineNode(timeline, id, edge, delta + (hit - edgeFrame), sources), snapped: hit };
}

