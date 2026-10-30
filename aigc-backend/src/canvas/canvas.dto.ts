import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  textModelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  scriptContent?: string;

  @IsOptional()
  @IsIn(['16:9', '9:16', '1:1'])
  aspectRatio?: string;

  @IsOptional()
  @IsString()
  storySummary?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  episodeCount?: number;
}

export class UpdateProjectDto {
  @IsString()
  @MaxLength(120)
  title!: string;
}

export class ImportScriptDto extends CreateProjectDto {
  @IsOptional()
  @IsIn(['auto', 'utf-8', 'gb18030', 'utf-16le', 'utf-16be'])
  encoding?: string;
}

export class SaveNodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  episodeNumber?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  appearance?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  sourceScript?: string;

  @IsOptional()
  @IsString()
  storyboardScript?: string;

  @IsOptional()
  @IsString()
  universalPrompt?: string;

  @IsOptional()
  @IsString()
  dialogue?: string;

  @IsOptional()
  @IsString()
  shotType?: string;

  @IsOptional()
  @IsString()
  movement?: string;

  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  duration?: number;

  @IsOptional()
  @IsString()
  videoResolution?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  audioUrl?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assetIds?: string[];
}

export class CreateLinkDto {
  @IsInt()
  @Min(1)
  episodeNumber!: number;

  @IsString()
  sourceKind!: string;

  @IsString()
  sourceId!: string;

  @IsString()
  targetKind!: string;

  @IsString()
  targetId!: string;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}

export class LayoutNodeDto {
  @IsString()
  nodeId!: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;
}

export class SaveLayoutDto {
  @IsInt()
  @Min(1)
  episodeNumber!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayoutNodeDto)
  nodes!: LayoutNodeDto[];
}
