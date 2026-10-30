import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveScriptDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(200) genre?: string;
  @IsOptional() @IsString() @MaxLength(1000) style?: string;
  @IsString() @MaxLength(100000) content!: string;
}

export class ExtractScriptDto {
  @IsIn(['character', 'scene', 'prop']) kind!: 'character' | 'scene' | 'prop';
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsIn(['1:1', '16:9', '9:16', '4:3', '3:4']) aspectRatio?: string;
}
