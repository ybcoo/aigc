import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { AIGCTimeline } from './timeline.types';

export class SaveEditorDto {
  @IsObject() timeline: AIGCTimeline;
  @IsInt() @Min(0) revision: number;
}
export class ImportEditorDto {
  @IsIn(['video', 'audio']) kind: 'video' | 'audio';
  @IsUUID() nodeId: string;
}
export class ExportEditorDto {
  @IsObject() timeline: AIGCTimeline;
  @IsIn(['mp4', 'mp3']) outputFormat: 'mp4' | 'mp3';
  @IsIn(['480p', '720p', '1080p']) resolution: '480p' | '720p' | '1080p';
  @IsOptional() @IsBoolean() burnSubtitles?: boolean;
  @IsOptional() @IsString() @MaxLength(80) watermark?: string;
}
