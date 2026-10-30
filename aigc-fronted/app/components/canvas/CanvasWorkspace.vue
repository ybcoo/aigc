<script setup lang="ts">
import { onBeforeMount } from 'vue'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { ConnectionMode, MarkerType, SelectionMode, VueFlow, useVueFlow, type Connection, type Edge, type Node } from '@vue-flow/core'
import {
  AudioWaveform,
  ChevronDown,
  Clapperboard,
  FileText,
  Film,
  Hand,
  Image as ImageIcon,
  LocateFixed,
  LoaderCircle,
  ListTodo,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Type,
  X,
} from 'lucide-vue-next'
import type { CanvasGenerationInput, CanvasJob, CanvasPayload, CanvasReference, MediaHistoryTarget, NodeKind, Project, ShotNode } from '~/types/canvas'
import type { AIConfig, AIServiceType } from '~/types/ai-config'
import { createAIConfigService } from '~/services/ai-config/ai-config.service'
import { createCanvasService } from '~/services/canvas/canvas.service'
import AIConfigDialog from '~/components/ai-config/AIConfigDialog.vue'
import AppSelect from '~/components/ui/AppSelect.vue'
import CanvasNode from './CanvasNode.vue'
import CanvasEdge from './CanvasEdge.vue'
import CanvasMediaHistory from './CanvasMediaHistory.vue'
import CanvasTasks from './CanvasTasks.vue'
import CanvasTextEditor from './CanvasTextEditor.vue'
import CanvasMediaPreview from './CanvasMediaPreview.vue'
import CanvasScriptDialog from './CanvasScriptDialog.vue'

const props = defineProps<{ projectId: string, initialEpisode?: number }>()
const config = useRuntimeConfig()
const api = createCanvasService(config.public.apiBase)
const aiConfigApi = createAIConfigService(config.public.apiBase)
const { fitView, setCenter, removeSelectedNodes } = useVueFlow()

const payload = ref<CanvasPayload>()
const projectTitleEditing = ref(false)
const projectTitleSaving = ref(false)
const projectTitleDraft = ref('')
const projectTitleError = ref('')
const projectTitleInput = ref<HTMLInputElement>()
const scriptOpen = ref(false)
const scriptSaving = ref(false)
const scriptError = ref('')
const scriptDrafts = reactive<Record<string, string>>({})
const scriptVisualDraft = reactive<{ genre?: string, style?: string }>({})
const scriptSubmissions = reactive<Record<string, boolean>>({})
const scriptCancelPending = new Set<string>()
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const episodeNumber = ref(props.initialEpisode || 1)
const episodeCreating = ref(false)
const interactionMode = ref<'select' | 'pan'>('select')
const loading = ref(true)
const errorMessage = ref('')
const addMenuOpen = ref(false)
const preview = ref<{ title: string, url: string, kind: string, content?: string }>()
const detail = ref<{ title: string, content: string, appearance?: string, prompt: string, aspectRatio: string, visualKind: string, duration?: number }>()
const historyTarget = ref<MediaHistoryTarget>()
const textEditorTarget = ref<{ id: string, title: string, content: string }>()
const uploadingNodeIds = ref(new Set<string>())
const referenceUploading = ref(new Set<string>())
const referenceRemoving = new Set<string>()
const promptDrafts = reactive<Record<string, string>>({})
const nodeJobs = reactive<Record<string, CanvasJob>>({})
const jobHistory = reactive<Record<string, CanvasJob>>({})
const tasksOpen = ref(false)
const tasksLoading = ref(false)
const tasksError = ref('')
const cancellingJobIds = ref(new Set<string>())
const cancelWhenReady = new Set<string>()
const tasks = computed(() => Object.values(jobHistory).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))))
const activeTaskCount = computed(() => tasks.value.filter(job => ['queued', 'running'].includes(job.status)).length)
const draftStorageKey = `aigc-agent-drafts:${props.projectId}`
let pollingTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let loadSequence = 0
const aiConfigOpen = ref(false)
const aiConfigs = ref<AIConfig[]>([])
const pendingConnectionError = ref('')
const canvasStage = ref<HTMLElement>()
const selectedCanvasNodeIds = ref<string[]>([])
const groupToolbarPosition = ref<{ left: number, top: number }>()
const sidebarOpen = ref(true)
const showReturnButton = ref(false)
const connectionStart = ref<{ nodeId: string, handleType: 'source' | 'target' }>()
const connectionCompleted = ref(false)
let layoutTimer: ReturnType<typeof setTimeout> | undefined

const project = computed<Project | undefined>(() => payload.value?.project)

async function editProjectTitle() {
  if (!project.value || projectTitleSaving.value) return
  projectTitleDraft.value = project.value.title || ''
  projectTitleError.value = ''
  projectTitleEditing.value = true
  await nextTick()
  projectTitleInput.value?.focus()
  projectTitleInput.value?.select()
}
function cancelProjectTitleEdit() {
  if (projectTitleSaving.value) return
  projectTitleEditing.value = false
  projectTitleError.value = ''
}
async function saveProjectTitle() {
  if (!projectTitleEditing.value || projectTitleSaving.value || !payload.value) return
  const title = projectTitleDraft.value.trim()
  if (title === payload.value.project.title) { projectTitleEditing.value = false; projectTitleError.value = ''; return }
  projectTitleSaving.value = true
  projectTitleError.value = ''
  try {
    const saved = await api.updateProject(props.projectId, title)
    if (disposed || !payload.value) return
    payload.value = { ...payload.value, project: { ...payload.value.project, ...saved } }
    projectTitleEditing.value = false
  } catch (cause: any) {
    if (!disposed) projectTitleError.value = cause?.data?.message || cause?.message || '名称保存失败，请重试'
  } finally { projectTitleSaving.value = false }
}

const assetGroups = computed(() => ({
  script: nodes.value.filter(node => node.data.visualKind === 'script'),
  image: nodes.value.filter(node => node.data.visualKind === 'image'),
  video: nodes.value.filter(node => node.data.visualKind === 'video'),
  text: nodes.value.filter(node => node.data.visualKind === 'text'),
  audio: nodes.value.filter(node => node.data.visualKind === 'audio'),
}))
const episodeOptions = computed(() => (project.value?.episodes || []).map(episode => ({
  value: episode.episodeNumber,
  label: episode.title,
})))

async function createEpisode() {
  if (!payload.value || episodeCreating.value) return
  episodeCreating.value = true
  errorMessage.value = ''
  try {
    const result = await api.createEpisode(props.projectId)
    if (disposed || !payload.value) return
    payload.value = { ...payload.value, project: { ...payload.value.project, episodeCount: result.episodeCount, episodes: [...payload.value.project.episodes.filter(episode => episode.id !== result.episode.id), result.episode].sort((a, b) => a.episodeNumber - b.episodeNumber) } }
    episodeNumber.value = result.episode.episodeNumber
  } catch (cause: any) {
    if (!disposed) errorMessage.value = cause?.data?.message || cause?.message || '新增剧集失败，请重试'
  } finally { episodeCreating.value = false }
}

