<script setup lang="ts">
import { Film, LoaderCircle, Music2, Plus, Upload } from 'lucide-vue-next'
import type { EditorCandidate, EditorMedia } from '~/types/editor'
defineProps<{ media: EditorMedia[], candidates: EditorCandidate[], busy: string, mediaUrl: (url: string) => string }>()
const emit = defineEmits<{ add: [media: EditorMedia, asAudio?: boolean], import: [candidate: EditorCandidate], upload: [] }>()
</script>

<template>
  <section class="editor-media-library" aria-label="视频素材">
    <button class="editor-library-upload" type="button" :disabled="Boolean(busy)" @click="emit('upload')"><LoaderCircle v-if="busy === 'upload'" :size="19" class="spin" /><Upload v-else :size="19" /><span>上传视频</span></button>
    <article v-for="item in media.filter(item => item.kind === 'video')" :key="item.id" class="editor-library-item">
      <div class="editor-library-thumb"><video :src="mediaUrl(item.url)" muted playsinline preload="metadata" /><span>{{ (item.duration / 30).toFixed(1) }}s</span></div>
      <div class="editor-library-item-title"><span :title="item.name">{{ item.name }}</span><button type="button" title="添加视频片段" @click="emit('add', item)"><Plus :size="15" /></button><button v-if="item.hasAudio" type="button" title="提取视频音轨" @click="emit('add', item, true)"><Music2 :size="14" /></button></div>
    </article>
    <article v-for="candidate in candidates.filter(item => item.kind === 'video' && !item.mediaId)" :key="candidate.id" class="editor-library-item">
      <div class="editor-library-thumb"><video :src="mediaUrl(candidate.url)" muted playsinline preload="metadata" /></div>
      <div class="editor-library-item-title"><span :title="candidate.name">{{ candidate.name }}</span><button type="button" title="导入并添加视频" :disabled="Boolean(busy)" @click="emit('import', candidate)"><LoaderCircle v-if="busy === candidate.id" :size="15" class="spin" /><Plus v-else :size="15" /></button></div>
    </article>
    <div v-if="!media.some(item => item.kind === 'video') && !candidates.some(item => item.kind === 'video')" class="editor-library-empty"><Film :size="22" /><span>暂无可用视频</span></div>
  </section>
</template>
