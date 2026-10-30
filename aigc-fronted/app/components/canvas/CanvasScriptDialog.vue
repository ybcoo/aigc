<script setup lang="ts">
import { FileText, LoaderCircle, Save, ScanLine, Square, X } from 'lucide-vue-next'
import AppSelect from '~/components/ui/AppSelect.vue'
import type { CanvasJob } from '~/types/canvas'
type Category = 'character' | 'scene' | 'prop'
const props = defineProps<{ content: string, title: string, genre: string, visualStyle: string, defaultModelId?: string, episode: number, jobs: CanvasJob[], models: Array<{ value: string, label: string }>, pending: Record<string, boolean>, saving: boolean, error: string }>()
const emit = defineEmits<{ close: [], 'update:content': [value: string], 'update:genre': [value: string], 'update:visualStyle': [value: string], save: [], extract: [input: { kind: Category, modelId: string, aspectRatio: string }], cancel: [kind: Category] }>()
const selectedModel = ref<string | number>(''), aspect = ref<string | number>('1:1')
const categories: Array<{ kind: Category, label: string }> = [{ kind: 'character', label: '角色' }, { kind: 'scene', label: '场景' }, { kind: 'prop', label: '道具' }]
watch(() => [props.models, props.defaultModelId] as const, ([models, preferred]) => {
  if (!models.some(model => model.value === selectedModel.value)) selectedModel.value = models.find(model => model.value === preferred)?.value || models[0]?.value || ''
}, { immediate: true })
function job(kind: Category) { return props.jobs.find(item => item.kind === 'canvas_asset_extract' && item.episodeNumber === props.episode && item.input?.category === kind) }
function busy(kind: Category) { return props.pending[kind] || ['queued', 'running'].includes(job(kind)?.status || '') }
function action(kind: Category) { if (busy(kind)) emit('cancel', kind); else emit('extract', { kind, modelId: String(selectedModel.value), aspectRatio: String(aspect.value) }) }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
onMounted(() => document.addEventListener('keydown', keydown))
onBeforeUnmount(() => document.removeEventListener('keydown', keydown))
</script>

<template>
  <Teleport to="body"><div class="preview-backdrop" @click.self="emit('close')">
    <section class="canvas-script-dialog" role="dialog" aria-modal="true" aria-labelledby="canvas-script-title">
      <header><div><FileText :size="18" /><h2 id="canvas-script-title">{{ title }} · 剧本</h2></div><button type="button" title="关闭剧本" @click="emit('close')"><X :size="18" /></button></header>
      <div class="canvas-script-body">
        <div class="script-visual-settings">
          <label>题材<input :value="genre" aria-label="项目题材" placeholder="如：现代都市、玄幻修仙、产品广告" maxlength="200" @input="emit('update:genre', ($event.target as HTMLInputElement).value)"></label>
          <label>视觉风格<input :value="visualStyle" aria-label="项目视觉风格" placeholder="如：写实电影、国风动漫、3D 动画" maxlength="1000" @input="emit('update:visualStyle', ($event.target as HTMLInputElement).value)"></label>
        </div>
        <textarea :value="content" aria-label="本集剧本" placeholder="填写本集剧本" maxlength="100000" @input="emit('update:content', ($event.target as HTMLTextAreaElement).value)" />
        <div class="script-extract-settings"><AppSelect v-model="selectedModel" :options="models" placeholder="未配置文本模型" aria-label="剧本提取模型" compact /><label>素材画幅<AppSelect v-model="aspect" :options="['1:1','16:9','9:16','4:3','3:4'].map(value => ({ value, label: value }))" aria-label="提取素材画幅" compact /></label></div>
        <div class="script-extract-actions"><div v-for="category in categories" :key="category.kind"><button type="button" class="secondary-button" :aria-label="busy(category.kind) ? `中断提取${category.label}` : `提取${category.label}`" :disabled="!busy(category.kind) && (!content.trim() || !selectedModel)" @click="action(category.kind)"><LoaderCircle v-if="busy(category.kind)" :size="15" class="spin" /><ScanLine v-else :size="15" /><span>{{ busy(category.kind) ? `提取${category.label}中` : `提取${category.label}` }}</span><Square v-if="busy(category.kind)" :size="11" /></button><span v-if="job(category.kind)?.status === 'succeeded'" class="script-extract-result">{{ job(category.kind)?.result?.content }}</span><span v-else-if="job(category.kind)?.status === 'cancelled'" class="script-extract-result">已中断</span><span v-else-if="job(category.kind)?.status === 'failed'" class="script-extract-error">{{ job(category.kind)?.error }}</span></div></div>
        <p v-if="error" role="alert" class="script-extract-error">{{ error }}</p>
      </div>
      <footer><button type="button" class="secondary-button" @click="emit('close')">关闭</button><button type="button" class="primary-button" :disabled="saving" @click="emit('save')"><LoaderCircle v-if="saving" :size="15" class="spin" /><Save v-else :size="15" />保存剧本</button></footer>
    </section>
  </div></Teleport>
</template>
