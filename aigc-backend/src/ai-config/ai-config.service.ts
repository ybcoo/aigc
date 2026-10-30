import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AigcAIConfig } from '@prisma/client';
import { prisma } from '../../prisma/prisma.service';
import type { DiscoverModelsDto, PreviewSpeechDto, SaveAIConfigDto } from './ai-config.dto';

const requestTimeoutMs = 20_000;
const redPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=';

@Injectable()
export class AIConfigService {
  async list() {
    const rows = await prisma.aigcAIConfig.findMany({
      orderBy: [{ serviceType: 'asc' }, { isDefault: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  async create(input: SaveAIConfigDto) {
    const data = this.normalizeInput(input, true);
    const existingCount = await prisma.aigcAIConfig.count({ where: { serviceType: data.serviceType } });
    const isDefault = data.isDefault || existingCount === 0;
    const row = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.aigcAIConfig.updateMany({ where: { serviceType: data.serviceType }, data: { isDefault: false } });
      }
      return tx.aigcAIConfig.create({ data: { ...data, isDefault } });
    });
    return this.toView(row);
  }

  async update(id: string, input: SaveAIConfigDto) {
    const current = await this.getById(id);
    const data = this.normalizeInput(input, false);
    const row = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.aigcAIConfig.updateMany({ where: { serviceType: data.serviceType, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.aigcAIConfig.update({
        where: { id },
        data: { ...data, apiKey: input.apiKey?.trim() || current.apiKey },
      });
    });
    return this.toView(row);
  }

  async remove(id: string) {
    const current = await this.getById(id);
    await prisma.aigcAIConfig.delete({ where: { id } });
    if (current.isDefault) {
      const fallback = await prisma.aigcAIConfig.findFirst({
        where: { serviceType: current.serviceType, isActive: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });
      if (fallback) await prisma.aigcAIConfig.update({ where: { id: fallback.id }, data: { isDefault: true } });
    }
    return { id };
  }

  async discoverModels(input: DiscoverModelsDto) {
    const resolved = await this.resolveConnection(input);
    const url = this.modelsUrl(resolved.baseUrl, resolved.provider, resolved.apiProtocol, resolved.apiKey);
    const response = await this.fetch(url, { method: 'GET', headers: this.authHeaders(resolved.apiKey, resolved.apiProtocol) });
    const body = await this.readJson(response);
    if (!response.ok) throw new BadRequestException(this.providerError(response.status, body));
    const candidates = [
      ...(Array.isArray(body.data) ? body.data : []),
      ...(Array.isArray(body.models) ? body.models : []),
      ...(Array.isArray(body.items) ? body.items : []),
    ];
    const models = candidates.map((item: unknown) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return String(record.id || record.name || record.model || '').replace(/^models\//, '');
    }).filter(Boolean);
    return [...new Set(models)].slice(0, 500);
  }

  async test(id: string, message = '') {
    const row = await this.getById(id);
    const startedAt = Date.now();
    try {
      if (row.serviceType === 'text' || row.serviceType === 'vision') {
        const responseText = await this.testChat(row, message, row.serviceType === 'vision');
        return { success: true, response: `${responseText || '连接成功'}（${Date.now() - startedAt}ms）`, errorMessage: '' };
      }
      if (row.serviceType === 'tts') {
        await this.previewSpeech({ id: row.id, voice: this.runtimeParams(row).voice || '' });
        return { success: true, response: `连接成功（${Date.now() - startedAt}ms）`, errorMessage: '' };
      }
      const models = await this.discoverModels({ id: row.id });
      if (!models.length) throw new Error('服务已连接，但没有返回可用模型');
      return { success: true, response: `检测到 ${models.length} 个模型（${Date.now() - startedAt}ms）`, errorMessage: '' };
    } catch (error) {
      return { success: false, response: '', errorMessage: this.errorMessage(error) };
    }
  }

  async previewSpeech(input: PreviewSpeechDto) {
    const resolved = await this.resolveSpeech(input);
    if (!resolved.model || !resolved.voice) throw new BadRequestException('请先填写 TTS 模型和声音 ID');
    const endpoint = resolved.endpoint || '/audio/speech';
    const response = await this.fetch(this.joinUrl(resolved.baseUrl, endpoint), {
      method: 'POST',
      headers: { ...this.authHeaders(resolved.apiKey, resolved.apiProtocol), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: resolved.model, voice: resolved.voice, input: '你好，这是一段音色试听。', response_format: 'mp3' }),
    });
    if (!response.ok) {
      const body = await this.readJson(response);
      throw new BadRequestException(this.providerError(response.status, body));
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'audio/mpeg',
    };
  }

  private normalizeInput(input: SaveAIConfigDto, create: boolean): Prisma.AigcAIConfigUncheckedCreateInput {
    const models = [...new Set(input.models.map((model) => model.trim()).filter(Boolean))];
    const baseUrl = this.validBaseUrl(input.baseUrl);
    if (!input.name.trim() || !models.length || !input.defaultModel.trim()) throw new BadRequestException('名称、模型列表和默认模型不能为空');
    if (!models.includes(input.defaultModel.trim())) throw new BadRequestException('默认模型必须存在于模型列表中');
    if (create && !input.apiKey?.trim()) throw new BadRequestException('新增配置必须填写 API Key');
    const maxReferences = input.runtimeParams?.max_reference_images;
    if (maxReferences && (!/^\d+$/.test(maxReferences) || Number(maxReferences) < 1 || Number(maxReferences) > 64)) {
      throw new BadRequestException('最大参考图数必须是 1 到 64 的整数');
    }
    return {
      serviceType: input.serviceType.trim(),
      provider: input.provider.trim(),
      apiProtocol: input.apiProtocol.trim() || 'openai',
      name: input.name.trim(),
      baseUrl,
      apiKey: input.apiKey?.trim() ?? '',
      models: models as Prisma.InputJsonValue,
      defaultModel: input.defaultModel.trim(),
      endpoint: this.normalizeEndpoint(input.endpoint),
      queryEndpoint: this.normalizeEndpoint(input.queryEndpoint),
      priority: input.priority,
      isDefault: input.isDefault,
      isActive: input.isActive,
      runtimeParams: (input.runtimeParams || {}) as Prisma.InputJsonValue,
    };
  }

  private async resolveConnection(input: DiscoverModelsDto) {
    const row = input.id ? await this.getById(input.id) : undefined;
    const baseUrl = this.validBaseUrl(input.baseUrl?.trim() || row?.baseUrl || '');
    const apiKey = input.apiKey?.trim() || row?.apiKey || '';
    if (!apiKey) throw new BadRequestException('请填写 API Key');
    return {
      baseUrl,
      apiKey,
      provider: input.provider?.trim() || row?.provider || '',
      apiProtocol: input.apiProtocol?.trim() || row?.apiProtocol || 'openai',
    };
  }

  private async resolveSpeech(input: PreviewSpeechDto) {
    const row = input.id ? await this.getById(input.id) : undefined;
    const runtime = row ? this.runtimeParams(row) : {};
    const baseUrl = this.validBaseUrl(input.baseUrl?.trim() || row?.baseUrl || '');
    const apiKey = input.apiKey?.trim() || row?.apiKey || '';
    if (!apiKey) throw new BadRequestException('请填写 API Key');
    return {
      baseUrl,
      apiKey,
      model: input.model?.trim() || row?.defaultModel || '',
      voice: input.voice?.trim() || runtime.voice || '',
      endpoint: row?.endpoint || '',
      apiProtocol: row?.apiProtocol || 'openai',
    };
  }

  private async testChat(row: AigcAIConfig, message: string, vision: boolean) {
    const prompt = message.trim() || '请只回复：连接成功';
    const isGemini = row.apiProtocol === 'gemini' || ['gemini', 'google'].includes(row.provider.toLowerCase());
    let url: string;
    let body: Record<string, unknown>;
    if (isGemini) {
      url = `${row.baseUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(row.defaultModel)}:generateContent?key=${encodeURIComponent(row.apiKey)}`;
      body = { contents: [{ parts: vision ? [{ text: '识别图片中的主要颜色，只回答颜色。' }, { inline_data: { mime_type: 'image/png', data: redPixel } }] : [{ text: prompt }] }] };
    } else {
      url = this.joinUrl(row.baseUrl.replace(/\/chat\/completions\/?$/, ''), '/chat/completions');
      body = {
        model: row.defaultModel,
        messages: [{ role: 'user', content: vision ? [{ type: 'text', text: '识别图片中的主要颜色，只回答颜色。' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${redPixel}` } }] : prompt }],
        max_tokens: 32,
      };
    }
    const response = await this.fetch(url, {
      method: 'POST',
      headers: { ...this.authHeaders(row.apiKey, row.apiProtocol), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await this.readJson(response);
    if (!response.ok) throw new BadRequestException(this.providerError(response.status, payload));
    if (isGemini) return String(payload.candidates?.[0]?.content?.parts?.[0]?.text || '连接成功');
    return String(payload.choices?.[0]?.message?.content || '连接成功');
  }

  private modelsUrl(baseUrl: string, provider: string, protocol: string, apiKey: string) {
    const base = baseUrl.replace(/\/(chat\/completions|models)\/?$/, '');
    if (protocol === 'gemini' || ['gemini', 'google'].includes(provider.toLowerCase())) {
      return `${base.replace(/\/v1beta$/, '')}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    }
    return `${base}/models`;
  }

  private authHeaders(apiKey: string, protocol: string): Record<string, string> {
    if (protocol === 'dashscope') return { Authorization: `Bearer ${apiKey}`, 'X-DashScope-SSE': 'disable' };
    return { Authorization: `Bearer ${apiKey}` };
  }

  private async fetch(url: string, init: RequestInit) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch (error) {
      throw new BadRequestException(`无法连接服务商：${this.errorMessage(error)}`);
    }
  }

  private async readJson(response: Response): Promise<any> {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
  }

  private providerError(status: number, payload: any) {
    const detail = payload?.error?.message || payload?.message || payload?.error || '';
    return `服务商返回 HTTP ${status}${detail ? `：${String(detail).slice(0, 500)}` : ''}`;
  }

  private validBaseUrl(value: string) {
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      return url.toString().replace(/\/$/, '');
    } catch {
      throw new BadRequestException('Base URL 必须是有效的 HTTP/HTTPS 地址');
    }
  }

  private normalizeEndpoint(value?: string) {
    const endpoint = value?.trim() || '';
    return endpoint && !endpoint.startsWith('/') ? `/${endpoint}` : endpoint;
  }

  private joinUrl(base: string, endpoint: string) {
    return `${base.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
  }

  private runtimeParams(row: AigcAIConfig) {
    return (row.runtimeParams && typeof row.runtimeParams === 'object' && !Array.isArray(row.runtimeParams) ? row.runtimeParams : {}) as Record<string, string>;
  }

  private async getById(id: string) {
    const row = await prisma.aigcAIConfig.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('AI 配置不存在');
    return row;
  }

  private toView(row: AigcAIConfig) {
    const models = Array.isArray(row.models) ? row.models.map(String) : [];
    return {
      id: row.id,
      serviceType: row.serviceType,
      provider: row.provider,
      apiProtocol: row.apiProtocol,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKeyMasked: this.maskKey(row.apiKey),
      models,
      defaultModel: row.defaultModel,
      endpoint: row.endpoint,
      queryEndpoint: row.queryEndpoint,
      priority: row.priority,
      isDefault: row.isDefault,
      isActive: row.isActive,
      runtimeParams: this.runtimeParams(row),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private maskKey(value: string) {
    if (!value) return '';
    return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }

  private errorMessage(error: unknown) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      return typeof response === 'string' ? response : String((response as { message?: string }).message || error.message);
    }
    return error instanceof Error ? error.message : String(error);
  }
}