const activeEpisode = computed(() => project.value?.episodes.find(episode => episode.episodeNumber === episodeNumber.value))
const scriptContent = computed(() => activeEpisode.value ? scriptDrafts[activeEpisode.value.id] ?? activeEpisode.value.scriptContent ?? '' : '')
const scriptGenre = computed(() => scriptVisualDraft.genre ?? project.value?.genre ?? '')
const scriptStyle = computed(() => scriptVisualDraft.style ?? project.value?.style ?? '')
const scriptPending = computed(() => Object.fromEntries(['character','scene','prop'].map(kind => [kind, Boolean(scriptSubmissions[`${episodeNumber.value}:${kind}`])])))

function updateScriptDraft(content: string) {
  if (!activeEpisode.value) return
  scriptDrafts[activeEpisode.value.id] = content
  try { localStorage.setItem(`aigc-script-drafts:${props.projectId}`, JSON.stringify(scriptDrafts)) } catch {}
}
function updateScriptVisualDraft(key: 'genre' | 'style', value: string) {
  scriptVisualDraft[key] = value
  try { localStorage.setItem(`aigc-script-visual-draft:${props.projectId}`, JSON.stringify(scriptVisualDraft)) } catch {}
}
async function saveScript() {
  if (!activeEpisode.value || scriptSaving.value) return
  const episode = episodeNumber.value, content = scriptContent.value, settings = { genre: scriptGenre.value, style: scriptStyle.value }
  scriptSaving.value = true; scriptError.value = ''
  try { await api.saveScript(props.projectId, episode, content, settings); if (episode === episodeNumber.value) await loadCanvas(true) }
  catch (error) { scriptError.value = error instanceof Error ? error.message : '剧本保存失败' }
  finally { scriptSaving.value = false }
}
async function extractScriptAssets(input: { kind: 'character' | 'scene' | 'prop', modelId: string, aspectRatio: string }) {
  const episode = episodeNumber.value, content = scriptContent.value, settings = { genre: scriptGenre.value, style: scriptStyle.value }, key = `${episode}:${input.kind}`
  if (scriptSubmissions[key]) return
  scriptSubmissions[key] = true; scriptError.value = ''
  try {
    await api.saveScript(props.projectId, episode, content, settings)
    const job = await api.extractScriptAssets(props.projectId, episode, input)
    rememberJob(job)
    if (scriptCancelPending.delete(key)) await cancelJobById(job.id)
    startPolling()
  } catch (error) { scriptError.value = error instanceof Error ? error.message : '提交提取任务失败' }
  finally { scriptSubmissions[key] = false; scriptCancelPending.delete(key) }
}
async function cancelScriptExtraction(kind: 'character' | 'scene' | 'prop') {
  const key = `${episodeNumber.value}:${kind}`
  const job = tasks.value.find(job => job.kind === 'canvas_asset_extract' && job.episodeNumber === episodeNumber.value && job.input?.category === kind && ['queued','running'].includes(job.status))
  if (job) await cancelJobById(job.id)
  else if (scriptSubmissions[key]) scriptCancelPending.add(key)
}

const addOptions: Array<{ kind: NodeKind, label: string, icon: Component }> = [
  { kind: 'text', label: '文本', icon: Type },
  { kind: 'image', label: '图片', icon: ImageIcon },
  { kind: 'audio', label: '音色', icon: AudioWaveform },
  { kind: 'video', label: '视频', icon: Film },
]

