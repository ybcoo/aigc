import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { Window } from 'happy-dom'

const root=resolve(import.meta.dirname,'..'), window=new Window({url:'http://localhost:3000'})
for(const key of ['window','document','Document','ShadowRoot','navigator','HTMLElement','Element','SVGElement','Node','localStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]})
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window)
let vue,Home,app,temp,requests=[],navigated=[],rejectCreation=false,holdCreation,failProjects=false
let rejectDeletion=false,holdDeletion
let rejectImport=false,holdImport
const playCalls=[],pauseCalls=[]
let playback=()=>Promise.resolve()
const projects=Array.from({length:15},(_,index)=>({id:`project-${index}`,title:`我的创作 ${index+1}`,description:'',episodeCount:1,aspectRatio:'16:9',updatedAt:'2026-10-28T10:00:00.000Z'}))
const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,30));await vue.nextTick()}
function setInput(selector,value){const el=document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}))}
async function mount(){const host=document.createElement('div');document.body.appendChild(host);app=vue.createApp(Home);app.component('NuxtLink',{props:['to'],render(){return vue.h('a',{href:this.to},this.$slots.default?.())}});app.config.warnHandler=()=>{};app.mount(host);await settle()}

before(async()=>{
  window.HTMLMediaElement.prototype.play=function(){playCalls.push(this);return playback(this)}
  window.HTMLMediaElement.prototype.pause=function(){pauseCalls.push(this)}
  window.HTMLMediaElement.prototype.load=function(){}
  globalThis.useRuntimeConfig=()=>({public:{apiBase:'http://localhost:3001/api'}})
  globalThis.navigateTo=async path=>{navigated.push(path)}
  globalThis.$fetch=async(url,options={})=>{
    requests.push({url,...options})
    if(url.endsWith('/ai-configs'))return{data:[{id:'text-config',name:'文本模型',serviceType:'text',isActive:true,models:['model-a','model-b'],defaultModel:'model-a'},{id:'image-config',serviceType:'image',isActive:true,models:['image-model']}]}
    if(url.includes('/projects/import-script')){
      assert.ok(options.body instanceof FormData)
      if(url.includes('preview=true'))return{data:{title:options.body.get('title'),encoding:options.body.get('encoding')==='auto'?'utf-8':options.body.get('encoding'),chapterCount:2,characterCount:30,chapters:[{episodeNumber:1,title:'第一章 开始',characterCount:15},{episodeNumber:2,title:'第二章 结束',characterCount:15}]}}
      if(holdImport)await new Promise(resolve=>{holdImport=resolve})
      if(rejectImport)throw{data:{message:'导入失败，请重试'}}
      return{data:{id:'imported-project',title:options.body.get('title'),episodeCount:2}}
    }
    if(url.endsWith('/projects')&&options.method==='POST'){
      if(holdCreation)await new Promise(resolve=>{holdCreation=resolve})
      if(rejectCreation)throw{data:{message:'项目创建失败，请稍后重试'}}
      return{data:{...options.body,id:'created-project'}}
    }
    if(options.method==='DELETE'&&url.includes('/projects/')){
      if(holdDeletion)await new Promise(resolve=>{holdDeletion=resolve})
      if(rejectDeletion)throw{data:{message:'该项目还有任务正在生成，请先中断'}}
      const id=url.split('/').at(-1),index=projects.findIndex(project=>project.id===id)
      assert.ok(index>=0);projects.splice(index,1);return{data:{id}}
    }
    if(url.endsWith('/projects')){if(failProjects)throw Error('offline');return{data:structuredClone(projects)}}
    throw Error(`Unexpected request ${url}`)
  }
  const style=document.createElement('style');style.textContent=await readFile(resolve(root,'app/assets/css/home.css'),'utf8');document.head.append(style)
  temp=await mkdtemp(resolve(root,'node_modules/.cache/home-test-'))
  const output=resolve(temp,'home.mjs')
  await build({entryPoints:[resolve(root,'app/pages/index.vue')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'vue',setup(builder){
    builder.onResolve({filter:/^~\//},args=>({path:resolve(root,'app',args.path.slice(2)+(args.path.endsWith('.vue')?'':'.ts'))}))
    builder.onLoad({filter:/\.vue$/},async args=>{
      const source=(await readFile(args.path,'utf8')).replace('<script setup lang="ts">','<script setup lang="ts">\nimport {ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount} from "vue";')
      const {descriptor}=parse(source,{filename:args.path});const script=compileScript(descriptor,{id:args.path,inlineTemplate:true})
      return{contents:script.content,loader:'ts',resolveDir:dirname(args.path)}
    })
  }}]})
  vue=await import('vue');Home=(await import(pathToFileURL(output).href)).default;await mount()
})
after(async()=>{app?.unmount();await window.happyDOM.close();if(temp)await rm(temp,{recursive:true,force:true})})

test('home has three ordered sections, defaults to landscape and one episode, and no create-project header',()=>{
  assert.equal(document.querySelector('.project-page-header'),null)
  assert.deepEqual([...document.querySelectorAll('.studio-home > section')].map(el=>el.classList[0]),['home-create','home-projects','home-featured'])
  assert.equal(document.querySelector('textarea').placeholder,'输入你的故事剧本')
  assert.equal(document.querySelector('[aria-label="创作画幅"]').textContent.trim(),'16:9')
  assert.match(document.querySelector('[aria-label="设置剧集数量"]').textContent,/1 集/)
  assert.equal(document.querySelector('.home-send').disabled,true)
  assert.ok(document.querySelector('.home-import-button').previousElementSibling.querySelector('[aria-label="设置剧集数量"]'),'TXT import follows the episode control')
  assert.match(document.querySelector('[aria-label="文本模型"]').textContent,/model-a/)
})
test('middle project row scrolls horizontally and view-all exposes all projects with search',async()=>{
  assert.equal(document.querySelectorAll('.home-project-rail .home-project-tile').length,12)
  assert.equal(window.getComputedStyle(document.querySelector('.home-project-rail')).overflowX,'auto')
  document.querySelector('.home-view-all').click();await settle()
  assert.equal(document.querySelectorAll('.home-all-projects-grid a').length,15)
  setInput('[aria-label="搜索项目"]','创作 15');await settle()
  assert.equal(document.querySelectorAll('.home-all-projects-grid a').length,1)
  assert.equal(document.querySelector('.home-all-projects-grid a').getAttribute('href'),'/projects/project-14')
  document.querySelector('[title="关闭项目列表"]').click();await settle()
})
test('featured works have distinct real posters, lazy video previews and a playable full preview',async()=>{
  const posters=[...document.querySelectorAll('.home-featured-media img')]
  assert.equal(posters.length,6);assert.equal(new Set(posters.map(img=>img.src)).size,6)
  for(const image of posters)assert.ok((await readFile(resolve(root,'public',image.getAttribute('src').slice(1)))).length>1000)
  assert.equal(document.querySelectorAll('.home-featured-media video').length,0)
  const button=document.querySelector('.home-featured-media');button.dispatchEvent(new window.MouseEvent('mouseenter'));await settle()
  assert.equal(document.querySelectorAll('.home-featured-media video').length,1)
  const video=button.querySelector('video');assert.equal(playCalls.at(-1),video);assert.equal(video.muted,true);assert.equal(video.defaultMuted,true)
  assert.equal(button.getAttribute('aria-busy'),'true')
  video.dispatchEvent(new window.Event('loadeddata'));await settle();assert.equal(button.classList.contains('is-previewing'),false)
  video.dispatchEvent(new window.Event('playing'));await settle();assert.equal(button.classList.contains('is-previewing'),true)
  const count=playCalls.length;button.dispatchEvent(new window.FocusEvent('focus'));await settle()
  assert.equal(playCalls.length,count);assert.equal(button.classList.contains('is-previewing'),true)
  button.dispatchEvent(new window.MouseEvent('mouseleave'));await settle();assert.equal(document.querySelectorAll('.home-featured-media video').length,0)
  assert.ok(pauseCalls.includes(video));assert.equal(video.getAttribute('src'),null)
  button.click();await settle();assert.ok(document.querySelector('.canvas-media-preview-video[controls]'))
  document.querySelector('[aria-label="关闭预览"]').click();await settle()
})
test('quickly switching hovered cards cancels the previous preview without affecting the next one',async()=>{
  const [first,second]=document.querySelectorAll('.home-featured-media')
  let rejectPrevious;playback=()=>new Promise((_resolve,reject)=>{rejectPrevious=reject})
  try{
    first.dispatchEvent(new window.MouseEvent('mouseenter'));await settle();const previous=first.querySelector('video')
    playback=()=>Promise.resolve();second.dispatchEvent(new window.MouseEvent('mouseenter'));await settle()
    assert.ok(pauseCalls.includes(previous));assert.equal(document.querySelectorAll('.home-featured-media video').length,1)
    const current=second.querySelector('video');current.dispatchEvent(new window.Event('playing'));await settle()
    rejectPrevious(Error('Playback interrupted by leaving'));await settle();assert.equal(second.classList.contains('is-previewing'),true)
    second.dispatchEvent(new window.MouseEvent('mouseleave'));await settle()
    const count=playCalls.length;first.dispatchEvent(new window.MouseEvent('mouseenter'));first.dispatchEvent(new window.MouseEvent('mouseleave'));await settle()
    assert.equal(playCalls.length,count);assert.equal(document.querySelectorAll('.home-featured-media video').length,0)
  }finally{playback=()=>Promise.resolve()}
})
test('blocked playback keeps the poster available instead of exposing a blank player',async()=>{
  const button=document.querySelector('.home-featured-media');playback=()=>Promise.reject(Error('Autoplay blocked'))
  try{
    button.dispatchEvent(new window.MouseEvent('mouseenter'));await settle()
    assert.equal(button.classList.contains('is-previewing'),false);assert.equal(button.getAttribute('aria-busy'),'false');assert.ok(button.querySelector('img'))
    button.dispatchEvent(new window.MouseEvent('mouseleave'));await settle()
  }finally{playback=()=>Promise.resolve()}
})
test('composer sends the unmodified script and all options exactly once, then enters its canvas',async()=>{
  const script='\n  【中景】秦宇说：“这句话不能改写。”\n【远景】古城落日。  \n'
  setInput('[aria-label="创作剧本"]',script);await settle()
  document.querySelector('[aria-label="设置风格"]').click();await settle();setInput('[aria-label="视觉风格"]','国风水墨动漫');await settle()
  document.querySelector('[aria-label="设置题材"]').click();await settle();setInput('[aria-label="故事题材"]','玄幻修仙');await settle()
  document.querySelector('[aria-label="设置剧集数量"]').click();await settle();setInput('[aria-label="剧集数量"]','3');await settle()
  holdCreation=true;const form=document.querySelector('.home-composer');form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle()
  assert.equal(document.querySelector('.home-send').disabled,true)
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle()
  const submissions=requests.filter(request=>request.method==='POST');assert.equal(submissions.length,1)
  assert.deepEqual(submissions[0].body,{title:'',scriptContent:script,textModelId:'text-config:model-a',aspectRatio:'16:9',style:'国风水墨动漫',genre:'玄幻修仙',episodeCount:3})
  const release=holdCreation;holdCreation=undefined;release();await settle()
  assert.equal(navigated.at(-1),'/projects/created-project')
  assert.equal(document.querySelector('[aria-label="创作剧本"]').value,'')
  assert.equal(JSON.parse(localStorage.getItem('aigc-home-story-draft')).script,'')
  app.unmount();await mount()
  assert.equal(document.querySelector('[aria-label="创作剧本"]').value,'','returning from the canvas must not restore a submitted script')
  assert.equal(document.querySelector('.home-send').disabled,true)
})
test('draft survives a revisit, and failed creation keeps the input and shows an error',async()=>{
  setInput('[aria-label="创作剧本"]','尚未发送成功的新剧本。');await settle()
  const before=document.querySelector('textarea').value;app.unmount();await mount();assert.equal(document.querySelector('textarea').value,before)
  assert.match(document.querySelector('[aria-label="设置风格"]').textContent,/国风水墨动漫/)
  rejectCreation=true;document.querySelector('.home-composer').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle()
  assert.match(document.querySelector('.home-error').textContent,/创建失败/);assert.equal(document.querySelector('textarea').value,before)
  assert.equal(JSON.parse(localStorage.getItem('aigc-home-story-draft')).script,before,'failed submissions retain the persisted draft too')
  assert.equal(document.querySelector('.home-send').disabled,false);rejectCreation=false
})
test('project deletion requires confirmation and Escape closes only its confirmation',async()=>{
  document.querySelector('.home-view-all').click();await settle()
  const button=document.querySelector('.home-all-projects-grid .home-project-delete')
  assert.equal(button.closest('a'),null)
  const before=requests.filter(request=>request.method==='DELETE').length
  button.click();await settle()
  assert.match(document.querySelector('.home-delete-dialog').textContent,/我的创作 1/)
  assert.match(document.querySelector('.home-delete-dialog').textContent,/无法撤销/)
  assert.equal(document.activeElement.textContent,'取消')
  document.querySelector('.home-delete-dialog button').click();await settle()
  assert.equal(document.querySelector('.home-delete-dialog'),null);assert.equal(document.activeElement,button)
  button.click();await settle()
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle()
  assert.equal(document.querySelector('.home-delete-dialog'),null);assert.ok(document.querySelector('.home-project-dialog'))
  assert.equal(requests.filter(request=>request.method==='DELETE').length,before)
  document.querySelector('[title="关闭项目列表"]').click();await settle()
})
test('failed deletion retains the project, and a successful retry updates both project views without duplicate requests',async()=>{
  const id=projects[0].id,title=projects[0].title,beforeCount=projects.length
  document.querySelector('.home-project-rail .home-project-delete').click();await settle()
  rejectDeletion=true;document.querySelector('.home-delete-dialog button:last-child').click();await settle()
  assert.match(document.querySelector('.home-delete-dialog [role="alert"]').textContent,/任务正在生成/)
  assert.ok(document.querySelector(`a[href="/projects/${id}"]`));assert.equal(projects.length,beforeCount)
  rejectDeletion=false;holdDeletion=true
  const before=requests.filter(request=>request.method==='DELETE').length
  document.querySelector('.home-delete-dialog button:last-child').click();await settle()
  assert.equal(document.querySelector('.home-delete-dialog').getAttribute('aria-busy'),'true')
  assert.ok([...document.querySelectorAll('.home-delete-dialog button')].every(button=>button.disabled))
  document.querySelector('.home-delete-dialog button:last-child').click()
  document.querySelector('.home-delete-backdrop').click();await settle();assert.ok(document.querySelector('.home-delete-dialog'))
  assert.equal(requests.filter(request=>request.method==='DELETE').length,before+1)
  const release=holdDeletion;holdDeletion=undefined;release();await settle()
  assert.equal(document.querySelector('.home-delete-dialog'),null);assert.equal(document.querySelector(`a[href="/projects/${id}"]`),null)
  assert.equal(document.querySelector('.home-count').textContent,String(beforeCount-1));assert.equal(projects.length,beforeCount-1)
  document.querySelector('.home-view-all').click();await settle();setInput('[aria-label="搜索项目"]',title);await settle()
  assert.equal(document.querySelector(`.home-all-projects-grid a[href="/projects/${id}"]`),null)
  setInput('[aria-label="搜索项目"]','');await settle()
  assert.equal(document.querySelectorAll('.home-all-projects-grid a').length,beforeCount-1)
  document.querySelector('[title="关闭项目列表"]').click();await settle()
  app.unmount();await mount();assert.equal(document.querySelector(`a[href="/projects/${id}"]`),null)
})
function pickScript(file){const input=document.querySelector('.script-import-dialog input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new window.Event('change',{bubbles:true}))}
test('TXT import previews before creating, carries home settings and retains its file and preview on failure',async()=>{
  const draft=document.querySelector('[aria-label="创作剧本"]').value
  document.querySelector('[aria-label="导入 TXT 剧本"]').click();await settle()
  const file=new File(['第一章 开始\r\n原文\r\n第二章 结束\r\n最后\r\n'],'原始剧本.txt',{type:'text/plain'})
  pickScript(file);await settle();assert.equal(document.querySelector('[aria-label="导入项目名称"]').value,'原始剧本')
  assert.equal([...document.querySelectorAll('.script-import-dialog footer button')].some(button=>button.textContent.includes('确认导入')),false)
  setInput('[aria-label="导入项目名称"]','导入测试项目');await settle()
  const previewButton=()=>[...document.querySelectorAll('.script-import-dialog footer button')].find(button=>button.textContent.includes('预览章节'))
  previewButton().click();await settle()
  assert.equal(document.querySelectorAll('.script-import-preview li').length,2)
  assert.equal(window.getComputedStyle(document.querySelector('.script-import-body')).overflowY,'auto')
  assert.ok(!['auto','scroll'].includes(window.getComputedStyle(document.querySelector('.script-import-preview ol')).overflowY),'chapter preview must not introduce a nested scroll area')
  const previewRequest=requests.findLast(request=>request.url.includes('import-script?preview=true'))
  assert.equal(await previewRequest.body.get('file').text(),await file.text())
  assert.equal(previewRequest.body.get('textModelId'),'text-config:model-a');assert.equal(previewRequest.body.get('style'),'国风水墨动漫');assert.equal(previewRequest.body.get('genre'),'玄幻修仙');assert.equal(previewRequest.body.get('aspectRatio'),'16:9');assert.equal(previewRequest.body.has('episodeCount'),false)
  document.querySelector('[aria-label="文本编码"]').click();await settle()
  ;[...document.querySelectorAll('.app-select-menu [role=option]')].find(option=>option.textContent.includes('GB18030')).click();await settle()
  assert.equal(document.querySelector('.script-import-preview'),null,'changing encoding invalidates the preview')
  previewButton().click();await settle();rejectImport=true
  document.querySelector('.script-import-dialog footer button:last-child').click();await settle()
  assert.match(document.querySelector('.script-import-body [role=alert]').textContent,/导入失败/)
  assert.match(document.querySelector('.script-import-file').textContent,/原始剧本.txt/);assert.ok(document.querySelector('.script-import-preview'))
  rejectImport=false;holdImport=true
  const before=requests.filter(request=>request.url.endsWith('/projects/import-script')).length
  document.querySelector('.script-import-dialog footer button:last-child').click();await settle()
  assert.ok([...document.querySelectorAll('.script-import-dialog footer button')].every(button=>button.disabled))
  document.querySelector('.script-import-dialog footer button:last-child').click()
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();assert.ok(document.querySelector('.script-import-dialog'))
  assert.equal(requests.filter(request=>request.url.endsWith('/projects/import-script')).length,before+1)
  const release=holdImport;holdImport=undefined;release();await settle()
  assert.equal(document.querySelector('.script-import-dialog'),null);assert.equal(navigated.at(-1),'/projects/imported-project');assert.equal(document.querySelector('[aria-label="创作剧本"]').value,draft)
})
test('TXT file validation rejects wrong extensions, empty and oversized files without submitting or altering the existing draft',async()=>{
  document.querySelector('[aria-label="导入 TXT 剧本"]').click();await settle()
  const before=requests.filter(request=>request.url.includes('import-script')).length
  const oversized=new File(['text'],'large.txt');Object.defineProperty(oversized,'size',{value:32*1024*1024+1})
  for(const file of [new File(['text'],'book.pdf'),new File([],'empty.txt'),oversized]){
    pickScript(file);await settle();assert.match(document.querySelector('.script-import-body [role=alert]').textContent,/32MB/);assert.equal(document.querySelector('.script-import-dialog footer button:last-child').disabled,true)
  }
  assert.equal(requests.filter(request=>request.url.includes('import-script')).length,before)
  document.querySelector('[title="关闭导入"]').click();await settle();assert.equal(document.querySelector('.script-import-dialog'),null)
})
