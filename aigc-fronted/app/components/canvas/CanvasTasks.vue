<script setup lang="ts">
import { ArrowLeft, AudioWaveform, Check, CircleAlert, Clock3, Eye, Film, Image as ImageIcon, ListTodo, LoaderCircle, RefreshCw, Square, X } from 'lucide-vue-next'
import type { CanvasJob, CanvasReference } from '~/types/canvas'

const props = defineProps<{
  jobs: CanvasJob[]
  loading: boolean
  error: string
  cancelling: string[]
  mediaUrl: (url: string) => string
}>()
const emit = defineEmits<{
  close: []
  refresh: []
  cancel: [jobId: string]
  preview: [payload: { title: string, url: string, kind: string, content?: string }]
}>()
const selectedId = ref('')
const selected = computed(() => props.jobs.find(job => job.id === selectedId.value))
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
const active = (job: CanvasJob) => ['queued', 'running'].includes(job.status)
const statusLabel = (job: CanvasJob) => ({ queued: '排队中', running: '生成中', succeeded: '已完成', cancelled: '已中断', failed: '失败' }[job.status] || job.status)
const statusIcon = (job: CanvasJob) => ({ queued: Clock3, running: LoaderCircle, succeeded: Check, cancelled: Square, failed: CircleAlert }[job.status] || Clock3)
const kindLabel = (job: CanvasJob) => ({ canvas_text: '文本生成', canvas_image: '图片生成', canvas_video: '视频生成', canvas_export: '成片导出', canvas_asset_extract: '剧本资源提取' }[job.kind] || '生成任务')
const title = (job: CanvasJob) => job.input?.nodeTitle || kindLabel(job)
const timestamp = (date?: string) => date ? new Date(date).toLocaleString('zh-CN', { hour12: false }) : ''
function elapsed(job: CanvasJob) {
  if (!job.createdAt) return ''
  const seconds = Math.max(0, Math.floor(((active(job) ? now.value : new Date(job.updatedAt || job.createdAt).getTime()) - new Date(job.createdAt).getTime()) / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}
function requestToken(reference: CanvasReference, job: CanvasJob) {
  const references = job.references || []
  const index = references.filter(item => item.kind === reference.kind).findIndex(item => item.sourceKey === reference.sourceKey)
  return `@${{ image: '图片', video: '视频', audio: '音色' }[reference.kind]}${index + 1}`
}
function previewReference(reference: CanvasReference) {
  emit('preview', { title: `${reference.token} · ${reference.name}`, kind: reference.kind, url: props.mediaUrl(reference.url) })
}
function previewResult(job: CanvasJob) {
  emit('preview', { title: title(job), kind: job.kind === 'canvas_export' ? job.input?.outputFormat === 'mp3' ? 'audio' : 'video' : job.kind === 'canvas_video' ? 'video' : ['canvas_text','canvas_asset_extract'].includes(job.kind) ? 'text' : 'image', url: props.mediaUrl(job.result?.url || ''), content: job.result?.content })
}
function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (selectedId.value) selectedId.value = ''
    else emit('close')
  }
}
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 1000); document.addEventListener('keydown', onEscape) })
onBeforeUnmount(() => { if (clock) clearInterval(clock); document.removeEventListener('keydown', onEscape) })
</script>

