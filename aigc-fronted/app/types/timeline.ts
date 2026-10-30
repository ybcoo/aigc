// Ported from aiedu-lab's existing timeline implementation.
// 时间线帧率必须与素材帧率一致（上游出片是 30fps）：不一致会让裁切点对不齐原片帧，
// 导出还要做 30→24 重采样（画面一顿一顿）。老草稿（fps 缺省/24）在读取时按 30/24 换算。
export const TIMELINE_FPS = 30;
/** 历史草稿的帧率，只用于换算。 */
export const LEGACY_TIMELINE_FPS = 24;
export const TIMELINE_TRANSITIONS = [
  'cut', 'fade', 'dissolve', 'fadeblack', 'fadewhite',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circleopen', 'hblur', 'zoomin',
] as const;
export type TimelineTransition = typeof TIMELINE_TRANSITIONS[number];

/**
 * 片段特效（对齐剪映"特效"）：只在片段内部做视觉处理，**不改变片段长度**——
 * 这是和转场的本质区别（转场靠两段重叠实现，会吃掉两段各一部分）。
 */
export type TimelineEffect = '' | 'shake' | 'zoom' | 'spin' | 'flash' | 'blur' | 'glow' | 'retro' | 'mono' | 'neon' | 'glitch' | 'storm' | 'pulse' | 'fadeblack';
export const TIMELINE_EFFECTS = ['shake', 'zoom', 'spin', 'flash', 'blur', 'glow', 'retro', 'mono', 'neon', 'glitch', 'storm', 'pulse', 'fadeblack'] as const;
/** 上一版的特效名（风雪/雨滴）已合并为 storm：老草稿读取时归一化到新名字。 */
export const LEGACY_TIMELINE_EFFECTS: Record<string, TimelineEffect> = { snow: 'storm', rain: 'storm' };
export const TIMELINE_SPEED_MIN = 0.5;
export const TIMELINE_SPEED_MAX = 2;
export const TIMELINE_SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;


export interface TimelineClip {
  id: string;
  shot_id: string;
  /** 本片段前面保留的空白帧数（主轨允许留空隙，对齐剪映的自由裁剪）。 */
  gap_before: number;
  source_start: number;
  /** 播放倍速；旧草稿缺省时按 1x 处理。duration 始终表示消耗的源素材帧数。 */
  speed?: number;
  duration: number;
  volume: number;
  muted: boolean;
  transition: TimelineTransition;
  transition_duration: number;
  /** 片段特效（空字符串 = 无特效），不改变片段长度 */
  effect: TimelineEffect;
}

export interface TimelineAudio {
  media_id?: string;
  id: string;
  shot_id: string;
  source: 'audio' | 'video' | 'upload';
  start: number;
  source_start: number;
  /** 播放倍速；旧草稿缺省时按 1x 处理。duration 始终表示消耗的源素材帧数。 */
  speed?: number;
  duration: number;
  volume: number;
  muted: boolean;
  fade_in: number;
  fade_out: number;
  /** 整集解说轨标记（后端合成的那一条）：重新合成时按它替换旧轨，避免越插越多。 */
  role?: 'narration';
}

/** 自动维护音轨的返回：rebuilt=false 表示这次什么都没改。 */
export interface TimelineAudioSync {
  rebuilt: boolean;
  draft: TimelineDraft;
}

export interface AIGCTimeline {
  version: 1;
  /** 时间线帧率（当前恒为 30）；缺省/24 表示 24fps 时代的老草稿，需要按 30/24 换算。 */
  fps?: number;
  clips: TimelineClip[];
  audio_tracks: TimelineAudio[];
  /** Missing/null retains legacy dialogue subtitles; [] explicitly clears them. */
  subtitles?: TimelineSubtitle[] | null;
}

export interface TimelineSubtitle {
  id: string;
  start: number;
  duration: number;
  text: string;
}

export interface TimelineDraft {
  audio_sources: TimelineAudioSource[];
  timeline: AIGCTimeline | null;
  revision: number;
  updated_at: string;
}

export interface TimelineAudioSource {
  id: string;
  name: string;
  duration: number;
  url: string;
  created_at: string;
}

export type TimelineAutoEditSubtitleMode = 'auto' | 'always' | 'none';

export interface TimelineAutoEditDecision {
  shot_id: string;
  title: string;
  transition: TimelineTransition;
  transition_duration: number;
  keep_original_audio: boolean;
  subtitle_source: 'spoken_dialogue' | 'narration' | 'none';
  subtitle_text: string;
  reason: string;
}

export interface TimelineAutoEditPlan {
  timeline: AIGCTimeline;
  summary: string;
  subtitle_reason: string;
  decisions: TimelineAutoEditDecision[];
}

export interface TimelineShot { id: string; trim_start: number; duration: number; muted: boolean; video_url: string; audio_url?: string; dialogue?: string; spoken_dialogue?: string }

