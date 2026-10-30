import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { GenerationService } from './generation.service';
import { GenerateNodeDto } from './generation.dto';

@Controller('projects/:projectId')
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}
  @Post('nodes/:kind/:nodeId/generate')
  async create(@Param('projectId') projectId: string, @Param('kind') kind: string, @Param('nodeId') nodeId: string, @Body() input: GenerateNodeDto) { return { data: await this.generation.create(projectId, kind, nodeId, input) }; }
  @Get('jobs')
  async list(@Param('projectId') projectId: string) { return { data: await this.generation.list(projectId) }; }
  @Get('jobs/:jobId')
  async get(@Param('projectId') projectId: string, @Param('jobId') jobId: string) { return { data: await this.generation.get(projectId, jobId) }; }
  @Post('jobs/:jobId/cancel')
  async cancel(@Param('projectId') projectId: string, @Param('jobId') jobId: string) { return { data: await this.generation.cancel(projectId, jobId) }; }
}
