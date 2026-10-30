import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateNodeDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) episodeNumber?: number;
  @IsString() prompt!: string;
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsIn(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']) aspectRatio?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(30) duration?: number;
  @IsOptional() @IsIn(['480p', '720p', '1080p']) resolution?: string;
}
