import type { AigcAIConfig } from '@prisma/client';
import type { CanvasReference } from '../canvas/canvas-context';
import type { GenerationInput } from './generation.provider';

const successStatuses = new Set(['succeeded', 'success', 'completed', 'complete', 'finished', 'done', 'ok']);
const failureStatuses = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled', 'fail', 'expired']);
type VideoRecord = Record<string, unknown>;

function record(value: unknown): value is VideoRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function taskRecords(payload: unknown, depth = 0): VideoRecord[] {
  if (depth > 5) return [];
  if (Array.isArray(payload)) return payload.flatMap(value => taskRecords(value, depth + 1));
  if (!record(payload)) return [];
  return [payload, ...['data', 'output', 'result', 'content', 'metadata', 'outputs'].flatMap(key => taskRecords(payload[key], depth + 1))];
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function httpUrl(value: unknown) {
  const url = text(value);
  try { return ['http:', 'https:'].includes(new URL(url).protocol) ? url : ''; }
  catch { return ''; }
}

export function videoProtocol(config: AigcAIConfig, model: string) {
  const runtime = (config.runtimeParams || {}) as Record<string, string>;
  const host = new URL(config.baseUrl).hostname.toLowerCase();
  if (config.apiProtocol === 'volcengine' || runtime.video_format === 'ark' || host === 'volces.com' || host.endsWith('.volces.com')) return 'ark';
  const xingzhan = config.provider.toLowerCase() === 'xingzhan' || host === 'xingzhan.cloud' || host.endsWith('.xingzhan.cloud');
  if (xingzhan && /^wan\d/i.test(model.trim())) return 'xingzhan-wan';
  if (xingzhan && /seedance/i.test(model)) return 'xingzhan-seedance';
  return 'openai';
}

export function wanVideoPrompt(prompt: string, ratio: string) {
  // Remove only the ratio annotation's line suffix, preserving dialogue on later lines.
  const clean = prompt.split('\n').map(line => line.replace(/=videoratio.*$/i, '').trim()).filter(Boolean).join('\n').trim();
  return clean.startsWith(`${ratio} `) || clean.startsWith(`${ratio}，`) ? clean : `${ratio} ${clean}`;
}

export function videoMediaPrompt(config: AigcAIConfig, model: string, prompt: string) {
  const protocol = videoProtocol(config, model);
  if (protocol === 'openai') return prompt;
  if (/seedance/i.test(model)) return prompt.replace(/@音色(\d+)/g, '@音频$1');
  if (/^wan\d/i.test(model.trim())) return prompt.replace(/@(图片|视频|音色)(\d+)/g, (_token, kind: string, number: string) => `${{ 图片: 'Image', 视频: 'Video', 音色: 'Audio' }[kind]} ${number}`);
  return prompt;
}

export function buildVideoBody(config: AigcAIConfig, input: GenerationInput, references: CanvasReference[]) {
  const protocol = videoProtocol(config, input.model);
  const prompt = videoMediaPrompt(config, input.model, input.prompt);
  const body: Record<string, unknown> = { model: input.model, prompt, duration: input.duration, ratio: input.aspectRatio };
  const runtime = (config.runtimeParams || {}) as Record<string, string>;
  if (!['1', 'true'].includes(String(runtime.video_resolution_off).trim().toLowerCase()) && input.resolution) {
    body[runtime.video_resolution_param?.trim() || 'resolution'] = runtime.video_resolution_value?.trim() || (protocol === 'xingzhan-wan' ? input.resolution.toUpperCase() : input.resolution);
  }
  if (protocol === 'ark') {
    delete body.prompt;
    return { ...body, watermark: false, content: [{ type: 'text', text: prompt }, ...references.map(reference => ({ type: `${reference.kind}_url`, [`${reference.kind}_url`]: { url: reference.url }, role: `reference_${reference.kind}` }))] };
  }
  if (protocol === 'xingzhan-wan') return {
    ...body, prompt: wanVideoPrompt(prompt, input.aspectRatio), generate_audio: true,
    media: references.map(reference => ({ type: reference.kind, url: reference.url })),
  };
  if (protocol === 'xingzhan-seedance') return {
    ...body, generate_audio: true,
    ...(references.length ? { media: references.map(reference => ({ type: reference.kind, url: reference.url })), omni_reference_task_type: 'reference' } : {}),
  };
  if (references.some(reference => reference.kind !== 'image')) throw new Error('当前视频协议尚不支持参考视频或音频，请选择对应协议的模型');
  return { ...body, images: references.map(reference => reference.url) };
}

export function videoTaskId(payload: unknown) {
  for (const row of taskRecords(payload)) for (const key of ['id', 'task_id', 'taskId']) {
    const id = text(row[key]);
    if (id) return id;
  }
  return '';
}

export function videoTaskStatus(payload: unknown) {
  const rows = taskRecords(payload);
  if (record(payload) && record(payload.data)) rows.unshift(payload.data);
  for (const row of rows) for (const key of ['status', 'state', 'task_status']) {
    const status = text(row[key]).toLowerCase();
    if (status) return status;
  }
  return '';
}

export function videoTaskFailed(status: string) { return failureStatuses.has(status); }
export function videoTaskSucceeded(status: string) { return successStatuses.has(status); }

export function videoResultUrl(payload: unknown) {
  const rows = taskRecords(payload);
  for (const row of rows) for (const key of ['video_url', 'url', 'result_url']) {
    const url = httpUrl(row[key]);
    if (url) return url;
  }
  // Xingzhan can put a successful video URL in fail_reason; never treat failure text as a result.
  if (videoTaskSucceeded(videoTaskStatus(payload))) for (const row of rows) {
    const url = httpUrl(row.fail_reason);
    if (url) return url;
  }
  return '';
}

export function videoFailureMessage(payload: unknown) {
  const rows = taskRecords(payload);
  for (const row of rows) if (record(row.error)) {
    const message = text(row.error.message), code = text(row.error.code);
    if (message || code) return [code, message].filter(Boolean).join(': ');
  }
  for (const row of rows) for (const key of ['error', 'fail_reason', 'message', 'msg']) {
    const message = text(row[key]);
    if (message && !httpUrl(message)) return message;
  }
  return '视频供应商生成失败';
}

export function videoPollPath(query: string, taskId: string) {
  const id = encodeURIComponent(taskId);
  return /\{(?:taskId|task_id|videoId|video_id|id)\}/.test(query)
    ? query.replace(/\{(?:taskId|task_id|videoId|video_id|id)\}/g, id)
    : `${query.replace(/\/$/, '')}/${id}`;
}

export function videoResponseFields(payload: unknown, prefix = '', depth = 0): string[] {
  if (!record(payload) || depth > 4) return [];
  return Object.entries(payload).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...(['data', 'output', 'result', 'content', 'metadata'].includes(key) ? videoResponseFields(value, path, depth + 1) : [])];
  }).slice(0, 100);
}
