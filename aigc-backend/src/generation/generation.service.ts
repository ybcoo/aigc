import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EditorService } from '../editor/editor.service';
import { ScriptService } from '../script/script.service';
import { StorageService } from '../storage/storage.service';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/prisma.service';
import { CanvasService } from '../canvas/canvas.service';
import { canvasKey, selectCanvasReferences } from '../canvas/canvas-context';
import { GenerateNodeDto } from './generation.dto';
import { GenerationProvider, providerPrompt, type GenerationInput, type VideoTaskProgress } from './generation.provider';
import { videoMediaPrompt, videoProtocol, wanVideoPrompt } from './generation.video';

@Injectable()
export class GenerationService implements OnModuleDestroy, OnModuleInit {
  private readonly controllers = new Map<string, AbortController>();
  private readonly submittingTargets = new Set<string>();
  constructor(private readonly canvas: CanvasService, private readonly provider: GenerationProvider, @Optional() private readonly editor?: EditorService, @Optional() private readonly script?: ScriptService, @Optional() private readonly storage: StorageService = new StorageService()) {}

  async create(projectId: string, kind: string, nodeId: string, request: GenerateNodeDto) {
    const key = `${projectId}:${nodeId}`;
    if (this.submittingTargets.has(key)) throw new BadRequestException('该节点正在提交生成任务');
    this.submittingTargets.add(key);
    try { return await this.enqueue(projectId, kind, nodeId, request); }
    finally { this.submittingTargets.delete(key); }
  }

