<script setup lang="ts">
import { LoaderCircle, Music2, Plus, Upload, X } from 'lucide-vue-next'
import type { EditorCandidate, EditorMedia } from '~/types/editor'
defineProps<{ media: EditorMedia[], candidates: EditorCandidate[], busy: string, mediaUrl: (url: string) => string }>()
const emit = defineEmits<{ close: [], upload: [], add: [media: EditorMedia], import: [candidate: EditorCandidate] }>()
let previousFocus: HTMLElement | null = null
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
onMounted(() => { previousFocus = document.activeElement as HTMLElement; document.addEventListener('keydown', keydown); document.querySelector<HTMLButtonElement>('.editor-audio-dialog header button')?.focus() })
onBeforeUnmount(() => { document.removeEventListener('keydown', keydown); previousFocus?.focus() })
</script>

<template>
  <Teleport to="body"><div class="preview-backdrop" @click.self="emit('close')">
    <section class="editor-audio-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-audio-title" @keydown.esc.stop="emit('close')">
      <header><h2 id="editor-audio-title">插入音源</h2><button type="button" title="关闭音源选择" @click="emit('close')"><X :size="17" /></button></header>
      <div class="editor-audio-dialog-body">
        <button type="button" class="editor-audio-upload" :disabled="Boolean(busy)" @click="emit('upload')"><LoaderCircle v-if="busy === 'upload'" :size="18" class="spin" /><Upload v-else :size="18" /><span>{{ busy === 'upload' ? '正在上传音源' : '上传音源' }}</span></button>
        <div v-for="item in media.filter(item => item.kind === 'audio')" :key="item.id" class="editor-audio-choice"><Music2 :size="18" /><div><span :title="item.name">{{ item.name }}</span><audio :src="mediaUrl(item.url)" controls preload="metadata" /></div><button type="button" title="插入该音源" :disabled="Boolean(busy)" @click="emit('add', item)"><Plus :size="17" /></button></div>
        <div v-for="item in candidates.filter(item => item.kind === 'audio' && !item.mediaId)" :key="item.id" class="editor-audio-choice"><Music2 :size="18" /><div><span :title="item.name">{{ item.name }}</span><audio :src="mediaUrl(item.url)" controls preload="metadata" /></div><button type="button" title="导入并插入音源" :disabled="Boolean(busy)" @click="emit('import', item)"><LoaderCircle v-if="busy === item.id" :size="17" class="spin" /><Plus v-else :size="17" /></button></div>
      </div>
      <footer><button type="button" class="secondary-button" @click="emit('close')">取消</button></footer>
    </section>
  </div></Teleport>
</template>
