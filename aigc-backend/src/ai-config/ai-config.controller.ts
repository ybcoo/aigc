import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AIConfigService } from './ai-config.service';
import { DiscoverModelsDto, PreviewSpeechDto, SaveAIConfigDto, TestAIConfigDto } from './ai-config.dto';

@Controller('ai-configs')
export class AIConfigController {
  constructor(private readonly aiConfigs: AIConfigService) {}

  @Get()
  async list() {
    return { data: await this.aiConfigs.list() };
  }

  @Post()
  async create(@Body() input: SaveAIConfigDto) {
    return { data: await this.aiConfigs.create(input) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() input: SaveAIConfigDto) {
    return { data: await this.aiConfigs.update(id, input) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { data: await this.aiConfigs.remove(id) };
  }

  @Post('models')
  async discoverModels(@Body() input: DiscoverModelsDto) {
    return { data: { models: await this.aiConfigs.discoverModels(input) } };
  }

  @Post(':id/test')
  async test(@Param('id') id: string, @Body() input: TestAIConfigDto) {
    return { data: await this.aiConfigs.test(id, input.message) };
  }

  @Post('tts-preview')
  async previewSpeech(@Body() input: PreviewSpeechDto, @Res() response: Response) {
    const audio = await this.aiConfigs.previewSpeech(input);
    response.setHeader('Content-Type', audio.contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.send(audio.buffer);
  }
}
