<script setup lang="ts">
import { Film, Pause, Play, SkipBack } from 'lucide-vue-next'
import type { AIGCTimeline } from '~/types/timeline'
import type { EditorMedia } from '~/types/editor'
import { frameTime, timelineLayout, timelineDuration, timelineOutputDuration } from '~/lib/timeline'
import EditorSyncedMedia from './EditorSyncedMedia.vue'
const props = defineProps<{ timeline: AIGCTimeline, media: EditorMedia[], aspect: string, frame: number, playing: boolean, mediaUrl: (url: string) => string }>()
const emit = defineEmits<{ seek: [frame: number], toggle: [], error: [] }>()
const total = computed(() => timelineDuration(props.timeline))
const visible = computed(() => timelineLayout(props.timeline).filter(row => props.frame >= row.start && props.frame < row.end))
const overlap = computed(() => visible.value.length === 2 ? visible.value[0].clip : undefined)
const blend = computed(() => overlap.value ? (props.frame - visible.value[1].start) / overlap.value.transition_duration : 0)
const ratio = computed(() => { const [w, h] = props.aspect.split(':').map(Number); return w > 0 && h > 0 ? w / h : 16 / 9 })
const source = (id: string) => props.media.find(item => item.id === id)
const audio = computed(() => props.timeline.audio_tracks.filter(track => props.frame >= track.start && props.frame < track.start + timelineOutputDuration(track)))
const subtitle = computed(() => props.timeline.subtitles?.find(cue => props.frame >= cue.start && props.frame < cue.start + cue.duration))
function style(index: number) {
  const t = overlap.value?.transition, b = Math.max(0, Math.min(1, blend.value)), incoming = index === 1
  if (!t) return {}
  if (t === 'fadeblack' || t === 'fadewhite') return { opacity: incoming ? Math.max(0, (b - .5) * 2) : Math.max(0, 1 - b * 2) }
  if (['fade', 'dissolve'].includes(t)) return { opacity: incoming ? b : 1 }
  if (t.startsWith('wipe') && incoming) return { clipPath: t === 'wipeleft' ? `inset(0 0 0 ${(1-b)*100}%)` : t === 'wiperight' ? `inset(0 ${(1-b)*100}% 0 0)` : t === 'wipeup' ? `inset(${(1-b)*100}% 0 0)` : `inset(0 0 ${(1-b)*100}% 0)` }
  if (t.startsWith('slide')) { const sign = ['slideleft', 'slideup'].includes(t) ? -1 : 1; return { transform: `translate${['slideup','slidedown'].includes(t) ? 'Y' : 'X'}(${(incoming ? (b-1) : b)*100*sign}%)` } }
  if (t === 'circleopen' && incoming) return { clipPath: `circle(${b*72}% at 50% 50%)` }
  if (t === 'hblur') return { opacity: incoming ? b : 1-b, filter: `blur(${(incoming ? 1-b : b)*18}px)` }
  if (t === 'zoomin') return { opacity: incoming ? b : 1-b, transform: `scale(${incoming ? 1.2-b*.2 : 1+b*.16})` }
  return {}
}
function trackVolume(track: AIGCTimeline['audio_tracks'][number]) {
  if (track.muted) return 0
  const offset = props.frame - track.start, duration = timelineOutputDuration(track)
  return track.volume * (track.fade_in ? Math.min(1, offset / track.fade_in) : 1) * (track.fade_out ? Math.min(1, (duration-offset)/track.fade_out) : 1)
}
</script>
<template>
  <div class="editor-preview"><div class="editor-preview-inner" :style="{ width: `min(100%, calc(46vh * ${ratio}))` }">
    <div class="editor-preview-stage" :style="{ aspectRatio: ratio, backgroundColor: overlap?.transition === 'fadewhite' ? '#fff' : '#121518' }">
      <Film v-if="!timeline.clips.length" :size="38" class="editor-preview-empty" />
      <div v-for="(row, index) in visible" :key="row.clip.id" class="editor-preview-layer" :style="style(index)"><EditorSyncedMedia v-if="source(row.clip.shot_id)" :src="mediaUrl(source(row.clip.shot_id)!.url)" :time="(row.clip.source_start + (frame-row.start)*(row.clip.speed || 1))/30" :playing="playing" :speed="row.clip.speed || 1" :volume="row.clip.muted ? 0 : row.clip.volume * (overlap ? index === 0 ? 1-blend : blend : 1)" @error="emit('error')" /></div>
      <p v-if="subtitle" class="editor-preview-subtitle">{{ subtitle.text }}</p>
    </div>
    <EditorSyncedMedia v-for="track in audio" :key="track.id" audio :src="mediaUrl(source(track.media_id || '')?.url || '')" :time="(track.source_start+(frame-track.start)*(track.speed || 1))/30" :playing="playing" :volume="trackVolume(track)" :speed="track.speed || 1" @error="emit('error')" />
    <input class="editor-preview-seek" type="range" min="0" :max="Math.max(0,total-1)" :value="frame" aria-label="预览进度" :disabled="!total" @input="emit('seek', Number(($event.target as HTMLInputElement).value))">
    <div class="editor-preview-controls"><span>{{ frameTime(frame) }} <em>/ {{ frameTime(total) }}</em></span><div><button type="button" title="回到开始" :disabled="!total" @click="emit('seek',0)"><SkipBack :size="15" /></button><button type="button" :title="playing ? '暂停' : '播放'" :disabled="!total" @click="emit('toggle')"><Pause v-if="playing" :size="17" /><Play v-else :size="17" /></button></div><span>30 fps</span></div>
  </div></div>
</template>
