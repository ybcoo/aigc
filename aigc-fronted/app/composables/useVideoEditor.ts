import { createEditorService } from '~/services/editor/editor.service'
import { normalizeTimeline, timelineDuration } from '~/lib/timeline'
import type { AIGCTimeline } from '~/types/timeline'
import type { EditorData } from '~/types/editor'

export function useVideoEditor(projectId: string, episode: number) {
  const api = createEditorService(useRuntimeConfig().public.apiBase, projectId, episode)
  const data = ref<EditorData>()
  const timeline = ref<AIGCTimeline>({ version: 1, fps: 30, clips: [], audio_tracks: [], subtitles: [] })
  const loading = ref(true), saving = ref(false), dirty = ref(false), error = ref(''), conflict = ref(false)
  const undoStack = ref<AIGCTimeline[]>([]), redoStack = ref<AIGCTimeline[]>([])
  let revision = 0, changes = 0, disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingSave: Promise<void> | undefined
  const key = `aigc-editor-draft:${projectId}:${episode}`
  function persist() { try { localStorage.setItem(key, JSON.stringify({ timeline: timeline.value, revision, dirty: dirty.value })) } catch {} }
  function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => { void save().catch(() => {}) }, 800) }
  function edit(value: AIGCTimeline) {
    if (disposed) return
    const next = normalizeTimeline(value)
    if (JSON.stringify(next) === JSON.stringify(timeline.value)) return
    undoStack.value = [...undoStack.value.slice(-79), structuredClone(toRaw(timeline.value))]
    redoStack.value = []
    timeline.value = next; dirty.value = true; changes++; persist(); schedule()
  }
  function undo() {
    const value = undoStack.value.at(-1); if (!value) return
    redoStack.value.push(structuredClone(toRaw(timeline.value))); undoStack.value.pop(); timeline.value = value; changes++; dirty.value = true; persist(); schedule()
  }
  function redo() {
    const value = redoStack.value.at(-1); if (!value) return
    undoStack.value.push(structuredClone(toRaw(timeline.value))); redoStack.value.pop(); timeline.value = value; changes++; dirty.value = true; persist(); schedule()
  }
  async function load() {
    loading.value = true; error.value = ''
    try {
      const result = await api.get(); if (disposed) return
      data.value = result; revision = result.revision
      timeline.value = result.timeline || { version: 1, fps: 30, clips: [], audio_tracks: [], subtitles: [] }
      const local = JSON.parse(localStorage.getItem(key) || 'null')
      if (local?.dirty && local.revision === revision) { timeline.value = normalizeTimeline(local.timeline); dirty.value = true; schedule() }
      else if (local?.dirty) error.value = '发现旧的本地草稿，服务端已有新版本，已保留本地备份'
    } catch (cause) { error.value = cause instanceof Error ? cause.message : '剪辑草稿加载失败' }
    finally { loading.value = false }
  }
  async function save(): Promise<void> {
    if (conflict.value) throw new Error(error.value)
    if (pendingSave) { await pendingSave; if (dirty.value && !disposed) return save(); return }
    if (!dirty.value || !data.value) return
    const marker = changes, snapshot = structuredClone(toRaw(timeline.value))
    saving.value = true
    pendingSave = (async () => {
      try {
        const result = await api.save(snapshot, revision)
        revision = result.revision
        if (!disposed) { dirty.value = changes !== marker; error.value = ''; persist() }
      } catch (cause: any) {
        if (cause.statusCode === 409 || cause.status === 409) conflict.value = true
        error.value = cause.data?.message || cause.message || '保存草稿失败'; throw cause
      } finally { saving.value = false; pendingSave = undefined }
    })()
    await pendingSave
    if (dirty.value && !disposed) return save()
  }
  onMounted(load)
  onBeforeUnmount(() => { disposed = true; if (timer) clearTimeout(timer); if (dirty.value) persist() })
  return { api, data, timeline, loading, saving, dirty, error, conflict, undoStack, redoStack, edit, undo, redo, save, total: computed(() => timelineDuration(timeline.value)) }
}
