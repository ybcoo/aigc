import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Window } from 'happy-dom'

const root=resolve(import.meta.dirname,'..')
const window=new Window({url:'http://localhost:3000'})
const document=window.document
let temporary,dispose
function wheel(target,options={}) {
  const event=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,...options})
  for(const key of ['ctrlKey','shiftKey'])Object.defineProperty(event,key,{value:Boolean(options[key])})
  target.dispatchEvent(event)
  return event
}
function dimensions(element,width,height,scrollWidth,scrollHeight) {
  for(const [key,value]of Object.entries({clientWidth:width,clientHeight:height,scrollWidth,scrollHeight}))Object.defineProperty(element,key,{configurable:true,value})
}

before(async()=>{
  globalThis.window=window
  globalThis.defineNuxtPlugin=plugin=>plugin
  temporary=await mkdtemp(resolve(root,'node_modules/.cache/history-swipe-'))
  const output=resolve(temporary,'plugin.mjs')
  await build({entryPoints:[resolve(root,'app/plugins/history-swipe.client.ts')],outfile:output,bundle:true,platform:'node',format:'esm',alias:{'~':resolve(root,'app')}})
  const plugin=(await import(pathToFileURL(output).href)).default
  assert.equal(plugin.enforce,'pre')
  plugin.setup({vueApp:{onUnmount(callback){dispose=callback}}})
  dimensions(document.documentElement,1200,800,1200,2400)
  Object.defineProperty(document,'scrollingElement',{configurable:true,value:document.documentElement})
  const style=document.createElement('style')
  style.textContent=await readFile(resolve(root,'app/assets/css/main.css'),'utf8')
  document.head.appendChild(style)
})
after(async()=>{dispose?.();await window.happyDOM.close();if(temporary)await rm(temporary,{recursive:true,force:true})})

test('the app claims initial events on every page, including zero movement, while leaving pinch gestures alone',()=>{
  for(const [deltaX,deltaY]of [[0,0],[0,30],[-40,0],[40,1]])assert.equal(wheel(document.body,{deltaX,deltaY}).defaultPrevented,true)
  assert.equal(wheel(document.body,{ctrlKey:true,deltaY:-20}).defaultPrevented,false)
  assert.equal(window.getComputedStyle(document.documentElement).overscrollBehaviorX,'none')
  assert.equal(window.getComputedStyle(document.body).overscrollBehaviorX,'none')
})
test('home page vertical scrolling is preserved without double scrolling or freezing at the viewport',()=>{
  document.documentElement.scrollTop=0
  assert.equal(wheel(document.body,{deltaY:40}).defaultPrevented,true)
  assert.equal(document.documentElement.scrollTop,40)
  wheel(document.body,{deltaX:1,deltaY:30})
  assert.equal(document.documentElement.scrollTop,70)
  wheel(document.body,{deltaY:1,deltaMode:2})
  assert.equal(document.documentElement.scrollTop,870)
  wheel(document.body,{deltaY:9999})
  assert.equal(document.documentElement.scrollTop,1600)
  wheel(document.body,{deltaY:9999})
  assert.equal(document.documentElement.scrollTop,1600)
})
test('nested vertical and horizontal scrollers move once and containment prevents scrolling the page behind a dialog',()=>{
  document.documentElement.scrollTop=0
  const panel=document.createElement('div');panel.style.cssText='overflow:auto;overscroll-behavior:contain';document.body.appendChild(panel)
  dimensions(panel,100,80,500,300)
  wheel(panel,{deltaY:35});assert.equal(panel.scrollTop,35);assert.equal(document.documentElement.scrollTop,0)
  panel.scrollLeft=100;wheel(panel,{deltaX:-25});assert.equal(panel.scrollLeft,75)
  wheel(panel,{deltaY:25,shiftKey:true});assert.equal(panel.scrollLeft,100)
  panel.scrollTop=220;wheel(panel,{deltaY:50});assert.equal(panel.scrollTop,220);assert.equal(document.documentElement.scrollTop,0)
  panel.scrollLeft=0;assert.equal(wheel(panel,{deltaX:-500}).defaultPrevented,true);assert.equal(panel.scrollLeft,0)
  panel.remove()
})
test('one application listener survives home/canvas/editor DOM replacement and is removed only when the app shuts down',()=>{
  for(const page of ['home','canvas','editor','home','canvas']) {
    document.body.replaceChildren()
    const node=document.createElement('main');node.className=`test-${page}`;document.body.appendChild(node)
    const event=wheel(node,{deltaX:-100});assert.equal(event.defaultPrevented,true)
  }
  dispose()
  assert.equal(wheel(document.body,{deltaX:-100}).defaultPrevented,false)
  assert.equal(wheel(document.body,{deltaY:40}).defaultPrevented,false)
})
