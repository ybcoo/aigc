<script setup lang="ts">
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  TestTube2,
  Trash2,
  Volume2,
  X,
} from 'lucide-vue-next'
import { createAIConfigService } from '~/services/ai-config/ai-config.service'
import type { AIConfig, AIConfigInput, AIServiceType } from '~/types/ai-config'
import AppSelect from '~/components/ui/AppSelect.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], changed: [] }>()
const config = useRuntimeConfig()
const api = createAIConfigService(config.public.apiBase)

const serviceLabels: Record<AIServiceType, string> = {
  text: '文本 / 对话', vision: '视觉判断', image: '文本生成图片', storyboard_image: '分镜图片生成', video: '视频生成', tts: '语音合成 TTS',
}
const serviceTypes = Object.keys(serviceLabels) as AIServiceType[]
const providerNames: Record<string, string> = {
  xingzhan: '星战云', openai: 'OpenAI', volcengine: '火山引擎', volces: '火山引擎', gemini: 'Google Gemini',
  deepseek: 'DeepSeek', qwen: '通义千问', dashscope: '通义万象', minimax: 'MiniMax', kling: '可灵', vidu: 'Vidu', custom: '自定义',
}
const presets: Record<AIServiceType, Array<{ id: string, models: string[] }>> = {
  text: [
    { id: 'xingzhan', models: [] }, { id: 'openai', models: ['gpt-4o', 'gpt-4o-mini'] },
    { id: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] }, { id: 'qwen', models: ['qwen3-max', 'qwen-plus', 'qwen-flash'] },
  ],
  vision: [
    { id: 'xingzhan', models: [] }, { id: 'openai', models: ['gpt-4o', 'gpt-4o-mini'] },
    { id: 'gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] }, { id: 'qwen', models: ['qwen-vl-max', 'qwen-vl-plus'] },
  ],
  image: [
    { id: 'xingzhan', models: [] }, { id: 'volcengine', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'] },
    { id: 'dashscope', models: ['wan2.6-image', 'qwen-image-edit-plus'] }, { id: 'gemini', models: ['gemini-2.5-flash-image'] },
    { id: 'openai', models: ['gpt-image-1'] },
  ],
  storyboard_image: [
    { id: 'xingzhan', models: [] }, { id: 'dashscope', models: ['wan2.6-image', 'qwen-image-edit-plus'] },
    { id: 'volcengine', models: ['doubao-seedream-4-5-251128'] }, { id: 'gemini', models: ['gemini-2.5-flash-image'] },
  ],
  video: [
    { id: 'xingzhan', models: [] }, { id: 'volces', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-1-5-pro-251215'] },
    { id: 'dashscope', models: ['wan2.7-t2v', 'wan2.7-i2v', 'wan2.6-r2v-flash'] },
    { id: 'gemini', models: ['veo-3.1-generate-preview'] }, { id: 'openai', models: ['sora-2', 'sora-2-pro'] },
  ],
  tts: [{ id: 'xingzhan', models: [] }, { id: 'minimax', models: ['speech-02-hd', 'speech-02-turbo'] }, { id: 'openai', models: ['gpt-4o-mini-tts'] }],
}

const rows = ref<AIConfig[]>([])
const loading = ref(false)
const editingId = ref<string | 'new'>()
const saving = ref(false)
const probing = ref(false)
const testingId = ref('')
const previewing = ref(false)
const showApiKey = ref(false)
const modelText = ref('')
const notice = ref<{ type: 'success' | 'error', text: string }>()
const audioUrl = ref('')
const form = reactive<AIConfigInput>(emptyForm())

function emptyForm(serviceType: AIServiceType = 'text'): AIConfigInput {
  return {
    serviceType, provider: 'xingzhan', apiProtocol: 'openai', name: '星战云', baseUrl: 'https://openapi.xingzhan.cloud/v1',
    apiKey: '', models: [], defaultModel: '', endpoint: '', queryEndpoint: '', priority: 0,
    isDefault: true, isActive: true, runtimeParams: {},
  }
}

function baseUrlFor(provider: string) {
  return ({
    xingzhan: 'https://openapi.xingzhan.cloud/v1', openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    dashscope: 'https://dashscope.aliyuncs.com', gemini: 'https://generativelanguage.googleapis.com',
    volcengine: 'https://ark.cn-beijing.volces.com/api/v3', volces: 'https://ark.cn-beijing.volces.com/api/v3',
    minimax: 'https://api.minimaxi.com/v1',
  } as Record<string, string>)[provider] || ''
}

function protocolFor(provider: string) {
  return ({ gemini: 'gemini', dashscope: 'dashscope', volcengine: 'volcengine', volces: 'volcengine' } as Record<string, string>)[provider] || 'openai'
}

function assignForm(input: AIConfigInput) {
  Object.assign(form, input)
  form.runtimeParams = { ...(input.runtimeParams || {}) }
  form.models = [...input.models]
  modelText.value = input.models.join('\n')
}

function parseModels() {
  return [...new Set(modelText.value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean))]
}

function openNew() {
  editingId.value = 'new'
  showApiKey.value = false
  clearAudio()
  assignForm(emptyForm())
}

function openEdit(row: AIConfig) {
  editingId.value = row.id
  showApiKey.value = false
  clearAudio()
  assignForm({ ...row, apiKey: '', runtimeParams: { ...row.runtimeParams } })
}

function changeServiceType() {
  const first = presets[form.serviceType][0]
  form.provider = first?.id || 'custom'
  applyProvider()
}

function applyProvider() {
  const preset = presets[form.serviceType].find(item => item.id === form.provider)
  const custom = form.provider === 'custom'
  form.apiProtocol = custom ? 'openai' : protocolFor(form.provider)
  form.baseUrl = custom ? '' : baseUrlFor(form.provider)
  form.name = custom ? '' : form.provider === 'xingzhan' ? '星战云' : `${providerNames[form.provider] || form.provider} ${serviceLabels[form.serviceType]}`
  modelText.value = (preset?.models || []).join('\n')
  form.models = preset?.models || []
  form.defaultModel = form.models[0] || ''
  form.endpoint = ''
  form.queryEndpoint = ''
}

async function load() {
  loading.value = true
  try { rows.value = await api.list() }
  catch (error) { showNotice('error', messageOf(error)) }
  finally { loading.value = false }
}

async function save() {
  const models = parseModels()
  if (!form.name.trim() || !form.provider.trim() || !form.baseUrl.trim() || !models.length || !form.defaultModel) {
    showNotice('error', '请完整填写名称、厂商、Base URL、模型列表和默认模型')
    return
  }
  saving.value = true
  try {
    await api.save({ ...form, models }, editingId.value === 'new' ? undefined : editingId.value)
    editingId.value = undefined
    showNotice('success', 'AI 配置已保存')
    await load()
    emit('changed')
  } catch (error) { showNotice('error', messageOf(error)) }
  finally { saving.value = false }
}

async function probeModels() {
  probing.value = true
  try {
    const result = await api.discoverModels({
      id: editingId.value === 'new' ? undefined : editingId.value,
      serviceType: form.serviceType, provider: form.provider, apiProtocol: form.apiProtocol,
      baseUrl: form.baseUrl, apiKey: form.apiKey,
    })
    modelText.value = result.models.join('\n')
    form.models = result.models
    if (!result.models.includes(form.defaultModel)) form.defaultModel = result.models[0] || ''
    showNotice('success', `检测到 ${result.models.length} 个模型`)
  } catch (error) { showNotice('error', messageOf(error)) }
  finally { probing.value = false }
}

async function test(row: AIConfig) {
  testingId.value = row.id
  try {
    const result = await api.test(row.id)
    showNotice(result.success ? 'success' : 'error', result.success ? result.response : result.errorMessage)
  } catch (error) { showNotice('error', messageOf(error)) }
  finally { testingId.value = '' }
}

async function remove(row: AIConfig) {
  if (!window.confirm(`确认删除“${row.name}”？`)) return
  try {
    await api.remove(row.id)
    showNotice('success', '配置已删除')
    await load()
    emit('changed')
  } catch (error) { showNotice('error', messageOf(error)) }
}

async function previewSpeech() {
  previewing.value = true
  clearAudio()
  try {
    const blob = await api.previewSpeech({
      id: editingId.value === 'new' ? undefined : editingId.value,
      baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.defaultModel,
      voice: form.runtimeParams.voice || '',
    })
    audioUrl.value = URL.createObjectURL(blob)
  } catch (error) { showNotice('error', messageOf(error)) }
  finally { previewing.value = false }
}

function clearAudio() {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
}

function showNotice(type: 'success' | 'error', text: string) {
  notice.value = { type, text }
  window.setTimeout(() => { if (notice.value?.text === text) notice.value = undefined }, 4500)
}

function messageOf(error: unknown) {
  if (error && typeof error === 'object') {
    const data = (error as { data?: { message?: string | string[] }, message?: string }).data
    if (Array.isArray(data?.message)) return data.message.join('；')
    if (data?.message) return data.message
  }
  return error instanceof Error ? error.message : '操作失败'
}

const formModels = computed(() => parseModels())
const serviceTypeOptions = computed(() => serviceTypes.map(type => ({ value: type, label: serviceLabels[type] })))
const providerOptions = computed(() => [
  ...presets[form.serviceType].map(item => ({ value: item.id, label: providerNames[item.id] || item.id })),
  { value: 'custom', label: '自定义' },
])
const defaultModelOptions = computed(() => formModels.value.map(model => ({ value: model, label: model })))
const endpointPreview = computed(() => {
  const base = form.baseUrl.replace(/\/$/, '')
  if (!base) return ''
  if (['text', 'vision'].includes(form.serviceType)) return `${base}/chat/completions`
  if (['image', 'storyboard_image'].includes(form.serviceType)) return `${base}${form.endpoint || '/images/generations'}`
  if (form.serviceType === 'video') return `${base}${form.endpoint || '/video/generations'}`
  return `${base}${form.endpoint || '/audio/speech'}`
})

watch(() => props.open, (open) => { if (open) void load(); else { editingId.value = undefined; clearAudio() } })
onBeforeUnmount(clearAudio)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ai-modal-backdrop" @click.self="emit('close')">
      <section class="ai-config-dialog" role="dialog" aria-modal="true" aria-label="AI 配置">
        <header class="ai-dialog-header">
          <div><strong>AI 配置</strong><span>配置画布生成所使用的模型服务</span></div>
          <button type="button" title="关闭" @click="emit('close')"><X :size="18" /></button>
        </header>

        <div v-if="!editingId" class="ai-config-list-view">
          <div class="ai-list-toolbar">
            <button type="button" class="primary-button" @click="openNew"><Plus :size="16" />添加配置</button>
            <button type="button" class="icon-button" title="刷新" @click="load"><RefreshCw :size="16" /></button>
          </div>
          <div v-if="loading" class="ai-empty"><LoaderCircle class="spin" :size="20" />正在加载配置</div>
          <div v-else-if="!rows.length" class="ai-empty">暂无 AI 配置，添加后即可在画布节点中选择模型。</div>
          <div v-else class="ai-config-table-wrap">
            <table class="ai-config-table">
              <thead><tr><th>名称</th><th>服务类型</th><th>厂商</th><th>默认模型</th><th>默认</th><th>API Key</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="row in rows" :key="row.id">
                  <td><strong>{{ row.name }}</strong></td><td>{{ serviceLabels[row.serviceType] }}</td><td>{{ providerNames[row.provider] || row.provider }}</td>
                  <td>{{ row.defaultModel || '-' }}</td><td><Check v-if="row.isDefault" :size="15" /></td><td>{{ row.apiKeyMasked || '-' }}</td>
                  <td><div class="table-actions">
                    <button type="button" title="测试连接" @click="test(row)"><LoaderCircle v-if="testingId === row.id" class="spin" :size="15" /><TestTube2 v-else :size="15" /></button>
                    <button type="button" title="编辑" @click="openEdit(row)"><Pencil :size="15" /></button>
                    <button type="button" title="删除" @click="remove(row)"><Trash2 :size="15" /></button>
                  </div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <form v-else class="ai-config-editor" @submit.prevent="save">
          <div class="ai-form-grid">
            <label>服务类型<AppSelect v-model="form.serviceType" :options="serviceTypeOptions" aria-label="服务类型" @change="changeServiceType" /></label>
            <label>配置名称<input v-model="form.name" placeholder="例如：星战云视频模型"></label>
            <label>厂商<AppSelect v-model="form.provider" :options="providerOptions" aria-label="厂商" @change="applyProvider" /></label>
            <label>接口规范<input v-model="form.apiProtocol" placeholder="openai"></label>
            <label class="span-2">Base URL<input v-model="form.baseUrl" placeholder="https://api.example.com/v1"></label>
            <label class="span-2">API Key<span class="secret-input"><input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" :placeholder="editingId === 'new' ? '输入 API Key' : '留空表示保持原密钥'"><button type="button" :title="showApiKey ? '隐藏' : '显示'" @click="showApiKey = !showApiKey"><EyeOff v-if="showApiKey" :size="16" /><Eye v-else :size="16" /></button></span></label>
            <label class="span-2 model-list-field"><span>模型列表<button type="button" class="probe-button" :disabled="probing || !form.baseUrl" @click="probeModels"><LoaderCircle v-if="probing" class="spin" :size="14" /><RefreshCw v-else :size="14" />检测可用模型</button></span><textarea v-model="modelText" rows="3" placeholder="多个模型使用换行或逗号分隔" /></label>
            <label>默认模型<AppSelect v-model="form.defaultModel" :options="defaultModelOptions" placeholder="选择默认模型" aria-label="默认模型" /></label>
            <label>优先级<input v-model.number="form.priority" type="number" min="-1000" max="1000"></label>
            <label v-if="['image', 'storyboard_image'].includes(form.serviceType)">最大参考图数<input v-model="form.runtimeParams.max_reference_images" type="number" min="1" max="64" placeholder="默认 3"></label>
            <template v-if="form.serviceType === 'video'"><label>提交端点<input v-model="form.endpoint" placeholder="/video/generations"></label><label>查询端点<input v-model="form.queryEndpoint" placeholder="/tasks/{taskId}"></label></template>
            <template v-if="form.serviceType === 'tts'"><label>声音 ID<input v-model="form.runtimeParams.voice" placeholder="输入或选择厂商声音 ID"></label><div class="voice-preview"><button type="button" class="secondary-button" :disabled="previewing || !form.defaultModel || !form.runtimeParams.voice" @click="previewSpeech"><LoaderCircle v-if="previewing" class="spin" :size="15" /><Volume2 v-else :size="15" />试听声音</button><audio v-if="audioUrl" :src="audioUrl" controls autoplay /></div></template>
            <div v-if="endpointPreview" class="endpoint-preview span-2"><strong>接口地址预览</strong><span>{{ endpointPreview }}</span></div>
            <label class="check-field"><input v-model="form.isDefault" type="checkbox">设为默认</label>
            <label class="check-field"><input v-model="form.isActive" type="checkbox">启用</label>
          </div>
          <footer class="ai-dialog-footer"><button type="button" class="secondary-button" @click="editingId = undefined">取消</button><button type="submit" class="primary-button" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" />保存</button></footer>
        </form>

        <div v-if="notice" class="ai-notice" :class="`is-${notice.type}`">{{ notice.text }}</div>
      </section>
    </div>
  </Teleport>
</template>
