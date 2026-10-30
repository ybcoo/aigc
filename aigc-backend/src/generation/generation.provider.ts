import { Injectable, Optional } from '@nestjs/common';
import type { AigcAIConfig } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CanvasReference } from '../canvas/canvas-context';
import { StorageService } from '../storage/storage.service';
import { buildVideoBody, videoFailureMessage, videoPollPath, videoProtocol, videoResponseFields, videoResultUrl, videoTaskFailed, videoTaskId, videoTaskStatus, videoTaskSucceeded } from './generation.video';
export { buildVideoBody } from './generation.video';

export type GenerationInput = { kind: 'text' | 'image' | 'video'; model: string; prompt: string; systemPrompt?: string; aspectRatio: string; duration: number; resolution: string; references: CanvasReference[] };
export type VideoTaskProgress = { providerTaskId: string; providerStatus: string; providerResponseFields: string[] };

class ProviderHTTPError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function imageRequestSize(model: string, aspectRatio: string, provider: string) {
  const [w, h] = aspectRatio.split(':').map(Number);
  if (/seedream|doubao/i.test(model)) {
    // Match aiedu's Seedream sizes: at least 3,686,400 pixels, preserving the requested ratio.
    const sizes: Record<string, string> = {
      '1:1': '1920x1920', '16:9': '2560x1440', '9:16': '1440x2560',
      '4:3': '2240x1680', '3:4': '1680x2240', '3:2': '2400x1600', '2:3': '1600x2400',
    };
    if (sizes[aspectRatio]) return sizes[aspectRatio];
    const scale = Math.sqrt(3686400 / (w * h));
    return `${Math.ceil(w * scale / 64) * 64}x${Math.ceil(h * scale / 64) * 64}`;
  }
  if (provider === 'openai') return w === h ? '1024x1024' : w > h ? '1536x1024' : '1024x1536';
  const width = Math.round((w >= h ? 1536 : 1536 * w / h) / 16) * 16;
  const height = Math.round((h >= w ? 1536 : 1536 * h / w) / 16) * 16;
  return `${width}x${height}`;
}

export function providerPrompt(prompt: string, references: CanvasReference[]) {
  const counts = { image: 0, video: 0, audio: 0 };
  const names = { image: '图片', video: '视频', audio: '音色' };
  const mapping = new Map(references.map(reference => [reference.token, `@${names[reference.kind]}${++counts[reference.kind]}`]));
  return prompt.replace(/@(图片|视频|音色)\d+/g, token => mapping.get(token) || token);
}

