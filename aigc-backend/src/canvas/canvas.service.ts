import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/prisma.service';
import type { CreateLinkDto, CreateProjectDto, ImportScriptDto, SaveLayoutDto, SaveNodeDto, UpdateProjectDto } from './canvas.dto';
import { buildCanvasContexts, canvasKey, canonicalKind } from './canvas-context';
import { characterCount, parseScriptImport, SCRIPT_IMPORT_MAX_EPISODES, type ScriptImportPreview } from './script-import';

const nodeKinds = ['character', 'scene', 'prop', 'text', 'image', 'audio', 'shot', 'video', 'script'] as const;
type NodeKind = (typeof nodeKinds)[number];
type MediaTarget = {
  where: { shotId?: string; assetId?: string; referenceNodeId?: string; audioNodeId?: string; kind: string };
  url: string;
  aspectRatio: string;
  updatedAt: Date;
};

@Injectable()
export class CanvasService {
  async listProjects() {
    const projects = await prisma.aigcProject.findMany({ orderBy: { updatedAt: 'desc' } });
    return projects.map(project => ({ ...project, episodes: [] }));
  }

  private async projectSettings(input: CreateProjectDto) {
    const textModelId = input.textModelId?.trim() || '';
    if (textModelId) {
      const colon = textModelId.indexOf(':');
      const config = await prisma.aigcAIConfig.findFirst({ where: { id: colon > 0 ? textModelId.slice(0, colon) : textModelId, serviceType: 'text', isActive: true } });
      const model = colon > 0 ? textModelId.slice(colon + 1) : config?.defaultModel;
      if (!config || !model || !Array.isArray(config.models) || !config.models.includes(model)) throw new BadRequestException('所选文本模型不可用，请重新选择');
    }
    return {
      title: input.title?.trim() || '',
      description: input.description?.trim() ?? '',
      genre: input.genre?.trim() ?? '',
      style: input.style?.trim() ?? '',
      textModelId,
      aspectRatio: input.aspectRatio ?? '16:9',
      storySummary: input.storySummary?.trim() ?? '',
    };
  }

  async createProject(input: CreateProjectDto) {
    const episodeCount = input.episodeCount ?? 1;
    return prisma.aigcProject.create({
      data: {
        ...await this.projectSettings(input),
        episodeCount,
        episodes: {
          create: Array.from({ length: episodeCount }, (_, index) => ({
            episodeNumber: index + 1,
            title: `第 ${index + 1} 集`,
            scriptContent: index === 0 ? input.scriptContent || '' : '',
          })),
        },
      },
      include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
    });
  }

  async importScript(filename: string, bytes: Uint8Array, input: ImportScriptDto, previewOnly: boolean) {
    if (!/\.txt$/i.test(filename)) throw new BadRequestException('仅支持 TXT 文件');
    const parsed = parseScriptImport(bytes, input.encoding);
    const title = input.title?.trim() || filename.split(/[\\/]/).at(-1)!.replace(/\.txt$/i, '');
    if (!title || characterCount(title) > 120) throw new BadRequestException('项目名称需为 1–120 个字符');
    const preview: ScriptImportPreview = { title, encoding: parsed.encoding, chapterCount: parsed.chapters.length, characterCount: characterCount(parsed.text), chapters: parsed.chapters.slice(0, 100).map((chapter, index) => ({ episodeNumber: index + 1, title: chapter.title, characterCount: characterCount(chapter.content) })) };
    if (previewOnly) return preview;
    const settings = await this.projectSettings({ ...input, title });
    return prisma.$transaction(async tx => {
      const project = await tx.aigcProject.create({ data: { ...settings, episodeCount: parsed.chapters.length } });
      for (let start = 0; start < parsed.chapters.length; start += 500) {
        await tx.aigcEpisode.createMany({ data: parsed.chapters.slice(start, start + 500).map((chapter, index) => ({ projectId: project.id, episodeNumber: start + index + 1, title: chapter.title, scriptContent: chapter.content, status: 'imported' })) });
      }
      return { id: project.id, title: project.title, episodeCount: project.episodeCount };
    }, { maxWait: 30000, timeout: 120000 });
  }

