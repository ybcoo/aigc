<script setup lang="ts">
const props = defineProps<{ target: { title: string, url: string, kind: string, content?: string } }>()
const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement>()
const previewRoot = ref<HTMLElement>()
const failed = ref(false)
let previousFocus: HTMLElement | null = null

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    emit('close')
  }
  if (event.key === 'Tab') {
    const elements = [...previewRoot.value?.querySelectorAll<HTMLElement>('a[href], button, video[controls], audio[controls], [tabindex="0"]') || []]
    const first = elements[0]
    const last = elements.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}

watch(() => props.target.url, () => { failed.value = false })
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', onKeydown, true)
  void nextTick(() => closeButton.value?.focus())
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <div ref="previewRoot" class="canvas-media-preview" role="dialog" aria-modal="true" :aria-label="target.title || '预览'" @click.self="emit('close')" @pointerdown.stop @wheel.stop>
      <div v-if="target.title" class="canvas-media-preview-title" :title="target.title">{{ target.title }}</div>
      <div v-if="failed" class="canvas-media-preview-error" role="alert">素材加载失败</div>
      <video v-else-if="target.url && target.kind === 'video'" class="canvas-media-preview-video" :src="target.url" controls autoplay playsinline @error="failed = true" />
      <audio v-else-if="target.url && target.kind === 'audio'" class="canvas-media-preview-audio" :src="target.url" controls autoplay @error="failed = true" />
      <img v-else-if="target.url" class="canvas-media-preview-image" :src="target.url" :alt="target.title || '预览'" draggable="false" @error="failed = true">
      <pre v-else-if="target.content" class="canvas-media-preview-text" tabindex="0">{{ target.content }}</pre>
      <div v-else class="canvas-media-preview-error">该节点还没有可预览的内容</div>
      <div class="canvas-media-preview-actions">
        <a v-if="target.url" :href="target.url" target="_blank" rel="noopener noreferrer">在新标签页打开</a>
        <button ref="closeButton" type="button" aria-label="关闭预览" @click="emit('close')">关闭</button>
      </div>
    </div>
  </Teleport>
</template>
