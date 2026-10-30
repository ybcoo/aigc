import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { prisma } from '../../prisma/prisma.service';
import type { ExportEditorDto, ImportEditorDto, SaveEditorDto } from './editor.dto';
import { copyEditorMedia, localMediaPath, probeMedia } from './editor.media';
import { renderTimeline, validateTimeline } from './editor.render';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class EditorService implements OnModuleInit, OnModuleDestroy {
  constructor(@Optional() private readonly storage: StorageService = new StorageService()) {}
  private readonly controllers = new Map<string, AbortController>();
  private readonly imports = new Map<string, Promise<unknown>>();
  private pendingExports = 0;
  private async episode(projectId: string, episodeNumber: number) {
    const episode = await prisma.aigcEpisode.findUnique({ where: { projectId_episodeNumber: { projectId, episodeNumber } }, include: { project: true } });
    if (!episode) throw new NotFoundException('项目或分集不存在');
    return episode;
  }
  async get(projectId: string, episodeNumber: number) {
    const episode = await this.episode(projectId, episodeNumber);
    const scope = { projectId, episodeNumber };
    const [media, videos, audios] = await Promise.all([
      prisma.aigcEditorMedia.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      prisma.aigcShot.findMany({ where: { ...scope, videoUrl: { not: '' } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, videoUrl: true, dialogue: true } }),
      prisma.aigcCanvasAudioNode.findMany({ where: { ...scope, audioUrl: { not: '' } }, select: { id: true, name: true, audioUrl: true } }),
    ]);
    const candidates = [...videos.map(item => ({ id: item.id, name: item.title, kind: 'video', url: item.videoUrl, dialogue: item.dialogue })), ...audios.map(item => ({ id: item.id, name: item.name, kind: 'audio', url: item.audioUrl }))].map(item => ({ ...item, mediaId: media.find(source => source.sourceKey === createHash('sha256').update(`${item.kind}:${item.id}:${item.url}`).digest('hex'))?.id }));
    return { project: { id: projectId, title: episode.project.title, aspectRatio: episode.project.aspectRatio, episodes: await prisma.aigcEpisode.findMany({ where: { projectId }, select: { episodeNumber: true, title: true }, orderBy: { episodeNumber: 'asc' } }) }, timeline: episode.timeline, revision: episode.timelineRevision, media, candidates };
  }
  async save(projectId: string, episodeNumber: number, input: SaveEditorDto) {
    await this.episode(projectId, episodeNumber);
    const media = await prisma.aigcEditorMedia.findMany({ where: { projectId, episodeNumber } });
    const timeline = validateTimeline(input.timeline, media);
    const result = await prisma.aigcEpisode.updateMany({ where: { projectId, episodeNumber, timelineRevision: input.revision }, data: { timeline: timeline as unknown as Prisma.InputJsonValue, timelineRevision: { increment: 1 } } });
    if (!result.count) throw new ConflictException('草稿已在其他窗口更新，请先重新加载，当前编辑内容仍保留');
    return { timeline, revision: input.revision + 1 };
  }
  async importNode(projectId: string, episodeNumber: number, input: ImportEditorDto) {
    await this.episode(projectId, episodeNumber);
    const scope = { id: input.nodeId, projectId, episodeNumber };
    const node = input.kind === 'video' ? await prisma.aigcShot.findFirst({ where: scope }) : await prisma.aigcCanvasAudioNode.findFirst({ where: scope });
    if (!node) throw new NotFoundException('当前集没有该素材');
    const url = 'videoUrl' in node ? node.videoUrl : node.audioUrl;
    if (!url) throw new BadRequestException('该节点尚无可用素材');
    const sourceKey = createHash('sha256').update(`${input.kind}:${node.id}:${url}`).digest('hex');
    const key = `${projectId}:${episodeNumber}:${sourceKey}`;
    const existing = await prisma.aigcEditorMedia.findUnique({ where: { projectId_episodeNumber_sourceKey: { projectId, episodeNumber, sourceKey } } });
    if (existing) return existing;
    if (this.imports.has(key)) return this.imports.get(key)!;
    const operation = this.storeMedia(projectId, episodeNumber, url, input.kind, 'title' in node ? node.title : node.name, sourceKey);
    this.imports.set(key, operation);
    try { return await operation; } finally { this.imports.delete(key); }
  }
  async upload(projectId: string, episodeNumber: number, file: Express.Multer.File, kind: 'video' | 'audio') {
    try { await this.episode(projectId, episodeNumber); return await this.storeMedia(projectId, episodeNumber, `/uploads/aigc/${file.filename}`, kind, file.originalname, randomUUID()); }
    finally { await unlink(file.path).catch(() => {}); }
  }
  private async storeMedia(projectId: string, episodeNumber: number, url: string, kind: string, name: string, sourceKey: string) {
    let path: string | undefined;
    let published: string | undefined;
    let saved = false;
    try {
      const signal = AbortSignal.timeout(90_000);
      const stored = await copyEditorMedia(url, kind, signal, undefined, this.storage);
      path = stored.path;
      const metadata = await probeMedia(stored.path, kind, signal);
      published = await this.storage.publishFile(path, signal);
      const result = await prisma.aigcEditorMedia.create({ data: { projectId, episodeNumber, sourceKey, kind, name, url: published, ...metadata } });
      saved = true; return result;
    } catch (error) { if (published) await this.storage.remove(published).catch(() => {}); throw error; }
    finally { if (path && (!saved || published !== `/uploads/aigc/${path.split('/').at(-1)}`)) await unlink(path).catch(() => {}); }
  }
  async export(projectId: string, episodeNumber: number, options: ExportEditorDto) {
    const episode = await this.episode(projectId, episodeNumber);
    const media = await prisma.aigcEditorMedia.findMany({ where: { projectId, episodeNumber } });
    const timeline = validateTimeline(options.timeline, media, true);
    const controller = new AbortController();
    if (this.controllers.size + this.pendingExports >= 2) throw new BadRequestException('已有两个导出任务进行中，请稍后重试');
    this.pendingExports++;
    let job: Awaited<ReturnType<typeof prisma.aigcJob.create>>;
    try {
      job = await prisma.aigcJob.create({ data: { projectId, episodeNumber, targetId: episode.id, kind: 'canvas_export', input: { ...options, timeline, nodeKind: 'export', nodeTitle: `第 ${episodeNumber} 集成片`, configName: '本地导出', model: 'FFmpeg', aspectRatio: episode.project.aspectRatio } as unknown as Prisma.InputJsonValue } });
      this.controllers.set(job.id, controller);
    } finally { this.pendingExports--; }
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    setImmediate(() => { void (async () => {
      let output: string | undefined;
      try {
        const started = await prisma.aigcJob.updateMany({ where: { id: job.id, status: 'queued' }, data: { status: 'running', progress: 1 } });
        if (!started.count) return;
        output = await renderTimeline(timeline, media.filter(item => timeline.clips.some(clip => clip.shot_id === item.id) || timeline.audio_tracks.some(track => track.media_id === item.id)), episode.project.aspectRatio, options, signal, async progress => { await prisma.aigcJob.updateMany({ where: { id: job.id, status: 'running', cancelRequested: false }, data: { progress } }); }, this.storage);
        const localOutput = output;
        output = await this.storage.publishFile(await localMediaPath(localOutput), signal);
        if (output !== localOutput) await this.storage.remove(localOutput);
        signal.throwIfAborted();
        const completed = await prisma.aigcJob.updateMany({ where: { id: job.id, status: 'running', cancelRequested: false }, data: { status: 'succeeded', progress: 100, result: { url: output } } });
        if (completed.count) output = undefined;
      } catch (error) {
        await prisma.aigcJob.updateMany({ where: { id: job.id, status: { in: ['queued', 'running'] } }, data: { status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? '' : error instanceof Error ? error.message : '导出失败' } });
      } finally {
        if (output) await this.storage.remove(output).catch(() => {});
        this.controllers.delete(job.id);
      }
    })(); });
    return job;
  }
  async cancel(projectId: string, jobId: string) {
    const job = await prisma.aigcJob.findFirst({ where: { id: jobId, projectId, kind: 'canvas_export' } });
    if (!job) throw new NotFoundException('导出任务不存在');
    await prisma.aigcJob.updateMany({ where: { id: jobId, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', cancelRequested: true } });
    this.controllers.get(jobId)?.abort();
    return prisma.aigcJob.findUniqueOrThrow({ where: { id: jobId } });
  }
  async onModuleInit() { await prisma.aigcJob.updateMany({ where: { kind: 'canvas_export', status: { in: ['queued', 'running'] } }, data: { status: 'failed', error: '服务已重启，导出任务已中断' } }); }
  onModuleDestroy() { for (const controller of this.controllers.values()) controller.abort(); }
}
