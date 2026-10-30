<script setup lang="ts">
import { ListPlus, Plus, X } from 'lucide-vue-next'
import type { AIGCTimeline, TimelineSubtitle } from '~/types/timeline'
import { timelineDuration, timelineLayout } from '~/lib/timeline'
import { dialogueSubtitles, MAX_SUBTITLE_TEXT, MAX_TIMELINE_SUBTITLES, nextSubtitleSlot } from '~/lib/timeline-subtitles'
const props = defineProps<{ timeline: AIGCTimeline, frame: number, sources: { id: string, dialogue?: string }[] }>()
const emit = defineEmits<{ close: [], apply: [cues: TimelineSubtitle[], selected: string] }>()
const total = computed(() => timelineDuration(props.timeline))
const slot = nextSubtitleSlot(props.timeline.subtitles || [], props.frame, total.value)
const text = ref(''), start = ref(slot?.start ?? props.frame), duration = ref(slot?.duration ?? 90), confirmReplace = ref(false), generationError = ref('')
const cues = computed(() => props.timeline.subtitles || [])
const error = computed(() => start.value < 0 || duration.value < 1 || start.value + duration.value > total.value ? '字幕时间不能超出成片范围' : cues.value.some(cue => start.value < cue.start + cue.duration && start.value + duration.value > cue.start) ? '字幕时间不能重叠' : '')
const hasDialogue = computed(() => props.timeline.clips.some(clip => props.sources.some(source => source.id === clip.shot_id && source.dialogue?.trim())))
function add() {
  if (!text.value.trim() || error.value || cues.value.length >= MAX_TIMELINE_SUBTITLES) return
  const cue = { id: crypto.randomUUID(), text: text.value.trim(), start: start.value, duration: duration.value }
  emit('apply', [...cues.value, cue], cue.id); emit('close')
}
function generate() {
  if (cues.value.length && !confirmReplace.value) { confirmReplace.value = true; return }
  const generated = dialogueSubtitles(timelineLayout(props.timeline), props.sources.map(source => ({ ...source, video_url: '', trim_start: 0, duration: 0, muted: false })))
  if (!generated) { generationError.value = '对白超出字幕数量或时长限制'; return }
  emit('apply', generated, generated[0]?.id || ''); emit('close')
}
function seconds(event: Event) { return Math.max(0, Math.round((Number((event.target as HTMLInputElement).value) || 0) * 30)) }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
onMounted(() => { document.addEventListener('keydown', keydown); document.querySelector<HTMLTextAreaElement>('.editor-subtitle-dialog textarea')?.focus() })
onBeforeUnmount(() => document.removeEventListener('keydown', keydown))
</script>

<template>
  <Teleport to="body"><div class="preview-backdrop"><section class="editor-export-dialog editor-subtitle-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-subtitle-title">
    <header><h2 id="editor-subtitle-title">字幕</h2><button type="button" title="关闭字幕设置" @click="emit('close')"><X :size="17" /></button></header>
    <div class="editor-export-body"><label>字幕内容<textarea v-model="text" aria-label="添加字幕内容" rows="4" :maxlength="MAX_SUBTITLE_TEXT" /></label>
      <div class="editor-subtitle-timing"><label>字幕起点（秒）<input type="number" aria-label="字幕起点" :min="0" :max="(total-1)/30" :step="1/30" :value="Number((start/30).toFixed(3))" @input="start=seconds($event)"></label><label>字幕时长（秒）<input type="number" aria-label="字幕时长" :min="1/30" :max="(total-start)/30" :step="1/30" :value="Number((duration/30).toFixed(3))" @input="duration=seconds($event)"></label></div>
      <p v-if="error || generationError" role="alert" class="editor-subtitle-error">{{ error || generationError }}</p><p v-if="cues.length>=MAX_TIMELINE_SUBTITLES" role="alert" class="editor-subtitle-error">字幕数量已达上限</p>
      <div class="editor-subtitle-generate"><p v-if="confirmReplace">将替换当前字幕轨道，视频和音轨保持不变。</p><button type="button" class="secondary-button" :disabled="!hasDialogue" @click="generate"><ListPlus :size="15" />{{ confirmReplace?'确认替换字幕':'从对白或旁白生成' }}</button></div>
    </div><footer><button type="button" class="secondary-button" @click="emit('close')">取消</button><button type="button" class="primary-button" :disabled="!text.trim() || Boolean(error) || cues.length>=MAX_TIMELINE_SUBTITLES" @click="add"><Plus :size="14" />添加字幕</button></footer>
  </section></div></Teleport>
</template>