  private async enqueue(projectId: string, kind: string, nodeId: string, request: GenerateNodeDto) {
    if (kind === 'script') throw new BadRequestException('请使用剧本节点中的资源提取功能');
    const node = await this.canvas.getNode(projectId, kind, nodeId);
    const episodeNumber = request.episodeNumber ?? node.episodeNumber;
    await this.canvas.assertNodeEpisode(projectId, kind, nodeId, episodeNumber);
    const generationKind = kind === 'text' ? 'text' : ['video', 'shot'].includes(kind) ? 'video' : 'image';
    if (kind === 'audio') throw new BadRequestException('音频节点用于上传参考音色');
    const canvas = await this.canvas.getCanvas(projectId, episodeNumber);
    const context = canvas.contexts[canvasKey(kind, nodeId)] || { references: [], textPrompt: '' };
    const prompt = request.prompt.trim() || context.textPrompt;
    if (!prompt) throw new BadRequestException('请先输入提示词或连接有内容的文本节点');
    let references;
    try { references = selectCanvasReferences(prompt, context.references); } catch (error) { throw new BadRequestException((error as Error).message); }
    const colon = request.modelId?.indexOf(':') ?? -1;
    const configId = colon > 0 ? request.modelId!.slice(0, colon) : request.modelId;
    const config = await prisma.aigcAIConfig.findFirst({
      where: { ...(configId ? { id: configId } : {}), isActive: true, serviceType: generationKind === 'image' ? { in: ['image', 'storyboard_image'] } : generationKind },
      orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    if (!config) throw new BadRequestException(`请先配置可用的${{ text: '文本', image: '生图', video: '视频' }[generationKind]}模型`);
    const model = colon > 0 ? request.modelId!.slice(colon + 1) : config.defaultModel;
    if (!Array.isArray(config.models) || !config.models.includes(model)) throw new BadRequestException('所选模型不属于该配置');
    const limit = Number((config.runtimeParams as Record<string, string>)?.max_reference_images) || 3;
    if (references.filter(reference => reference.kind === 'image').length > limit) throw new BadRequestException(`当前模型最多支持 ${limit} 张参考图，请减少 @图片 引用`);
    if (generationKind !== 'video' && references.some(reference => reference.kind !== 'image')) throw new BadRequestException('图片节点只能引用图片');
    const input: GenerationInput = { kind: generationKind, model, prompt, references, aspectRatio: request.aspectRatio || ('aspectRatio' in node ? node.aspectRatio : '1:1'), duration: request.duration || ('duration' in node ? node.duration : 5), resolution: request.resolution || ('videoResolution' in node ? node.videoResolution : '480p') };
    const nodeKind = kind === 'shot' ? 'video' : kind;
    const active = await prisma.aigcJob.findFirst({ where: { projectId, targetId: nodeId, status: { in: ['queued', 'running'] } } });
    if (active) throw new BadRequestException('该节点正在生成，请等待或中断当前任务');
    await this.canvas.updateNode(projectId, nodeKind, nodeId, { ...(generationKind === 'video' ? { universalPrompt: prompt, duration: input.duration, videoResolution: input.resolution } : { prompt }), ...(generationKind !== 'text' ? { aspectRatio: input.aspectRatio } : {}) });
    let submittedPrompt = providerPrompt(prompt, references);
    if (generationKind === 'video') {
      submittedPrompt = videoMediaPrompt(config, model, submittedPrompt);
      if (videoProtocol(config, model) === 'xingzhan-wan') submittedPrompt = wanVideoPrompt(submittedPrompt, input.aspectRatio);
    }
    const snapshot = { ...input, nodeKind, nodeTitle: 'name' in node ? node.name : node.title, configName: config.name, providerPrompt: submittedPrompt };
    const job = await prisma.aigcJob.create({ data: { projectId, episodeNumber, kind: `canvas_${generationKind}`, targetId: nodeId, modelId: config.id, input: snapshot as unknown as Prisma.InputJsonValue, references: references as unknown as Prisma.InputJsonValue } });
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60 * 1000)]);
    setImmediate(() => { void this.run(job.id, projectId, nodeKind, nodeId, config, input, signal); });
    return job;
  }

  async get(projectId: string, jobId: string) {
    const job = await prisma.aigcJob.findFirst({ where: { id: jobId, projectId } });
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }

  async list(projectId: string) {
    const project = await prisma.aigcProject.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('项目不存在');
    const scope = { projectId, kind: { startsWith: 'canvas_' } };
    const [active, recent] = await Promise.all([
      prisma.aigcJob.findMany({ where: { ...scope, status: { in: ['queued', 'running'] } }, orderBy: { createdAt: 'desc' } }),
      prisma.aigcJob.findMany({ where: { ...scope, status: { notIn: ['queued', 'running'] } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return [...active, ...recent].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async cancel(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    if (job.kind === 'canvas_export' && this.editor) return this.editor.cancel(projectId, jobId);
    if (job.kind === 'canvas_asset_extract' && this.script) return this.script.cancel(projectId, jobId);
    await prisma.aigcJob.updateMany({ where: { id: jobId, projectId, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', cancelRequested: true } });
    this.controllers.get(jobId)?.abort();
    return this.get(projectId, jobId);
  }

  private async run(jobId: string, projectId: string, kind: string, nodeId: string, config: Parameters<GenerationProvider['generate']>[0], input: GenerationInput, signal: AbortSignal) {
    let uncommittedUrl: string | undefined;
    let providerProgress: VideoTaskProgress | undefined;
    try {
      const started = await prisma.aigcJob.updateMany({ where: { id: jobId, status: 'queued' }, data: { status: 'running' } });
      if (!started.count) return;
      const result = await this.provider.generate(config, input, signal, async progress => {
        signal.throwIfAborted();
        providerProgress = progress;
        await prisma.aigcJob.updateMany({ where: { id: jobId, status: 'running', cancelRequested: false }, data: { result: progress as unknown as Prisma.InputJsonValue } });
      });
      uncommittedUrl = result.url;
      signal.throwIfAborted();
      const published = await prisma.$transaction(async tx => {
        const saved = await tx.aigcJob.updateMany({ where: { id: jobId, status: 'running', cancelRequested: false }, data: { status: 'succeeded', progress: 100, result: { ...providerProgress, ...result } } });
        if (!saved.count) return false;
        await this.canvas.updateNodeInTransaction(tx, projectId, kind, nodeId, input.kind === 'text' ? { content: result.content } : input.kind === 'video' ? { videoUrl: result.url } : { imageUrl: result.url }, 'generated');
        return true;
      });
      if (published) uncommittedUrl = undefined;
    } catch (error) {
      const cancelled = this.controllers.get(jobId)?.signal.aborted;
      await prisma.aigcJob.updateMany({ where: { id: jobId, status: { in: ['queued', 'running'] } }, data: { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? '' : signal.aborted ? '生成超过 20 分钟，请重试' : error instanceof Error ? error.message : '生成失败' } });
    } finally { if (uncommittedUrl) await this.storage.remove(uncommittedUrl).catch(() => {}); this.controllers.delete(jobId); }
  }

  onModuleDestroy() { for (const controller of this.controllers.values()) controller.abort(); }

  async onModuleInit() {
    await prisma.aigcJob.updateMany({ where: { kind: { startsWith: 'canvas_' }, status: { in: ['queued', 'running'] } }, data: { status: 'failed', error: '服务已重启，生成任务已中断，请重新生成' } });
  }
}