  async updateProject(projectId: string, input: UpdateProjectDto) {
    if (!await prisma.aigcProject.findUnique({ where: { id: projectId }, select: { id: true } })) throw new NotFoundException('项目不存在');
    return prisma.aigcProject.update({ where: { id: projectId }, data: { title: input.title.trim() }, select: { id: true, title: true, updatedAt: true } });
  }

  async createEpisode(projectId: string) {
    return prisma.$transaction(async tx => {
      // Allocate the episode number under a project lock, including concurrent tabs.
      const project = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aigc_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      if (!project.length) throw new NotFoundException('项目不存在');
      const episodes = await tx.aigcEpisode.aggregate({ where: { projectId }, _max: { episodeNumber: true }, _count: true });
      if (episodes._count >= SCRIPT_IMPORT_MAX_EPISODES) throw new BadRequestException('剧集数量已达上限');
      const episodeNumber = (episodes._max.episodeNumber || 0) + 1;
      const episode = await tx.aigcEpisode.create({ data: { projectId, episodeNumber, title: `第 ${episodeNumber} 集` } });
      const episodeCount = episodes._count + 1;
      await tx.aigcProject.update({ where: { id: projectId }, data: { episodeCount } });
      return { episode, episodeCount };
    });
  }

  async deleteProject(projectId: string) {
    return prisma.$transaction(async tx => {
      // Serialize deletion with new child records, whose foreign keys lock this project.
      const project = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM aigc_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      if (!project.length) throw new NotFoundException('项目不存在');
      if (await tx.aigcJob.findFirst({ where: { projectId, status: { in: ['queued', 'running'] } }, select: { id: true } })) {
        throw new ConflictException('该项目还有任务正在生成，请先在画布任务菜单中中断或等待完成后再删除');
      }
      await tx.aigcProject.delete({ where: { id: projectId } });
      return { id: projectId };
    });
  }

