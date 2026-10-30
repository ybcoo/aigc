import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { EDITOR_ROOT } from './editor.media';
import { EditorService } from './editor.service';
import { ExportEditorDto, ImportEditorDto, SaveEditorDto } from './editor.dto';

mkdirSync(EDITOR_ROOT, { recursive: true });
@Controller('projects/:projectId/episodes/:episode/editor')
export class EditorController {
  constructor(private readonly editor: EditorService) {}
  @Get()
  async get(@Param('projectId') id: string, @Param('episode', ParseIntPipe) episode: number) { return { data: await this.editor.get(id, episode) }; }
  @Put()
  async save(@Param('projectId') id: string, @Param('episode', ParseIntPipe) episode: number, @Body() input: SaveEditorDto) { return { data: await this.editor.save(id, episode, input) }; }
  @Post('import')
  async import(@Param('projectId') id: string, @Param('episode', ParseIntPipe) episode: number, @Body() input: ImportEditorDto) { return { data: await this.editor.importNode(id, episode, input) }; }
  @Post('media/:kind')
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: EDITOR_ROOT, filename: (_request, file, callback) => callback(null, `editor-upload-${randomUUID()}${extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(@Param('projectId') id: string, @Param('episode', ParseIntPipe) episode: number, @Param('kind') kind: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file || !['video', 'audio'].includes(kind)) { if (file) await unlink(file.path).catch(() => {}); throw new BadRequestException('请选择有效的视频或音频文件'); }
    return { data: await this.editor.upload(id, episode, file, kind as 'video' | 'audio') };
  }
  @Post('exports')
  async export(@Param('projectId') id: string, @Param('episode', ParseIntPipe) episode: number, @Body() input: ExportEditorDto) { return { data: await this.editor.export(id, episode, input) }; }
  @Post('exports/:jobId/cancel')
  async cancel(@Param('projectId') id: string, @Param('jobId') jobId: string) { return { data: await this.editor.cancel(id, jobId) }; }
}
