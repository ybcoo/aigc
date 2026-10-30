<script setup lang="ts">
import { Captions, Film, GripVertical, Music2, VolumeX } from 'lucide-vue-next'
import type { AIGCTimeline } from '~/types/timeline'
import type { EditorMedia } from '~/types/editor'
import { dragTimelineNode, dragTimelineNodeSnapped, frameTime, mediaSourceKey, nearestSnapTarget, shotSourceKey, timelineDraggedEdgeFrame, timelineDuration, timelineLayout, timelineOutputDuration, timelineSnapTargets, timelineSpeed, type TimelineTrimEdge } from '~/lib/timeline'

const props = defineProps<{ timeline: AIGCTimeline, media: EditorMedia[], frame: number, selected: string, zoom: number }>()
const emit = defineEmits<{ select: [id: string], seek: [frame: number], edit: [value: AIGCTimeline], preview: [value: AIGCTimeline | null], reorder: [id: string, index: number] }>()
interface DragState {
  id: string
  edge: TimelineTrimEdge
  base: AIGCTimeline
  preview: AIGCTimeline
  clientX: number
  clientY: number
  moved: boolean
}
const ruler = ref<HTMLElement>()
const draggedClip = ref('')
const drag = ref<DragState | null>(null)
const guide = ref<number | null>(null)
const total = computed(() => timelineDuration(props.timeline))
const width = computed(() => Math.max(600, total.value / 30 * props.zoom + 40))
const layout = computed(() => timelineLayout(props.timeline))
const ticks = computed(() => { const step = Math.max(1, Math.ceil(80 / props.zoom)); return Array.from({ length: Math.ceil(width.value / props.zoom / step) }, (_, index) => index * step) })
const source = (id: string) => props.media.find(item => item.id === id)
const px = (frame: number) => frame / 30 * props.zoom
const sourceFrames = computed(() => Object.fromEntries(props.media.flatMap(media => [[shotSourceKey(media.id, 'video'), media.duration], [mediaSourceKey(media.id), media.duration]])))
const headShift = computed(() => {
  const current = drag.value
  if (!current || current.edge !== 'head') return 0
  const before = current.base.clips.find(clip => clip.id === current.id)
  const after = current.preview.clips.find(clip => clip.id === current.id)
  return before && after ? Math.max(0, Math.round((after.source_start - before.source_start) / timelineSpeed(before))) : 0
})
const freeGap = computed(() => {
  if (!headShift.value || !drag.value) return null
  const row = timelineLayout(drag.value.base).find(row => row.clip.id === drag.value!.id)
  return row ? { left: px(row.start), width: px(headShift.value) } : null
})
// Keep the head under the pointer while trimming; the magnetic video track closes on release.
const rows = computed(() => (freeGap.value && drag.value ? timelineLayout(drag.value.base) : layout.value).map(row => {
  const shift = drag.value?.id === row.clip.id ? headShift.value : 0
  return { ...row, left: px(row.start + shift), right: px(row.end), width: Math.max(2, px(row.end - row.start - shift)) }
}))
const selectedVideo = computed(() => rows.value.find(row => row.clip.id === props.selected))
const selectedAudio = computed(() => props.timeline.audio_tracks.find(track => track.id === props.selected))
const selectedSubtitle = computed(() => props.timeline.subtitles?.find(cue => cue.id === props.selected))
const bubbleText = computed(() => {
  const current = drag.value
  if (!current) return ''
  if (current.edge === 'body') return frameTime(timelineDraggedEdgeFrame(current.preview, current.id, 'body') || 0)
  const row = timelineLayout(current.preview).find(row => row.clip.id === current.id)
  const track = current.preview.audio_tracks.find(track => track.id === current.id)
  const cue = current.preview.subtitles?.find(cue => cue.id === current.id)
  return frameTime(row ? row.end - row.start : track ? timelineOutputDuration(track) : cue?.duration || 0)
})
let cleanup: (() => void) | undefined

