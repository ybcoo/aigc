<script setup lang="ts">
import { Handle, Position, useConnection, type ValidConnectionFunc } from '@vue-flow/core'
import {
  AudioWaveform,
  ChevronDown,
  Download,
  Eye,
  Film,
  FileText,
  History,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Pause,
  Plus,
  Square,
  X,
  Send,
  Settings2,
  Trash2,
  Type,
  Upload,
} from 'lucide-vue-next'
import AppSelect from '~/components/ui/AppSelect.vue'
import type { NodeKind } from '~/types/canvas'
import type { CanvasGenerationInput, CanvasJob, CanvasReference } from '~/types/canvas'
import CanvasMentionInput from './CanvasMentionInput.vue'

type VisualKind = 'text' | 'image' | 'audio' | 'video' | 'script'

interface CanvasNodeData {
  visualKind: VisualKind
  apiKind: NodeKind
  recordId: string
  title: string
  prompt: string
  content: string
  appearance?: string
  mediaUrl: string
  aspectRatio: string
  duration?: number
  resolution?: string
  modelOptions?: Array<{ value: string, label: string }>
  targetHandle: boolean
  sourceHandle: boolean
  editable: boolean
  deletable: boolean
  dimmed?: boolean
  uploading?: boolean
  references?: CanvasReference[]
  referenceUploading?: boolean
  referenceRemoving?: boolean
  job?: CanvasJob
  cancelling?: boolean
}

const props = defineProps<{
  id: string
  data: CanvasNodeData
  selected?: boolean
  isValidConnection?: ValidConnectionFunc
}>()
const emit = defineEmits<{
  save: [payload: { kind: string, id: string, prompt: string }]
  upload: [payload: { kind: string, id: string, file: File }]
  remove: [payload: { kind: string, id: string }]
  preview: [payload: { title: string, url: string, kind: VisualKind, content?: string }]
  details: [payload: CanvasNodeData]
  history: [payload: { kind: NodeKind, id: string, title: string }]
  'draft-change': [id: string, prompt: string]
  generate: [payload: { kind: NodeKind, id: string } & CanvasGenerationInput]
  cancel: [id: string]
  'add-reference': [payload: { kind: NodeKind, id: string, referenceKind: 'image' | 'video' | 'audio', file: File }]
  'remove-reference': [payload: { nodeId: string, reference: CanvasReference }]
  close: []
  edit: [payload: { id: string, title: string, content: string }]
  script: []
}>()

const prompt = ref(props.data.prompt || '')
const fileInput = ref<HTMLInputElement>()
const { startHandle } = useConnection()
const selectedModel = ref<string | number>()
const sourceMenuOpen = ref(false)
const sourceMenu = ref<HTMLElement>()
const mediaRatio = ref('')
const videoElement = ref<HTMLVideoElement>()
const videoPlaying = ref(false)
const videoError = ref('')
const videoStarting = ref(false)
let videoPlaybackSession = 0
const imageState = ref<'loading' | 'loaded' | 'error'>('loading')
const imageAttempt = ref(0)
const mentionInput = ref<InstanceType<typeof CanvasMentionInput>>()
const referenceInput = ref<HTMLInputElement>()
const referenceKind = ref<'image' | 'video' | 'audio'>('image')
const referenceMenuOpen = ref(false)
const failedReferenceVideos = reactive(new Set<string>())
const agentExpanded = ref(false)
const settingsOpen = ref(false)
const aspectRatio = ref(props.data.aspectRatio || '1:1')
const duration = ref(props.data.duration || 5)
const resolution = ref(props.data.resolution || '480p')
const aspectOptions = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].map(value => ({ value, label: value }))
const durationOptions = [5, 10, 15, 30].map(value => ({ value, label: `${value}s` }))
const resolutionOptions = ['480p', '720p', '1080p'].map(value => ({ value, label: value }))
const running = computed(() => Boolean(props.data.job && ['queued', 'running'].includes(props.data.job.status)))
const agentTitle = computed(() => `${nodeMeta.value.label} AI`)
const generationSettingsLabel = computed(() => `${aspectRatio.value} | ${duration.value}s`)
const referenceIsSelected = (token: string) => (prompt.value.match(/@(图片|视频|音色)\d+/g) || []).includes(token)