  async getCanvas(projectId: string, episodeNumber: number) {
    const project = await prisma.aigcProject.findUnique({
      where: { id: projectId },
      include: { episodes: { select: { id: true, episodeNumber: true, title: true }, orderBy: { episodeNumber: 'asc' } } },
    });
    if (!project) throw new NotFoundException('项目不存在');

    const currentEpisode = await prisma.aigcEpisode.findUnique({ where: { projectId_episodeNumber: { projectId, episodeNumber } }, select: { id: true, scriptContent: true } });
    if (!currentEpisode) throw new NotFoundException('分集不存在');

    const scope = { projectId, episodeNumber };
    const [assets, textNodes, referenceNodes, audioNodes, shots, links, layouts, jobs] = await Promise.all([
      prisma.aigcAsset.findMany({ where: { projectId, OR: [{ episodes: { some: { episode: scope } } }, { episodeNumber, episodes: { none: {} } }] }, orderBy: { createdAt: 'asc' } }),
      prisma.aigcCanvasTextNode.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      prisma.aigcCanvasReferenceNode.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      prisma.aigcCanvasAudioNode.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      prisma.aigcShot.findMany({ where: scope, include: { versions: { orderBy: { createdAt: 'desc' } } }, orderBy: [{ canvasVideoNode: 'asc' }, { position: 'asc' }] }),
      prisma.aigcCanvasLink.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      prisma.aigcCanvasLayout.findMany({ where: scope }),
      prisma.aigcJob.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);

    const data = { project: { ...project, episodes: project.episodes.map(episode => episode.id === currentEpisode.id ? { ...episode, scriptContent: currentEpisode.scriptContent } : episode) }, episodeNumber, assets, textNodes, referenceNodes, audioNodes, shots, links, layouts, jobs };
    return { ...data, contexts: buildCanvasContexts(data) };
  }

  async getNode(projectId: string, kind: string, nodeId: string) {
    const parsed = this.parseNodeKind(kind);
    const where = { id: nodeId, projectId };
    const node = parsed === 'script' ? await prisma.aigcEpisode.findFirst({ where }) : ['character', 'scene', 'prop'].includes(parsed)
      ? await prisma.aigcAsset.findFirst({ where: { ...where, kind: parsed } })
      : parsed === 'image' ? await prisma.aigcCanvasReferenceNode.findFirst({ where })
        : parsed === 'text' ? await prisma.aigcCanvasTextNode.findFirst({ where })
          : parsed === 'audio' ? await prisma.aigcCanvasAudioNode.findFirst({ where })
            : await prisma.aigcShot.findFirst({ where });
    if (!node) throw new NotFoundException('节点不存在');
    return node;
  }

  async createNode(projectId: string, kind: string, input: SaveNodeDto) {
    const nodeKind = this.parseNodeKind(kind);
    const episodeNumber = input.episodeNumber ?? 1;
    const episodeId = await this.assertProjectEpisode(projectId, episodeNumber);
    if (nodeKind === 'script') return this.getNode(projectId, 'script', episodeId);

    if (nodeKind === 'character' || nodeKind === 'scene' || nodeKind === 'prop') {
      return prisma.aigcAsset.create({
        data: {
          projectId,
          episodeNumber,
          kind: nodeKind,
          name: input.name?.trim() || this.defaultNodeTitle(nodeKind),
          description: input.description?.trim() ?? '',
          appearance: input.appearance?.trim() ?? '',
          prompt: input.prompt?.trim() ?? '',
          imageUrl: input.imageUrl?.trim() ?? '',
          aspectRatio: input.aspectRatio ?? '1:1',
          episodes: { create: { episodeId } },
        },
      });
    }
    if (nodeKind === 'text') {
      return prisma.aigcCanvasTextNode.create({
        data: { projectId, episodeNumber, title: input.title?.trim() || '新建文本', content: input.content ?? '', prompt: input.prompt ?? '' },
      });
    }
    if (nodeKind === 'image') {
      return prisma.aigcCanvasReferenceNode.create({
        data: { projectId, episodeNumber, name: input.name?.trim() || '参考图', imageUrl: input.imageUrl?.trim() ?? '', prompt: input.prompt ?? '', aspectRatio: input.aspectRatio ?? '1:1' },
      });
    }
    if (nodeKind === 'audio') {
      return prisma.aigcCanvasAudioNode.create({
        data: { projectId, episodeNumber, name: input.name?.trim() || '参考音色', audioUrl: input.audioUrl?.trim() ?? '' },
      });
    }

    const count = await prisma.aigcShot.count({ where: { projectId, episodeNumber, canvasVideoNode: nodeKind === 'video' } });
    return prisma.aigcShot.create({
      data: {
        projectId,
        episodeNumber,
        position: count + 1,
        title: input.title?.trim() || (nodeKind === 'video' ? '新建视频' : `分镜 ${count + 1}`),
        description: input.description?.trim() ?? '',
        sourceScript: input.sourceScript ?? '',
        storyboardScript: input.storyboardScript ?? '',
        universalPrompt: input.universalPrompt ?? '',
        dialogue: input.dialogue ?? '',
        shotType: input.shotType ?? '中景',
        movement: input.movement ?? '固定机位',
        aspectRatio: input.aspectRatio ?? '16:9',
        duration: input.duration ?? 5,
        videoResolution: input.videoResolution ?? '480p',
        videoUrl: input.videoUrl?.trim() ?? '',
        assetIds: input.assetIds ?? [],
        canvasVideoNode: nodeKind === 'video',
      },
    });
  }

  async updateNode(projectId: string, kind: string, nodeId: string, input: SaveNodeDto, source = 'generated') {
    return prisma.$transaction(tx => this.updateNodeInTransaction(tx, projectId, kind, nodeId, input, source));
  }

  async updateNodeInTransaction(tx: Prisma.TransactionClient, projectId: string, kind: string, nodeId: string, input: SaveNodeDto, source = 'generated') {
    const nodeKind = this.parseNodeKind(kind);
    const mediaUrl = nodeKind === 'video' ? input.videoUrl : nodeKind === 'audio' ? input.audioUrl : input.imageUrl;
    if (nodeKind !== 'text' && mediaUrl !== undefined) {
        const target = await this.mediaTarget(tx, projectId, nodeKind, nodeId);
        await this.retainCurrentMedia(tx, target);
        const record = await this.updateNodeRecord(tx, projectId, nodeKind, nodeId, input);
        await this.selectMediaVersion(tx, target, mediaUrl, input.aspectRatio ?? target.aspectRatio, source);
        return record;
    }
    return this.updateNodeRecord(tx, projectId, nodeKind, nodeId, input);
  }

  private updateNodeRecord(db: Prisma.TransactionClient, projectId: string, nodeKind: NodeKind, nodeId: string, input: SaveNodeDto) {
    if (nodeKind === 'script') return db.aigcEpisode.update({ where: { id: nodeId, projectId }, data: { title: input.title, scriptContent: input.content } });
    if (nodeKind === 'character' || nodeKind === 'scene' || nodeKind === 'prop') {
      return db.aigcAsset.update({ where: { id: nodeId, projectId, kind: nodeKind }, data: this.assetUpdate(input) });
    }
    if (nodeKind === 'text') {
      return db.aigcCanvasTextNode.update({ where: { id: nodeId, projectId }, data: { title: input.title, content: input.content, prompt: input.prompt } });
    }
    if (nodeKind === 'image') {
      return db.aigcCanvasReferenceNode.update({ where: { id: nodeId, projectId }, data: { name: input.name, imageUrl: input.imageUrl, prompt: input.prompt, aspectRatio: input.aspectRatio } });
    }
    if (nodeKind === 'audio') {
      return db.aigcCanvasAudioNode.update({ where: { id: nodeId, projectId }, data: { name: input.name, audioUrl: input.audioUrl } });
    }
    return db.aigcShot.update({
      where: { id: nodeId, projectId },
      data: {
        title: input.title,
        description: input.description,
        sourceScript: input.sourceScript,
        storyboardScript: input.storyboardScript,
        universalPrompt: input.universalPrompt,
        dialogue: input.dialogue,
        shotType: input.shotType,
        movement: input.movement,
        aspectRatio: input.aspectRatio,
        duration: input.duration,
        videoResolution: input.videoResolution,
        videoUrl: input.videoUrl,
        imageUrl: input.imageUrl,
        assetIds: input.assetIds,
      },
    });
  }

  async deleteNode(projectId: string, kind: string, nodeId: string, episodeNumber?: number) {
    const nodeKind = this.parseNodeKind(kind);
    if (nodeKind === 'script') throw new BadRequestException('剧本节点属于当前分集，不能删除');
    await prisma.$transaction(async (tx) => {
      if (['character', 'scene', 'prop'].includes(nodeKind) && episodeNumber !== undefined) {
        const episode = await tx.aigcEpisode.findUnique({ where: { projectId_episodeNumber: { projectId, episodeNumber } } });
        const asset = await tx.aigcAsset.findFirst({ where: { id: nodeId, projectId, kind: nodeKind }, include: { episodes: true } });
        if (!episode || !asset) throw new NotFoundException('素材节点不存在');
        if (asset.episodes.length ? !asset.episodes.some(link => link.episodeId === episode.id) : asset.episodeNumber !== episodeNumber) throw new NotFoundException('当前集没有此素材');
        if (asset.episodes.length > 1) {
          await tx.aigcAssetEpisode.deleteMany({ where: { assetId: nodeId, episodeId: episode.id } });
          await tx.aigcCanvasLink.deleteMany({ where: { projectId, episodeNumber, OR: [{ sourceId: nodeId }, { targetId: nodeId }] } });
          await tx.aigcCanvasLayout.deleteMany({ where: { projectId, episodeNumber, nodeId: `${nodeKind}:${nodeId}` } });
          return;
        }
      }
      await tx.aigcCanvasLink.deleteMany({
        where: { projectId, OR: [{ sourceId: nodeId }, { targetId: nodeId }] },
      });
      await tx.aigcCanvasLayout.deleteMany({ where: { projectId, nodeId: { contains: nodeId } } });
      if (nodeKind === 'character' || nodeKind === 'scene' || nodeKind === 'prop') await tx.aigcAsset.delete({ where: { id: nodeId, projectId } });
      else if (nodeKind === 'text') await tx.aigcCanvasTextNode.delete({ where: { id: nodeId, projectId } });
      else if (nodeKind === 'image') await tx.aigcCanvasReferenceNode.delete({ where: { id: nodeId, projectId } });
      else if (nodeKind === 'audio') await tx.aigcCanvasAudioNode.delete({ where: { id: nodeId, projectId } });
      else await tx.aigcShot.delete({ where: { id: nodeId, projectId } });
    });
    return { id: nodeId };
  }

  async createLink(projectId: string, input: CreateLinkDto) {
    if (input.sourceId === input.targetId) throw new BadRequestException('节点不能连接自己');
    const [source, target] = await Promise.all([this.getNode(projectId, input.sourceKind, input.sourceId), this.getNode(projectId, input.targetKind, input.targetId)]);
    await Promise.all([this.assertNodeEpisode(projectId, input.sourceKind, input.sourceId, input.episodeNumber), this.assertNodeEpisode(projectId, input.targetKind, input.targetId, input.episodeNumber)]);
    const sourceKind = canonicalKind(input.sourceKind);
    const targetKind = canonicalKind(input.targetKind);
    if (targetKind === 'script' || sourceKind === 'script' && !['character', 'scene', 'prop', 'image'].includes(targetKind)) throw new BadRequestException('剧本只能连接图片节点');
    if (targetKind === 'audio' || (targetKind === 'text' && sourceKind !== 'text')) throw new BadRequestException('该节点不支持这种输入类型');
    if ((sourceKind === 'video' || sourceKind === 'audio') && targetKind !== 'video') throw new BadRequestException('视频和音频只能作为视频节点的参考');
    const link = await prisma.aigcCanvasLink.upsert({
      where: {
        projectId_episodeNumber_sourceKind_sourceId_targetKind_targetId: {
          projectId,
          episodeNumber: input.episodeNumber,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          targetKind: input.targetKind,
          targetId: input.targetId,
        },
      },
      update: { locked: input.locked ?? false },
      create: { projectId, ...input, locked: input.locked ?? false },
    });
    if (input.sourceKind === 'text' && 'content' in source && source.content.trim()) {
      const prompt = 'prompt' in target ? target.prompt : 'universalPrompt' in target ? target.universalPrompt : '';
      if (!prompt.trim()) {
        const canvas = await this.getCanvas(projectId, input.episodeNumber);
        const textPrompt = canvas.contexts[canvasKey(input.targetKind, input.targetId)]?.textPrompt || source.content;
        await this.updateNode(projectId, input.targetKind, input.targetId, targetKind === 'video' ? { universalPrompt: textPrompt } : { prompt: textPrompt });
      }
    }
    return link;
  }

  async attachReference(projectId: string, kind: string, nodeId: string, referenceKind: string, url: string, name: string, episodeNumber?: number) {
    const target = await this.getNode(projectId, kind, nodeId);
    const episode = episodeNumber ?? target.episodeNumber;
    await this.assertNodeEpisode(projectId, kind, nodeId, episode);
    if (!['image', 'video', 'audio'].includes(referenceKind)) throw new BadRequestException('不支持的参考类型');
    if (['text', 'audio', 'script'].includes(kind) || (referenceKind !== 'image' && canonicalKind(kind) !== 'video')) throw new BadRequestException('此节点不支持该类型参考');
    return prisma.$transaction(async tx => {
      const scope = { projectId, episodeNumber: episode };
      const node = referenceKind === 'image'
        ? await tx.aigcCanvasReferenceNode.create({ data: { ...scope, name, imageUrl: url } })
        : referenceKind === 'audio'
          ? await tx.aigcCanvasAudioNode.create({ data: { ...scope, name, audioUrl: url } })
          : await tx.aigcShot.create({ data: { ...scope, title: name, videoUrl: url, canvasVideoNode: true } });
      const link = await tx.aigcCanvasLink.create({ data: { ...scope, sourceKind: referenceKind, sourceId: node.id, targetKind: kind, targetId: nodeId } });
      const targetLayout = await tx.aigcCanvasLayout.findFirst({ where: { ...scope, nodeId: { in: [canvasKey(kind, nodeId), `shot:${nodeId}`, `shot-video:${nodeId}`] } } });
      const count = await tx.aigcCanvasLink.count({ where: { ...scope, targetKind: kind, targetId: nodeId } });
      const layout = await tx.aigcCanvasLayout.create({ data: { ...scope, nodeId: `${referenceKind}:${node.id}`, x: (targetLayout?.x ?? 600) - 340, y: (targetLayout?.y ?? 80) + (count - 1) * 270 } });
      return { node, link, layout };
    });
  }

  async deleteLink(projectId: string, linkId: string) {
    const result = await prisma.aigcCanvasLink.deleteMany({ where: { id: linkId, projectId, locked: false } });
    if (!result.count) throw new BadRequestException('固定流程连线不能删除');
    return { id: linkId };
  }

  async saveLayout(projectId: string, input: SaveLayoutDto) {
    await prisma.$transaction(input.nodes.map((node) => prisma.aigcCanvasLayout.upsert({
      where: { projectId_episodeNumber_nodeId: { projectId, episodeNumber: input.episodeNumber, nodeId: node.nodeId } },
      update: { x: node.x, y: node.y, width: node.width, height: node.height },
      create: { projectId, episodeNumber: input.episodeNumber, ...node },
    })));
    return { count: input.nodes.length };
  }

  async attachUpload(projectId: string, kind: string, nodeId: string, url: string) {
    const nodeKind = this.parseNodeKind(kind);
    if (nodeKind === 'text' || nodeKind === 'script') throw new BadRequestException('文本和剧本节点不能上传媒体');
    const input = nodeKind === 'video' ? { videoUrl: url } : nodeKind === 'audio' ? { audioUrl: url } : { imageUrl: url };
    return this.updateNode(projectId, nodeKind, nodeId, input, 'uploaded');
  }

  async listMediaVersions(projectId: string, kind: string, nodeId: string) {
    const nodeKind = this.parseNodeKind(kind);
    return prisma.$transaction(async (tx) => {
      const target = await this.mediaTarget(tx, projectId, nodeKind, nodeId);
      const current = await this.retainCurrentMedia(tx, target);
      const versions = await tx.aigcMediaVersion.findMany({ where: target.where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return versions.map(version => ({ ...version, isCurrent: version.id === current?.id }));
    });
  }

  async restoreMediaVersion(projectId: string, kind: string, nodeId: string, versionId: string) {
    const nodeKind = this.parseNodeKind(kind);
    return prisma.$transaction(async (tx) => {
      const target = await this.mediaTarget(tx, projectId, nodeKind, nodeId);
      const version = await tx.aigcMediaVersion.findFirst({ where: { ...target.where, id: versionId } });
      if (!version) throw new NotFoundException('历史版本不存在或不属于该节点');
      await this.retainCurrentMedia(tx, target);
      await tx.aigcMediaVersion.updateMany({ where: target.where, data: { isCurrent: false } });
      await tx.aigcMediaVersion.update({ where: { id: version.id }, data: { isCurrent: true } });
      const input: SaveNodeDto = { aspectRatio: version.aspectRatio || undefined };
      if (nodeKind === 'video') input.videoUrl = version.url;
      else if (nodeKind === 'audio') input.audioUrl = version.url;
      else input.imageUrl = version.url;
      return this.updateNodeRecord(tx, projectId, nodeKind, nodeId, input);
    });
  }

  private async mediaTarget(db: Prisma.TransactionClient, projectId: string, kind: NodeKind, nodeId: string): Promise<MediaTarget> {
    if (kind === 'character' || kind === 'scene' || kind === 'prop') {
      const node = await db.aigcAsset.findFirst({ where: { id: nodeId, projectId, kind } });
      if (!node) throw new NotFoundException('素材节点不存在');
      return { where: { assetId: nodeId, kind: 'image' }, url: node.imageUrl, aspectRatio: node.aspectRatio, updatedAt: node.updatedAt };
    }
    if (kind === 'image') {
      const node = await db.aigcCanvasReferenceNode.findFirst({ where: { id: nodeId, projectId } });
      if (!node) throw new NotFoundException('图片节点不存在');
      return { where: { referenceNodeId: nodeId, kind: 'image' }, url: node.imageUrl, aspectRatio: node.aspectRatio, updatedAt: node.updatedAt };
    }
    if (kind === 'audio') {
      const node = await db.aigcCanvasAudioNode.findFirst({ where: { id: nodeId, projectId } });
      if (!node) throw new NotFoundException('音频节点不存在');
      return { where: { audioNodeId: nodeId, kind: 'audio' }, url: node.audioUrl, aspectRatio: '', updatedAt: node.updatedAt };
    }
    if (kind === 'text' || kind === 'script') throw new BadRequestException('文本和剧本节点没有媒体历史');
    const node = await db.aigcShot.findFirst({ where: { id: nodeId, projectId } });
    if (!node) throw new NotFoundException('分镜或视频节点不存在');
    const mediaKind = kind === 'video' ? 'video' : 'image';
    return { where: { shotId: nodeId, kind: mediaKind }, url: kind === 'video' ? node.videoUrl : node.imageUrl, aspectRatio: node.aspectRatio, updatedAt: node.updatedAt };
  }

  private async retainCurrentMedia(db: Prisma.TransactionClient, target: MediaTarget) {
    if (!target.url) return null;
    const current = await db.aigcMediaVersion.findFirst({ where: { ...target.where, url: target.url }, orderBy: { createdAt: 'desc' } });
    return current ?? db.aigcMediaVersion.create({ data: { ...target.where, url: target.url, aspectRatio: target.aspectRatio, source: 'existing', isCurrent: true, createdAt: target.updatedAt } });
  }

  private async selectMediaVersion(db: Prisma.TransactionClient, target: MediaTarget, url: string, aspectRatio: string, source: string) {
    await db.aigcMediaVersion.updateMany({ where: target.where, data: { isCurrent: false } });
    if (!url) return;
    const existing = await db.aigcMediaVersion.findFirst({ where: { ...target.where, url }, orderBy: { createdAt: 'desc' } });
    if (existing) await db.aigcMediaVersion.update({ where: { id: existing.id }, data: { isCurrent: true } });
    else await db.aigcMediaVersion.create({ data: { ...target.where, url, aspectRatio, source, isCurrent: true } });
  }

  private parseNodeKind(kind: string): NodeKind {
    if (!nodeKinds.includes(kind as NodeKind)) throw new BadRequestException('不支持的节点类型');
    return kind as NodeKind;
  }

  private defaultNodeTitle(kind: NodeKind) {
    return { character: '新建角色', scene: '新建场景', prop: '新建道具' }[kind] ?? '新建节点';
  }

  private assetUpdate(input: SaveNodeDto): Prisma.AigcAssetUpdateInput {
    return {
      name: input.name,
      description: input.description,
      appearance: input.appearance,
      prompt: input.prompt,
      imageUrl: input.imageUrl,
      aspectRatio: input.aspectRatio,
      relatedAssetIds: input.assetIds,
    };
  }

  private async assertProjectEpisode(projectId: string, episodeNumber: number) {
    const episode = await prisma.aigcEpisode.findUnique({
      where: { projectId_episodeNumber: { projectId, episodeNumber } },
      select: { id: true },
    });
    if (!episode) throw new NotFoundException('分集不存在');
    return episode.id;
  }

  async assertNodeEpisode(projectId: string, kind: string, nodeId: string, episodeNumber: number) {
    if (['character', 'scene', 'prop'].includes(kind)) {
      const asset = await prisma.aigcAsset.findFirst({ where: { id: nodeId, projectId, kind, OR: [{ episodes: { some: { episode: { projectId, episodeNumber } } } }, { episodeNumber, episodes: { none: {} } }] }, select: { id: true } });
      if (!asset) throw new BadRequestException('只能使用当前分集关联的素材');
    } else {
      const node = await this.getNode(projectId, kind, nodeId);
      if (node.episodeNumber !== episodeNumber) throw new BadRequestException('只能连接当前分集的节点');
    }
  }
}
