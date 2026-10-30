import type { AIGCTimeline } from './timeline'
import type { Project } from './canvas'
export interface EditorMedia { id: string, name: string, kind: 'video' | 'audio', url: string, duration: number, width: number, height: number, hasAudio: boolean }
export interface EditorCandidate { id: string, name: string, kind: 'video' | 'audio', url: string, mediaId?: string, dialogue?: string }
export interface EditorData { project: Project, timeline: AIGCTimeline | null, revision: number, media: EditorMedia[], candidates: EditorCandidate[] }
export interface EditorExportOptions { outputFormat: 'mp4' | 'mp3', resolution: '480p' | '720p' | '1080p', burnSubtitles: boolean, watermark: string }
