<script setup lang="ts">
import { FileText, FileUp, LoaderCircle, Upload, X } from 'lucide-vue-next'
import AppSelect from '~/components/ui/AppSelect.vue'
import { createCanvasService } from '~/services/canvas/canvas.service'
import type { Project, ScriptImportPreview, ScriptImportSettings } from '~/types/canvas'

const props = defineProps<{ settings: ScriptImportSettings }>()
const emit = defineEmits<{ close: [], imported: [project: Pick<Project, 'id' | 'title' | 'episodeCount'>] }>()
const config = useRuntimeConfig()
const api = createCanvasService(config.public.apiBase)
const file = ref<File>()
const fileInput = ref<HTMLInputElement>()
const panel = ref<HTMLElement>()
const title = ref('')
const encoding = ref<string | number>('auto')
const preview = ref<ScriptImportPreview>()
const busy = ref<'' | 'preview' | 'import'>('')
const error = ref('')
let disposed = false
let previousFocus: HTMLElement | null = null
const encodingOptions = [
  { value: 'auto', label: '自动识别编码' }, { value: 'utf-8', label: 'UTF-8' },
  { value: 'gb18030', label: 'GB18030 / GBK' }, { value: 'utf-16le', label: 'UTF-16 LE' }, { value: 'utf-16be', label: 'UTF-16 BE' },
]
watch(encoding, () => { preview.value = undefined; error.value = '' })

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  input.value = ''
  if (!selected) return
  preview.value = undefined; error.value = ''
  if (!/\.txt$/i.test(selected.name) || !selected.size || selected.size > 32 * 1024 * 1024) {
    file.value = undefined
    error.value = '请选择不超过 32MB 的非空 TXT 文件'
    return
  }
  file.value = selected
  title.value = selected.name.replace(/\.txt$/i, '').slice(0, 120)
}
function clearFile() { file.value = undefined; preview.value = undefined; error.value = ''; title.value = '' }
function close() { if (!busy.value) emit('close') }
async function submit(previewOnly: boolean) {
  if (!file.value || busy.value || !previewOnly && !preview.value) return
  busy.value = previewOnly ? 'preview' : 'import'; error.value = ''
  try {
    const settings = { ...props.settings, title: title.value, encoding: String(encoding.value) }
    if (previewOnly) {
      const result = await api.previewScriptImport(file.value, settings)
      if (!disposed) preview.value = result
    } else {
      const project = await api.importScript(file.value, settings)
      if (!disposed) emit('imported', project)
    }
  } catch (cause: any) {
    if (!disposed) error.value = cause?.data?.message || cause?.message || '导入失败，请检查文件后重试'
  } finally { if (!disposed) busy.value = '' }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); close() }
  if (event.key !== 'Tab') return
  // AppSelect menus are portalled; leave their own keyboard interaction intact.
  if (!panel.value?.contains(document.activeElement)) return
  const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type=file])')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement
  panel.value?.focus()
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('keydown', onKeydown)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body"><div class="preview-backdrop" @click.self="close">
    <section ref="panel" class="script-import-dialog" role="dialog" aria-modal="true" aria-labelledby="script-import-title" tabindex="-1" :aria-busy="Boolean(busy)">
      <header><div><FileUp :size="18" /><h2 id="script-import-title">导入 TXT 剧本</h2></div><button type="button" title="关闭导入" :disabled="Boolean(busy)" @click="close"><X :size="18" /></button></header>
      <div class="script-import-body">
        <div class="script-import-file-field"><span>TXT 文件</span><div class="script-import-file"><FileText :size="21" /><span :title="file?.name">{{ file?.name || '未选择文件' }}</span><button type="button" :disabled="Boolean(busy)" @click="fileInput?.click()"><Upload :size="14" />{{ file ? '更换文件' : '选择文件' }}</button><button v-if="file" class="script-import-clear" type="button" title="移除文件" aria-label="移除文件" :disabled="Boolean(busy)" @click="clearFile"><X :size="14" /></button></div><small>UTF-8、GB18030 / GBK、UTF-16 · 最大 32MB</small><input ref="fileInput" class="sr-only" type="file" accept=".txt,text/plain" aria-label="TXT 文件" :disabled="Boolean(busy)" @change="chooseFile"></div>
        <label class="script-import-field">项目名称<input v-model="title" aria-label="导入项目名称" maxlength="120" placeholder="使用文件名" :disabled="Boolean(busy)"></label>
        <div class="script-import-field"><span>文本编码</span><AppSelect v-model="encoding" :options="encodingOptions" aria-label="文本编码" :disabled="Boolean(busy)" /></div>
        <p v-if="error" class="home-error" role="alert">{{ error }}</p>
        <section v-if="preview" class="script-import-preview" aria-label="章节预览"><header><strong>{{ preview.chapterCount }} 章</strong><span>{{ preview.characterCount.toLocaleString() }} 字符 · {{ preview.encoding }}</span></header><ol><li v-for="chapter in preview.chapters" :key="chapter.episodeNumber"><span :title="chapter.title">{{ chapter.episodeNumber }}. {{ chapter.title }}</span><span>{{ chapter.characterCount.toLocaleString() }} 字符</span></li></ol><p v-if="preview.chapterCount > preview.chapters.length">预览前 {{ preview.chapters.length }} 章，确认后导入全部 {{ preview.chapterCount }} 章。</p></section>
      </div>
      <footer><button type="button" class="secondary-button" :disabled="Boolean(busy)" @click="close">取消</button><button type="button" :class="preview ? 'secondary-button' : 'primary-button'" :disabled="!file || Boolean(busy)" @click="submit(true)"><LoaderCircle v-if="busy === 'preview'" :size="14" class="spin" />预览章节</button><button v-if="preview" type="button" class="primary-button" :disabled="!file || Boolean(busy)" @click="submit(false)"><LoaderCircle v-if="busy === 'import'" :size="14" class="spin" />确认导入</button></footer>
    </section>
  </div></Teleport>
</template>