@Injectable()
export class GenerationProvider {
  private readonly videoPollTimeoutMs = 15 * 60 * 1000;
  constructor(@Optional() private readonly storage: StorageService = new StorageService()) {}
  async generate(config: AigcAIConfig, input: GenerationInput, signal: AbortSignal, onVideoTask?: (progress: VideoTaskProgress) => Promise<void>): Promise<{ content?: string; url?: string }> {
    const references = await Promise.all(input.references.map(async reference => ({ ...reference, url: await this.referenceUrl(reference, input.kind, signal) })));
    const prompt = providerPrompt(input.prompt, input.references);
    const request = { ...input, prompt, references };
    if (config.apiProtocol === 'gemini') return this.gemini(config, request, signal);
    if (input.kind === 'text') {
      const payload = await this.json(config, config.endpoint || '/chat/completions', {
        model: input.model, messages: [...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []), { role: 'user', content: prompt }], stream: false,
      }, signal);
      const content = payload.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text || '').join('') : '';
      if (!text.trim()) throw new Error('文本模型没有返回可用内容');
      return { content: text };
    }
    if (input.kind === 'image') return { url: await this.image(config, request, signal) };
    return { url: await this.video(config, request, signal, onVideoTask) };
  }

  private async image(config: AigcAIConfig, input: GenerationInput, signal: AbortSignal) {
    const size = imageRequestSize(input.model, input.aspectRatio, config.apiProtocol === 'dashscope' ? 'dashscope' : config.provider);
    const prompt = `${input.prompt}\n输出画幅：${input.aspectRatio}。`;
    let payload: any;
    if (config.apiProtocol === 'dashscope') {
      payload = await this.json(config, config.endpoint || '/api/v1/services/aigc/multimodal-generation/generation', {
        model: input.model, input: { messages: [{ role: 'user', content: [...input.references.map(reference => ({ image: reference.url })), { text: prompt }] }] },
        parameters: { size: size.replace('x', '*'), n: 1, watermark: false },
      }, signal);
      const parts = payload.output?.choices?.[0]?.message?.content || [];
      const url = parts.find(part => part.image)?.image;
      if (url) return this.storeMedia(url, 'image', signal);
    } else if (config.provider === 'openai' && input.references.length) {
      const form = new FormData();
      form.set('model', input.model); form.set('prompt', prompt);
      form.set('size', size);
      for (const reference of input.references) {
        const response = await fetch(reference.url, { signal });
        if (!response.ok) throw new Error('无法读取参考图片');
        form.append('image[]', await response.blob(), 'reference.png');
      }
      payload = await this.json(config, config.endpoint || '/images/edits', form, signal);
    } else {
      payload = await this.json(config, config.endpoint || '/images/generations', {
        model: input.model, prompt, n: 1, size,
        ...(input.references.length ? { image: input.references.map(reference => reference.url) } : {}),
      }, signal);
    }
    const item = payload.data?.[0] || payload.images?.[0];
    const url = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
    if (!url) throw new Error('生图模型没有返回可用图片');
    return this.storeMedia(url, 'image', signal);
  }

  private waitForVideoPoll(signal: AbortSignal) { return delay(5000, undefined, { signal }); }

  private async video(config: AigcAIConfig, input: GenerationInput, signal: AbortSignal, onVideoTask?: (progress: VideoTaskProgress) => Promise<void>) {
    const ark = videoProtocol(config, input.model) === 'ark';
    const endpoint = config.endpoint || (ark ? '/contents/generations/tasks' : '/video/generations');
    let payload = await this.json(config, endpoint, buildVideoBody(config, input, input.references), signal);
    const taskId = videoTaskId(payload);
    const query = config.queryEndpoint || `${endpoint.replace(/\/$/, '')}/{id}`;
    const deadline = Date.now() + this.videoPollTimeoutMs;
    let lastProgress = '';
    for (;;) {
      signal.throwIfAborted();
      const status = videoTaskStatus(payload);
      const progress: VideoTaskProgress = { providerTaskId: taskId, providerStatus: status, providerResponseFields: videoResponseFields(payload) };
      const progressKey = JSON.stringify(progress);
      if (onVideoTask && progressKey !== lastProgress) { await onVideoTask(progress); lastProgress = progressKey; }
      if (videoTaskFailed(status)) throw new Error(videoFailureMessage(payload));
      const url = videoResultUrl(payload);
      if (url) return this.storeMedia(url, 'video', signal);
      if (!taskId) throw new Error('视频供应商没有返回视频地址或任务 ID');
      if (Date.now() >= deadline) throw new Error(videoTaskSucceeded(status)
        ? `视频供应商任务 ${taskId} 已完成，但查询仍未返回可用视频地址；请凭此任务 ID 查询原结果，勿重复提交生成`
        : `视频生成查询超时（上游任务 ${taskId}，最后状态 ${status || '未知'}），请查询原任务结果`);
      await this.waitForVideoPoll(signal);
      try { payload = await this.json(config, videoPollPath(query, taskId), undefined, signal); }
      catch (error) {
        signal.throwIfAborted();
        if (error instanceof ProviderHTTPError ? error.status >= 500 || [408, 429].includes(error.status) : error instanceof TypeError) continue;
        throw error;
      }
    }
  }

  private async gemini(config: AigcAIConfig, input: GenerationInput, signal: AbortSignal) {
    if (input.kind === 'video') throw new Error('Gemini 视频生成需要单独的视频协议配置');
    const parts: any[] = [{ text: input.prompt }];
    for (const reference of input.references) {
      const response = await fetch(reference.url, { signal });
      if (!response.ok) throw new Error('无法读取参考图片');
      parts.push({ inlineData: { mimeType: response.headers.get('content-type') || 'image/png', data: Buffer.from(await response.arrayBuffer()).toString('base64') } });
    }
    const endpoint = `/models/${encodeURIComponent(input.model)}:generateContent`;
    const base = config.baseUrl.replace(/\/$/, '').replace(/\/v1beta$/, '');
    const payload = await this.json({ ...config, baseUrl: `${base}/v1beta` }, endpoint, {
      contents: [{ parts }], ...(input.systemPrompt ? { systemInstruction: { parts: [{ text: input.systemPrompt }] } } : {}), ...(input.kind === 'image' ? { generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: input.aspectRatio } } } : {}),
    }, signal);
    const result = payload.candidates?.[0]?.content?.parts || [];
    if (input.kind === 'text') {
      const content = result.map(part => part.text || '').join('');
      if (!content) throw new Error('文本模型没有返回可用内容');
      return { content };
    }
    const image = result.find(part => part.inlineData || part.inline_data);
    const inline = image?.inlineData || image?.inline_data;
    if (!inline?.data) throw new Error('生图模型没有返回可用图片');
    return { url: await this.storeMedia(`data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`, 'image', signal) };
  }

  private async referenceUrl(reference: CanvasReference, targetKind: string, signal: AbortSignal) {
    if (/^https?:\/\//.test(reference.url) || reference.url.startsWith('data:')) return reference.url;
    if (!reference.url.startsWith('/uploads/aigc/')) throw new Error('参考素材路径无效');
    if (targetKind === 'video') { const publicUrl = await this.storage.providerReference(reference.url, signal); if (publicUrl) return publicUrl; }
    if (reference.kind !== 'image') throw new Error('本地视频/音频作为模型参考需要配置 PUBLIC_ASSET_BASE_URL，使服务商能够读取文件');
    signal.throwIfAborted();
    const base = resolve(process.cwd(), 'uploads', 'aigc');
    const path = resolve(process.cwd(), `.${reference.url}`);
    if (!path.startsWith(`${base}/`)) throw new Error('参考素材路径无效');
    const type = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' })[extname(path).toLowerCase()];
    if (!type) throw new Error('参考图片须为 PNG、JPEG 或 WebP');
    return `data:${type};base64,${(await readFile(path)).toString('base64')}`;
  }

  private async storeMedia(url: string, kind: 'image' | 'video', signal: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`保存生成结果失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) { await response.body?.cancel(); throw new Error('生成结果超过 100 MB'); }
    const chunks: Buffer[] = []; let size = 0;
    if (!response.body) throw new Error('生成结果为空');
    const reader = response.body.getReader();
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 100 * 1024 * 1024) throw new Error('生成结果超过 100 MB');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks, size);
    signal.throwIfAborted();
    if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('生成结果为空或超过 100 MB');
    const extension = kind === 'video' ? '.mp4' : contentType.includes('webp') ? '.webp' : contentType.includes('jpeg') ? '.jpg' : '.png';
    const name = `generated-${randomUUID()}${extension}`;
    return this.storage.putBuffer(bytes, name, signal);
  }

  private async json(config: AigcAIConfig, endpoint: string, body: Record<string, unknown> | FormData | undefined, signal: AbortSignal): Promise<any> {
    const headers: Record<string, string> = config.apiProtocol === 'gemini' ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`, { method: body ? 'POST' : 'GET', headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal });
    const text = await response.text();
    let result: any;
    try { result = JSON.parse(text); } catch {
      const message = `供应商返回了无效 JSON（HTTP ${response.status}）`;
      throw response.ok ? new Error(message) : new ProviderHTTPError(message, response.status);
    }
    if (!response.ok) throw new ProviderHTTPError(`供应商 HTTP ${response.status}：${String(result.error?.message || result.message || '请求失败').slice(0, 400)}`, response.status);
    return result;
  }
}
