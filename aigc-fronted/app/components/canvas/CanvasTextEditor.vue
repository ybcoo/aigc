<script setup lang="ts">
import { LoaderCircle, Pencil, X } from 'lucide-vue-next'
import { createCanvasService } from '~/services/canvas/canvas.service'

const props = defineProps<{ projectId: string, target: { id: string, title: string, content: string } }>()
const emit = defineEmits<{ close: [], saved: [] }>()
const config = useRuntimeConfig()
const api = createCanvasService(config.public.apiBase)
const content = ref(props.target.content)
const saving = ref(false)
const error = ref('')
const input = ref<HTMLTextAreaElement>()
let previousFocus: HTMLElement | null = null

function close() { if (!saving.value) emit('close') }
async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await api.updateNode(props.projectId, 'text', props.target.id, { content: content.value })
    emit('saved')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存文本失败' }
  finally { saving.value = false }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); close() }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  if (event.key === 'Tab') {
    const dialog = input.value?.closest('.text-node-editor')
    const elements = [...dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') || []]
    const first = elements[0]
    const last = elements.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  void nextTick(() => input.value?.focus())
})
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <Teleport to="body">
    <div class="preview-backdrop" @keydown="onKeydown">
      <section class="text-node-editor" role="dialog" aria-modal="true" aria-labelledby="text-node-editor-heading">
        <header><div><Pencil :size="16" /><h2 id="text-node-editor-heading">自己编写文本</h2><span :title="target.title">{{ target.title }}</span></div><button type="button" class="icon-button" title="关闭文本编辑" :disabled="saving" @click="close"><X :size="17" /></button></header>
        <div class="text-node-editor-body"><textarea ref="input" v-model="content" :disabled="saving" rows="14" aria-label="文本内容" placeholder="在这里直接编写文本内容…" /><p v-if="error" class="text-node-editor-error" role="alert">{{ error }}</p></div>
        <footer><button type="button" class="secondary-button" :disabled="saving" @click="close">取消</button><button type="button" class="primary-button" :disabled="saving" @click="save"><LoaderCircle v-if="saving" :size="14" class="spin" />{{ saving ? '保存中' : '保存' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>
