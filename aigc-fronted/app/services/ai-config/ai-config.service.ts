import type { AIConfig, AIConfigInput, AIConfigTestResult } from '~/types/ai-config'

interface ApiEnvelope<T> { data: T }

export function createAIConfigService(apiBase: string) {
  const request = <T>(path: string, options: Parameters<typeof $fetch>[1] = {}) =>
    $fetch<ApiEnvelope<T>>(`${apiBase}${path}`, options).then(response => response.data)

  return {
    list: () => request<AIConfig[]>('/ai-configs'),
    save: (input: AIConfigInput, id?: string) => request<AIConfig>(id ? `/ai-configs/${id}` : '/ai-configs', {
      method: id ? 'PUT' : 'POST',
      body: input,
    }),
    remove: (id: string) => request<{ id: string }>(`/ai-configs/${id}`, { method: 'DELETE' }),
    test: (id: string) => request<AIConfigTestResult>(`/ai-configs/${id}/test`, { method: 'POST', body: { message: '请只回复：连接成功' } }),
    discoverModels: (input: Partial<AIConfigInput> & { id?: string }) => request<{ models: string[] }>('/ai-configs/models', {
      method: 'POST',
      body: input,
    }),
    async previewSpeech(input: { id?: string, baseUrl?: string, apiKey?: string, model?: string, voice?: string }) {
      const response = await fetch(`${apiBase}/ai-configs/tts-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.message || '音色试听失败')
      }
      return response.blob()
    },
  }
}