function followFrame(value: AIGCTimeline, id: string, edge: TimelineTrimEdge) {
  const row = timelineLayout(value).find(row => row.clip.id === id)
  const track = value.audio_tracks.find(track => track.id === id) || value.subtitles?.find(cue => cue.id === id)
  const frame = row ? edge === 'tail' ? row.end - 1 : row.start : track ? track.start + (edge === 'tail' ? ('text' in track ? track.duration : timelineOutputDuration(track)) - 1 : 0) : 0
  return Math.max(0, Math.min(Math.max(0, timelineDuration(value) - 1), frame))
}
function edgeFrame(id: string, edge: TimelineTrimEdge) {
  const row = layout.value.find(row => row.clip.id === id)
  return row ? edge === 'head' ? row.start : row.end : timelineDraggedEdgeFrame(props.timeline, id, edge) || 0
}
function trim(event: PointerEvent, id: string, edge: TimelineTrimEdge) {
  if (event.button !== 0) return
  event.preventDefault(); event.stopPropagation(); cleanup?.(); emit('select', id)
  const base = structuredClone(toRaw(props.timeline)), startX = event.clientX, zoom = props.zoom
  const pointerId = event.pointerId, element = event.currentTarget as HTMLElement
  const frames = sourceFrames.value
  const video = base.clips.some(clip => clip.id === id)
  const targets = timelineSnapTargets(base, props.frame, id, video)
  let next = base, raf = 0, lastSeek = 0, pending: PointerEvent | null = null, moved = false
  drag.value = { id, edge, base, preview: base, clientX: event.clientX, clientY: event.clientY, moved: false }
  const apply = (point: PointerEvent) => {
    const delta = (point.clientX - startX) / zoom * 30
    const baseRow = video && edge === 'head' ? timelineLayout(base).find(row => row.clip.id === id) : undefined
    const snap = baseRow ? nearestSnapTarget(baseRow.start + delta, targets, zoom) : null
    const result = baseRow
      ? { timeline: dragTimelineNode(base, id, edge, snap === null ? delta : snap - baseRow.start, frames), snapped: snap }
      : dragTimelineNodeSnapped(base, id, edge, delta, frames, { targets, zoom })
    next = result.timeline
    moved ||= Math.abs(point.clientX - startX) > 3
    drag.value = { id, edge, base, preview: next, clientX: point.clientX, clientY: point.clientY, moved }
    guide.value = result.snapped
    emit('preview', next)
    if (performance.now() - lastSeek >= 80) { lastSeek = performance.now(); emit('seek', followFrame(next, id, edge)) }
  }
  const move = (point: PointerEvent) => {
    if (point.pointerId !== pointerId) return
    pending = point
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const point = pending; pending = null; if (point) apply(point) })
  }
  const finish = (point: PointerEvent) => {
    if (point.pointerId !== pointerId) return
    cancelAnimationFrame(raf)
    // Flush the release position even when the last pointermove is still waiting for a frame.
    if (pending || moved || point.clientX !== startX) apply(point)
    const changed = JSON.stringify(next) !== JSON.stringify(base)
    cleanup?.()
    if (changed) emit('edit', next)
    emit('seek', followFrame(next, id, edge))
  }
  const cancel = (point: PointerEvent) => { if (point.pointerId === pointerId) cleanup?.() }
  const blur = () => cleanup?.()
  cleanup = () => {
    cancelAnimationFrame(raf); pending = null
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', cancel)
    element.removeEventListener('lostpointercapture', cancel); window.removeEventListener('blur', blur)
    cleanup = undefined; drag.value = null; guide.value = null; emit('preview', null)
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
  }
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', cancel)
  element.addEventListener('lostpointercapture', cancel); window.addEventListener('blur', blur)
  element.setPointerCapture?.(pointerId)
}
function trimKey(event: KeyboardEvent, id: string, edge: TimelineTrimEdge) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  const next = dragTimelineNode(props.timeline, id, edge, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 30 : 1), sourceFrames.value)
  if (next !== props.timeline) { emit('edit', next); emit('seek', followFrame(next, id, edge)) }
}
function seek(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault(); cleanup?.()
  const pointerId = event.pointerId
  const move = (point: PointerEvent) => {
    if (point.pointerId !== pointerId) return
    const left = ruler.value?.getBoundingClientRect().left || 0
    emit('seek', Math.max(0, Math.min(Math.max(0, total.value - 1), Math.round((point.clientX - left) / props.zoom * 30))))
  }
  move(event)
  const up = (point: PointerEvent) => { if (point.pointerId === pointerId) cleanup?.() }
  cleanup = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); cleanup = undefined }
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up)
}
function selectVideo(id: string, start: number) { emit('select', id); emit('seek', start) }
function drop(event: DragEvent, index: number) { event.preventDefault(); if (draggedClip.value) emit('reorder', draggedClip.value, index); draggedClip.value = '' }
function reorder(event: DragEvent, id: string) {
  draggedClip.value = id
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }
}
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div class="editor-timeline-scroll"><div class="editor-timeline-board" :style="{ width: `${width + 112}px` }">
    <div class="editor-ruler-row"><div class="editor-lane-name editor-ruler-label">30 FPS</div><div ref="ruler" class="editor-ruler" :style="{ width: `${width}px` }" @pointerdown="seek"><span v-for="second in ticks" :key="second" :style="{ left: `${second * zoom}px` }">{{ frameTime(second * 30).slice(0, 5) }}</span></div></div>
    <div class="editor-lane video-lane"><div class="editor-lane-name"><Film :size="14" />视频轨道</div><div class="editor-lane-content" :style="{ width: `${width}px` }">
      <div v-for="row in rows.filter(row => row.clip.gap_before > 0)" :key="`gap-${row.clip.id}`" class="editor-trim-gap" :style="{ left: `${px(row.start - row.clip.gap_before)}px`, width: `${px(row.clip.gap_before)}px` }" />
      <div v-if="freeGap" class="editor-trim-gap" :style="{ left: `${freeGap.left}px`, width: `${freeGap.width}px` }" />
      <div v-for="(row, index) in rows" :key="row.clip.id" class="editor-track-clip" :class="{ selected: selected === row.clip.id }" role="button" tabindex="0" :aria-label="source(row.clip.shot_id)?.name" :aria-pressed="selected === row.clip.id" :style="{ left: `${row.left}px`, width: `${row.width}px`, zIndex: selected === row.clip.id ? 3 : 1 }" :draggable="!drag" @dragstart="reorder($event, row.clip.id)" @dragover.prevent @drop="drop($event, index)" @dragend="draggedClip = ''" @click.stop="selectVideo(row.clip.id, row.start)" @keydown.enter="selectVideo(row.clip.id, row.start)">
        <GripVertical :size="12" /><div><strong>{{ source(row.clip.shot_id)?.name || '素材已删除' }}</strong><span>{{ ((row.end - row.start) / 30).toFixed(1) }}s<template v-if="row.clip.speed !== 1"> · {{ row.clip.speed }}x</template></span></div>
        <span v-if="row.clip.transition_duration" class="editor-transition-badge" :style="{ width: `${px(row.clip.transition_duration)}px` }" title="转场重叠" />
        <span v-if="row.clip.muted" class="editor-clip-mute-badge" title="静音" aria-label="静音"><VolumeX :size="11" /></span>
      </div>
      <template v-if="selectedVideo">
        <button v-for="edge in (['head', 'tail'] as const)" :key="edge" type="button" role="slider" class="editor-trim-handle" :class="edge" :style="{ left: `${edge === 'head' ? selectedVideo.left : selectedVideo.right}px` }" :title="edge === 'head' ? '裁切片段首端' : '裁切片段末端'" :aria-label="edge === 'head' ? '裁切片段首端' : '裁切片段末端'" :aria-valuemin="0" :aria-valuemax="Math.max(1, total)" :aria-valuenow="edgeFrame(selectedVideo.clip.id, edge)" :aria-valuetext="frameTime(edgeFrame(selectedVideo.clip.id, edge))" @pointerdown="trim($event, selectedVideo.clip.id, edge)" @keydown="trimKey($event, selectedVideo.clip.id, edge)" @click.stop><span /></button>
      </template>
    </div></div>
    <div class="editor-lane audio-lane"><div class="editor-lane-name"><Music2 :size="14" />音轨</div><div class="editor-lane-content" :style="{ width: `${width}px` }">
      <div v-for="track in timeline.audio_tracks" :key="track.id" class="editor-track-audio" :class="{ selected: selected === track.id, muted: track.muted }" role="button" tabindex="0" :aria-pressed="selected === track.id" :style="{ left: `${px(track.start)}px`, width: `${Math.max(2, px(timelineOutputDuration(track)))}px`, zIndex: selected === track.id ? 3 : 1 }" @pointerdown="trim($event, track.id, 'body')" @keydown.enter="selectVideo(track.id, track.start)"><Music2 :size="12" /><span>{{ source(track.media_id || '')?.name || '音源' }}</span><small v-if="track.speed !== 1">{{ track.speed }}x</small></div>
      <template v-if="selectedAudio">
        <button v-for="edge in (['head', 'tail'] as const)" :key="edge" type="button" role="slider" class="editor-trim-handle" :class="edge" :style="{ left: `${px(selectedAudio.start + (edge === 'tail' ? timelineOutputDuration(selectedAudio) : 0))}px` }" :title="edge === 'head' ? '裁切音轨首端' : '裁切音轨末端'" :aria-label="edge === 'head' ? '裁切音轨首端' : '裁切音轨末端'" :aria-valuemin="0" :aria-valuemax="Math.max(1, total)" :aria-valuenow="edgeFrame(selectedAudio.id, edge)" :aria-valuetext="frameTime(edgeFrame(selectedAudio.id, edge))" @pointerdown="trim($event, selectedAudio.id, edge)" @keydown="trimKey($event, selectedAudio.id, edge)" @click.stop><span /></button>
      </template>
    </div></div>
    <div class="editor-lane subtitle-lane"><div class="editor-lane-name"><Captions :size="14" />字幕轨道</div><div class="editor-lane-content" :style="{ width: `${width}px` }">
      <div v-for="cue in timeline.subtitles || []" :key="cue.id" class="editor-track-subtitle" :class="{ selected: selected === cue.id }" role="button" tabindex="0" :aria-pressed="selected === cue.id" :style="{ left: `${px(cue.start)}px`, width: `${Math.max(2, px(cue.duration))}px` }" @pointerdown="trim($event, cue.id, 'body')" @keydown.enter="selectVideo(cue.id, cue.start)"><span>{{ cue.text }}</span></div>
      <template v-if="selectedSubtitle">
        <button v-for="edge in (['head', 'tail'] as const)" :key="edge" type="button" role="slider" class="editor-trim-handle" :class="edge" :style="{ left: `${px(selectedSubtitle.start + (edge === 'tail' ? selectedSubtitle.duration : 0))}px` }" :title="edge === 'head' ? '裁切字幕首端' : '裁切字幕末端'" :aria-label="edge === 'head' ? '裁切字幕首端' : '裁切字幕末端'" :aria-valuemin="0" :aria-valuemax="Math.max(1, total)" :aria-valuenow="edgeFrame(selectedSubtitle.id, edge)" :aria-valuetext="frameTime(edgeFrame(selectedSubtitle.id, edge))" @pointerdown="trim($event, selectedSubtitle.id, edge)" @keydown="trimKey($event, selectedSubtitle.id, edge)" @click.stop><span /></button>
      </template>
    </div></div>
    <div v-if="guide !== null" class="editor-snap-guide" :style="{ left: `${112 + px(guide)}px` }" />
    <div class="editor-playhead" :style="{ left: `${112 + px(frame)}px` }"><span /></div>
  </div></div>
  <Teleport to="body"><div v-if="drag?.moved" class="editor-trim-bubble" :style="{ left: `${drag.clientX}px`, top: `${drag.clientY - 10}px` }">{{ bubbleText }}</div></Teleport>
</template>
