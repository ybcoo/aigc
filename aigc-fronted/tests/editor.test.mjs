import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import { Window } from 'happy-dom'
const root=resolve(import.meta.dirname,'..'),window=new Window({url:'http://localhost:3000/projects/editor?view=edit'})
for(const key of ['window','document','navigator','HTMLElement','Element','SVGElement','Node','MouseEvent','TouchEvent','localStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]})
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window)
window.HTMLElement.prototype.getBoundingClientRect=function(){return new window.DOMRect(0,0,1000,600)}
const storage='aigc-editor-draft:project:1'
let app,vue,Workspace,Timeline,tempDir,requests=[],jobId=0
const jobs=new Map()
const data={project:{id:'project',title:'Editor test',aspectRatio:'16:9',episodes:[{episodeNumber:1,title:'第 1 集'},{episodeNumber:2,title:'第 2 集'}]},timeline:null,revision:0,media:[{id:'red',name:'First video',kind:'video',url:'/uploads/aigc/red.mp4',duration:90,width:320,height:180,hasAudio:true},{id:'blue',name:'Second video',kind:'video',url:'/uploads/aigc/blue.mp4',duration:60,width:320,height:180,hasAudio:false}],candidates:[{id:'node-red',kind:'video',name:'First video',mediaId:'red'},{id:'node-blue',kind:'video',name:'Second video',mediaId:'blue'}]}
const draft=()=>JSON.parse(localStorage.getItem(storage)).timeline
async function settle(ms=100){await new Promise(resolve=>setTimeout(resolve,ms));await vue.nextTick()}
async function choose(label,text){const trigger=document.querySelector(`.app-select-trigger[aria-label="${label}"]`);if(trigger.getAttribute('aria-expanded')!=='true')trigger.click();await vue.nextTick();const option=[...document.querySelectorAll('.app-select-menu [role="option"]')].find(item=>item.textContent===text);assert.ok(option);option.click();await settle()}
before(async()=>{
 globalThis.useRuntimeConfig=()=>({public:{apiBase:'http://localhost:3001/api'}})
 globalThis.useRouter=()=>({push:()=>{}})
 globalThis.$fetch=async(url,options={})=>{
  requests.push({url,...options})
  if(url.endsWith('/editor')&&options.method==='PUT'){assert.equal(options.body.revision,data.revision);data.timeline=structuredClone(options.body.timeline);data.revision++;return{data:{timeline:structuredClone(data.timeline),revision:data.revision}}}
  if(url.endsWith('/editor'))return{data:structuredClone(data)}
  if(url.endsWith('/media/audio')){const media={id:'uploaded-music',name:'Uploaded music.wav',kind:'audio',url:'/uploads/aigc/music.wav',duration:210,hasAudio:true,width:0,height:0};data.media.push(media);return{data:structuredClone(media)}}
  if(url.endsWith('/exports')){const job={id:`export-${jobId++}`,kind:'canvas_export',status:'running',progress:5,targetId:'episode-id',episodeNumber:1,input:{outputFormat:options.body.outputFormat},result:{},error:''};jobs.set(job.id,job);return{data:structuredClone(job)}}
  if(url.includes('/exports/')&&url.endsWith('/cancel')){const id=url.split('/exports/')[1].split('/')[0];const job=jobs.get(id);job.status='cancelled';return{data:structuredClone(job)}}
  if(url.includes('/jobs/'))return{data:structuredClone(jobs.get(url.split('/jobs/')[1]))}
  throw new Error(`Unexpected editor request: ${url}`)
 }
 const style=document.createElement('style');style.textContent=await readFile(resolve(root,'app/assets/css/main.css'),'utf8')+await readFile(resolve(root,'app/assets/css/editor.css'),'utf8');document.head.append(style)
 tempDir=await mkdtemp(resolve(root,'node_modules/.cache/editor-test-'));const outfile=resolve(tempDir,'editor.mjs')
 const imports='import { ref,computed,reactive,watch,nextTick,onMounted,onBeforeUnmount,toRaw } from "vue";\n'
 await build({entryPoints:[resolve(root,'app/components/editor/VideoEditorWorkspace.vue')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'compile-vue-editor',setup(builder){
  builder.onResolve({filter:/^~\//},args=>({path:resolve(root,'app',args.path.slice(2)+(args.path.endsWith('.vue')?'':'.ts'))}))
  builder.onLoad({filter:/\.vue$/},async args=>{const source=(await readFile(args.path,'utf8')).replace('<script setup lang="ts">',`<script setup lang="ts">\n${imports}`);const {descriptor}=parse(source,{filename:args.path});return{contents:compileScript(descriptor,{id:args.path,inlineTemplate:true}).content+(args.path.endsWith('VideoEditorWorkspace.vue')?'\nexport { default as Timeline } from "./EditorTimeline.vue";':''),loader:'ts',resolveDir:dirname(args.path)}})
  builder.onLoad({filter:/useVideoEditor\.ts$/},async args=>({contents:imports+await readFile(args.path,'utf8'),loader:'ts',resolveDir:dirname(args.path)}))
 }}]})
 vue=await import('vue');const compiled=await import(pathToFileURL(outfile).href);Workspace=compiled.default;Timeline=compiled.Timeline
 await mount()
})
async function mount(){const host=document.createElement('div');document.body.append(host);app=vue.createApp({render:()=>vue.h(Workspace,{projectId:'project',episode:1})});app.component('NuxtLink',{props:['to'],render(){return vue.h('a',{href:this.to},this.$slots.default?.())}});app.mount(host);await settle()}
after(async()=>{app?.unmount();await window.happyDOM.close();if(tempDir)await rm(tempDir,{recursive:true,force:true})})
test('editor imports the current episode videos, renders tracks and preserves the canvas return link',()=>{
 assert.equal(document.querySelectorAll('.editor-track-clip').length,2)
 assert.equal(document.querySelector('.editor-library'),null)
 assert.equal(document.querySelector('.editor-media-library'),null)
 assert.ok(document.querySelector('.editor-preview-stage video'))
 assert.ok(document.querySelector('.audio-lane'))
 assert.ok(document.querySelector('.subtitle-lane'))
 assert.equal(document.querySelector('.original-audio-lane'),null)
 assert.equal(document.querySelectorAll('.editor-lane').length,3)
 assert.match(document.querySelector('.editor-back').getAttribute('href'),/episode=1/)
 assert.equal(draft().clips.reduce((sum,clip)=>sum+clip.duration,0),150)
})
test('add material expands a horizontal video-only library, independent from the audio insertion dialog',async()=>{
 document.querySelector('[title="添加素材"]').click();await vue.nextTick()
 assert.equal(document.querySelectorAll('.editor-media-library .editor-library-item').length,2)
 assert.ok(document.querySelector('.editor-library-upload'))
 assert.equal(window.getComputedStyle(document.querySelector('.editor-media-library')).display,'flex')
 document.querySelector('[title="添加素材"]').click();await vue.nextTick()
 assert.equal(document.querySelector('.editor-media-library'),null)
})
test('split, delete, undo, redo and clip speed affect the real persisted timeline',async()=>{
 document.querySelector('.editor-track-clip').click();await settle()
 const seek=document.querySelector('[aria-label="预览进度"]');seek.value='30';seek.dispatchEvent(new window.Event('input',{bubbles:true}));await vue.nextTick()
 document.querySelector('[title="分割片段"]').click();await settle();assert.equal(draft().clips.length,3)
 document.querySelector('[title="删除片段"]').click();await settle();assert.equal(draft().clips.length,2)
 document.querySelector('[title="撤销"]').click();await settle();assert.equal(draft().clips.length,3)
 document.querySelector('[title="重做"]').click();await settle();assert.equal(draft().clips.length,2)
 document.querySelector('[title="撤销"]').click();await settle()
 document.querySelector('.editor-track-clip').click();await settle()
 await choose('片段倍速','2x');assert.equal(draft().clips[0].speed,2)
 const before=draft().clips[0].duration
 document.querySelector('.video-lane .tail').dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,button:0,clientX:100}))
 document.dispatchEvent(new window.PointerEvent('pointermove',{clientX:116}));document.dispatchEvent(new window.PointerEvent('pointerup',{clientX:116}));await settle()
 assert.ok(draft().clips[0].duration>before)
})
test('uploaded music inserts a full-length independent, splittable and trimmable audio track without losing videos',async()=>{
 const clips=draft().clips.length
 document.querySelector('[title="插入音源"]').click();await vue.nextTick()
 assert.ok(document.querySelector('.editor-audio-dialog'));document.querySelector('.editor-audio-upload').click();await vue.nextTick()
 const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[new window.File(['music'],'music.wav',{type:'audio/wav'})]});input.dispatchEvent(new window.Event('change',{bubbles:true}));await settle()
 assert.equal(draft().clips.length,clips);assert.equal(draft().audio_tracks[0].duration,210)
 assert.equal(document.querySelectorAll('.editor-track-audio').length,1)
 assert.equal(document.querySelector('.editor-audio-dialog'),null)
 const seek=document.querySelector('[aria-label="预览进度"]');seek.value='60';seek.dispatchEvent(new window.Event('input',{bubbles:true}));await vue.nextTick()
 document.querySelector('[title="分割片段"]').click();await settle();assert.equal(draft().audio_tracks.length,2)
 const audio=document.querySelector('.editor-track-audio');audio.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,button:0,clientX:100}));document.dispatchEvent(new window.PointerEvent('pointerup',{clientX:100}));await settle()
 const before=draft().audio_tracks[0].duration
 document.querySelector('.audio-lane .tail').dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,button:0,clientX:100}));document.dispatchEvent(new window.PointerEvent('pointermove',{clientX:76}));document.dispatchEvent(new window.PointerEvent('pointerup',{clientX:76}));await settle()
 assert.ok(draft().audio_tracks[0].duration<before)
 document.querySelector('[title="关闭原声"]').click();await settle();assert.ok(draft().clips.every(clip=>clip.muted));assert.ok(document.querySelector('[title="开启原声"]'))
 assert.equal(document.querySelectorAll('.editor-track-clip .editor-clip-mute-badge').length,draft().clips.length)
 const badgeStyle=window.getComputedStyle(document.querySelector('.editor-clip-mute-badge'));assert.equal(badgeStyle.position,'absolute');assert.equal(badgeStyle.top,'2px');assert.equal(badgeStyle.right,'2px')
 document.querySelector('[title="开启原声"]').click();await settle();assert.ok(draft().clips.every(clip=>!clip.muted));assert.equal(document.querySelector('.editor-clip-mute-badge'),null)
})
test('subtitles and transitions are editable and export settings include MP3 and interruption',async()=>{
 const seek=document.querySelector('[aria-label="预览进度"]');seek.value='0';seek.dispatchEvent(new window.Event('input',{bubbles:true}));await vue.nextTick()
 document.querySelector('[title="添加字幕"]').click();await settle()
 const caption=document.querySelector('.editor-subtitle-dialog textarea');caption.value='An editable caption';caption.dispatchEvent(new window.Event('input',{bubbles:true}));await vue.nextTick();document.querySelector('.editor-subtitle-dialog .primary-button').click();await settle();assert.equal(draft().subtitles[0].text,'An editable caption')
 document.querySelector('.editor-track-clip').click();await settle();document.querySelector('[title="添加转场"]').click();await settle();await choose('片尾转场','交叉淡化');assert.equal(draft().clips[0].transition,'fade')
 await choose('片尾转场','淡出至黑');assert.equal(draft().clips[0].transition,'fadeblack')
 document.querySelector('.editor-header .primary-button').click();await settle();await choose('输出格式','MP3 音频')
 document.querySelector('.editor-export-dialog .primary-button').click();await settle(200)
 const request=requests.findLast(request=>request.url.endsWith('/exports'));assert.equal(request.body.outputFormat,'mp3');assert.equal(request.body.timeline.audio_tracks.length,2);assert.equal(request.body.timeline.subtitles[0].text,'An editable caption')
 const stop=[...document.querySelectorAll('.editor-header button')].find(button=>button.textContent.includes('导出中'));assert.ok(stop);stop.click();await settle();assert.equal([...jobs.values()].at(-1).status,'cancelled')
})
test('autosave and reopening preserve edits while export completion exposes a real download action',async()=>{
 await settle(1000);assert.equal(data.timeline.clips.length,draft().clips.length);assert.equal(JSON.parse(localStorage.getItem(storage)).dirty,false)
 const before=structuredClone(data.timeline);app.unmount();await mount();assert.deepEqual(draft(),before)
 document.querySelector('.editor-header .primary-button').click();await settle();document.querySelector('.editor-export-dialog .primary-button').click();await settle()
 const job=[...jobs.values()].at(-1);job.status='succeeded';job.result={url:'/uploads/aigc/result.mp4'};await settle(1400)
 assert.ok(document.querySelector('.editor-export-complete'));assert.match(document.querySelector('.editor-export-complete').textContent,/下载 MP4/)
})

