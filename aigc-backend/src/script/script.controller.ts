import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ScriptService } from './script.service';
import { ExtractScriptDto, SaveScriptDto } from './script.dto';

@Controller('projects/:projectId/episodes/:episode/script')
export class ScriptController {
  constructor(private readonly script: ScriptService) {}
  @Get()
  async get(@Param('projectId') projectId: string, @Param('episode', ParseIntPipe) episode: number) { return { data: await this.script.get(projectId, episode) }; }
  @Put()
  async save(@Param('projectId') projectId: string, @Param('episode', ParseIntPipe) episode: number, @Body() input: SaveScriptDto) { return { data: await this.script.save(projectId, episode, input) }; }
  @Post('extract')
  async extract(@Param('projectId') projectId: string, @Param('episode', ParseIntPipe) episode: number, @Body() input: ExtractScriptDto) { return { data: await this.script.extract(projectId, episode, input) }; }
}