function mediaUrl(path = '') {
  if (!path || /^https?:\/\//.test(path)) return path
  return `${new URL(config.public.apiBase).origin}${path}`
}

function layoutFor(id: string, fallback: { x: number, y: number }) {
  const saved = payload.value?.layouts.find(item => item.nodeId === id)
  return saved ? { x: saved.x, y: saved.y } : fallback
}

function baseNode(id: string, position: { x: number, y: number }, data: Record<string, unknown>): Node {
  const mediaKind = data.visualKind === 'video' ? 'video' : String(data.apiKind)
  const context = payload.value?.contexts?.[id]
  const prompt = Object.hasOwn(promptDrafts, id) ? promptDrafts[id] : String(data.prompt || context?.textPrompt || '')
  return { id, type: 'canvas', position, data: { ...data, prompt, references: (context?.references || []).map(reference => ({ ...reference, url: mediaUrl(reference.url) })), job: nodeJobs[id], referenceUploading: referenceUploading.value.has(id), referenceRemoving: referenceRemoving.has(id), uploading: uploadingNodeIds.value.has(`${mediaKind}:${data.recordId}`), modelOptions: modelsFor(String(data.visualKind || '')) } }
}

function modelsFor(visualKind: string) {
  const serviceType: AIServiceType = visualKind === 'text' ? 'text'
    : visualKind === 'video' ? 'video'
      : visualKind === 'audio' ? 'tts'
        : 'image'
  const options = aiConfigs.value.filter(item => item.isActive && (item.serviceType === serviceType || serviceType === 'image' && item.serviceType === 'storyboard_image')).flatMap(item =>
    (item.defaultModel ? [item.defaultModel, ...item.models.filter(model => model !== item.defaultModel)] : item.models).map(model => ({ value: `${item.id}:${model}`, label: `${item.name} · ${model}` })),
  )
  const preferred = serviceType === 'text' ? project.value?.textModelId : ''
  return preferred ? [...options.filter(option => option.value === preferred), ...options.filter(option => option.value !== preferred)] : options
}

async function loadAIConfigs() {
  try {
    aiConfigs.value = await aiConfigApi.list()
    if (payload.value) buildGraph()
  } catch {
    aiConfigs.value = []
  }
}

function buildGraph() {
  if (!payload.value) return
  const selected = new Set(nodes.value.filter(node => node.selected).map(node => node.id))
  const nextNodes: Node[] = []
  const counters: Record<string, number> = {}
  const add = (kind: string, id: string, column: number, data: Record<string, unknown>) => {
    const index = counters[kind] ?? 0
    counters[kind] = index + 1
    nextNodes.push(baseNode(`${kind}:${id}`, layoutFor(`${kind}:${id}`, { x: column, y: 80 + index * 250 }), data))
  }

  const episode = payload.value.project.episodes.find(episode => episode.episodeNumber === episodeNumber.value)
  if (episode?.id) add('script', episode.id, -320, { visualKind: 'script', apiKind: 'script', recordId: episode.id, title: episode.title, prompt: '', content: episode.scriptContent || '', mediaUrl: '', aspectRatio: '', targetHandle: false, sourceHandle: true, editable: false, deletable: false })

  for (const asset of payload.value.assets) {
    add(asset.kind, asset.id, { character: 40, scene: 360, prop: 680 }[asset.kind], {
      visualKind: 'image',
      apiKind: asset.kind,
      recordId: asset.id,
      title: asset.name,
      prompt: asset.prompt,
      content: asset.description,
      appearance: asset.appearance,
      mediaUrl: mediaUrl(asset.imageUrl),
      aspectRatio: asset.aspectRatio,
      targetHandle: true,
      sourceHandle: true,
      editable: true,
      deletable: true,
    })
  }
  for (const item of payload.value.textNodes) {
    add('text', item.id, 40, {
      visualKind: 'text', apiKind: 'text', recordId: item.id, title: item.title, prompt: item.prompt,
      content: item.content, mediaUrl: '', aspectRatio: '', targetHandle: true, sourceHandle: true, editable: true, deletable: true,
    })
  }
  for (const item of payload.value.referenceNodes) {
    add('image', item.id, 360, {
      visualKind: 'image', apiKind: 'image', recordId: item.id, title: item.name, prompt: item.prompt,
      content: '', mediaUrl: mediaUrl(item.imageUrl), aspectRatio: item.aspectRatio, targetHandle: true, sourceHandle: true, editable: true, deletable: true,
    })
  }
  for (const item of payload.value.audioNodes) {
    add('audio', item.id, 680, {
      visualKind: 'audio', apiKind: 'audio', recordId: item.id, title: item.name, prompt: '',
      content: '', mediaUrl: mediaUrl(item.audioUrl), aspectRatio: '', targetHandle: true, sourceHandle: true, editable: true, deletable: true,
    })
  }

  let shotIndex = 0
  let videoIndex = 0
  for (const shot of payload.value.shots) {
    if (shot.canvasVideoNode) {
      const id = `video:${shot.id}`
      nextNodes.push(baseNode(id, layoutFor(id, { x: 1080, y: 80 + videoIndex++ * 300 }), videoData(shot)))
      continue
    }
    const id = `video:${shot.id}`
    nextNodes.push(baseNode(id, layoutFor(id, layoutFor(`shot-video:${shot.id}`, { x: 1080, y: 80 + shotIndex++ * 290 })), videoData(shot)))
  }

  const persistedEdges: Edge[] = payload.value.links.map(link => ({
    id: link.id,
    source: endpointId(link.sourceKind, link.sourceId),
    target: endpointId(link.targetKind, link.targetId),
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'canvas',
    animated: false,
    markerEnd: MarkerType.ArrowClosed,
    data: { locked: link.locked, sourceKind: link.sourceKind },
    style: edgeStyle(link.sourceKind, false),
  }))
  nodes.value = nextNodes.map(node => ({ ...node, selected: selected.has(node.id) }))
  edges.value = persistedEdges
  applySelectionFocus()
}

function edgeStyle(sourceKind: string, active: boolean) {
  const color = active ? '#10b981' : ({ character: '#14b8a6', scene: '#f59e0b', prop: '#0ea5e9' } as Record<string, string>)[sourceKind] || '#818cf8'
  return { stroke: color, strokeWidth: active ? 2.5 : 1.7 }
}

function videoData(shot: ShotNode) {
  return {
    visualKind: 'video', apiKind: 'video', recordId: shot.id, title: shot.title,
    prompt: shot.universalPrompt || shot.storyboardScript || shot.sourceScript || shot.description, content: shot.description, mediaUrl: mediaUrl(shot.videoUrl), aspectRatio: shot.aspectRatio,
    duration: shot.duration, resolution: shot.videoResolution, targetHandle: true, sourceHandle: true,
    editable: true, deletable: true,
  }
}

function endpointId(kind: string, id: string) {
  if (kind === 'shot') return `video:${id}`
  return `${kind}:${id}`
}

async function loadCanvas(keepViewport = false) {
  const sequence = ++loadSequence
  const episode = episodeNumber.value
  if (!keepViewport) loading.value = true
  try {
    const result = await api.getCanvas(props.projectId, episode)
    if (disposed || sequence !== loadSequence || episode !== episodeNumber.value) return
    payload.value = result
    for (const job of [...result.jobs].reverse()) rememberJob(job)
    buildGraph()
    startPolling()
    if (!keepViewport) nextTick(() => fitView({ padding: 0.18, duration: 350 }))
  } catch (error) {
    if (sequence === loadSequence) errorMessage.value = error instanceof Error ? error.message : '画布加载失败'
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function addNode(kind: NodeKind) {
  addMenuOpen.value = false
  await api.createNode(props.projectId, kind, { episodeNumber: episodeNumber.value })
  await loadCanvas(true)
}

async function connectNodes(connection: Connection) {
  connectionCompleted.value = true
  if (!connection.source || !connection.target || connection.source === connection.target) return
  const connectionError = canvasConnectionError(connection)
  if (connectionError) {
    errorMessage.value = connectionError
    return
  }
  const source = nodes.value.find(node => node.id === connection.source)
  const target = nodes.value.find(node => node.id === connection.target)
  if (!source || !target) return
  const sourceData = source.data as Record<string, string>
  const targetData = target.data as Record<string, string>
  const targetPrompt = Object.hasOwn(promptDrafts, target.id) ? promptDrafts[target.id] : targetData.prompt || ''
  const textConnection = sourceData.apiKind === 'text'
  const pendingId = `pending:${crypto.randomUUID()}`
  edges.value = [...edges.value, {
    id: pendingId,
    source: connection.source,
    target: connection.target,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'canvas',
    animated: true,
    markerEnd: MarkerType.ArrowClosed,
    data: { locked: false, pending: true, sourceKind: sourceData.apiKind },
    style: edgeStyle(sourceData.apiKind, true),
  }]
  errorMessage.value = ''
  try {
    if (textConnection) {
      const body = targetData.apiKind === 'video' || targetData.apiKind === 'shot' ? { universalPrompt: targetPrompt } : { prompt: targetPrompt }
      await api.updateNode(props.projectId, targetData.apiKind as NodeKind, targetData.recordId, body)
    }
    await api.createLink(props.projectId, {
      episodeNumber: episodeNumber.value,
      sourceKind: sourceData.apiKind,
      sourceId: sourceData.recordId,
      targetKind: targetData.apiKind,
      targetId: targetData.recordId,
    })
    // A new text connection can seed an empty prompt, but must not replace edits made while connecting.
    if (textConnection && sourceData.content?.trim() && !targetPrompt.trim() && Object.hasOwn(promptDrafts, target.id) && promptDrafts[target.id] === targetPrompt) {
      delete promptDrafts[target.id]
      persistPromptDrafts()
    }
    await loadCanvas(true)
  } catch (error) {
    edges.value = edges.value.filter(edge => edge.id !== pendingId)
    errorMessage.value = error instanceof Error ? error.message : '节点连接失败，请重试'
  }
}

async function removeEdge(edge: Edge) {
  if (edge.data?.locked || edge.id.startsWith('locked:')) return
  await disconnectReference(edge.id, edge.target)
}

async function removeEdgeById(id: string) {
  const edge = edges.value.find(item => item.id === id)
  if (edge) await removeEdge(edge)
}

// Keep this on Handles: Vue Flow's global validator also filters edges loaded from storage.
function isValidCanvasConnection(connection: Connection) {
  const message = canvasConnectionError(connection)
  pendingConnectionError.value = message
  return !message
}

function canvasConnectionError(connection: Connection) {
  if (!connection.source || !connection.target) return '请将连线拖到可连接的节点'
  if (connection.source === connection.target) return '节点不能连接自身'
  const source = nodes.value.find(node => node.id === connection.source)
  const target = nodes.value.find(node => node.id === connection.target)
  if (!source || !target) return '没有找到连接节点'
  const sourceData = source.data as Record<string, any>
  const targetData = target.data as Record<string, any>
  const sourceKind = String(sourceData.visualKind || '')
  const targetKind = String(targetData.visualKind || '')
  const imageKinds = ['character', 'scene', 'prop', 'image']
  if (targetKind === 'script') return '剧本节点不接收其他节点输入'
  if (sourceKind === 'script' && targetKind !== 'image') return '剧本只能连接图片节点'
  if (imageKinds.includes(sourceKind) && targetKind === 'text') return '图片不能作为文本节点的输入，请从文本节点连接到图片节点'
  if (sourceKind === 'video' && imageKinds.includes(targetKind)) return '视频不能反向连接图片节点，请从图片节点连接到视频'
  if (sourceKind === 'video' && targetKind !== 'video') return '视频只能连接到视频节点，作为生成参考'
  if (sourceKind === 'audio' && targetKind !== 'video') return '音频只能作为视频节点的参考音色'
  if (targetKind === 'audio') return '音频节点只作为参考音色输出，不能接收其他节点'
  if (targetKind === 'text' && sourceKind !== 'text') return '文本节点只接收文本提示词'
  if (edges.value.some(edge => !edge.id.startsWith('locked:') && edge.source === connection.source && edge.target === connection.target)) return '这两个节点已经连接'
  if (sourceKind === 'image' && !sourceData.mediaUrl) return '该图片节点还没有可用图片'
  if (sourceKind === 'video' && !sourceData.mediaUrl) return '该视频节点还没有可用视频'
  if (sourceKind === 'audio' && !sourceData.mediaUrl) return '该音频节点还没有可用音频'
  return ''
}

function handleConnectStart(params: { nodeId?: string, handleType?: 'source' | 'target' }) {
  connectionCompleted.value = false
  connectionStart.value = params.nodeId && params.handleType
    ? { nodeId: params.nodeId, handleType: params.handleType }
    : undefined
  pendingConnectionError.value = ''
}

function handleConnectEnd(event?: MouseEvent | TouchEvent) {
  const start = connectionStart.value
  const completed = connectionCompleted.value
  connectionStart.value = undefined
  connectionCompleted.value = false

  if (!completed && start && event) {
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    const targetElement = point
      ? document.elementsFromPoint(point.clientX, point.clientY)
        .map(element => element.closest<HTMLElement>('.vue-flow__node'))
        .find(Boolean)
      : undefined
    const targetNodeId = targetElement?.dataset.id || ''
    if (targetNodeId && targetNodeId !== start.nodeId) {
      const fallbackConnection: Connection = start.handleType === 'target'
        ? { source: targetNodeId, target: start.nodeId, sourceHandle: 'right', targetHandle: 'left' }
        : { source: start.nodeId, target: targetNodeId, sourceHandle: 'right', targetHandle: 'left' }
      void connectNodes(fallbackConnection)
      pendingConnectionError.value = ''
      return
    }
  }

  if (pendingConnectionError.value) errorMessage.value = pendingConnectionError.value
  pendingConnectionError.value = ''
}

function viewportOutsideNodes(transform: { x: number, y: number, zoom: number }) {
  const rect = canvasStage.value?.getBoundingClientRect()
  if (!rect || !nodes.value.length || !transform.zoom) return false
  const minX = Math.min(...nodes.value.map(node => node.position.x))
  const minY = Math.min(...nodes.value.map(node => node.position.y))
  const maxX = Math.max(...nodes.value.map(node => node.position.x + (node.dimensions.width || 236)))
  const maxY = Math.max(...nodes.value.map(node => node.position.y + (node.dimensions.height || 204)))
  const visibleLeft = -transform.x / transform.zoom
  const visibleTop = -transform.y / transform.zoom
  const visibleRight = visibleLeft + rect.width / transform.zoom
  const visibleBottom = visibleTop + rect.height / transform.zoom
  return visibleRight < minX || visibleLeft > maxX || visibleBottom < minY || visibleTop > maxY
}

function handleMoveEnd(payload: { flowTransform: { x: number, y: number, zoom: number } }) {
  showReturnButton.value = viewportOutsideNodes(payload.flowTransform)
}

function returnToNodes() {
  showReturnButton.value = false
  void fitView({ padding: 0.18, duration: 420 })
}

async function removeNode(payload: { kind: string, id: string }) {
  const job = nodeJobs[`${payload.kind}:${payload.id}`]
  if (job && ['queued', 'running'].includes(job.status)) await cancelGeneration(`${payload.kind}:${payload.id}`)
  await api.deleteNode(props.projectId, payload.kind as NodeKind, payload.id, episodeNumber.value)
  await loadCanvas(true)
}

function handleSelectionChange(selection: { nodes: Node[] }) {
  selectedCanvasNodeIds.value = selection.nodes.map(node => node.id)
  applySelectionFocus()
  void nextTick(updateGroupToolbar)
}

function closeNodeAgent() {
  removeSelectedNodes()
  nodes.value = nodes.value.map(node => ({ ...node, selected: false }))
  selectedCanvasNodeIds.value = []
  applySelectionFocus()
  void nextTick(updateGroupToolbar)
}

async function onTextSaved() {
  textEditorTarget.value = undefined
  await loadCanvas(true)
}

function applySelectionFocus() {
  const focusedId = selectedCanvasNodeIds.value.length === 1 ? selectedCanvasNodeIds.value[0] : ''
  const relatedNodeIds = new Set<string>(focusedId ? [focusedId] : [])
  if (focusedId) {
    for (const edge of edges.value) {
      if (edge.source === focusedId || edge.target === focusedId) {
        relatedNodeIds.add(edge.source)
        relatedNodeIds.add(edge.target)
      }
    }
  }
  nodes.value = nodes.value.map(node => ({
    ...node,
    data: { ...node.data, dimmed: Boolean(focusedId && !relatedNodeIds.has(node.id)) },
  }))
  edges.value = edges.value.map(edge => {
    const related = Boolean(focusedId && (edge.source === focusedId || edge.target === focusedId))
    const sourceKind = String(edge.data?.sourceKind || '')
    return {
      ...edge,
      style: {
        ...edgeStyle(sourceKind, related),
        opacity: focusedId && !related ? 0.12 : 1,
      },
    }
  })
}

function updateGroupToolbar() {
  if (!canvasStage.value || selectedCanvasNodeIds.value.length < 2) {
    groupToolbarPosition.value = undefined
    return
  }
  const selected = new Set(selectedCanvasNodeIds.value)
  const elements = [...canvasStage.value.querySelectorAll<HTMLElement>('.vue-flow__node')]
    .filter(element => selected.has(element.dataset.id || ''))
  if (elements.length < 2) {
    groupToolbarPosition.value = undefined
    return
  }
  const stageRect = canvasStage.value.getBoundingClientRect()
  const rects = elements.map(element => element.getBoundingClientRect())
  const left = Math.min(...rects.map(rect => rect.left)) - stageRect.left
  const right = Math.max(...rects.map(rect => rect.right)) - stageRect.left
  const top = Math.min(...rects.map(rect => rect.top)) - stageRect.top
  groupToolbarPosition.value = { left: (left + right) / 2, top: Math.max(8, top - 12) }
}

const selectedDeletableNodes = computed(() => {
  const selected = new Set(selectedCanvasNodeIds.value)
  const unique = new Map<string, { kind: string, id: string }>()
  for (const node of nodes.value) {
    if (!selected.has(node.id) || !node.data?.deletable) continue
    const kind = String(node.data.apiKind || '')
    const id = String(node.data.recordId || '')
    if (kind && id) unique.set(`${kind}:${id}`, { kind, id })
  }
  return [...unique.values()]
})

async function deleteSelectedNodes() {
  if (!selectedDeletableNodes.value.length) return
  if (!window.confirm(`确认删除选中的 ${selectedDeletableNodes.value.length} 个节点？`)) return
  try {
    for (const node of selectedDeletableNodes.value) {
      await api.deleteNode(props.projectId, node.kind as NodeKind, node.id, episodeNumber.value)
    }
    selectedCanvasNodeIds.value = []
    groupToolbarPosition.value = undefined
    await loadCanvas(true)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '整组删除失败'
  }
}

function focusCanvasNode(nodeId: string) {
  const node = nodes.value.find(item => item.id === nodeId)
  if (!node) return
  nodes.value = nodes.value.map(item => ({ ...item, selected: item.id === nodeId }))
  selectedCanvasNodeIds.value = [nodeId]
  showReturnButton.value = false
  applySelectionFocus()
  const width = node.dimensions.width || 236, height = node.dimensions.height || 204
  const area = canvasStage.value?.getBoundingClientRect()
  const zoom = node.data.visualKind === 'script' && area ? Math.max(.15, Math.min(1, (area.width - 48) / width, (area.height - 96) / height)) : 1
  void setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom, duration: 350 })
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  localStorage.setItem(`aigc-canvas-sidebar:${props.projectId}`, sidebarOpen.value ? '1' : '0')
  void nextTick(() => fitView({ padding: 0.18, duration: 250 }))
}

async function savePrompt(payload: { kind: string, id: string, prompt: string }) {
  const body = payload.kind === 'video' ? { universalPrompt: payload.prompt } : { prompt: payload.prompt }
  await api.updateNode(props.projectId, payload.kind as NodeKind, payload.id, body)
  await loadCanvas(true)
}

function updatePromptDraft(id: string, prompt: string) {
  promptDrafts[id] = prompt
  if (nodes.value.some(node => node.id === id && node.data.prompt !== prompt)) {
    nodes.value = nodes.value.map(node => node.id === id ? { ...node, data: { ...node.data, prompt } } : node)
  }
  persistPromptDrafts()
}

function persistPromptDrafts() {
  try { localStorage.setItem(draftStorageKey, JSON.stringify(promptDrafts)) } catch { /* Storage may be unavailable or full. */ }
}

function jobNodeKey(job: CanvasJob) {
  const kind = job.input?.nodeKind || (job.kind === 'canvas_video' ? 'video' : job.kind === 'canvas_text' ? 'text' : 'image')
  return `${kind}:${job.targetId}`
}

function rememberJob(job: CanvasJob) {
  if (!job.kind.startsWith('canvas_')) return
  const existing = jobHistory[job.id]
  if (existing && !['queued', 'running'].includes(existing.status) && ['queued', 'running'].includes(job.status)) return
  if (existing?.updatedAt && job.updatedAt && existing.updatedAt > job.updatedAt) return
  jobHistory[job.id] = job
  if (job.kind === 'canvas_export' || job.kind === 'canvas_asset_extract') return
  const key = jobNodeKey(job)
  const previous = nodeJobs[key]
  if (!previous || previous.id === job.id || !previous.id.startsWith('pending:') && String(job.createdAt || '') >= String(previous.createdAt || '')) nodeJobs[key] = job
}

async function loadJobs() {
  if (tasksLoading.value) return
  tasksLoading.value = true
  tasksError.value = ''
  try {
    const jobs = await api.listJobs(props.projectId)
    if (disposed) return
    const changed = jobs.some(job => job.episodeNumber === episodeNumber.value && ['queued', 'running'].includes(jobHistory[job.id]?.status || '') && !['queued', 'running'].includes(job.status))
    for (const job of [...jobs].reverse()) rememberJob(job)
    if (changed && payload.value) await loadCanvas(true)
    refreshNodeStates()
    startPolling()
  } catch (error) { tasksError.value = error instanceof Error ? error.message : '读取任务失败' }
  finally { tasksLoading.value = false }
}

function openTasks() { tasksOpen.value = !tasksOpen.value; if (tasksOpen.value) void loadJobs() }

async function generateNode(input: { kind: NodeKind, id: string } & CanvasGenerationInput) {
  const key = `${input.kind}:${input.id}`
  updatePromptDraft(key, input.prompt)
  if (nodeJobs[key] && ['queued', 'running'].includes(nodeJobs[key].status)) return
  nodeJobs[key] = { id: `pending:${key}`, targetId: input.id, status: 'queued', error: '', kind: `canvas_${input.kind}`, episodeNumber: episodeNumber.value }
  refreshNodeStates()
  try {
    const job = await api.generateNode(props.projectId, input.kind, input.id, { ...input, episodeNumber: episodeNumber.value })
    nodeJobs[key] = job
    rememberJob(job)
    if (cancelWhenReady.delete(key)) await cancelJobById(job.id)
    refreshNodeStates()
    startPolling()
  } catch (error) {
    cancelWhenReady.delete(key)
    errorMessage.value = error instanceof Error ? error.message : '提交生成失败'
    nodeJobs[key] = { ...nodeJobs[key], status: 'failed', error: errorMessage.value }
    refreshNodeStates()
  }
}

async function cancelGeneration(key: string) {
  const job = nodeJobs[key]
  if (!job) return
  if (job.id.startsWith('pending:')) { cancelWhenReady.add(key); refreshNodeStates(); return }
  await cancelJobById(job.id)
}

async function cancelJobById(jobId: string) {
  if (cancellingJobIds.value.has(jobId)) return
  cancellingJobIds.value.add(jobId)
  refreshNodeStates()
  try {
    rememberJob(await api.cancelJob(props.projectId, jobId))
    refreshNodeStates()
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '中断失败' }
  finally { cancellingJobIds.value.delete(jobId); refreshNodeStates() }
}

function refreshNodeStates() {
  nodes.value = nodes.value.map(node => ({ ...node, data: { ...node.data, job: nodeJobs[node.id], cancelling: cancelWhenReady.has(node.id) || cancellingJobIds.value.has(nodeJobs[node.id]?.id || ''), referenceUploading: referenceUploading.value.has(node.id), referenceRemoving: referenceRemoving.has(node.id) } }))
}

function startPolling() {
  if (pollingTimer || disposed || ![...Object.values(nodeJobs), ...Object.values(jobHistory)].some(job => ['queued', 'running'].includes(job.status))) return
  pollingTimer = setTimeout(async () => {
    pollingTimer = undefined
    let changed = false
    const active = Object.values(jobHistory).filter(job => ['queued', 'running'].includes(job.status))
    await Promise.all(active.map(async job => {
      try {
        const next = await api.getJob(props.projectId, job.id)
        if (disposed) return
        rememberJob(next)
        if (next.status !== job.status && !['queued', 'running'].includes(next.status)) {
          changed ||= next.episodeNumber === episodeNumber.value
          if (next.status === 'failed') errorMessage.value = next.error || '生成失败'
        }
      } catch { /* A temporary polling failure should not clear the running state. */ }
    }))
    if (disposed) return
    if (changed) await loadCanvas(true)
    else refreshNodeStates()
    startPolling()
  }, 1500)
}

async function uploadNodeReference(input: { kind: NodeKind, id: string, referenceKind: 'image' | 'video' | 'audio', file: File }) {
  const key = `${input.kind}:${input.id}`
  if (referenceUploading.value.has(key)) return
  referenceUploading.value.add(key)
  refreshNodeStates()
  try {
    const target = nodes.value.find(node => node.id === key)
    if (target) await api.saveLayout(props.projectId, episodeNumber.value, [{ nodeId: key, x: target.position.x, y: target.position.y }])
    await api.uploadReference(props.projectId, input.kind, input.id, input.referenceKind, input.file, episodeNumber.value)
    await loadCanvas(true)
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '添加参考素材失败' }
  finally { referenceUploading.value.delete(key); refreshNodeStates() }
}

async function removeNodeReference(input: { nodeId: string, reference: CanvasReference }) {
  await disconnectReference(input.reference.id, input.nodeId)
}

async function disconnectReference(linkId: string, nodeId: string) {
  if (referenceRemoving.has(nodeId)) return
  referenceRemoving.add(nodeId)
  const episode = episodeNumber.value
  refreshNodeStates()
  edges.value = edges.value.map(edge => edge.id === linkId ? { ...edge, data: { ...edge.data, deleting: true } } : edge)
  try {
    await api.deleteLink(props.projectId, linkId)
    if (disposed || episode !== episodeNumber.value) return
    const node = nodes.value.find(node => node.id === nodeId)
    edges.value = edges.value.filter(edge => edge.id !== linkId)
    if (payload.value) payload.value.links = payload.value.links.filter(link => link.id !== linkId)
    if (node) {
      const previous = (node.data.references || []) as CanvasReference[]
      const counts = { image: 0, video: 0, audio: 0 }
      const labels = { image: '图片', video: '视频', audio: '音色' }
      const next = previous.filter(reference => reference.id !== linkId).map(reference => ({ ...reference, token: `@${labels[reference.kind]}${++counts[reference.kind]}` }))
      const prompt = Object.hasOwn(promptDrafts, nodeId) ? promptDrafts[nodeId] : String(node.data.prompt || '')
      const rewritten = prompt.replace(/@(图片|视频|音色)\d+/g, token => {
        const source = previous.find(reference => reference.token === token)
        return source ? next.find(reference => reference.sourceKey === source.sourceKey)?.token || '' : token
      })
      if (payload.value?.contexts[nodeId]) payload.value.contexts[nodeId].references = next
      nodes.value = nodes.value.map(item => item.id === nodeId ? { ...item, data: { ...item.data, references: next } } : item)
      applySelectionFocus()
      if (rewritten !== prompt) {
        updatePromptDraft(nodeId, rewritten)
        const kind = node.data.apiKind as NodeKind
        await api.updateNode(props.projectId, kind, String(node.data.recordId), kind === 'video' ? { universalPrompt: rewritten } : { prompt: rewritten })
      }
    }
    await loadCanvas(true)
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '取消参考失败' }
  finally {
    referenceRemoving.delete(nodeId)
    edges.value = edges.value.map(edge => edge.id === linkId ? { ...edge, data: { ...edge.data, deleting: false } } : edge)
    refreshNodeStates()
  }
}

async function uploadFile(payload: { kind: string, id: string, file: File }) {
  const key = `${payload.kind}:${payload.id}`
  if (uploadingNodeIds.value.has(key)) return
  uploadingNodeIds.value.add(key)
  setUploadState(payload.kind, payload.id, true)
  try {
    await api.uploadNodeFile(props.projectId, payload.kind as NodeKind, payload.id, payload.file)
    await loadCanvas(true)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '素材上传失败'
  } finally {
    uploadingNodeIds.value.delete(key)
    setUploadState(payload.kind, payload.id, false)
  }
}

function setUploadState(kind: string, id: string, uploading: boolean) {
  nodes.value = nodes.value.map(node => {
    const mediaKind = node.data.visualKind === 'video' ? 'video' : node.data.apiKind
    return node.data.recordId === id && mediaKind === kind ? { ...node, data: { ...node.data, uploading } } : node
  })
}

async function onHistoryRestored() {
  historyTarget.value = undefined
  await loadCanvas(true)
}

function scheduleLayoutSave() {
  if (layoutTimer) clearTimeout(layoutTimer)
  const episode = episodeNumber.value
  const layout = nodes.value.map(node => ({ nodeId: node.id, x: node.position.x, y: node.position.y, width: node.dimensions.width || undefined, height: node.dimensions.height || undefined }))
  layoutTimer = setTimeout(() => {
    void api.saveLayout(props.projectId, episode, layout)
  }, 500)
}

watch(episodeNumber, () => {
  scriptOpen.value = false; scriptError.value = ''; closeNodeAgent(); void loadCanvas()
})
onBeforeMount(() => {
  document.documentElement.classList.add('aigc-canvas-page')
  document.body.classList.add('aigc-canvas-page')
})
onMounted(() => {
  try {
    const draft = JSON.parse(localStorage.getItem(`aigc-script-visual-draft:${props.projectId}`) || '{}')
    if (typeof draft.genre === 'string') scriptVisualDraft.genre = draft.genre
    if (typeof draft.style === 'string') scriptVisualDraft.style = draft.style
  } catch {}
  sidebarOpen.value = localStorage.getItem(`aigc-canvas-sidebar:${props.projectId}`) !== '0'
  try {
    const savedScripts = JSON.parse(localStorage.getItem(`aigc-script-drafts:${props.projectId}`) || '{}')
    if (savedScripts && typeof savedScripts === 'object') for (const [id, value] of Object.entries(savedScripts)) if (typeof value === 'string') scriptDrafts[id] = value
    const drafts = JSON.parse(localStorage.getItem(draftStorageKey) || '{}')
    if (drafts && typeof drafts === 'object') for (const [id, value] of Object.entries(drafts)) if (typeof value === 'string') promptDrafts[id] = value
  } catch { /* Ignore malformed local drafts. */ }
  return Promise.all([loadCanvas(), loadAIConfigs(), loadJobs()])
})
onBeforeUnmount(() => {
  disposed = true
  if (pollingTimer) clearTimeout(pollingTimer)
  if (layoutTimer) clearTimeout(layoutTimer)
  document.documentElement.classList.remove('aigc-canvas-page')
  document.body.classList.remove('aigc-canvas-page')
})
</script>

<template>
  <main class="workspace-shell">
    <header class="workspace-header">
      <NuxtLink to="/" class="brand-mark" title="返回项目列表" aria-label="返回项目列表"><img src="https://file.ybcfish.cloud/fishybc.png" alt="" width="30" height="30" draggable="false"></NuxtLink>
      <div class="project-heading">
        <form v-if="projectTitleEditing" class="project-title-form" @submit.prevent="saveProjectTitle">
          <input ref="projectTitleInput" v-model="projectTitleDraft" class="project-title-input" aria-label="剧本名称" placeholder="未命名" maxlength="120" :disabled="projectTitleSaving" @blur="saveProjectTitle" @keydown.esc.stop.prevent="cancelProjectTitleEdit">
          <LoaderCircle v-if="projectTitleSaving" :size="13" class="project-title-saving spin" aria-label="正在保存名称" />
          <p v-if="projectTitleError" class="project-title-error" role="alert">{{ projectTitleError }}</p>
        </form>
        <button v-else type="button" class="project-title-button" title="编辑剧本名称" aria-label="编辑剧本名称" :disabled="!project" @click="editProjectTitle"><strong>{{ project?.title || '未命名' }}</strong><Pencil :size="12" /></button>
        <span>无限画布</span>
      </div>
      <AppSelect v-model="episodeNumber" class="episode-select" :options="episodeOptions" :disabled="episodeCreating || loading" :searchable="episodeOptions.length > 100" search-placeholder="搜索分集" aria-label="选择分集" compact>
        <template #footer="{ close }">
          <button type="button" class="episode-add-button" :disabled="episodeCreating" @click="close(); createEpisode()"><LoaderCircle v-if="episodeCreating" :size="14" class="spin" /><Plus v-else :size="14" />新增一集</button>
        </template>
      </AppSelect>
      <LoaderCircle v-if="episodeCreating" :size="14" class="spin" role="status" aria-label="正在新增剧集" />
      <button type="button" class="header-tasks-button" title="查看生成任务" :aria-expanded="tasksOpen" @click="openTasks"><ListTodo :size="16" /><span>任务</span><span v-if="activeTaskCount" class="tasks-count">{{ activeTaskCount }}</span></button>
      <button type="button" class="header-icon-button" title="AI 配置" @click="aiConfigOpen = true"><Settings2 :size="17" /></button>
      <span class="save-state">自动保存</span>
    </header>

    <div class="workspace-body">
      <aside v-if="sidebarOpen" class="canvas-sidebar">
        <header><strong>素材节点</strong><button type="button" title="收起素材栏" @click="toggleSidebar"><PanelLeftClose :size="17" /></button></header>
        <section v-for="group in ([['script', '剧本'], ['image', '图片'], ['video', '视频'], ['text', '文本'], ['audio', '音频']] as const)" :key="group[0]">
          <div class="sidebar-group-title">{{ group[1] }}<span>{{ assetGroups[group[0]].length }}</span></div>
          <button
            v-for="asset in assetGroups[group[0]]"
            :key="asset.id"
            type="button"
            :title="group[0] === 'script' ? '定位当前剧本' : asset.data.title"
            :aria-label="group[0] === 'script' ? '定位当前剧本' : undefined"
            :class="{ active: selectedCanvasNodeIds.includes(asset.id) }"
            @click="focusCanvasNode(asset.id)"
          ><FileText v-if="group[0] === 'script'" :size="14" /><span>{{ asset.data.title || '未命名' }}</span></button>
          <div v-if="!assetGroups[group[0]].length" class="sidebar-empty">暂无数据</div>
        </section>
      </aside>

      <section ref="canvasStage" class="canvas-stage">
      <button v-if="!sidebarOpen" type="button" class="sidebar-open-button" title="展开素材栏" @click="toggleSidebar"><PanelLeftOpen :size="17" /></button>
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :pan-on-drag="interactionMode === 'pan' ? true : [1, 2]"
        :pan-on-scroll="true"
        :pan-on-scroll-speed="0.8"
        :selection-on-drag="interactionMode === 'select'"
        :selection-mode="SelectionMode.Partial"
        :connection-mode="ConnectionMode.Loose"
        :connection-radius="32"
        :nodes-connectable="interactionMode === 'select'"
        :elements-selectable="interactionMode === 'select'"
        :nodes-draggable="interactionMode === 'select'"
        :zoom-on-scroll="false"
        :zoom-on-pinch="true"
        :prevent-scrolling="true"
        :min-zoom="0.15"
        :max-zoom="2"
        fit-view-on-init
        @connect="connectNodes"
        @connect-start="handleConnectStart"
        @connect-end="handleConnectEnd"
        @node-drag-stop="scheduleLayoutSave"
        @node-drag="updateGroupToolbar"
        @move="updateGroupToolbar"
        @move-end="handleMoveEnd"
        @selection-change="handleSelectionChange"
        @edge-double-click="({ edge }) => removeEdge(edge)"
      >
        <Background pattern-color="#d8dde5" :gap="22" :size="1" />
        <Controls position="bottom-right" />
        <template #node-canvas="nodeProps">
          <CanvasNode
            v-bind="nodeProps"
            :is-valid-connection="isValidCanvasConnection"
            @save="savePrompt"
            @upload="uploadFile"
            @remove="removeNode"
            @preview="preview = $event"
            @details="detail = $event"
            @history="historyTarget = $event"
            @draft-change="updatePromptDraft"
            @generate="generateNode"
            @cancel="cancelGeneration"
            @add-reference="uploadNodeReference"
            @remove-reference="removeNodeReference"
            @close="closeNodeAgent"
            @edit="textEditorTarget = $event"
            @script="scriptOpen = true"
          />
        </template>
        <template #edge-canvas="edgeProps">
          <CanvasEdge v-bind="edgeProps" @remove="removeEdgeById" />
        </template>
      </VueFlow>

      <button v-if="showReturnButton" type="button" class="return-to-nodes-button nodrag nopan" @click="returnToNodes">
        <LocateFixed :size="16" />回到节点
      </button>

      <div
        v-if="groupToolbarPosition && selectedDeletableNodes.length"
        class="group-selection-toolbar nodrag nopan"
        :style="{ left: `${groupToolbarPosition.left}px`, top: `${groupToolbarPosition.top}px` }"
        @pointerdown.stop
      >
        <button type="button" @click="deleteSelectedNodes"><Trash2 :size="15" />整组删除</button>
      </div>

      <div class="canvas-toolbar">
        <div class="segmented-tools">
          <button type="button" title="选择与框选" :class="{ active: interactionMode === 'select' }" :aria-pressed="interactionMode === 'select'" @click="interactionMode = 'select'; addMenuOpen = false"><MousePointer2 :size="17" /></button>
          <button type="button" title="移动画布" :class="{ active: interactionMode === 'pan' }" :aria-pressed="interactionMode === 'pan'" @click="interactionMode = 'pan'; addMenuOpen = false"><Hand :size="17" /></button>
        </div>
        <span class="canvas-toolbar-divider" aria-hidden="true" />
        <div class="add-node-wrap">
          <button type="button" class="add-node-button" :class="{ active: addMenuOpen }" :aria-expanded="addMenuOpen" @click="addMenuOpen = !addMenuOpen"><Plus :size="17" />添加节点</button>
          <div v-if="addMenuOpen" class="add-node-menu">
            <button v-for="option in addOptions" :key="option.kind" type="button" @click="addNode(option.kind)">
              <component :is="option.icon" :size="16" />{{ option.label }}
            </button>
          </div>
        </div>
        <span class="canvas-toolbar-divider" aria-hidden="true" />
        <NuxtLink :to="`/projects/${projectId}?view=edit&episode=${episodeNumber}`" class="canvas-toolbar-edit" title="视频剪辑"><Clapperboard :size="16" />视频剪辑</NuxtLink>
      </div>

      <div v-if="loading" class="canvas-loading">正在加载画布...</div>
      <button v-if="errorMessage" type="button" class="canvas-error" @click="errorMessage = ''">{{ errorMessage }}<X :size="14" /></button>
      </section>
    </div>

    <CanvasTasks v-if="tasksOpen" :jobs="tasks" :loading="tasksLoading" :error="tasksError" :cancelling="[...cancellingJobIds]" :media-url="mediaUrl" @close="tasksOpen = false" @refresh="loadJobs" @cancel="cancelJobById" @preview="preview = $event" />
    <CanvasScriptDialog v-if="scriptOpen && activeEpisode" :key="activeEpisode.id" :content="scriptContent" :title="activeEpisode.title" :genre="scriptGenre" :visual-style="scriptStyle" :default-model-id="project?.textModelId" :episode="episodeNumber" :jobs="tasks" :models="modelsFor('text')" :pending="scriptPending" :saving="scriptSaving" :error="scriptError" @close="scriptOpen=false" @update:content="updateScriptDraft" @update:genre="updateScriptVisualDraft('genre', $event)" @update:visual-style="updateScriptVisualDraft('style', $event)" @save="saveScript" @extract="extractScriptAssets" @cancel="cancelScriptExtraction" />
    <CanvasMediaPreview v-if="preview" :key="`${preview.kind}:${preview.url}`" :target="preview" @close="preview = undefined" />
    <CanvasMediaHistory v-if="historyTarget" :key="`${historyTarget.kind}:${historyTarget.id}`" :project-id="projectId" :target="historyTarget" @close="historyTarget = undefined" @restored="onHistoryRestored" />
    <CanvasTextEditor v-if="textEditorTarget" :key="textEditorTarget.id" :project-id="projectId" :target="textEditorTarget" @close="textEditorTarget = undefined" @saved="onTextSaved" />
    <div v-if="detail" class="preview-backdrop" @click.self="detail = undefined">
      <section class="node-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="node-detail-heading">
        <header><h2 id="node-detail-heading">{{ detail.title || '节点详情' }}</h2><button type="button" class="icon-button" title="关闭" @click="detail = undefined"><X :size="17" /></button></header>
        <div class="node-detail-body"><dl><div v-if="detail.aspectRatio"><dt>画幅比例</dt><dd>{{ detail.aspectRatio }}<template v-if="detail.duration"> · {{ detail.duration }}s</template></dd></div><div v-if="detail.appearance"><dt>外观</dt><dd>{{ detail.appearance }}</dd></div><div v-if="detail.content"><dt>{{ detail.visualKind === 'text' ? '文本内容' : '描述' }}</dt><dd>{{ detail.content }}</dd></div><div v-if="detail.prompt"><dt>生成提示词</dt><dd>{{ detail.prompt }}</dd></div></dl></div>
        <footer><button type="button" class="secondary-button" @click="detail = undefined">关闭</button></footer>
      </section>
    </div>
    <AIConfigDialog :open="aiConfigOpen" @close="aiConfigOpen = false" @changed="loadAIConfigs" />
  </main>
</template>
