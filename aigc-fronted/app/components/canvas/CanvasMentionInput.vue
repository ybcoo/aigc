<script setup lang="ts">
import type { CanvasReference } from '~/types/canvas'

const props = defineProps<{ modelValue: string, references: CanvasReference[], disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], preview: [reference: CanvasReference], submit: [] }>()
const textarea = ref<HTMLTextAreaElement>()
const highlight = ref<HTMLElement>()
const scrollContent = ref<HTMLElement>()
const cursor = ref(0)
const menuOpen = ref(false)
let observer: ResizeObserver | undefined
const parts = computed(() => {
  const result: Array<{ text: string, reference?: CanvasReference }> = []
  let offset = 0
  for (const match of props.modelValue.matchAll(/@(图片|视频|音色)\d+/g)) {
    if (match.index > offset) result.push({ text: props.modelValue.slice(offset, match.index) })
    result.push({ text: match[0], reference: props.references.find(reference => reference.token === match[0]) })
    offset = match.index + match[0].length
  }
  if (offset < props.modelValue.length) result.push({ text: props.modelValue.slice(offset) })
  return result
})

function syncScroll() {
  if (!textarea.value || !highlight.value || !scrollContent.value) return
  highlight.value.style.width = `${textarea.value.clientWidth}px`
  highlight.value.style.height = `${textarea.value.clientHeight}px`
  scrollContent.value.style.transform = `translate(${-textarea.value.scrollLeft}px, ${-textarea.value.scrollTop}px)`
}
function updateCursor() {
  cursor.value = textarea.value?.selectionStart || 0
  menuOpen.value = Boolean(props.references.length && props.modelValue[cursor.value - 1] === '@')
}
function onInput(event: Event) {
  const input = event.target as HTMLTextAreaElement
  emit('update:modelValue', input.value)
  cursor.value = input.selectionStart
  menuOpen.value = Boolean(props.references.length && input.value[cursor.value - 1] === '@')
  void nextTick(syncScroll)
}
function insert(token: string) {
  if (props.disabled) return
  const start = textarea.value?.selectionStart ?? props.modelValue.length
  const end = textarea.value?.selectionEnd ?? start
  const from = menuOpen.value && props.modelValue[start - 1] === '@' ? start - 1 : start
  const insertion = `${token} `
  emit('update:modelValue', props.modelValue.slice(0, from) + insertion + props.modelValue.slice(end))
  menuOpen.value = false
  void nextTick(() => {
    textarea.value?.focus()
    textarea.value?.setSelectionRange(from + insertion.length, from + insertion.length)
    syncScroll()
  })
}
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') menuOpen.value = false
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (menuOpen.value && props.references[0]) insert(props.references[0].token)
    else emit('submit')
  }
}
watch(() => props.modelValue, () => { void nextTick(syncScroll) })
onMounted(() => {
  observer = new ResizeObserver(syncScroll)
  if (textarea.value) observer.observe(textarea.value)
  syncScroll()
})
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ insert })
</script>

<template>
  <div class="mention-input">
    <div v-if="menuOpen" class="mention-menu" role="listbox" aria-label="参考素材">
      <button v-for="reference in references" :key="reference.id" type="button" role="option" @mousedown.prevent @click="insert(reference.token)"><span>{{ reference.token }}</span>{{ reference.name }}</button>
    </div>
    <div class="mention-editor">
      <div ref="highlight" class="mention-highlight" aria-hidden="true"><div ref="scrollContent" class="mention-text"><span v-for="(part, index) in parts" :key="index" :class="{ 'mention-token': part.reference }" :title="part.reference?.name" @mousedown="part.reference && $event.preventDefault()" @click="part.reference && emit('preview', part.reference)">{{ part.text }}</span><span>&#8203;</span></div></div>
      <textarea ref="textarea" :value="modelValue" :disabled="disabled" class="mention-text mention-textarea" rows="4" placeholder="描述需要生成的内容" spellcheck="false" @input="onInput" @scroll="syncScroll" @click="updateCursor" @keyup="updateCursor" @keydown="onKeydown" />
    </div>
  </div>
</template>
