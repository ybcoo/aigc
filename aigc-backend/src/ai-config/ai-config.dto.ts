import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const aiServiceTypes = ['text', 'vision', 'image', 'storyboard_image', 'video', 'tts'] as const;

export class SaveAIConfigDto {
  @IsIn(aiServiceTypes)
  serviceType!: string;

  @IsString()
  @MaxLength(64)
  provider!: string;

  @IsString()
  @MaxLength(64)
  apiProtocol!: string;

  @IsString()
  @MaxLength(128)
  name!: string;

  @IsString()
  @MaxLength(2000)
  baseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;

  @IsArray()
  @IsString({ each: true })
  models!: string[];

  @IsString()
  @MaxLength(256)
  defaultModel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  queryEndpoint?: string;

  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority!: number;

  @IsBoolean()
  isDefault!: boolean;

  @IsBoolean()
  isActive!: boolean;

  @IsObject()
  runtimeParams!: Record<string, string>;
}

export class DiscoverModelsDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsIn(aiServiceTypes)
  serviceType?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  apiProtocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  apiKey?: string;
}

export class TestAIConfigDto {
  @IsOptional()
  @IsString()
  message?: string;
}

export class PreviewSpeechDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  voice?: string;
}
