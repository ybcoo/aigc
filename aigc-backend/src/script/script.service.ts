import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type AigcAIConfig } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../prisma/prisma.service';
import { GenerationProvider, type GenerationInput } from '../generation/generation.provider';
import type { ExtractScriptDto, SaveScriptDto } from './script.dto';
import { assetLabels, assetNameKey, extractionPrompt, extractionSystemPrompt, parseExtractedAssets, scriptChunks, type AssetCategory, type ExtractedAsset, type ScriptVisualContext } from './script.extraction';

const digest = (content: string) => createHash('sha256').update(content).digest('hex');

@Injectable()
export class ScriptService implements OnModuleInit, OnModuleDestroy {
  private readonly controllers = new Map<string, AbortController>();
  private readonly pending = new Set<string>();
  constructor(private readonly provider: GenerationProvider) {}

  async get(projectId: string, episodeNumber: number) {
    const episode = await prisma.aigcEpisode.findUnique({ where: { projectId_episodeNumber: { projectId, episodeNumber } }, include: { project: { select: { genre: true, style: true, textModelId: true } } } });
    if (!episode) throw new NotFoundException('分集不存在');
    return episode;
  }
  async save(projectId: string, episodeNumber: number, input: SaveScriptDto) {
    const episode = await this.get(projectId, episodeNumber);
    return prisma.$transaction(async tx => {
      if (input.genre !== undefined || input.style !== undefined) await tx.aigcProject.update({ where: { id: projectId }, data: { ...(input.genre !== undefined ? { genre: input.genre.trim() } : {}), ...(input.style !== undefined ? { style: input.style.trim() } : {}) } });
      return tx.aigcEpisode.update({ where: { id: episode.id }, data: { scriptContent: input.content, ...(input.title !== undefined ? { title: input.title.trim() || `第 ${episodeNumber} 集` } : {}) } });
    });
  }
  async extract(projectId: string, episodeNumber: number, input: ExtractScriptDto) {
    const key = `${projectId}:${episodeNumber}:${input.kind}`;
    if (this.pending.has(key)) throw new BadRequestException('正在提交该类资源的提取任务');
    this.pending.add(key);
    try {
      const episode = await this.get(projectId, episodeNumber);
      if (!episode.scriptContent.trim()) throw new BadRequestException('请先填写并保存当前集剧本');
      if (episode.scriptContent.length > 100000) throw new BadRequestException('单集剧本最多支持 100000 字符');
      const targetId = `${episode.id}:${input.kind}`;
      if (await prisma.aigcJob.findFirst({ where: { projectId, targetId, kind: 'canvas_asset_extract', status: { in: ['queued', 'running'] } } })) throw new BadRequestException('该类资源正在提取，可在任务中中断');
      const modelId = input.modelId || episode.project.textModelId;
      const colon = modelId?.indexOf(':') ?? -1;
      const configId = colon > 0 ? modelId.slice(0, colon) : modelId;
      const config = await prisma.aigcAIConfig.findFirst({ where: { ...(configId ? { id: configId } : {}), serviceType: 'text', isActive: true }, orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }] });
      if (!config) throw new BadRequestException('请先配置可用的文本模型');
      const model = colon > 0 ? modelId.slice(colon + 1) : config.defaultModel;
      if (!Array.isArray(config.models) || !config.models.includes(model)) throw new BadRequestException('所选模型不属于该文本配置');
      const job = await prisma.aigcJob.create({ data: { projectId, episodeNumber, targetId, kind: 'canvas_asset_extract', modelId: config.id, input: { nodeKind: 'script', nodeTitle: `提取${assetLabels[input.kind]}`, category: input.kind, model, configName: config.name, prompt: episode.scriptContent, systemPrompt: extractionSystemPrompt(input.kind), genre: episode.project.genre, style: episode.project.style, aspectRatio: input.aspectRatio || '1:1' } } });
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20 * 60 * 1000)]);
      setImmediate(() => { void this.run(job.id, episode, input.kind, config, model, input.aspectRatio || '1:1', signal); });
      return job;
    } finally { this.pending.delete(key); }
  }

  private async run(jobId: string, episode: Awaited<ReturnType<ScriptService['get']>>, kind: AssetCategory, config: AigcAIConfig, model: string, aspectRatio: string, signal: AbortSignal) {
    try {
      const started = await prisma.aigcJob.updateMany({ where: { id: jobId, status: 'queued' }, data: { status: 'running', progress: 1 } });
      if (!started.count) return;
      const catalog = await prisma.aigcAsset.findMany({ where: { projectId: episode.projectId, kind }, orderBy: { updatedAt: 'desc' } });
      const chunks = scriptChunks(episode.scriptContent);
      const rows: ExtractedAsset[] = [];
      for (let index = 0; index < chunks.length; index++) {
        signal.throwIfAborted();
        const prompt = extractionPrompt(kind, chunks[index], catalog.slice(0, 200), episode.project);
        const request: GenerationInput = { kind: 'text', model, prompt, systemPrompt: extractionSystemPrompt(kind), references: [], aspectRatio: '1:1', duration: 5, resolution: '480p' };
        const response = await this.provider.generate(config, request, signal);
        let parsed: ExtractedAsset[];
        try { parsed = parseExtractedAssets(response.content || '', kind); }
        catch (error) {
          signal.throwIfAborted();
          const repair = await this.provider.generate(config, { ...request, prompt: `${prompt}\n上次结果不合法：${error instanceof Error ? error.message : '资源分类或JSON结构错误'}。请重新按原剧本提取，只保留真实属于${assetLabels[kind]}的条目，每项必须有 kind:"${kind}"；不要把其他分类改写 kind 后混入。无需该类资源时返回 {"assets":[]}。\n<previous_reply>${(response.content || '').slice(0, 12000)}</previous_reply>` }, signal);
          parsed = parseExtractedAssets(repair.content || '', kind);
        }
        rows.push(...parsed);
        if (rows.length > 500) throw new BadRequestException('单次提取最多支持 500 个资源，请拆分剧本');
        await prisma.aigcJob.updateMany({ where: { id: jobId, status: 'running', cancelRequested: false }, data: { progress: Math.round((index + 1) / chunks.length * 90) } });
      }
      signal.throwIfAborted();
      await this.commit(jobId, episode, kind, rows, aspectRatio, episode.project, signal);
    } catch (error) {
      const cancelled = this.controllers.get(jobId)?.signal.aborted;
      await prisma.aigcJob.updateMany({ where: { id: jobId, status: { in: ['queued', 'running'] } }, data: { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? '' : signal.aborted ? '资源提取超时，请重试或拆分剧本' : error instanceof Error ? error.message : '资源提取失败' } });
    } finally { this.controllers.delete(jobId); }
  }

  private async commit(jobId: string, episode: Awaited<ReturnType<ScriptService['get']>>, kind: AssetCategory, rows: ExtractedAsset[], aspectRatio: string, context: ScriptVisualContext, signal: AbortSignal) {
    await prisma.$transaction(async tx => {
      // Cross-episode extraction jobs share one catalog; serialize only their short database commit.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${episode.projectId}, 0))`;
      signal.throwIfAborted();
      const current = await tx.aigcEpisode.findUnique({ where: { id: episode.id } });
      if (!current || digest(current.scriptContent) !== digest(episode.scriptContent)) throw new BadRequestException('提取期间剧本已更新，请按最新剧本重新提取');
      const claimed = await tx.aigcJob.updateMany({ where: { id: jobId, status: 'running', cancelRequested: false }, data: { progress: 95 } });
      if (!claimed.count) return;
      const catalog = await tx.aigcAsset.findMany({ where: { projectId: episode.projectId, kind }, orderBy: { createdAt: 'asc' } });
      const ids: string[] = [];
      let created = 0, reused = 0;
      for (const row of rows) {
        signal.throwIfAborted();
        let asset = row.existingAssetId ? catalog.find(item => item.id === row.existingAssetId) : catalog.find(item => assetNameKey(item.name) === assetNameKey(row.name));
        if (row.existingAssetId && !asset) throw new BadRequestException('模型引用了不属于当前项目或分类的资源，请重新提取');
        if (!asset) {
          const visualContext = [context.genre && `题材：${context.genre}`, context.style && `视觉风格：${context.style}`].filter(Boolean).join('；');
          const prompt = [visualContext, row.prompt || [row.name, row.description, row.appearance].filter(Boolean).join('。')].filter(Boolean).join('\n');
          asset = await tx.aigcAsset.create({ data: { projectId: episode.projectId, episodeNumber: episode.episodeNumber, kind, name: row.name, description: row.description, appearance: row.appearance, prompt, aspectRatio } });
          catalog.push(asset); created++;
        } else if (!ids.includes(asset.id)) reused++;
        if (ids.includes(asset.id)) continue;
        ids.push(asset.id);
        await tx.aigcAssetEpisode.upsert({ where: { assetId_episodeId: { assetId: asset.id, episodeId: episode.id } }, create: { assetId: asset.id, episodeId: episode.id }, update: {} });
        const nodeId = `${kind}:${asset.id}`;
        const count = await tx.aigcCanvasLayout.count({ where: { projectId: episode.projectId, episodeNumber: episode.episodeNumber, nodeId: { startsWith: `${kind}:` } } });
        await tx.aigcCanvasLayout.upsert({ where: { projectId_episodeNumber_nodeId: { projectId: episode.projectId, episodeNumber: episode.episodeNumber, nodeId } }, update: {}, create: { projectId: episode.projectId, episodeNumber: episode.episodeNumber, nodeId, x: { character: 40, scene: 360, prop: 680 }[kind], y: 80 + count * 280 } });
      }
      signal.throwIfAborted();
      const content = ids.length ? `${assetLabels[kind]}提取完成：新增 ${created} 个，复用 ${reused} 个。` : `当前剧本无需提取${assetLabels[kind]}`;
      await tx.aigcJob.update({ where: { id: jobId }, data: { status: 'succeeded', progress: 100, result: { content, created, reused, assetIds: ids } as Prisma.InputJsonValue } });
    }, { maxWait: 30000, timeout: 30000 });
  }

  async cancel(projectId: string, jobId: string) {
    const job = await prisma.aigcJob.findFirst({ where: { id: jobId, projectId, kind: 'canvas_asset_extract' } });
    if (!job) throw new NotFoundException('提取任务不存在');
    await prisma.aigcJob.updateMany({ where: { id: jobId, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', cancelRequested: true } });
    this.controllers.get(jobId)?.abort();
    return prisma.aigcJob.findUniqueOrThrow({ where: { id: jobId } });
  }
  async onModuleInit() { await prisma.aigcJob.updateMany({ where: { kind: 'canvas_asset_extract', status: { in: ['queued', 'running'] } }, data: { status: 'failed', error: '服务已重启，提取任务已中断，请重试' } }); }
  onModuleDestroy() { for (const controller of this.controllers.values()) controller.abort(); }
}
