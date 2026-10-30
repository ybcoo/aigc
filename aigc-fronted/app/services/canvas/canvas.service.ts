import type { CanvasGenerationInput, CanvasJob, CanvasLink, CanvasMediaVersion, CanvasPayload, CanvasRecord, Episode, NodeKind, NodeSaveInput, Project, ScriptImportPreview, ScriptImportSettings } from '~/types/canvas'

interface ApiEnvelope<T> {
  data: T
}

export function createCanvasService(apiBase: string) {
  const request = <T>(path: string, options: Parameters<typeof $fetch>[1] = {}) =>
    $fetch<ApiEnvelope<T>>(`${apiBase}${path}`, options).then(response => response.data)

  return {
    listProjects: () => request<Project[]>('/projects'),
    createProject: (input: { title?: string, aspectRatio: string, episodeCount: number, scriptContent?: string, textModelId?: string, genre?: string, style?: string }) =>
      request<Project>('/projects', { method: 'POST', body: input }),
    updateProject: (projectId: string, title: string) =>
      request<Pick<Project, 'id' | 'title' | 'updatedAt'>>(`/projects/${projectId}`, { method: 'PUT', body: { title } }),
    deleteProject: (projectId: string) => request<{ id: string }>(`/projects/${projectId}`, { method: 'DELETE' }),
    createEpisode: (projectId: string) => request<{ episode: Episode, episodeCount: number }>(`/projects/${projectId}/episodes`, { method: 'POST' }),
    previewScriptImport: (file: File, settings: ScriptImportSettings) => {
      const body = new FormData()
      body.append('file', file)
      for (const [key, value] of Object.entries(settings)) if (value !== undefined) body.append(key, value)
      return request<ScriptImportPreview>('/projects/import-script?preview=true', { method: 'POST', body })
    },
    importScript: (file: File, settings: ScriptImportSettings) => {
      const body = new FormData()
      body.append('file', file)
      for (const [key, value] of Object.entries(settings)) if (value !== undefined) body.append(key, value)
      return request<Pick<Project, 'id' | 'title' | 'episodeCount'>>('/projects/import-script', { method: 'POST', body })
    },
    getCanvas: (projectId: string, episodeNumber: number) =>
      request<CanvasPayload>(`/projects/${projectId}/canvas?episode=${episodeNumber}`),
    createNode: (projectId: string, kind: NodeKind, input: NodeSaveInput) =>
      request<CanvasRecord>(`/projects/${projectId}/nodes/${kind}`, { method: 'POST', body: input }),
    updateNode: (projectId: string, kind: NodeKind, nodeId: string, input: NodeSaveInput) =>
      request<CanvasRecord>(`/projects/${projectId}/nodes/${kind}/${nodeId}`, { method: 'PUT', body: input }),
    deleteNode: (projectId: string, kind: NodeKind, nodeId: string, episode?: number) =>
      request<{ id: string }>(`/projects/${projectId}/nodes/${kind}/${nodeId}${episode ? `?episode=${episode}` : ''}`, { method: 'DELETE' }),
    listMediaVersions: (projectId: string, kind: NodeKind, nodeId: string) =>
      request<CanvasMediaVersion[]>(`/projects/${projectId}/nodes/${kind}/${nodeId}/versions`),
    restoreMediaVersion: (projectId: string, kind: NodeKind, nodeId: string, versionId: string) =>
      request<CanvasRecord>(`/projects/${projectId}/nodes/${kind}/${nodeId}/versions/${versionId}/restore`, { method: 'POST' }),
    generateNode: (projectId: string, kind: NodeKind, nodeId: string, input: CanvasGenerationInput) =>
      request<CanvasJob>(`/projects/${projectId}/nodes/${kind}/${nodeId}/generate`, { method: 'POST', body: input }),
    getJob: (projectId: string, jobId: string) => request<CanvasJob>(`/projects/${projectId}/jobs/${jobId}`),
    listJobs: (projectId: string) => request<CanvasJob[]>(`/projects/${projectId}/jobs`),
    cancelJob: (projectId: string, jobId: string) => request<CanvasJob>(`/projects/${projectId}/jobs/${jobId}/cancel`, { method: 'POST' }),
    uploadReference: (projectId: string, kind: NodeKind, nodeId: string, referenceKind: 'image' | 'video' | 'audio', file: File, episode?: number) => {
      const body = new FormData()
      body.append('file', file)
      return request<unknown>(`/projects/${projectId}/nodes/${kind}/${nodeId}/references/${referenceKind}${episode ? `?episode=${episode}` : ''}`, { method: 'POST', body })
    },
    saveScript: (projectId: string, episode: number, content: string, settings: { title?: string, genre?: string, style?: string } = {}) => request<unknown>(`/projects/${projectId}/episodes/${episode}/script`, { method: 'PUT', body: { content, ...settings } }),
    extractScriptAssets: (projectId: string, episode: number, input: { kind: 'character' | 'scene' | 'prop', modelId?: string, aspectRatio: string }) => request<CanvasJob>(`/projects/${projectId}/episodes/${episode}/script/extract`, { method: 'POST', body: input }),
    createLink: (projectId: string, input: Record<string, unknown>) =>
      request<CanvasLink>(`/projects/${projectId}/links`, { method: 'POST', body: input }),
    deleteLink: (projectId: string, linkId: string) =>
      request<{ id: string }>(`/projects/${projectId}/links/${linkId}`, { method: 'DELETE' }),
    saveLayout: (projectId: string, episodeNumber: number, nodes: Array<Record<string, number | string | undefined>>) =>
      request<{ count: number }>(`/projects/${projectId}/layout`, { method: 'PUT', body: { episodeNumber, nodes } }),
    uploadNodeFile: (projectId: string, kind: NodeKind, nodeId: string, file: File) => {
      const body = new FormData()
      body.append('file', file)
      return request<CanvasRecord>(`/projects/${projectId}/nodes/${kind}/${nodeId}/upload`, { method: 'POST', body })
    },
  }
}
