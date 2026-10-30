<script setup lang="ts">
import { ArrowLeft, ArrowRight, Captions, Check, Download, Gauge, Library, LoaderCircle, Redo2, Save, Scissors, Sparkles, Square, Trash2, Undo2, Upload, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-vue-next'
import AppSelect from '~/components/ui/AppSelect.vue'
import EditorPreview from './EditorPreview.vue'
import EditorTimeline from './EditorTimeline.vue'
import EditorInspector from './EditorInspector.vue'
import EditorExportDialog from './EditorExportDialog.vue'
import EditorMediaLibrary from './EditorMediaLibrary.vue'
import EditorAudioImportDialog from './EditorAudioImportDialog.vue'
import EditorSubtitleDialog from './EditorSubtitleDialog.vue'
import { useVideoEditor } from '~/composables/useVideoEditor'
import type { EditorCandidate, EditorExportOptions, EditorMedia } from '~/types/editor'
import type { AIGCTimeline, TimelineSubtitle } from '~/types/timeline'
import type { CanvasJob } from '~/types/canvas'
import { frameTime, moveTimelineClip, splitTimeline, timelineAudioInsertStart, timelineDuration } from '~/lib/timeline'

const props = defineProps<{ projectId: string, episode: number }>()
const editor = useVideoEditor(props.projectId, props.episode)
const { data, timeline, loading, saving, dirty, error, undoStack, redoStack, total } = editor
const config = useRuntimeConfig(), router = useRouter()
const selected = ref(''), frame = ref(0), playing = ref(false), zoom = ref(42), libraryOpen = ref(false), audioImportOpen = ref(false)
const trimPreview = ref<AIGCTimeline | null>(null)
const subtitleOpen = ref(false)
const subtitleSources = computed(() => data.value?.candidates.filter(item => item.kind === 'video' && item.mediaId).map(item => ({ id: item.mediaId!, dialogue: item.dialogue })) || [])
const importing = ref(''), uploadKind = ref<'video'|'audio'>('video'), fileInput = ref<HTMLInputElement>()
const exportOpen = ref(false), exportSubmitting = ref(false), exportJob = ref<CanvasJob>(), downloadBusy = ref(false)
let disposed = false, animation = 0, exportTimer: ReturnType<typeof setTimeout> | undefined
const jobStorage = `aigc-editor-export:${props.projectId}:${props.episode}`
const shown = computed(()=>trimPreview.value || timeline.value)
const anyAudible = computed(()=>timeline.value.clips.some(clip=>!clip.muted))
const clipIndex = computed(()=>timeline.value.clips.findIndex(item=>item.id===selected.value))
const selectedClip = computed(()=>timeline.value.clips[clipIndex.value])
const selectedItem = computed(()=>selectedClip.value || timeline.value.audio_tracks.find(track=>track.id===selected.value))
function openSpeed(){document.querySelector<HTMLButtonElement>('.editor-inspector [aria-label="片段倍速"]')?.click()}
function openTransition(){if(selectedClip.value)document.querySelector<HTMLButtonElement>('.editor-inspector [aria-label="片尾转场"]')?.click()}
const busyExport = computed(()=>exportSubmitting.value || ['queued','running'].includes(exportJob.value?.status || ''))
const episodeOptions = computed(()=>data.value?.project.episodes.map(episode=>({value:episode.episodeNumber,label:episode.title})) || [])
function mediaUrl(url: string) { return !url || /^https?:/.test(url) ? url : new URL(url,config.public.apiBase).href }
function edit(value: AIGCTimeline) { playing.value=false; trimPreview.value=null; editor.edit(value) }
function select(id: string) { selected.value=id; playing.value=false }
function seek(value: number) { playing.value=false; frame.value=Math.max(0,Math.min(Math.max(0,timelineDuration(shown.value)-1),value)) }
watch(timeline,()=>{frame.value=Math.min(frame.value,Math.max(0,total.value-1));playing.value=false})
watch(playing,enabled=>{
  cancelAnimationFrame(animation)
  if(!enabled)return
  const start=performance.now(), origin=frame.value >= total.value-1 ? 0 : frame.value
  frame.value=origin
  const tick=(now:number)=>{const next=origin+Math.floor((now-start)*30/1000);if(next>=total.value){frame.value=Math.max(0,total.value-1);playing.value=false;return}frame.value=next;animation=requestAnimationFrame(tick)}
  animation=requestAnimationFrame(tick)
})
function addMedia(media: EditorMedia, asAudio=false) {
  if(media.kind==='video' && !asAudio){
    if(timeline.value.clips.length>=100){error.value='最多支持 100 个视频片段';return}
    const id=crypto.randomUUID();edit({...timeline.value,clips:[...timeline.value.clips,{id,shot_id:media.id,gap_before:0,source_start:0,duration:media.duration,speed:1,volume:1,muted:timeline.value.clips.length>0 && timeline.value.clips.every(clip=>clip.muted),transition:'cut',transition_duration:0,effect:''}]});selected.value=id
  }else{
    if(!media.hasAudio || timeline.value.audio_tracks.length>=32){error.value='该素材没有音轨，或音轨数量已达上限';return}
    const id=crypto.randomUUID(), start=timelineAudioInsertStart(timeline.value,selected.value,frame.value)
    edit({...timeline.value,audio_tracks:[...timeline.value.audio_tracks,{id,shot_id:'',media_id:media.id,source:'upload',start,source_start:0,duration:Math.min(media.duration,54000-start),speed:1,volume:1,muted:false,fade_in:0,fade_out:0}]});selected.value=id
  }
}
async function importCandidate(candidate: EditorCandidate, add=true) {
  importing.value=candidate.id;error.value=''
  try{const media=await editor.api.import(candidate.kind,candidate.id);if(disposed)return;if(!data.value!.media.some(item=>item.id===media.id))data.value!.media.push(media);candidate.mediaId=media.id;if(add){addMedia(media);if(candidate.kind==='audio')audioImportOpen.value=false}return media}
  catch(cause:any){error.value=cause.data?.message || cause.message || '导入素材失败'}finally{importing.value=''}
}
async function importAll() {
  if(importing.value || !data.value)return
  for(const candidate of data.value.candidates.filter(item=>item.kind==='video')){
    if(disposed)break
    const media=candidate.mediaId ? data.value.media.find(media=>media.id===candidate.mediaId) : await importCandidate(candidate,false)
    if(media && !timeline.value.clips.some(clip=>clip.shot_id===media.id))addMedia(media)
  }
}
let initialized=false
watch(loading,async value=>{if(!value && data.value && !initialized){initialized=true;if(!data.value.timeline && !dirty.value)await importAll()} })
function upload(kind:'video'|'audio'){uploadKind.value=kind;void nextTick(()=>fileInput.value?.click())}
async function fileChanged(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;if(file.size>100*1024*1024){error.value='素材不能超过 100 MB';return}importing.value='upload';try{const media=await editor.api.upload(uploadKind.value,file);if(disposed)return;data.value!.media.push(media);addMedia(media);if(media.kind==='audio')audioImportOpen.value=false}catch(cause:any){error.value=cause.data?.message || cause.message || '上传素材失败'}finally{importing.value=''}}
function remove(){if(!selected.value)return;edit({...timeline.value,clips:timeline.value.clips.filter(item=>item.id!==selected.value),audio_tracks:timeline.value.audio_tracks.filter(item=>item.id!==selected.value),subtitles:timeline.value.subtitles?.filter(item=>item.id!==selected.value)});selected.value=''}
function split(){const next=splitTimeline(timeline.value,selected.value,frame.value);if(next===timeline.value){error.value='请将播放头移到片段内部并避开转场';return}edit(next)}
function reorder(id:string,index:number){edit(moveTimelineClip(timeline.value,id,index))}
function applySubtitles(cues: TimelineSubtitle[], id: string){edit({...timeline.value,subtitles:cues});selected.value=id;seek(cues.find(cue=>cue.id===id)?.start || 0)}
function muteSelected(){const clip=timeline.value.clips.find(clip=>clip.id===selected.value);if(clip)edit({...timeline.value,clips:timeline.value.clips.map(item=>item.id===clip.id?{...item,muted:!item.muted}:item)})}
function muteOriginal(){const muted=timeline.value.clips.some(clip=>!clip.muted);edit({...timeline.value,clips:timeline.value.clips.map(clip=>({...clip,muted}))})}
async function exportVideo(options:EditorExportOptions){exportSubmitting.value=true;error.value='';try{await editor.save();exportJob.value=await editor.api.export(structuredClone(toRaw(timeline.value)),options);localStorage.setItem(jobStorage,exportJob.value.id);exportOpen.value=false;pollExport()}catch(cause:any){error.value=cause.data?.message || cause.message || '导出失败'}finally{exportSubmitting.value=false}}
function pollExport(){if(disposed || exportTimer || !exportJob.value || !['queued','running'].includes(exportJob.value.status))return;exportTimer=setTimeout(async()=>{exportTimer=undefined;try{const job=await editor.api.job(exportJob.value!.id);if(disposed)return;exportJob.value=job;if(job.status==='failed')error.value=job.error}catch{}pollExport()},1200)}
async function cancelExport(){try{if(exportJob.value)exportJob.value=await editor.api.cancel(exportJob.value.id)}catch(cause:any){error.value=cause.data?.message || cause.message || '中断导出失败'}}
async function downloadResult(){if(!exportJob.value?.result?.url || downloadBusy.value)return;downloadBusy.value=true;try{const response=await fetch(mediaUrl(exportJob.value.result.url));if(!response.ok)throw new Error('下载失败');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`${data.value?.project.title || '成片'}.${exportJob.value.input?.outputFormat || 'mp4'}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(cause:any){error.value=cause.message}finally{downloadBusy.value=false}}
function keydown(event:KeyboardEvent){if(exportOpen.value || audioImportOpen.value || subtitleOpen.value || (event.target as HTMLElement)?.closest('input,textarea,button,[contenteditable="true"]'))return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();playing.value=false;event.shiftKey?editor.redo():editor.undo()}else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove()}else if(event.key===' '){event.preventDefault();if(total.value)playing.value=!playing.value}}
function hidden(){if(document.hidden)playing.value=false}
onMounted(async()=>{document.documentElement.classList.add('aigc-editor-page');document.body.classList.add('aigc-editor-page');document.addEventListener('keydown',keydown);document.addEventListener('visibilitychange',hidden);const id=localStorage.getItem(jobStorage);if(id)try{exportJob.value=await editor.api.job(id);pollExport()}catch{}})
onBeforeUnmount(()=>{disposed=true;cancelAnimationFrame(animation);if(exportTimer)clearTimeout(exportTimer);document.removeEventListener('keydown',keydown);document.removeEventListener('visibilitychange',hidden);document.documentElement.classList.remove('aigc-editor-page');document.body.classList.remove('aigc-editor-page')})
</script>

<template>
  <main class="video-editor-workspace">
    <header class="editor-header"><NuxtLink :to="`/projects/${projectId}?episode=${episode}`" class="editor-back" title="返回画布"><ArrowLeft :size="17" />画布</NuxtLink><span class="editor-header-divider" /><div class="editor-project-title"><strong>{{ data?.project.title || '视频剪辑' }}</strong><span>视频剪辑</span></div><AppSelect :model-value="episode" :options="episodeOptions" aria-label="剪辑分集" compact @update:model-value="router.push(`/projects/${projectId}?view=edit&episode=${$event}`)" /><span class="editor-save-state"><LoaderCircle v-if="saving" :size="12" class="spin" /><Check v-else-if="!dirty" :size="12" />{{ saving?'保存中':dirty?'未保存':'已保存' }}</span><button type="button" class="secondary-button" :disabled="loading || saving || !dirty" @click="editor.save().catch(()=>{})"><Save :size="14" />保存</button><button v-if="busyExport" type="button" class="secondary-button" @click="cancelExport"><Square :size="13" />导出中 {{ exportJob?.progress || 0 }}%</button><button v-else type="button" class="primary-button" :disabled="!timeline.clips.length || loading" @click="exportOpen=true"><Download :size="14" />导出成片</button></header>
    <div v-if="error" class="editor-error" role="alert"><span>{{ error }}</span><button type="button" title="关闭提示" @click="error='' "><X :size="14" /></button></div>
    <div v-if="exportJob?.status==='succeeded'" class="editor-export-complete"><Check :size="14" /><span>成片已导出</span><button type="button" :disabled="downloadBusy" @click="downloadResult"><Download :size="13" />下载 {{ exportJob.input?.outputFormat?.toUpperCase() || 'MP4' }}</button><button type="button" title="收起导出结果" @click="exportJob=undefined"><X :size="14" /></button></div>
    <div class="editor-upper">
      <section class="editor-center"><div v-if="loading" class="editor-loading"><LoaderCircle :size="24" class="spin" />正在读取草稿</div><EditorPreview v-else :timeline="shown" :media="data?.media || []" :aspect="data?.project.aspectRatio || '16:9'" :frame="frame" :playing="playing" :media-url="mediaUrl" @seek="seek" @toggle="playing=!playing" @error="playing=false;error='素材预览失败，请检查视频是否可访问'" /></section>
      <EditorInspector :timeline="shown" :selected="selected" :media="data?.media || []" @edit="edit" />
    </div>
    <section class="editor-bottom" :class="{ 'library-open': libraryOpen }">
      <div class="editor-tools">
        <div>
          <button type="button" class="editor-tool-command editor-original-toggle" :title="anyAudible?'关闭原声':'开启原声'" :aria-pressed="!anyAudible" :disabled="!timeline.clips.length" @click="muteOriginal"><Volume2 v-if="anyAudible" :size="16" /><VolumeX v-else :size="16" /><span>{{ anyAudible?'关闭原声':'开启原声' }}</span></button>
          <button type="button" class="editor-tool-command" title="添加素材" :aria-expanded="libraryOpen" :class="{ active: libraryOpen }" @click="libraryOpen=!libraryOpen"><Library :size="16" /><span>添加素材</span></button>
          <button type="button" class="editor-tool-command" title="插入音源" :disabled="Boolean(importing) || timeline.audio_tracks.length>=32" @click="audioImportOpen=true"><LoaderCircle v-if="importing && uploadKind==='audio'" :size="16" class="spin" /><Upload v-else :size="16" /><span>插入音源</span></button>
          <button type="button" class="editor-tool-command" :title="selectedClip?.muted?'取消静音':'静音'" :disabled="!selectedClip" @click="muteSelected"><VolumeX v-if="selectedClip?.muted" :size="16" /><Volume2 v-else :size="16" /><span>{{ selectedClip?.muted?'取消静音':'静音' }}</span></button>
          <button type="button" class="editor-tool-command" title="添加转场" :disabled="!selectedClip || clipIndex>=timeline.clips.length-1" @click="openTransition"><Sparkles :size="16" /><span>转场</span></button>
          <button type="button" class="editor-tool-command" title="片段变速" :disabled="!selectedItem" @click="openSpeed"><Gauge :size="16" /><span>变速<template v-if="selectedItem && selectedItem.speed!==1"> · {{ selectedItem.speed }}x</template></span></button>
          <button type="button" class="editor-tool-command" title="添加字幕" :disabled="!total" @click="playing=false;subtitleOpen=true"><Captions :size="17" /><span>字幕</span></button>
          <span class="editor-tool-divider" />
          <button type="button" title="分割片段" :disabled="!selected" @click="split"><Scissors :size="16" /></button>
          <button type="button" title="删除片段" :disabled="!selected" @click="remove"><Trash2 :size="16" /></button>
          <button type="button" title="向前移动片段" :disabled="clipIndex<=0" @click="reorder(selected,clipIndex-1)"><ArrowLeft :size="16" /></button>
          <button type="button" title="向后移动片段" :disabled="clipIndex<0 || clipIndex>=timeline.clips.length-1" @click="reorder(selected,clipIndex+1)"><ArrowRight :size="16" /></button>
          <button type="button" title="撤销" :disabled="!undoStack.length" @click="playing=false;editor.undo()"><Undo2 :size="16" /></button>
          <button type="button" title="重做" :disabled="!redoStack.length" @click="playing=false;editor.redo()"><Redo2 :size="16" /></button>
        </div>
        <div><span class="editor-duration">{{ timeline.clips.length }} 个片段 · {{ frameTime(total) }}</span><button type="button" title="缩小时间轴" :disabled="zoom<=12" @click="zoom=Math.max(12,zoom-10)"><ZoomOut :size="15" /></button><input v-model.number="zoom" type="range" min="12" max="120" aria-label="时间轴缩放"><button type="button" title="放大时间轴" :disabled="zoom>=120" @click="zoom=Math.min(120,zoom+10)"><ZoomIn :size="15" /></button></div>
      </div>
      <EditorMediaLibrary v-if="libraryOpen" :media="data?.media || []" :candidates="data?.candidates || []" :busy="importing" :media-url="mediaUrl" @add="addMedia" @import="importCandidate" @upload="upload('video')" />
      <EditorTimeline :timeline="shown" :media="data?.media || []" :frame="frame" :selected="selected" :zoom="zoom" @select="select" @seek="seek" @edit="edit" @preview="trimPreview=$event" @reorder="reorder" />
    </section>
    <input ref="fileInput" class="sr-only" type="file" :accept="`${uploadKind}/*`" @change="fileChanged">
    <EditorAudioImportDialog v-if="audioImportOpen" :media="data?.media || []" :candidates="data?.candidates || []" :busy="importing" :media-url="mediaUrl" @close="audioImportOpen=false" @upload="upload('audio')" @add="addMedia($event);audioImportOpen=false" @import="importCandidate" />
    <EditorSubtitleDialog v-if="subtitleOpen" :timeline="timeline" :frame="frame" :sources="subtitleSources" @close="subtitleOpen=false" @apply="applySubtitles" />
    <EditorExportDialog v-if="exportOpen" :busy="busyExport" @close="exportOpen=false" @export="exportVideo" />
  </main>
</template>