watch(() => props.selected, selected => {
  if (!selected) { agentExpanded.value = false; settingsOpen.value = false; referenceMenuOpen.value = false }
})

watch(() => props.data.mediaUrl, () => {
  videoPlaybackSession++
  videoElement.value?.pause()
  videoPlaying.value = false
  videoStarting.value = false
  videoError.value = ''
  mediaRatio.value = ''
  imageState.value = 'loading'
  imageAttempt.value = 0
})

watch(() => props.data.prompt, value => { if (value !== prompt.value) prompt.value = value || '' })
watch(prompt, value => emit('draft-change', props.id, value))
watch(() => props.data.modelOptions, (options) => {
  if (!options?.some(option => option.value === selectedModel.value)) selectedModel.value = options?.[0]?.value
}, { immediate: true, deep: true })

const nodeMeta = computed(() => ({
  text: { label: '文本', icon: Type },
  image: { label: '图片', icon: ImageIcon },
  audio: { label: '音频', icon: AudioWaveform },
  video: { label: '视频', icon: Film },
  script: { label: '剧本', icon: FileText },
}[props.data.visualKind]))

const isImage = computed(() => props.data.visualKind === 'image')
const isVideo = computed(() => props.data.visualKind === 'video')
const isAudio = computed(() => props.data.visualKind === 'audio')
const isText = computed(() => props.data.visualKind === 'text')
const isScript = computed(() => props.data.visualKind === 'script')
const nodeStyle = computed(() => {
  if (isText.value || isAudio.value || isScript.value) return undefined
  const [width, height] = (props.data.aspectRatio || '').split(':').map(Number)
  const ratio = mediaRatio.value || (width > 0 && height > 0 ? `${width} / ${height}` : isVideo.value ? '16 / 9' : '1 / 1')
  return { aspectRatio: ratio }
})
const uploadLabel = computed(() => isVideo.value ? '上传视频' : isAudio.value ? '上传音频' : '上传图片')
const emptyLabel = computed(() => isScript.value ? '剧本' : isVideo.value ? '暂无视频' : isAudio.value ? '暂无音频' : isText.value ? '暂无文本' : '暂无图片')
const connectionColor = computed(() => ({
  image: '#14b8a6',
  audio: '#64748b',
}[props.data.visualKind] || '#6366f1'))
const connectionFromNodeId = computed(() => startHandle.value?.nodeId || '')
const isNodeDropActive = computed(() => Boolean(connectionFromNodeId.value && connectionFromNodeId.value !== props.id))

function chooseFile() {
  sourceMenuOpen.value = false
  fileInput.value?.click()
}

function readMediaRatio(event: Event) {
  const media = event.target as HTMLImageElement | HTMLVideoElement
  const width = 'naturalWidth' in media ? media.naturalWidth : media.videoWidth
  const height = 'naturalHeight' in media ? media.naturalHeight : media.videoHeight
  if (width > 0 && height > 0) mediaRatio.value = `${width} / ${height}`
  if ('naturalWidth' in media) imageState.value = 'loaded'
}

function retryImage() {
  imageState.value = 'loading'
  imageAttempt.value++
}

async function toggleVideo() {
  const video = videoElement.value
  if (!video) return
  if (videoStarting.value || !video.paused) {
    videoPlaybackSession++
    video.pause()
    videoStarting.value = false
    return
  }
  videoError.value = ''
  videoStarting.value = true
  const session = ++videoPlaybackSession
  try {
    if (video.error) video.load()
    await video.play()
  }
  catch {
    if (videoElement.value === video && session === videoPlaybackSession) videoError.value = '视频播放失败，可点击重试或放大预览'
  } finally {
    if (videoElement.value === video && session === videoPlaybackSession) videoStarting.value = false
  }
}

function openHistory() {
  sourceMenuOpen.value = false
  emit('history', { kind: isVideo.value ? 'video' : props.data.apiKind, id: props.data.recordId, title: props.data.title })
}

function closeSourceMenu(event: PointerEvent) {
  if (!sourceMenu.value?.contains(event.target as globalThis.Node)) sourceMenuOpen.value = false
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') sourceMenuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', closeSourceMenu)
  document.addEventListener('keydown', closeOnEscape)
})
onBeforeUnmount(() => {
  videoPlaybackSession++
  videoElement.value?.pause()
  document.removeEventListener('pointerdown', closeSourceMenu)
  document.removeEventListener('keydown', closeOnEscape)
})

function handleFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) emit('upload', { kind: isVideo.value ? 'video' : props.data.apiKind, id: props.data.recordId, file })
  ;(event.target as HTMLInputElement).value = ''
}

function chooseReference(kind: 'image' | 'video' | 'audio') {
  referenceKind.value = kind
  referenceMenuOpen.value = false
  void nextTick(() => referenceInput.value?.click())
}
function handleReferenceFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('add-reference', { kind: props.data.apiKind, id: props.data.recordId, referenceKind: referenceKind.value, file })
  input.value = ''
}
function submit() {
  if (running.value) { emit('cancel', props.id); return }
  if (!prompt.value.trim() || !selectedModel.value) return
  emit('generate', { kind: props.data.apiKind, id: props.data.recordId, prompt: prompt.value, modelId: String(selectedModel.value), aspectRatio: aspectRatio.value, duration: duration.value, resolution: resolution.value })
}
</script>

<template>
  <div class="canvas-node" :style="nodeStyle" :class="[`canvas-node--${data.visualKind}`, { 'is-selected': selected, 'is-dimmed': data.dimmed, 'has-media': Boolean(data.mediaUrl) }]" @click="isScript && emit('script')">
    <Handle v-if="data.targetHandle" id="left" type="target" :position="Position.Left" :connectable-start="true" :connectable-end="true" :is-valid-connection="isValidConnection" class="canvas-handle canvas-handle--left">
      <span :style="{ background: connectionColor }"><Plus :size="11" /></span>
    </Handle>
    <Handle
      v-if="data.targetHandle"
      id="node-drop"
      type="target"
      :position="Position.Left"
      :connectable-start="false"
      :connectable-end="isNodeDropActive"
      :is-valid-connection="isValidConnection"
      class="canvas-node-drop-handle"
      :class="{ 'is-active': isNodeDropActive }"
    />

    <div v-if="selected" class="node-actions nodrag nowheel">
      <button v-if="isText && data.editable" type="button" title="自己编写文本" aria-label="编辑文本" :disabled="running" @pointerdown.stop @click.stop="emit('edit', { id: data.recordId, title: data.title, content: data.content })"><Pencil :size="15" /></button>
      <button type="button" title="放大预览" :disabled="!data.mediaUrl && !data.content" @click.stop="emit('preview', { title: data.title, url: data.mediaUrl, kind: isScript ? 'text' : data.visualKind, content: data.content })">
        <Eye :size="15" />
      </button>
      <a v-if="data.mediaUrl" :href="data.mediaUrl" download title="下载">
        <Download :size="15" />
      </a>
      <button v-if="data.deletable" type="button" title="删除节点" @click.stop="emit('remove', { kind: data.apiKind, id: data.recordId })">
        <Trash2 :size="15" />
      </button>
    </div>

    <div class="node-body">
      <img v-if="isImage && data.mediaUrl" :key="`${data.mediaUrl}:${imageAttempt}`" :src="data.mediaUrl" :alt="imageState === 'loaded' ? data.title : ''" draggable="false" :style="{ visibility: imageState === 'loaded' ? 'visible' : 'hidden' }" @load="readMediaRatio" @error="imageState = 'error'">
      <video v-else-if="isVideo && data.mediaUrl" :key="data.mediaUrl" ref="videoElement" :src="data.mediaUrl" playsinline preload="metadata" draggable="false" @loadedmetadata="readMediaRatio" @play="videoPlaying = true" @pause="videoPlaying = false" @ended="videoPlaying = false" />
      <div v-else-if="isAudio && data.mediaUrl" class="node-audio">
        <span class="node-audio-icon"><AudioWaveform :size="26" /></span>
        <div><strong>{{ data.title }}</strong><audio :src="data.mediaUrl" controls preload="metadata" class="nodrag nopan nowheel" @pointerdown.stop @click.stop /></div>
      </div>
      <div v-else-if="(isText || isScript) && data.content" class="node-copy" :class="{ 'nodrag nopan nowheel': selected }" @wheel="selected && $event.stopPropagation()">
        <strong v-if="isScript" class="script-node-title"><FileText :size="14" />{{ data.title }} · 剧本</strong>
        {{ data.content }}
      </div>
      <div v-else class="node-empty">
        <component :is="nodeMeta.icon" :size="26" :stroke-width="1.5" />
        <span>{{ emptyLabel }}</span>
      </div>
      <div v-if="isImage && data.mediaUrl && imageState !== 'loaded' && !running && !data.uploading" class="node-image-state" role="status" aria-live="polite">
        <template v-if="imageState === 'loading'"><LoaderCircle :size="20" class="spin" /><span>图片加载中</span></template>
        <template v-else><ImageIcon :size="24" :stroke-width="1.5" /><span>图片加载失败</span><button type="button" class="nodrag nopan" @pointerdown.stop @click.stop="retryImage">重新加载</button></template>
      </div>
    </div>

    <button v-if="isVideo && data.mediaUrl" type="button" class="node-video-play nodrag nopan nowheel" :title="videoPlaying || videoStarting ? '暂停视频' : '播放视频'" :aria-label="videoPlaying || videoStarting ? '暂停视频' : '播放视频'" :aria-pressed="videoPlaying" @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="toggleVideo">
      <LoaderCircle v-if="videoStarting" :size="14" class="spin" /><Pause v-else-if="videoPlaying" :size="14" fill="currentColor" /><Play v-else :size="14" fill="currentColor" />
    </button>
    <p v-if="isVideo && videoError" class="node-video-error" role="alert">{{ videoError }}</p>

    <button type="button" class="node-detail-button nodrag nopan" title="查看详情" aria-label="查看详情" @pointerdown.stop @click.stop="isScript ? emit('script') : emit('details', data)">
      <Info :size="14" />
    </button>
    <div v-if="data.editable && !isText" ref="sourceMenu" class="node-source nodrag nopan" @pointerdown.stop @click.stop>
      <Transition name="node-menu">
        <div v-if="sourceMenuOpen" class="node-source-menu" role="menu">
          <button type="button" role="menuitem" @click="chooseFile"><Upload :size="14" />{{ uploadLabel }}</button>
          <button type="button" role="menuitem" @click="openHistory"><History :size="14" />选择历史版本</button>
        </div>
      </Transition>
      <button type="button" class="node-upload" :disabled="data.uploading || running" title="更换素材" aria-label="更换素材" aria-haspopup="menu" :aria-expanded="sourceMenuOpen" @click="sourceMenuOpen = !sourceMenuOpen">
        <LoaderCircle v-if="data.uploading" :size="14" class="spin" /><Upload v-else :size="14" />
      </button>
    </div>
    <div v-if="data.uploading" class="node-uploading"><LoaderCircle :size="17" class="spin" />上传中</div>
    <div v-if="running" class="node-uploading"><LoaderCircle :size="17" class="spin" />生成中</div>
    <input ref="fileInput" class="sr-only" type="file" :accept="isVideo ? 'video/*' : isAudio ? 'audio/*' : 'image/*'" @change="handleFile">

    <Transition name="agent-panel">
    <div v-if="selected && data.editable && !isAudio" class="node-agent nodrag nopan nowheel" :class="{ 'is-expanded': agentExpanded }" @pointerdown.stop @mousedown.stop @click.stop @wheel.stop>
      <header class="agent-header">
        <div class="agent-heading"><strong>{{ agentTitle }}</strong><span :title="data.title">{{ data.title }}</span></div>
        <div class="agent-header-actions">
          <button v-if="isVideo" type="button" title="视频历史" aria-label="视频历史" @click="openHistory"><History :size="15" /></button>
          <button v-if="data.deletable" type="button" title="删除节点" aria-label="删除节点" @click="emit('remove', { kind: data.apiKind, id: data.recordId })"><Trash2 :size="15" /></button>
          <button type="button" :title="agentExpanded ? '恢复默认高度' : '放大智能体'" :aria-label="agentExpanded ? '恢复默认高度' : '放大智能体'" @click="agentExpanded = !agentExpanded"><Minimize2 v-if="agentExpanded" :size="15" /><Maximize2 v-else :size="15" /></button>
          <button type="button" title="收起智能体" aria-label="收起智能体" @click.stop="emit('close')"><ChevronDown :size="16" /></button>
        </div>
      </header>
      <div class="agent-content">
      <div class="agent-options">
        <AppSelect v-model="selectedModel" :options="data.modelOptions || []" :disabled="!data.modelOptions?.length" placeholder="未配置可用模型" aria-label="生成模型" placement="top" compact />
        <AppSelect v-if="isImage" v-model="aspectRatio" :options="aspectOptions" aria-label="画幅比例" placement="top" compact />
        <div v-if="isVideo" class="agent-settings-wrap">
          <button type="button" class="agent-settings-trigger" title="视频设置" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen"><Settings2 :size="13" />{{ generationSettingsLabel }}</button>
          <div v-if="settingsOpen" class="agent-settings-popover">
            <div class="agent-settings-heading"><strong>视频设置</strong><button type="button" title="关闭设置" @click="settingsOpen = false"><X :size="14" /></button></div>
            <label>画幅比例<AppSelect v-model="aspectRatio" :options="aspectOptions" aria-label="画幅比例" compact /></label>
            <label>视频时长<AppSelect v-model="duration" :options="durationOptions" aria-label="视频时长" compact /></label>
            <label>清晰度<AppSelect v-model="resolution" :options="resolutionOptions" aria-label="视频清晰度" compact /></label>
          </div>
        </div>
      </div>
      <div class="agent-composer">
      <div v-if="!isText" class="agent-references">
      <div class="agent-reference-strip">
        <div v-for="reference in data.references || []" :key="reference.id" class="agent-reference" :class="{ 'is-used': referenceIsSelected(reference.token) }">
          <button type="button" :title="`${reference.token} · ${reference.name}`" @mousedown.prevent @click="mentionInput?.insert(reference.token)"><img v-if="reference.kind === 'image'" :src="reference.url" :alt="reference.name"><video v-else-if="reference.kind === 'video' && !failedReferenceVideos.has(reference.url)" :key="reference.url" :src="reference.url" muted playsinline preload="metadata" draggable="false" @error="failedReferenceVideos.add(reference.url)" /><Film v-else-if="reference.kind === 'video'" :size="22" /><AudioWaveform v-else :size="22" /><span>{{ reference.token }}</span></button>
          <button type="button" class="agent-reference-remove" title="取消参考并断开连线" :disabled="running || data.referenceRemoving" @click="emit('remove-reference', { nodeId: id, reference })"><X :size="10" /></button>
        </div>
        <div v-if="!isText" class="agent-reference-add-wrap">
          <button type="button" class="agent-reference-add" title="添加参考素材" :disabled="running || data.referenceUploading" @click="isVideo ? referenceMenuOpen = !referenceMenuOpen : chooseReference('image')"><LoaderCircle v-if="data.referenceUploading" :size="17" class="spin" /><Plus v-else :size="19" /></button>
        </div>
      </div>
      <div v-if="referenceMenuOpen" class="agent-reference-menu"><button type="button" @click="chooseReference('image')"><ImageIcon :size="14" />上传参考图</button><button type="button" @click="chooseReference('video')"><Film :size="14" />上传参考视频</button><button type="button" @click="chooseReference('audio')"><AudioWaveform :size="14" />上传参考音色</button></div>
      </div>
      <input ref="referenceInput" type="file" class="sr-only" :accept="`${referenceKind}/*`" @change="handleReferenceFile">
      <div class="agent-input-row" :class="{ 'is-text': isText }">
      <CanvasMentionInput ref="mentionInput" v-model="prompt" :references="data.references || []" :disabled="running" @submit="submit" @preview="emit('preview', { title: `${$event.token} · ${$event.name}`, url: $event.url, kind: $event.kind })" />
        <button type="button" class="agent-send" :title="running ? '中断生成' : '发送并生成'" :disabled="data.cancelling || (!running && (!prompt.trim() || !selectedModel))" @click="submit"><LoaderCircle v-if="data.cancelling" :size="15" class="spin" /><Square v-else-if="running" :size="13" fill="currentColor" /><Send v-else :size="15" /></button>
      </div>
      </div>
      <p v-if="data.job?.status === 'failed' && data.job.error" class="agent-error" role="alert">{{ data.job.error }}</p>
      </div>
    </div>
    </Transition>

    <Handle v-if="data.sourceHandle" id="right" type="source" :position="Position.Right" :connectable-start="true" :connectable-end="true" :is-valid-connection="isValidConnection" class="canvas-handle canvas-handle--right">
      <span :style="{ background: connectionColor }"><Plus :size="11" /></span>
    </Handle>
  </div>
</template>
