import type { AIGCTimeline } from '~/types/timeline'
import type { EditorData, EditorExportOptions, EditorMedia } from '~/types/editor'
import type { CanvasJob } from '~/types/canvas'
export function createEditorService(base: string, projectId: string, episode: number) {
  const root = `${base}/projects/${projectId}/episodes/${episode}/editor`
  const request = <T>(path = '', options: Parameters<typeof $fetch>[1] = {}) => $fetch<{ data: T }>(root + path, options).then(result => result.data)
  return {
    get: () => request<EditorData>(),
    save: (timeline: AIGCTimeline, revision: number) => request<{ timeline: AIGCTimeline, revision: number }>('', { method: 'PUT', body: { timeline, revision } }),
    import: (kind: string, nodeId: string) => request<EditorMedia>('/import', { method: 'POST', body: { kind, nodeId } }),
    upload: (kind: string, file: File) => { const body = new FormData(); body.append('file', file); return request<EditorMedia>(`/media/${kind}`, { method: 'POST', body }) },
    export: (timeline: AIGCTimeline, options: EditorExportOptions) => request<CanvasJob>('/exports', { method: 'POST', body: { ...options, timeline } }),
    cancel: (id: string) => request<CanvasJob>(`/exports/${id}/cancel`, { method: 'POST' }),
    job: (id: string) => $fetch<{ data: CanvasJob }>(`${base}/projects/${projectId}/jobs/${id}`).then(result => result.data),
  }
}