<template>
  <Teleport to="body">
    <div class="canvas-tasks-backdrop" @click.self="emit('close')">
      <section class="canvas-tasks" :class="{ 'is-detail': selected }" role="dialog" aria-modal="true" aria-labelledby="canvas-tasks-title">
        <header class="tasks-header">
          <div><button v-if="selected" type="button" class="tasks-icon-button" title="返回任务列表" @click="selectedId = ''"><ArrowLeft :size="17" /></button><ListTodo v-else :size="17" /><h2 id="canvas-tasks-title">{{ selected ? '任务详情' : '生成任务' }}</h2><span v-if="!selected">{{ jobs.filter(active).length }} 项进行中</span></div>
          <div><button type="button" class="tasks-icon-button" title="刷新任务" :disabled="loading" @click="emit('refresh')"><RefreshCw :size="15" :class="{ spin: loading }" /></button><button type="button" class="tasks-icon-button" title="关闭任务菜单" @click="emit('close')"><X :size="18" /></button></div>
        </header>
        <div v-if="error" class="tasks-error" role="alert">{{ error }}</div>
        <div v-if="selected" class="task-detail-body">
          <div class="task-detail-heading"><component :is="statusIcon(selected)" :size="18" :class="{ spin: selected.status === 'running' }" /><h3>{{ title(selected) }}</h3><span :class="['task-status', `status-${selected.status}`]">{{ statusLabel(selected) }}</span></div>
          <dl class="task-metadata">
            <div><dt>任务类型</dt><dd>{{ kindLabel(selected) }} · 第 {{ selected.episodeNumber }} 集</dd></div>
            <div><dt>模型</dt><dd>{{ [selected.input?.configName, selected.input?.model].filter(Boolean).join(' · ') || '—' }}</dd></div>
            <div v-if="selected.input?.genre"><dt>题材</dt><dd>{{ selected.input.genre }}</dd></div>
            <div v-if="selected.input?.style"><dt>视觉风格</dt><dd>{{ selected.input.style }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ timestamp(selected.createdAt) || '—' }}</dd></div>
            <div><dt>{{ active(selected) ? '已用时' : '耗时' }}</dt><dd>{{ elapsed(selected) || '—' }}</dd></div>
            <div v-if="selected.input?.aspectRatio && selected.kind !== 'canvas_text'"><dt>生成设置</dt><dd>{{ selected.input.aspectRatio }}<template v-if="selected.kind === 'canvas_video'"> · {{ selected.input.duration }}s · {{ selected.input.resolution }}</template></dd></div>
          </dl>
          <p v-if="selected.error" class="tasks-error">{{ selected.error }}</p>
          <section class="task-detail-section"><h4>本次提交的参考素材 <span>{{ selected.references?.length || 0 }}</span></h4>
            <div v-if="selected.references?.length" class="task-reference-grid">
              <button v-for="reference in selected.references" :key="reference.sourceKey" type="button" class="task-reference" :title="`预览 ${reference.name}`" @click="previewReference(reference)">
                <span class="task-reference-media"><img v-if="reference.kind === 'image'" :src="mediaUrl(reference.url)" :alt="reference.name"><video v-else-if="reference.kind === 'video'" :src="mediaUrl(reference.url)" muted playsinline preload="metadata" /><AudioWaveform v-else :size="27" /></span>
                <strong>{{ reference.token }}<template v-if="requestToken(reference, selected) !== reference.token"> → {{ requestToken(reference, selected) }}</template></strong><span>{{ reference.name }}</span>
              </button>
            </div><p v-else class="task-muted">未提交参考素材</p>
          </section>
          <section class="task-detail-section"><h4>提示词</h4><pre>{{ selected.input?.prompt || '—' }}</pre></section>
          <section v-if="selected.input?.providerPrompt && selected.input.providerPrompt !== selected.input.prompt" class="task-detail-section"><h4>请求引用编号转换后</h4><pre>{{ selected.input.providerPrompt }}</pre></section>
          <section v-if="selected.result?.url || selected.result?.content" class="task-detail-section"><button type="button" class="task-text-button" @click="previewResult(selected)"><Eye :size="15" />查看生成结果</button></section>
        </div>
        <div v-else class="tasks-list">
          <div v-if="!jobs.length" class="tasks-empty"><LoaderCircle v-if="loading" :size="25" class="spin" /><ListTodo v-else :size="28" /><span>{{ loading ? '正在读取任务' : '暂无生成任务' }}</span></div>
          <article v-for="job in jobs" :key="job.id" class="task-row">
            <component :is="job.kind === 'canvas_video' ? Film : job.kind === 'canvas_image' ? ImageIcon : ListTodo" :size="18" class="task-kind-icon" />
            <div class="task-row-content"><div class="task-row-title"><strong :title="title(job)">{{ title(job) }}</strong><span :class="['task-status', `status-${job.status}`]"><LoaderCircle v-if="active(job)" :size="11" class="spin" />{{ statusLabel(job) }}</span></div><p>{{ kindLabel(job) }} · 第 {{ job.episodeNumber }} 集</p><p>{{ timestamp(job.createdAt) }}<span v-if="elapsed(job)"> · {{ elapsed(job) }}</span></p><p v-if="job.error" class="task-row-error">{{ job.error }}</p><div class="task-row-actions"><button type="button" class="task-text-button" @click="selectedId = job.id"><Eye :size="13" />查看</button><button v-if="active(job)" type="button" class="task-text-button" :disabled="cancelling.includes(job.id)" @click="emit('cancel', job.id)"><LoaderCircle v-if="cancelling.includes(job.id)" :size="12" class="spin" /><Square v-else :size="12" />{{ cancelling.includes(job.id) ? '中断中' : '中断' }}</button></div></div>
          </article>
        </div>
        <footer v-if="selected" class="task-detail-footer"><button type="button" class="secondary-button" @click="selectedId = ''">返回列表</button><button v-if="active(selected)" type="button" class="secondary-button" :disabled="cancelling.includes(selected.id)" @click="emit('cancel', selected.id)"><Square :size="13" />中断任务</button></footer>
      </section>
    </div>
  </Teleport>
</template>