function timelineFixture(sourceDuration = 90) {
 const clip=(id,shot_id,duration)=>({id,shot_id,duration,source_start:0,speed:1,gap_before:0,volume:1,muted:false,transition:'cut',transition_duration:0,effect:''})
 const state=vue.reactive({value:{version:1,fps:30,clips:[clip('first','red',sourceDuration),clip('second','blue',60)],audio_tracks:[{id:'music',media_id:'music-source',shot_id:'',source:'upload',source_start:0,start:30,duration:sourceDuration === 90 ? 120 : sourceDuration,speed:1,volume:1,muted:false,fade_in:0,fade_out:0}],subtitles:[{id:'caption',text:'Caption',start:0,duration:30}]},preview:null,selected:'',frame:0,commits:0})
 const host=document.createElement('div');document.body.append(host)
 const fixture=vue.createApp({render:()=>vue.h(Timeline,{timeline:state.preview || state.value,media:[...data.media.filter(item=>item.id!=='red'),{id:'red',duration:sourceDuration,name:'Video',kind:'video'},{id:'music-source',duration:sourceDuration === 90 ? 210 : sourceDuration,name:'Music',kind:'audio'}],frame:state.frame,selected:state.selected,zoom:48,onSelect:id=>{state.selected=id},onSeek:frame=>{state.frame=frame},onPreview:value=>{state.preview=value},onEdit:value=>{state.value=value;state.commits++}})})
 fixture.mount(host)
 return {host,state,dispose:()=>{fixture.unmount();host.remove()}}
}
function pointer(target,type,x,id=7) { target.dispatchEvent(new window.PointerEvent(type,{bubbles:true,button:0,clientX:x,clientY:250,pointerId:id})) }
test('video handles stay outside draggable clips; head follows the pointer, then closes the magnetic track once',async()=>{
 const {host,state,dispose}=timelineFixture()
 try {
  assert.equal(host.querySelector('.editor-trim-handle'),null)
  host.querySelector('.editor-track-clip').click();await vue.nextTick()
  const handle=host.querySelector('.video-lane .head')
  assert.ok(handle);assert.equal(handle.closest('.editor-track-clip'),null)
  assert.equal(handle.getAttribute('role'),'slider')
  pointer(handle,'pointerdown',100);pointer(document,'pointermove',148);await settle(30)
  assert.equal(state.commits,0);assert.equal(state.value.clips[0].duration,90)
  assert.equal(state.preview.clips[0].source_start,30)
  assert.equal(host.querySelector('.editor-track-clip').style.left,'48px')
  assert.equal(host.querySelectorAll('.editor-track-clip')[1].style.left,'144px')
  assert.ok(host.querySelector('.editor-trim-gap'));assert.ok(document.querySelector('.editor-trim-bubble'))
  pointer(document,'pointerup',148);await vue.nextTick()
  assert.equal(state.commits,1);assert.equal(state.value.clips[0].source_start,30);assert.equal(state.value.clips[0].duration,60)
  assert.equal(state.preview,null);assert.equal(host.querySelector('.editor-track-clip').style.left,'0px')
  assert.equal(host.querySelectorAll('.editor-track-clip')[1].style.left,'96px')
  assert.equal(document.querySelector('.editor-trim-bubble'),null)
 } finally {dispose()}
})
test('video tail flushes the release position, follows the playhead and cannot extend beyond the source',async()=>{
 const {host,state,dispose}=timelineFixture()
 try {
  host.querySelector('.editor-track-clip').click();await vue.nextTick()
  pointer(host.querySelector('.video-lane .tail'),'pointerdown',100)
  pointer(document,'pointermove',76);pointer(document,'pointerup',52);await vue.nextTick()
  assert.equal(state.commits,1);assert.equal(state.value.clips[0].duration,60)
  assert.equal(state.frame,59)
  pointer(host.querySelector('.video-lane .tail'),'pointerdown',100)
  pointer(document,'pointerup',1000);await vue.nextTick()
  assert.equal(state.value.clips[0].duration,90);assert.equal(state.commits,2)
  const handle=host.querySelector('.video-lane .head')
  handle.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await vue.nextTick()
  assert.equal(state.value.clips[0].source_start,1)
  assert.equal(state.value.clips[0].duration,89)
 } finally {dispose()}
})
test('audio head preserves its end; body moves independently; tail obeys source limits and supports cancellation',async()=>{
 const {host,state,dispose}=timelineFixture()
 try {
  pointer(host.querySelector('.editor-track-audio'),'pointerdown',100);pointer(document,'pointerup',100);await vue.nextTick()
  assert.equal(state.selected,'music');assert.equal(state.commits,0)
  pointer(host.querySelector('.audio-lane .head'),'pointerdown',100);pointer(document,'pointerup',148);await vue.nextTick()
  assert.deepEqual([state.value.audio_tracks[0].start,state.value.audio_tracks[0].source_start,state.value.audio_tracks[0].duration],[60,30,90])
  assert.equal(state.value.audio_tracks[0].start+state.value.audio_tracks[0].duration,150)
  pointer(host.querySelector('.editor-track-audio'),'pointerdown',100);pointer(document,'pointerup',148);await vue.nextTick()
  assert.deepEqual([state.value.audio_tracks[0].start,state.value.audio_tracks[0].source_start,state.value.audio_tracks[0].duration],[90,30,90])
  pointer(host.querySelector('.audio-lane .tail'),'pointerdown',100);pointer(document,'pointerup',1000);await vue.nextTick()
  assert.equal(state.value.audio_tracks[0].duration,210);assert.equal(state.value.audio_tracks[0].source_start,0)
  const before=JSON.stringify(state.value),commits=state.commits
  pointer(host.querySelector('.audio-lane .tail'),'pointerdown',100);pointer(document,'pointermove',52);await settle(30)
  assert.notEqual(state.preview,null)
  pointer(document,'pointercancel',52);await vue.nextTick()
  assert.equal(state.preview,null);assert.equal(JSON.stringify(state.value),before);assert.equal(state.commits,commits)
  pointer(document,'pointerup',52);assert.equal(state.commits,commits)
 } finally {dispose()}
})
test('timeline handles snap to other endpoints and ignore unrelated pointers',async()=>{
 const {host,state,dispose}=timelineFixture()
 try {
  host.querySelector('.editor-track-clip').click();await vue.nextTick()
  pointer(host.querySelector('.video-lane .tail'),'pointerdown',100)
  pointer(document,'pointermove',5,8);await settle(30)
  assert.equal(state.preview,null);assert.equal(state.commits,0)
  pointer(document,'pointermove',5);await settle(30)
  assert.ok(host.querySelector('.editor-snap-guide'))
  assert.equal(state.preview.clips[0].duration,30)
  pointer(document,'pointerup',5);await vue.nextTick()
  assert.equal(state.commits,1);assert.equal(state.value.clips[0].duration,30)
  assert.equal(host.querySelector('.editor-snap-guide'),null)
 } finally {dispose()}
})
for (const kind of ['video','audio'])test(`${kind}: a full 16s source trimmed at its head to 10s can be restored to 16s by its tail`,async()=>{
 const {host,state,dispose}=timelineFixture(480)
 try {
  const lane=kind==='video'?'.video-lane':'.audio-lane'
  if(kind==='video')host.querySelector('.editor-track-clip').click()
  else {pointer(host.querySelector('.editor-track-audio'),'pointerdown',100);pointer(document,'pointerup',100)}
  await vue.nextTick()
  pointer(host.querySelector(`${lane} .head`),'pointerdown',100);pointer(document,'pointerup',388);await vue.nextTick()
  const item=()=>kind==='video'?state.value.clips[0]:state.value.audio_tracks[0]
  assert.equal(item().source_start,180);assert.equal(item().duration,300)
  pointer(host.querySelector(`${lane} .tail`),'pointerdown',100);pointer(document,'pointerup',244);await vue.nextTick()
  assert.equal(item().duration,390);assert.equal(item().source_start,90)
  pointer(host.querySelector(`${lane} .tail`),'pointerdown',100);pointer(document,'pointerup',244);await vue.nextTick()
  assert.equal(item().duration,480);assert.equal(item().source_start,0)
  pointer(host.querySelector(`${lane} .tail`),'pointerdown',100);pointer(document,'pointerup',500);await vue.nextTick()
  assert.equal(item().duration,480);assert.equal(item().source_start+item().duration,480)
  assert.equal(state.commits,3)
 } finally {dispose()}
})
test('inspector duration is output duration at the selected speed and audio fades cannot overlap',async()=>{
 document.querySelector('.editor-track-clip').click();await settle()
 await choose('片段倍速','2x')
 const clip=draft().clips[0]
 assert.equal(Number(document.querySelector('[aria-label="片段时长"]').value),Number((Math.round(clip.duration/2)/30).toFixed(3)))
 const input=document.querySelector('[aria-label="片段时长"]');input.value='.2';input.dispatchEvent(new window.Event('change',{bubbles:true}));await settle()
 assert.equal(draft().clips[0].duration,12)
 const audio=document.querySelector('.editor-track-audio');pointer(audio,'pointerdown',100);pointer(document,'pointerup',100);await settle()
 const fadeIn=document.querySelector('[aria-label="音频淡入"]');fadeIn.value='100';fadeIn.dispatchEvent(new window.Event('change',{bubbles:true}));await settle()
 const fadeOut=document.querySelector('[aria-label="音频淡出"]');fadeOut.value='100';fadeOut.dispatchEvent(new window.Event('change',{bubbles:true}));await settle()
 const track=draft().audio_tracks[0];assert.ok(track.fade_in+track.fade_out<=Math.round(track.duration/track.speed))
})
test('subtitle head, tail and body stay within the timeline and never overlap adjacent cues',async()=>{
 const {host,state,dispose}=timelineFixture()
 try {
  state.value.subtitles=[{id:'caption',start:0,duration:30,text:'First'},{id:'second-caption',start:60,duration:30,text:'Second'}];await vue.nextTick()
  pointer(host.querySelector('.editor-track-subtitle'),'pointerdown',100);pointer(document,'pointerup',100);await vue.nextTick()
  pointer(host.querySelector('.subtitle-lane .tail'),'pointerdown',100);pointer(document,'pointerup',500);await vue.nextTick()
  assert.deepEqual([state.value.subtitles[0].start,state.value.subtitles[0].duration],[0,60])
  pointer(host.querySelector('.subtitle-lane .head'),'pointerdown',100);pointer(document,'pointerup',124);await vue.nextTick()
  assert.deepEqual([state.value.subtitles[0].start,state.value.subtitles[0].duration],[15,45])
  pointer(host.querySelector('.editor-track-subtitle'),'pointerdown',100);pointer(document,'pointerup',500);await vue.nextTick()
  assert.deepEqual([state.value.subtitles[0].start,state.value.subtitles[0].duration],[15,45])
  pointer(host.querySelector('.subtitle-lane .head'),'pointerdown',100);pointer(document,'pointerup',0);await vue.nextTick()
  assert.deepEqual([state.value.subtitles[0].start,state.value.subtitles[0].duration],[0,60])
  assert.equal(state.value.clips[0].duration,90);assert.equal(state.value.audio_tracks[0].duration,120)
 } finally {dispose()}
})
