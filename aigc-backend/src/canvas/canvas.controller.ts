import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { CanvasService } from './canvas.service';
import { CreateLinkDto, CreateProjectDto, ImportScriptDto, SaveLayoutDto, SaveNodeDto, UpdateProjectDto } from './canvas.dto';
import { StorageService } from '../storage/storage.service';
import { SCRIPT_IMPORT_MAX_BYTES } from './script-import';

const uploadRoot = join(process.cwd(), 'uploads', 'aigc');
mkdirSync(uploadRoot, { recursive: true });

@Controller('projects')
export class CanvasController {
  constructor(private readonly canvas: CanvasService, @Optional() private readonly storage: StorageService = new StorageService()) {}

  private async persistUpload(file: Express.Multer.File, attach: (url: string) => Promise<unknown>) {
    let url: string | undefined, saved = false;
    try {
      url = await this.storage.publishFile(file.path, AbortSignal.timeout(120000));
      const data = await attach(url); saved = true; return { data };
    } catch (error) { if (url) await this.storage.remove(url).catch(() => {}); throw error; }
    finally { if (!saved || url !== `/uploads/aigc/${file.filename}`) await unlink(file.path).catch(() => {}); }
  }

  @Get()
  async listProjects() {
    return { data: await this.canvas.listProjects() };
  }

  @Post()
  async createProject(@Body() input: CreateProjectDto) {
    return { data: await this.canvas.createProject(input) };
  }

  @Post('import-script')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: SCRIPT_IMPORT_MAX_BYTES, files: 1, fields: 10 } }))
  async importScript(@UploadedFile() file: Express.Multer.File | undefined, @Body() input: ImportScriptDto, @Res({ passthrough: true }) response: Response, @Query('preview') preview?: string) {
    if (!file) throw new BadRequestException('请选择 TXT 文件');
    if (preview !== undefined && !['true', 'false'].includes(preview)) throw new BadRequestException('预览参数无效');
    const data = await this.canvas.importScript(file.originalname, file.buffer, input, preview === 'true');
    response.status(preview === 'true' ? 200 : 201);
    return { data };
  }

  @Put(':projectId')
  async updateProject(@Param('projectId') projectId: string, @Body() input: UpdateProjectDto) {
    return { data: await this.canvas.updateProject(projectId, input) };
  }

  @Delete(':projectId')
  async deleteProject(@Param('projectId') projectId: string) {
    return { data: await this.canvas.deleteProject(projectId) };
  }

  @Post(':projectId/episodes')
  async createEpisode(@Param('projectId') projectId: string) {
    return { data: await this.canvas.createEpisode(projectId) };
  }

  @Get(':projectId/canvas')
  async getCanvas(
    @Param('projectId') projectId: string,
    @Query('episode', new ParseIntPipe({ optional: true })) episode = 1,
  ) {
    return { data: await this.canvas.getCanvas(projectId, episode) };
  }

  @Post(':projectId/nodes/:kind')
  async createNode(@Param('projectId') projectId: string, @Param('kind') kind: string, @Body() input: SaveNodeDto) {
    return { data: await this.canvas.createNode(projectId, kind, input) };
  }

  @Put(':projectId/nodes/:kind/:nodeId')
  async updateNode(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Param('nodeId') nodeId: string,
    @Body() input: SaveNodeDto,
  ) {
    return { data: await this.canvas.updateNode(projectId, kind, nodeId, input) };
  }

  @Delete(':projectId/nodes/:kind/:nodeId')
  async deleteNode(@Param('projectId') projectId: string, @Param('kind') kind: string, @Param('nodeId') nodeId: string, @Query('episode', new ParseIntPipe({ optional: true })) episode?: number) {
    return { data: await this.canvas.deleteNode(projectId, kind, nodeId, episode) };
  }

  @Post(':projectId/links')
  async createLink(@Param('projectId') projectId: string, @Body() input: CreateLinkDto) {
    return { data: await this.canvas.createLink(projectId, input) };
  }

  @Delete(':projectId/links/:linkId')
  async deleteLink(@Param('projectId') projectId: string, @Param('linkId') linkId: string) {
    return { data: await this.canvas.deleteLink(projectId, linkId) };
  }

  @Put(':projectId/layout')
  async saveLayout(@Param('projectId') projectId: string, @Body() input: SaveLayoutDto) {
    return { data: await this.canvas.saveLayout(projectId, input) };
  }

  @Post(':projectId/nodes/:kind/:nodeId/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadRoot,
      filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 100 * 1024 * 1024 },
  }))
  async upload(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Param('nodeId') nodeId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) return { data: null };
    return this.persistUpload(file, url => this.canvas.attachUpload(projectId, kind, nodeId, url));
  }

  @Get(':projectId/nodes/:kind/:nodeId/versions')
  async listVersions(@Param('projectId') projectId: string, @Param('kind') kind: string, @Param('nodeId') nodeId: string) {
    return { data: await this.canvas.listMediaVersions(projectId, kind, nodeId) };
  }

  @Post(':projectId/nodes/:kind/:nodeId/references/:referenceKind')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({ destination: uploadRoot, filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`) }),
    limits: { fileSize: 100 * 1024 * 1024 },
  }))
  async uploadReference(@Param('projectId') projectId: string, @Param('kind') kind: string, @Param('nodeId') nodeId: string, @Param('referenceKind') referenceKind: string, @UploadedFile() file?: Express.Multer.File, @Query('episode', new ParseIntPipe({ optional: true })) episode?: number) {
    if (!file) return { data: null };
    return this.persistUpload(file, url => this.canvas.attachReference(projectId, kind, nodeId, referenceKind, url, file.originalname, episode));
  }

  @Post(':projectId/nodes/:kind/:nodeId/versions/:versionId/restore')
  async restoreVersion(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Param('nodeId') nodeId: string,
    @Param('versionId') versionId: string,
  ) {
    return { data: await this.canvas.restoreMediaVersion(projectId, kind, nodeId, versionId) };
  }
}
