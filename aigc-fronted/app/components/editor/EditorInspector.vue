<script setup lang="ts">
import { SlidersHorizontal, Volume2, VolumeX } from 'lucide-vue-next'
import AppSelect from '~/components/ui/AppSelect.vue'
import type { AIGCTimeline } from '~/types/timeline'
import type { EditorMedia } from '~/types/editor'
import { TIMELINE_SPEED_PRESETS, TIMELINE_TRANSITIONS } from '~/types/timeline'
import { normalizeTimeline, setTimelineItemSpeed, timelineClipStartFloor, timelineDuration, timelineLayout, timelineOutputDuration, timelineSourceDuration, timelineSpeed } from '~/lib/timeline'
import { subtitleBounds } from '~/lib/timeline-subtitles'
const props = defineProps<{ timeline: AIGCTimeline, selected: string, media: EditorMedia[] }>()
const emit = defineEmits<{ edit: [timeline: AIGCTimeline] }>()
const clip = computed(() => props.timeline.clips.find(item => item.id === props.selected))
const track = computed(() => props.timeline.audio_tracks.find(item => item.id === props.selected))
const subtitle = computed(() => props.timeline.subtitles?.find(item => item.id === props.selected))
const item = computed(() => clip.value || track.value)
const source = computed(() => props.media.find(media => media.id === (clip.value?.shot_id || track.value?.media_id)))
const clipIndex = computed(() => props.timeline.clips.findIndex(item => item.id === props.selected))
const clipStart = computed(() => timelineLayout(props.timeline)[clipIndex.value]?.start || 0)
const startFloor = computed(() => clipIndex.value >= 0 ? timelineClipStartFloor(props.timeline, clipIndex.value) : 0)
const outputDuration = computed(() => item.value ? timelineOutputDuration(item.value) : 1)
const maxOutputDuration = computed(() => item.value && source.value ? Math.max(1, Math.min(Math.floor((source.value.duration - item.value.source_start) / timelineSpeed(item.value)), 54000 - (track.value?.start || 0))) : 1)
const labels: Record<string,string> = { cut:'无转场',fade:'交叉淡化',dissolve:'溶解',fadeblack:'淡出至黑',fadewhite:'淡出至白',wipeleft:'向左擦除',wiperight:'向右擦除',wipeup:'向上擦除',wipedown:'向下擦除',slideleft:'向左滑动',slideright:'向右滑动',slideup:'向上滑动',slidedown:'向下滑动',circleopen:'圆形展开',hblur:'模糊溶解',zoomin:'推近转场' }
const transitions = TIMELINE_TRANSITIONS.map(value => ({ value,label:labels[value] }))
const canTransition = computed(() => Boolean(clip.value && props.timeline.clips.at(-1)?.id !== clip.value.id))
function update(change: Record<string,unknown>) { emit('edit',normalizeTimeline({ ...props.timeline, clips:props.timeline.clips.map(clip => clip.id===props.selected ? {...clip,...change} : clip),audio_tracks:props.timeline.audio_tracks.map(track=>track.id===props.selected ? {...track,...change} : track) })) }
function numeric(event: Event) { return Number((event.target as HTMLInputElement).value) || 0 }
function trimStart(event: Event) { if (!item.value || !source.value) return; const start=Math.max(0,Math.min(source.value.duration-1,Math.round(numeric(event)*30))); update({source_start:start,duration:Math.min(item.value.duration,source.value.duration-start)}) }
function trimDuration(event: Event) { if (!item.value || !source.value) return; const frames=Math.max(1,Math.min(maxOutputDuration.value,Math.round(numeric(event)*30))); update({duration:Math.min(source.value.duration-item.value.source_start,timelineSourceDuration(frames,item.value))}) }
function transition(value: string|number) { update({transition:String(value),transition_duration:value==='cut'?0:Math.min(15,Math.floor((item.value?.duration || 1)/2))}) }
function caption(change: { text?:string, start?:number, duration?:number }) {
  if (!subtitle.value) return
  if (change.text !== undefined && !change.text.trim()) { emit('edit',{...props.timeline,subtitles:props.timeline.subtitles?.filter(cue=>cue.id!==subtitle.value!.id)}); return }
  const bounds=subtitleBounds(props.timeline.subtitles || [],subtitle.value.id,timelineDuration(props.timeline))
  const next={...subtitle.value,...change}; next.start=Math.max(bounds.min,Math.min(bounds.max-1,next.start)); next.duration=Math.max(1,Math.min(bounds.max-next.start,next.duration))
  emit('edit',{...props.timeline,subtitles:props.timeline.subtitles?.map(cue=>cue.id===next.id?next:cue)})
}
</script>
<template>
  <aside class="editor-inspector"><h3><SlidersHorizontal :size="15" />片段设置</h3>
    <div v-if="!item && !subtitle" class="editor-inspector-empty">未选择片段</div>
    <template v-if="item"><h4>{{ source?.name || '素材已删除' }}</h4>
      <label v-if="clip">起点 <span>秒</span><input type="number" aria-label="视频时间轴起点" :value="Number((clipStart/30).toFixed(3))" :min="startFloor/30" :max="Math.max(startFloor,timelineDuration(timeline)-outputDuration)/30" :step="1/30" @change="update({gap_before:Math.max(0,Math.round(numeric($event)*30)-startFloor)})"></label>
      <label>素材入点 <span>秒</span><input type="number" aria-label="素材入点" :value="Number((item.source_start/30).toFixed(3))" min="0" :max="((source?.duration || 1)-1)/30" :step="1/30" @change="trimStart"></label>
      <label>片段时长 <span>秒</span><input type="number" aria-label="片段时长" :value="Number((outputDuration/30).toFixed(3))" :min="1/30" :max="maxOutputDuration/30" :step="1/30" @change="trimDuration"></label>
      <label v-if="track">轨道起点 <span>秒</span><input type="number" aria-label="音频时间轴起点" :value="Number((track.start/30).toFixed(3))" min="0" :max="(54000-outputDuration)/30" :step="1/30" @change="update({start:Math.max(0,Math.min(54000-outputDuration,Math.round(numeric($event)*30)))})"></label>
      <label>倍速<AppSelect :model-value="item.speed || 1" :options="TIMELINE_SPEED_PRESETS.map(value=>({value,label:`${value}x`}))" aria-label="片段倍速" @update:model-value="emit('edit',setTimelineItemSpeed(timeline,selected,Number($event)))" compact /></label>
      <div class="editor-volume-label"><span>音量 {{ Math.round(item.volume*100) }}%</span><button type="button" :title="item.muted?'取消静音':'静音片段'" @click="update({muted:!item.muted})"><VolumeX v-if="item.muted" :size="15" /><Volume2 v-else :size="15" /></button></div><input type="range" min="0" max="100" :value="item.volume*100" aria-label="片段音量" @change="update({volume:numeric($event)/100})">
      <template v-if="track"><label>淡入 <span>秒</span><input type="number" aria-label="音频淡入" min="0" :step="1/30" :max="(outputDuration-track.fade_out)/30" :value="track.fade_in/30" @change="update({fade_in:Math.max(0,Math.min(outputDuration-track.fade_out,Math.round(numeric($event)*30)))})"></label><label>淡出 <span>秒</span><input type="number" aria-label="音频淡出" min="0" :step="1/30" :max="(outputDuration-track.fade_in)/30" :value="track.fade_out/30" @change="update({fade_out:Math.max(0,Math.min(outputDuration-track.fade_in,Math.round(numeric($event)*30)))})"></label></template>
      <template v-if="clip"><label>片尾转场<AppSelect :model-value="clip.transition" :options="transitions" :disabled="!canTransition" aria-label="片尾转场" @update:model-value="transition" compact /></label><label v-if="clip.transition!=='cut'">转场重叠 <span>秒</span><input type="number" min="0.04" max="1.6" step="0.1" :value="clip.transition_duration/30" @change="update({transition_duration:Math.max(1,Math.min(48,Math.round(numeric($event)*30)))})"></label></template>
    </template>
    <template v-if="subtitle"><label>字幕内容<textarea :value="subtitle.text" rows="5" maxlength="200" @change="caption({text:($event.target as HTMLTextAreaElement).value})" /></label><label>开始时间 <span>秒</span><input type="number" min="0" step="0.1" :value="subtitle.start/30" @change="caption({start:Math.round(numeric($event)*30)})"></label><label>显示时长 <span>秒</span><input type="number" min="0.04" step="0.1" :value="subtitle.duration/30" @change="caption({duration:Math.round(numeric($event)*30)})"></label></template>
  </aside>
</template>
