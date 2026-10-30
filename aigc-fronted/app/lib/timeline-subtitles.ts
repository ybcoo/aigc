// Ported from aiedu-lab's existing timeline implementation.
const uuid = (): string => crypto.randomUUID();
import type { TimelineShot as AIGCShot } from '../types/timeline';
import type { TimelineClip, TimelineSubtitle } from '../types/timeline';
import { TIMELINE_FPS as FPS } from '../types/timeline';

export const MAX_TIMELINE_SUBTITLES = 500;
export const MAX_SUBTITLE_TEXT = 200;

const BRACKET_SPEECH_LABEL = /^\s*[([（【]\s*(?:旁白|解说|画外音|对白|角色对白|voice[- ]?over|narration)\s*[)\]）】]\s*[：:]?\s*/i;
const SPEECH_LABEL = /[\p{Script=Han}A-Za-z0-9·_-]{1,16}(?:\s*[(（][^()（）\n]{0,20}[)）])?\s*[：:]\s*/gu;

/** Remove script-only speaker/type labels before text enters the caption track. */
export function cleanTimelineSubtitleText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(BRACKET_SPEECH_LABEL, '').replace(SPEECH_LABEL, '\n')
    .split('\n')
    .map(part => part.trim().replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』]+$/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

export function normalizeSubtitles(cues: TimelineSubtitle[], total: number): TimelineSubtitle[] {
  return cues.filter(cue => cue.start < total).map(cue => ({ ...cue, duration: Math.min(cue.duration, total - cue.start) }))
    .sort((a, b) => a.start - b.start);
}

export function subtitleBounds(cues: TimelineSubtitle[], id: string, total: number): { min: number; max: number } {
  const ordered = [...cues].sort((a, b) => a.start - b.start);
  const index = ordered.findIndex(cue => cue.id === id);
  const previous = ordered[index - 1];
  return { min: previous ? previous.start + previous.duration : 0, max: ordered[index + 1]?.start ?? total };
}

export function nextSubtitleSlot(cues: TimelineSubtitle[], frame: number, total: number): { start: number; duration: number } | null {
  let start = Math.max(0, Math.round(frame));
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    if (cue.start + cue.duration <= start) continue;
    if (cue.start > start) return { start, duration: Math.min(3 * FPS, cue.start - start, total - start) };
    start = cue.start + cue.duration;
  }
  return start < total ? { start, duration: Math.min(3 * FPS, total - start) } : null;
}

export function dragSubtitle(cues: TimelineSubtitle[], id: string, edge: 'head' | 'tail' | 'body', delta: number, total: number): TimelineSubtitle[] {
  const cue = cues.find(item => item.id === id);
  if (!cue || !Number.isFinite(delta)) return cues;
  const bounds = subtitleBounds(cues, id, total);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const step = Math.round(delta);
  let { start, duration } = cue;
  if (edge === 'body') start = clamp(start + step, bounds.min, bounds.max - duration);
  else if (edge === 'head') {
    const end = start + duration;
    start = clamp(start + step, bounds.min, end - 1);
    duration = end - start;
  } else duration = clamp(duration + step, 1, bounds.max - start);
  if (start === cue.start && duration === cue.duration) return cues;
  return cues.map(item => item.id === id ? { ...item, start, duration } : item);
}

export function dialogueSubtitles(rows: { clip: TimelineClip; start: number; end: number }[], shots: AIGCShot[]): TimelineSubtitle[] | null {
  const byID = new Map(shots.map(shot => [shot.id, cleanTimelineSubtitleText(shot.spoken_dialogue?.trim() || shot.dialogue?.trim() || '')]));
  const cues: TimelineSubtitle[] = [];
  for (const row of rows) {
    const text = Array.from(byID.get(row.clip.shot_id) || '');
    if (!text.length) continue;
    const duration = row.end - row.start - row.clip.transition_duration;
    const count = Math.ceil(text.length / MAX_SUBTITLE_TEXT);
    if (count > duration || cues.length + count > MAX_TIMELINE_SUBTITLES) return null;
    for (let i = 0; i < count; i++) {
      const start = row.start + Math.floor(duration * i / count);
      const end = row.start + Math.floor(duration * (i + 1) / count);
      cues.push({ id: uuid(), start, duration: end - start, text: text.slice(i * MAX_SUBTITLE_TEXT, (i + 1) * MAX_SUBTITLE_TEXT).join('') });
    }
  }
  return cues;
}

