<script setup lang="ts">
import { Download, X } from 'lucide-vue-next'
import AppSelect from '~/components/ui/AppSelect.vue'
import type { EditorExportOptions } from '~/types/editor'
const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ close: [], export: [options: EditorExportOptions] }>()
const options = reactive<EditorExportOptions>({outputFormat:'mp4',resolution:'720p',burnSubtitles:false,watermark:''})
function close(event: KeyboardEvent) { if(event.key==='Escape')emit('close') }
onMounted(()=>document.addEventListener('keydown',close)); onBeforeUnmount(()=>document.removeEventListener('keydown',close))
</script>
<template><Teleport to="body"><div class="preview-backdrop" @click.self="emit('close')"><section class="editor-export-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-export-heading"><header><h2 id="editor-export-heading">导出成片</h2><button type="button" title="关闭导出设置" @click="emit('close')"><X :size="17" /></button></header><div class="editor-export-body"><label>输出格式<AppSelect v-model="options.outputFormat" :options="[{value:'mp4',label:'MP4 视频'},{value:'mp3',label:'MP3 音频'}]" aria-label="输出格式" /></label><template v-if="options.outputFormat==='mp4'"><label>分辨率<AppSelect v-model="options.resolution" :options="['480p','720p','1080p'].map(value=>({value,label:value}))" aria-label="导出分辨率" /></label><label class="editor-check"><input v-model="options.burnSubtitles" type="checkbox">将字幕合成到画面</label><label>水印文字<input v-model="options.watermark" type="text" maxlength="80" placeholder="不添加水印" /></label></template></div><footer><button type="button" class="secondary-button" @click="emit('close')">取消</button><button type="button" class="primary-button" :disabled="busy" @click="emit('export',{...options})"><Download :size="14" />开始导出</button></footer></section></div></Teleport></template>
