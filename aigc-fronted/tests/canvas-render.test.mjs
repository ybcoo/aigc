import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import { Window } from 'happy-dom'

const root = resolve(import.meta.dirname, '..')
const window = new Window({ url: 'http://localhost:3000' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'SVGElement', 'Node', 'MouseEvent', 'TouchEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] })
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
window.DOMMatrixReadOnly = class { m22 = 1 }

// A DOM runner has no layout engine; provide node/handle geometry, but use the real Vue Flow renderer.
window.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.classList.contains('vue-flow__node')) {
    const [, x = 0, y = 0] = this.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/) || []
    const panel = this.querySelector('.canvas-node')
    const [ratioWidth, ratioHeight] = (panel?.style.aspectRatio || '').split('/').map(Number)
    const width = panel?.classList.contains('canvas-node--shot-script') ? 264 : 236
    const height = ratioWidth > 0 && ratioHeight > 0 ? width * ratioHeight / ratioWidth : 196
    return new window.DOMRect(Number(x), Number(y), width, height)
  }
  if (this.classList.contains('vue-flow__handle')) {
    const node = this.closest('.vue-flow__node').getBoundingClientRect()
    if (this.classList.contains('is-active')) return node
    const size = this.classList.contains('canvas-handle--internal') ? 6 : 56
    const x = this.dataset.handlepos === 'right' ? node.right - size / 2 : node.left - size / 2
    return new window.DOMRect(x, node.top + node.height / 2 - size / 2, size, size)
  }
  return new window.DOMRect(0, 0, 1280, 800)
}
for (const [property, dimension] of [['offsetWidth', 'width'], ['offsetHeight', 'height'], ['clientWidth', 'width'], ['clientHeight', 'height']]) {
  Object.defineProperty(window.HTMLElement.prototype, property, { get() { return this.getBoundingClientRect()[dimension] } })
}
globalThis.ResizeObserver = window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set() }
  observe(target) {
    this.targets.add(target)
    queueMicrotask(() => { if (this.targets.has(target)) this.callback([{ target }]) })
  }
  unobserve(target) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
}

const fixture = {
  project: { id: 'project', title: 'Canvas regression', episodeCount: 1, episodes: [{ episodeNumber: 1, title: 'Episode 1' }] },
  episodeNumber: 1,
  assets: [
    { id: 'actor', kind: 'character', name: 'Actor', description: 'Actor description', imageUrl: 'https://example.com/actor.png', aspectRatio: '1:1' },
    { id: 'scene', kind: 'scene', name: 'Scene', imageUrl: 'https://example.com/scene.png', aspectRatio: '1:1' },
    { id: 'prop', kind: 'prop', name: 'Prop', imageUrl: 'https://example.com/prop.png', aspectRatio: '1:1' },
    { id: 'empty', kind: 'character', name: 'Empty actor', imageUrl: '', aspectRatio: '1:1' },
  ],
  textNodes: [{ id: 'text', title: 'Text', content: 'Connected text becomes the prompt', prompt: 'Write text' }, { id: 'empty-text', title: 'Empty text', content: '', prompt: '' }], referenceNodes: [], audioNodes: [], layouts: [], jobs: [],
  shots: [{ id: 'shot', title: 'Shot', aspectRatio: '16:9', storyboardScript: 'Shot script', videoUrl: 'https://example.com/video.mp4', duration: 5, canvasVideoNode: false }],
  links: [
    { id: 'actor-scene', sourceKind: 'character', sourceId: 'actor', targetKind: 'scene', targetId: 'scene' },
    { id: 'scene-shot', sourceKind: 'scene', sourceId: 'scene', targetKind: 'shot', targetId: 'shot' },
  ],
}
let records, requests, app, store, tempDir, vue, Workspace
let holdNextSubmission = false, releaseSubmission
let rejectNextTextSave = false
let rejectNextProjectRename = false
let rejectNextEpisode = false, holdEpisode = false, releaseEpisode
let linkSequence = 0
let holdNextLink = false, releaseLink
let scriptFixtures = false, requestedEpisode = 1
const generatedJobs = new Map()

function canvasResponse() {
  const data = structuredClone(records)
  if (scriptFixtures) {
    data.episodeNumber = requestedEpisode
    data.assets = data.assets.filter(asset => asset.episodeNumbers?.includes(requestedEpisode))
    data.links = data.links.filter(link => link.episodeNumber === requestedEpisode)
    data.jobs = [...generatedJobs.values()].filter(job => job.episodeNumber === requestedEpisode).map(job => structuredClone(job))
  }
  data.contexts = {}
  const normalized = kind => kind === 'shot' ? 'video' : kind
  for (const link of data.links) {
    const key = `${normalized(link.targetKind)}:${link.targetId}`
    const context = data.contexts[key] ||= { references: [], textPrompt: '' }
    if (link.sourceKind === 'text') {
      context.textPrompt = [context.textPrompt, data.textNodes.find(node => node.id === link.sourceId)?.content || ''].filter(Boolean).join('\n\n')
      continue
    }
    const kind = normalized(link.sourceKind) === 'video' ? 'video' : link.sourceKind === 'audio' ? 'audio' : 'image'
    const source = [...data.assets, ...data.referenceNodes, ...data.audioNodes, ...data.shots].find(node => node.id === link.sourceId)
    const url = source && (kind === 'video' ? source.videoUrl : kind === 'audio' ? source.audioUrl : source.imageUrl)
    if (url && !context.references.some(reference => reference.sourceKey === `${normalized(link.sourceKind)}:${link.sourceId}`)) {
      const number = context.references.filter(reference => reference.kind === kind).length + 1
      context.references.push({ id: link.id, sourceKey: `${normalized(link.sourceKind)}:${link.sourceId}`, kind, token: `@${{image:'图片',video:'视频',audio:'音色'}[kind]}${number}`, name: source.name || source.title, url })
    }
  }
  return { data }
}

function nodeElement(id) {
  return [...document.querySelectorAll('.vue-flow__node')].find(element => element.dataset.id === id)
}

async function settle(delay = 80) {
  if (delay > 80) await new Promise(resolve => setTimeout(resolve, delay - 80))
  for (let i = 0; i < 8; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
    await vue.nextTick()
  }
}

function assertVisibleEdges(count) {
  const paths = [...document.querySelectorAll('.canvas-edge-visible')]
  assert.equal(paths.length, count, 'every saved/fixed edge must have a visible SVG path')
  for (const path of paths) {
    assert.equal(path.namespaceURI, 'http://www.w3.org/2000/svg')
    assert.match(path.getAttribute('d'), /^M[-\d.]+,[-\d.]+ C/)
    assert.doesNotMatch(path.getAttribute('d'), /NaN|undefined/)
    assert.ok(Number(path.getAttribute('stroke-width')) > 0)
    assert.ok(path.getAttribute('stroke'))
    for (let element = path; element; element = element.parentElement) {
      const style = window.getComputedStyle(element)
      assert.notEqual(style.display, 'none')
      assert.notEqual(style.visibility, 'hidden')
      assert.notEqual(style.opacity, '0')
    }
  }
}

before(async () => {
  const stylesheet = document.createElement('style')
  stylesheet.textContent = [
    await readFile(resolve(root, 'node_modules/@vue-flow/core/dist/style.css'), 'utf8'),
    await readFile(resolve(root, 'node_modules/@vue-flow/core/dist/theme-default.css'), 'utf8'),
    await readFile(resolve(root, 'app/assets/css/main.css'), 'utf8'),
    await readFile(resolve(root, 'app/assets/css/editor.css'), 'utf8'),
  ].join('\n')
  document.head.appendChild(stylesheet)
  records = structuredClone(fixture)
  requests = []
  globalThis.useRuntimeConfig = () => ({ public: { apiBase: 'http://localhost:3001/api' } })
  globalThis.$fetch = async (url, options = {}) => {
    requests.push({ url, ...options })
    if (url.endsWith('/ai-configs')) return { data: ['text', 'image', 'video'].map(type => ({ id: `config-${type}`, isActive: true, serviceType: type, name: type, models: ['test-model'] })) }
    if (url.includes('/canvas?')) { requestedEpisode = Number(new URL(url).searchParams.get('episode')) || 1; return canvasResponse() }
    if (options.method === 'POST' && url.endsWith('/projects/project/episodes')) {
      if (rejectNextEpisode) { rejectNextEpisode=false; throw Error('新增剧集失败，请重试') }
      if (holdEpisode) { holdEpisode=false; await new Promise(resolve=>{releaseEpisode=resolve}) }
      const episodeNumber=Math.max(...records.project.episodes.map(episode=>episode.episodeNumber))+1
      const episode={id:`new-episode-${episodeNumber}`,episodeNumber,title:`第 ${episodeNumber} 集`,scriptContent:''}
      records.project.episodes.push(episode);records.project.episodeCount++
      return {data:{episode:structuredClone(episode),episodeCount:records.project.episodeCount}}
    }
    if (options.method === 'PUT' && url.endsWith('/projects/project')) {
      if (rejectNextProjectRename) { rejectNextProjectRename=false; throw Error('名称保存失败，请重试') }
      records.project.title=options.body.title
      records.project.updatedAt=new Date().toISOString()
      return { data: { id: records.project.id, title: records.project.title, updatedAt: records.project.updatedAt } }
    }
    if (options.method === 'PUT' && /\/episodes\/\d+\/script$/.test(url)) {
      const episode = Number(url.match(/\/episodes\/(\d+)\/script$/)[1])
      const record = records.project.episodes.find(item => item.episodeNumber === episode)
      record.scriptContent = options.body.content
      if (options.body.genre !== undefined) records.project.genre = options.body.genre
      if (options.body.style !== undefined) records.project.style = options.body.style
      return { data: structuredClone(record) }
    }
    if (options.method === 'POST' && url.endsWith('/script/extract')) {
      const episode = Number(url.match(/\/episodes\/(\d+)\/script/)[1])
      const record = records.project.episodes.find(item => item.episodeNumber === episode)
      const kind = options.body.kind
      const job = { id: `extraction-${generatedJobs.size}`, targetId: `${record.id}:${kind}`, kind: 'canvas_asset_extract', episodeNumber: episode, status: 'running', error: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { ...options.body, nodeKind: 'script', category: kind, nodeTitle: `提取${{ character:'角色',scene:'场景',prop:'道具' }[kind]}`, prompt: record.scriptContent, genre: records.project.genre, style: records.project.style }, result: {} }
      generatedJobs.set(job.id,job)
      return { data: structuredClone(job) }
    }
    if (url.endsWith('/jobs')) return { data: [...generatedJobs.values()].map(job => structuredClone(job)) }
    if (url.endsWith('/nodes/character/actor/versions')) return { data: [
      { id: 'version-current', kind: 'image', url: 'https://example.com/actor.png', source: 'uploaded', isCurrent: true, createdAt: '2026-10-26T00:00:00Z' },
      { id: 'version-old', kind: 'image', url: 'https://example.com/actor-old.png', source: 'generated', isCurrent: false, createdAt: '2026-10-25T00:00:00Z' },
    ] }
    if (url.endsWith('/nodes/character/actor/versions/version-old/restore') && options.method === 'POST') {
      const actor = records.assets.find(asset => asset.id === 'actor')
      actor.imageUrl = 'https://example.com/actor-old.png'
      actor.aspectRatio = '9:16'
      return { data: actor }
    }
    if (options.method === 'POST' && url.endsWith('/links')) {
      const link = { ...options.body, id: linkSequence++ ? `new-link-${linkSequence}` : 'new-link' }
      records.links.push(link)
      if (link.sourceKind === 'text') {
        const target = [...records.assets, ...records.referenceNodes, ...records.textNodes, ...records.shots].find(node => node.id === link.targetId)
        const field = ['video', 'shot'].includes(link.targetKind) ? 'universalPrompt' : 'prompt'
        if (target && !target[field]?.trim()) target[field] = canvasResponse().data.contexts[`${link.targetKind === 'shot' ? 'video' : link.targetKind}:${link.targetId}`]?.textPrompt || ''
      }
      if (holdNextLink) {
        holdNextLink = false
        await new Promise(resolve => { releaseLink = resolve })
      }
      return { data: link }
    }
    if (options.method === 'POST' && url.split('?')[0].endsWith('/references/image')) {
      const node = { id: 'uploaded-reference', name: 'Uploaded reference', imageUrl: 'https://example.com/uploaded.png', aspectRatio: '1:1' }
      records.referenceNodes.push(node)
      const [kind, nodeId] = url.split('/nodes/')[1].split('/')
      records.links.push({ id: 'uploaded-reference-link', sourceKind: 'image', sourceId: node.id, targetKind: kind, targetId: nodeId })
      return { data: { node } }
    }
    if (options.method === 'POST' && url.endsWith('/generate')) {
      const [kind, nodeId] = url.split('/nodes/')[1].split('/')
      const context = canvasResponse().data.contexts[`${kind}:${nodeId}`]
      const references = (context?.references || []).filter(reference => (options.body.prompt.match(/@(图片|视频|音色)\d+/g) || []).includes(reference.token))
      const node = [...records.assets, ...records.textNodes, ...records.shots].find(node => node.id === nodeId)
      const job = { id: `job-${generatedJobs.size}`, targetId: nodeId, status: 'running', kind: `canvas_${kind === 'text' ? 'text' : kind === 'video' ? 'video' : 'image'}`, episodeNumber: 1, error: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), references: structuredClone(references), input: { ...options.body, nodeKind: kind, nodeTitle: node?.name || node?.title || nodeId, model: 'test-model' } }
      generatedJobs.set(job.id, job)
      if (holdNextSubmission) {
        holdNextSubmission = false
        await new Promise(resolve => { releaseSubmission = resolve })
      }
      return { data: structuredClone(job) }
    }
    if (url.includes('/jobs/')) {
      const id = url.split('/jobs/')[1].split('/')[0]
      const job = generatedJobs.get(id)
      if (url.endsWith('/cancel')) { job.status = 'cancelled'; job.updatedAt = new Date().toISOString() }
      return { data: { ...job } }
    }
    if (options.method === 'PUT' && url.endsWith('/layout')) return { data: {} }
    if (options.method === 'PUT' && url.includes('/nodes/')) {
      if (rejectNextTextSave && url.includes('/nodes/text/')) {
        rejectNextTextSave = false
        throw new Error('Text save temporarily failed')
      }
      const id = url.split('/').at(-1)
      const node = [...records.assets, ...records.referenceNodes, ...records.textNodes, ...records.shots].find(node => node.id === id)
      Object.assign(node, options.body)
      return { data: node }
    }
    if (options.method === 'DELETE' && url.includes('/links/')) {
      records.links = records.links.filter(link => !url.endsWith(`/${link.id}`))
      return { data: {} }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  tempDir = await mkdtemp(resolve(root, 'node_modules/.cache/canvas-render-'))
  const outfile = resolve(tempDir, 'workspace.mjs')
  await build({
    entryPoints: [resolve(root, 'app/components/canvas/CanvasWorkspace.vue')], outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{
      name: 'compile-nuxt-vue-for-dom-test',
      setup(builder) {
        builder.onResolve({ filter: /^~\// }, args => ({ path: resolve(root, 'app', args.path.slice(2) + (args.path.endsWith('.vue') ? '' : '.ts')) }))
        builder.onLoad({ filter: /\.vue$/ }, async args => {
          const source = (await readFile(args.path, 'utf8')).replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { ref, computed, reactive, watch, nextTick, onMounted, onBeforeUnmount } from "vue";')
          const { descriptor } = parse(source, { filename: args.path })
          const script = compileScript(descriptor, { id: args.path, inlineTemplate: true })
          return { contents: script.content, loader: 'ts', resolveDir: dirname(args.path) }
        })
      },
    }],
  })
  vue = await import('vue')
  Workspace = (await import(pathToFileURL(outfile).href)).default
  await mountWorkspace()
})

async function mountWorkspace() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = vue.createApp({ render: () => vue.h(Workspace, { projectId: 'project' }) })
  app.component('NuxtLink', { props: ['to'], render() { return vue.h('a', { href: this.to }, this.$slots.default?.()) } })
  app.config.warnHandler = () => {}
  app.mount(host)
  await settle()
  // Obtain the store created by the mounted workspace, without replacing Vue Flow.
  const candidates = []
  function visit(instance) {
    if (!instance) return
    if (instance.type?.name === 'VueFlow') candidates.push(instance)
    const tree = instance.subTree
    if (tree?.component) visit(tree.component)
    for (const child of Array.isArray(tree?.children) ? tree.children : []) visitVNode(child)
  }
  function visitVNode(vnode) {
    if (vnode?.component) visit(vnode.component)
    for (const child of Array.isArray(vnode?.children) ? vnode.children : []) visitVNode(child)
  }
  visit(app._instance)
  assert.equal(candidates.length, 1)
  store = Object.getOwnPropertySymbols(candidates[0].provides)
    .map(key => candidates[0].provides[key]).find(value => value?.getNodes && value?.setEdges)
  assert.ok(store?.getNodes.value.length)
}

after(async () => {
  app?.unmount()
  await window.happyDOM.close()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

test('saved references render while old storyboards are displayed as single video nodes', async () => {
  assert.equal(store.isValidConnection.value, null, 'interactive rules must not filter edges loaded into the store')
  assertVisibleEdges(2)
  store.setEdges([...store.edges.value])
  await settle()
  assertVisibleEdges(2)
  assert.equal(nodeElement('shot:shot'), undefined)
  assert.equal(nodeElement('shot-script:shot'), undefined)
  assert.ok(nodeElement('video:shot'))
  assert.equal(document.querySelectorAll('.canvas-node--image').length, 4)
})

test('canvas title edits save independently, support blank names and retain drafts on errors',async()=>{
  const open=async()=>{document.querySelector('[aria-label="编辑剧本名称"]').click();await settle();return document.querySelector('[aria-label="剧本名称"]')}
  let input=await open();assert.equal(input.value,records.project.title)
  input.value='我自己的故事';input.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  const canvasReads=requests.filter(request=>request.url.includes('/canvas?')).length
  document.querySelector('.project-title-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle()
  assert.equal(records.project.title,'我自己的故事');assert.match(document.querySelector('[aria-label="编辑剧本名称"]').textContent,/我自己的故事/)
  assert.equal(requests.filter(request=>request.url.includes('/canvas?')).length,canvasReads)
  input=await open();input.value='不保存的名字';input.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();assert.equal(records.project.title,'我自己的故事')
  input=await open();input.value='';input.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  input.dispatchEvent(new window.FocusEvent('blur'));await settle()
  assert.equal(records.project.title,'');assert.equal(document.querySelector('[aria-label="编辑剧本名称"]').textContent.trim(),'未命名')
  input=await open();assert.equal(input.value,'');assert.equal(input.placeholder,'未命名')
  input.value='保存失败时保留草稿';input.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  rejectNextProjectRename=true;document.querySelector('.project-title-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle()
  assert.equal(document.querySelector('[aria-label="剧本名称"]').value,'保存失败时保留草稿');assert.match(document.querySelector('.project-title-error').textContent,/保存失败/);assert.equal(records.project.title,'')
  input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle()
})

test('bottom toolbar is one source-aligned control strip with a current-episode video editor entry', async () => {
  const toolbar = document.querySelector('.canvas-toolbar')
  assert.ok(['#fff', 'rgb(255, 255, 255)'].includes(window.getComputedStyle(toolbar).backgroundColor))
  assert.equal(window.getComputedStyle(toolbar.querySelector('.segmented-tools')).borderTopWidth, '0px')
  assert.equal(toolbar.querySelector('.canvas-toolbar-edit').getAttribute('href'), '/projects/project?view=edit&episode=1')
  toolbar.querySelector('.add-node-button').click()
  await vue.nextTick()
  assert.equal(window.getComputedStyle(toolbar.querySelector('.add-node-menu')).gridTemplateColumns, '1fr')
  assert.equal(toolbar.querySelectorAll('.add-node-menu button').length, 4)
  toolbar.querySelector('[title="选择与框选"]').click()
  await vue.nextTick()
  assert.equal(toolbar.querySelector('.add-node-menu'), null)
})

test('dragging creates a visible reference edge that survives reload and can be disconnected', async () => {
  const source = nodeElement('character:actor').querySelector('[data-handleid="right"]')
  const targetNode = nodeElement('prop:prop')
  const point = targetNode.getBoundingClientRect()
  const mouse = (name, target) => target.dispatchEvent(new window.MouseEvent(name, { bubbles: true, button: 0, clientX: point.left + 100, clientY: point.top + 100, view: window }))
  document.elementFromPoint = () => targetNode.querySelector('[data-handleid="node-drop"]')
  document.elementsFromPoint = () => [targetNode]
  mouse('mousedown', source)
  await vue.nextTick()
  mouse('mousemove', document)
  mouse('mouseup', document)
  await settle()
  assert.equal(requests.filter(request => request.method === 'POST').length, 1)
  assertVisibleEdges(3)
  assert.ok(document.getElementById('new-link'))
  const edge = document.getElementById('new-link').closest('.vue-flow__edge')
  edge.querySelector('.canvas-edge-hitbox').dispatchEvent(new window.PointerEvent('pointerenter'))
  await vue.nextTick()
  const remove = document.querySelector('[aria-label="解除节点关联"]')
  assert.ok(remove, 'hovering the line must expose the disconnect control')
  remove.click()
  await settle()
  assertVisibleEdges(2)
})

test('left-to-right drag preserves direction and duplicate validation does not erase saved edges', async () => {
  const source = nodeElement('scene:scene').querySelector('[data-handleid="left"]')
  const targetNode = nodeElement('prop:prop')
  const point = targetNode.getBoundingClientRect()
  document.elementFromPoint = () => targetNode.querySelector('[data-handleid="right"]')
  document.elementsFromPoint = () => [targetNode]
  async function drag() {
    source.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 360, clientY: 180, view: window }))
    await vue.nextTick()
    for (const name of ['mousemove', 'mouseup']) {
      document.dispatchEvent(new window.MouseEvent(name, { bubbles: true, button: 0, clientX: point.right, clientY: point.top + 100, view: window }))
    }
    await settle()
  }
  const originalCount = requests.filter(request => request.method === 'POST').length
  await drag()
  assertVisibleEdges(3)
  const request = requests.filter(request => request.method === 'POST').at(-1)
  assert.equal(request.body.sourceKind, 'prop')
  assert.equal(request.body.targetKind, 'scene')
  await drag()
  assert.equal(requests.filter(request => request.method === 'POST').length, originalCount + 1)
  assertVisibleEdges(3)
  assert.match(document.querySelector('.canvas-error').textContent, /已经连接/)
  store.setEdges([...store.edges.value])
  await settle()
  assertVisibleEdges(3)
})

test('image loading is separate from generation status, and a failed load can retry without regenerating', async () => {
  const node = nodeElement('scene:scene')
  let image = node.querySelector('.node-body img')
  const url = image.src
  assert.match(node.querySelector('.node-image-state').textContent, /图片加载中/)
  image.dispatchEvent(new window.Event('error'))
  await vue.nextTick()
  assert.match(node.querySelector('.node-image-state').textContent, /图片加载失败/)
  const count = requests.length
  node.querySelector('.node-image-state button').click()
  await vue.nextTick()
  const retry = node.querySelector('.node-body img')
  assert.notEqual(retry, image)
  assert.equal(retry.src, url)
  assert.match(node.querySelector('.node-image-state').textContent, /图片加载中/)
  assert.equal(requests.length, count)
  retry.dispatchEvent(new window.Event('load'))
  await vue.nextTick()
  assert.equal(node.querySelector('.node-image-state'), null)
  assert.equal(retry.style.visibility, 'visible')
  const canvasNode = store.nodes.value.find(item => item.id === 'scene:scene')
  canvasNode.data = { ...canvasNode.data, mediaUrl: 'https://example.com/new-scene.png' }
  await vue.nextTick()
  assert.match(node.querySelector('.node-image-state').textContent, /图片加载中/)
  node.querySelector('.node-body img').dispatchEvent(new window.Event('load'))
  await vue.nextTick()
  assert.equal(node.querySelector('.node-image-state'), null)
});

test('media fills each node with its intrinsic aspect ratio and details stay behind the info button', async () => {
  const node = nodeElement('character:actor')
  const panel = node.querySelector('.canvas-node')
  const image = node.querySelector('.node-body img')
  assert.equal(node.querySelector('.node-header'), null)
  assert.equal(node.querySelector('.node-title'), null)
  assert.ok(!node.textContent.includes('Actor description'))
  assert.match(nodeElement('character:empty').querySelector('.node-empty').textContent, /暂无/)
  assert.equal(window.getComputedStyle(node.querySelector('.node-body')).position, 'absolute')
  for (const [width, height] of [[900, 1600], [1600, 900], [1000, 1000], [1600, 1200]]) {
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height })
    image.dispatchEvent(new window.Event('load'))
    await vue.nextTick()
    assert.equal(panel.style.aspectRatio, `${width} / ${height}`)
  }
  const menuPosition = window.getComputedStyle(node.querySelector('.node-source'))
  const detailPosition = window.getComputedStyle(node.querySelector('.node-detail-button'))
  assert.equal(menuPosition.left, '8px')
  assert.equal(menuPosition.bottom, '8px')
  assert.equal(detailPosition.right, '8px')
  assert.equal(detailPosition.top, '8px')
  node.querySelector('[aria-label="查看详情"]').click()
  await vue.nextTick()
  assert.match(document.querySelector('.node-detail-dialog').textContent, /Actor description/)
  document.querySelector('.node-detail-dialog footer button').click()
  const videoNode = nodeElement('video:shot')
  const video = videoNode.querySelector('video')
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1080 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1920 })
  video.dispatchEvent(new window.Event('loadedmetadata'))
  await vue.nextTick()
  assert.equal(videoNode.querySelector('.canvas-node').style.aspectRatio, '1080 / 1920')
})

test('video nodes play with sound in place, pause and retry without selecting or dragging the node', async () => {
  const node = nodeElement('video:shot'), video = node.querySelector('.node-body video')
  const selectedBefore = store.getSelectedNodes.value.map(node => node.id)
  const agentsBefore = document.querySelectorAll('.node-agent').length
  const originalUrl = video.getAttribute('src')
  let paused = true, playCalls = 0, pauseCalls = 0, bubbledPointerDown = 0
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
  video.play = async () => { playCalls++; paused = false; video.dispatchEvent(new window.Event('play')) }
  video.pause = () => { pauseCalls++; paused = true; video.dispatchEvent(new window.Event('pause')) }
  const onPointerDown = () => { bubbledPointerDown++ }
  node.addEventListener('pointerdown', onPointerDown)
  try {
    assert.equal(video.hasAttribute('muted'), false)
    assert.equal(video.hasAttribute('autoplay'), false)
    assert.equal(window.getComputedStyle(video).pointerEvents, 'none')
    let button = node.querySelector('[aria-label="播放视频"]')
    assert.ok(button.classList.contains('nodrag') && button.classList.contains('nopan'))
    button.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    button.click(); await vue.nextTick(); await vue.nextTick()
    assert.equal(playCalls, 1); assert.equal(paused, false); assert.equal(bubbledPointerDown, 0)
    assert.ok(node.querySelector('[aria-label="暂停视频"]'))
    assert.deepEqual(store.getSelectedNodes.value.map(node => node.id), selectedBefore)
    assert.equal(document.querySelectorAll('.node-agent').length, agentsBefore)
    assert.equal(document.querySelector('.canvas-media-preview'), null)
    node.querySelector('[aria-label="暂停视频"]').click(); await vue.nextTick()
    assert.equal(paused, true); assert.equal(pauseCalls, 1)
    video.play = async () => { throw Error('Cannot play') }
    node.querySelector('[aria-label="播放视频"]').click(); await vue.nextTick(); await vue.nextTick()
    assert.match(node.querySelector('.node-video-error').textContent, /播放失败/)
    video.play = async () => { paused = false; video.dispatchEvent(new window.Event('play')) }
    node.querySelector('[aria-label="播放视频"]').click(); await vue.nextTick(); await vue.nextTick()
    assert.equal(node.querySelector('.node-video-error'), null)
    video.dispatchEvent(new window.Event('ended')); paused = true; await vue.nextTick()
    assert.ok(node.querySelector('[aria-label="播放视频"]'))
    let rejectPlay
    video.play = () => new Promise((_resolve, reject) => { rejectPlay = reject })
    node.querySelector('[aria-label="播放视频"]').click(); await vue.nextTick()
    node.querySelector('[aria-label="暂停视频"]').click(); await vue.nextTick()
    rejectPlay(Error('Interrupted by pause')); await vue.nextTick(); await vue.nextTick()
    assert.equal(node.querySelector('.node-video-error'), null)
    store.updateNodeData('video:shot', { mediaUrl: 'https://example.com/replaced-video.mp4' }); await vue.nextTick(); await vue.nextTick()
    assert.ok(pauseCalls >= 3)
    assert.equal(node.querySelector('video').getAttribute('src'), 'https://example.com/replaced-video.mp4')
    assert.ok(node.querySelector('[aria-label="播放视频"]'))
  } finally {
    node.removeEventListener('pointerdown', onPointerDown)
    store.updateNodeData('video:shot', { mediaUrl: originalUrl }); await vue.nextTick()
  }
})

test('upload opens a source menu and history selection restores the node without losing edges', async () => {
  const node = nodeElement('character:actor')
  const input = node.querySelector('input[type="file"]')
  let filePickerCalls = 0
  input.click = () => { filePickerCalls += 1 }
  const upload = node.querySelector('[aria-label="更换素材"]')
  upload.click()
  await vue.nextTick()
  assert.equal(filePickerCalls, 0)
  let menuItems = node.querySelectorAll('[role="menuitem"]')
  assert.equal(menuItems.length, 2)
  assert.match(menuItems[0].textContent, /上传图片/)
  assert.match(menuItems[1].textContent, /选择历史版本/)
  menuItems[0].click()
  assert.equal(filePickerCalls, 1)
  upload.click()
  await vue.nextTick()
  menuItems = node.querySelectorAll('[role="menuitem"]')
  menuItems[1].click()
  await settle()
  const dialog = document.querySelector('.media-history-dialog')
  assert.ok(dialog)
  assert.equal(dialog.querySelectorAll('.media-version').length, 2)
  assert.ok(dialog.querySelector('.is-current button').disabled)
  dialog.querySelector('.media-version:not(.is-current) button').click()
  await settle()
  assert.equal(document.querySelector('.media-history-dialog'), null)
  assert.equal(nodeElement('character:actor').querySelector('.node-body img').src, 'https://example.com/actor-old.png')
  assertVisibleEdges(3)
})

test('connecting text fills the downstream prompt and manual edits survive closing the agent', async () => {
  const sourceNode = nodeElement('text:text')
  const targetNode = nodeElement('character:empty')
  const source = sourceNode.querySelector('[data-handleid="right"]')
  const point = targetNode.getBoundingClientRect()
  document.elementFromPoint = () => targetNode.querySelector('[data-handleid="node-drop"]')
  document.elementsFromPoint = () => [targetNode]
  source.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, view: window }))
  await vue.nextTick()
  for (const type of ['mousemove', 'mouseup']) document.dispatchEvent(new window.MouseEvent(type, { bubbles: true, button: 0, clientX: point.left + 20, clientY: point.top + 30, view: window }))
  await settle()
  store.addSelectedNodes([store.findNode('character:empty')])
  await settle()
  let textarea = nodeElement('character:empty').querySelector('.mention-textarea')
  assert.equal(textarea.value, 'Connected text becomes the prompt')
  textarea.value = 'User can freely edit this prompt'
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
  await vue.nextTick()
  store.removeSelectedNodes([store.findNode('character:empty')])
  await settle()
  store.addSelectedNodes([store.findNode('character:empty')])
  await settle()
  textarea = nodeElement('character:empty').querySelector('.mention-textarea')
  assert.equal(textarea.value, 'User can freely edit this prompt')
})

test('agent reference upload creates a connected image node, mentions are sent and cancellation survives reopening', async () => {
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('character:actor')])
  await settle()
  const beforeEdges = store.edges.value.length
  const oldImage = nodeElement('character:actor').querySelector('.node-body img').src
  const fileInput = nodeElement('character:actor').querySelector('.node-agent input[type="file"]')
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new window.File(['mock'], 'reference.png', { type: 'image/png' })] })
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }))
  await settle()
  assert.ok(nodeElement('image:uploaded-reference'))
  assert.equal(store.edges.value.length, beforeEdges + 1)
  assert.equal(nodeElement('character:actor').querySelector('.node-body img').src, oldImage)
  store.addSelectedNodes([store.findNode('character:actor')])
  await settle()
  let agent = nodeElement('character:actor').querySelector('.node-agent')
  assert.equal(agent.querySelectorAll('.agent-reference').length, 1)
  agent.querySelector('.agent-reference > button').click()
  await vue.nextTick()
  assert.match(agent.querySelector('textarea').value, /@图片1/)
  assert.match(agent.querySelector('.mention-token').textContent, /@图片1/)
  agent.querySelector('[title="发送并生成"]').click()
  await settle()
  const request = requests.findLast(request => request.url.endsWith('/generate'))
  assert.match(request.body.prompt, /@图片1/)
  assert.equal(request.body.modelId, 'config-image:test-model')
  assert.ok(nodeElement('character:actor').querySelector('.node-uploading'))
  store.removeSelectedNodes()
  await settle()
  store.addSelectedNodes([store.findNode('character:actor')])
  await settle()
  agent = nodeElement('character:actor').querySelector('.node-agent')
  assert.ok(agent.querySelector('[title="中断生成"]'))
  assert.match(agent.querySelector('textarea').value, /@图片1/)
  agent.querySelector('[title="中断生成"]').click()
  await settle()
  assert.ok(agent.querySelector('[title="发送并生成"]'))
  agent.querySelector('.agent-reference-remove').click()
  await settle()
  assert.equal(store.edges.value.length, beforeEdges)
  assert.ok(nodeElement('image:uploaded-reference'), 'disconnecting keeps the reference node available for reuse')
  assert.equal(nodeElement('character:actor').querySelectorAll('.agent-reference').length, 0)
})

test('agent layout matches the source structure and can expand, close and reopen without clearing drafts', async () => {
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('character:actor')])
  await settle()
  let agent = nodeElement('character:actor').querySelector('.node-agent')
  assert.match(agent.querySelector('.agent-header').textContent, /图片 AI/)
  assert.ok(agent.querySelector('.agent-composer .agent-reference-add'))
  assert.ok(agent.querySelector('.agent-input-row .mention-input'))
  assert.ok(agent.querySelector('.agent-input-row .agent-send'))
  assert.equal(agent.querySelector('.agent-footer'), null)
  assert.equal(agent.querySelector('.agent-options').querySelectorAll('.app-select').length, 2)
  assert.equal(window.getComputedStyle(agent.querySelector('.agent-options .app-select')).flexBasis, 'auto')
  assert.equal(window.getComputedStyle(agent.querySelector('.agent-send')).width, '40px')
  agent.querySelector('[title="放大智能体"]').click()
  await vue.nextTick()
  assert.ok(agent.classList.contains('is-expanded'))
  assert.ok(Math.abs(Number.parseFloat(window.getComputedStyle(agent).height) - window.innerHeight * 0.8) < 0.01)
  const draft = agent.querySelector('textarea').value
  agent.querySelector('[title="收起智能体"]').click()
  await settle()
  assert.equal(nodeElement('character:actor').querySelector('.node-agent'), null)
  store.addSelectedNodes([store.findNode('character:actor')])
  await settle()
  agent = nodeElement('character:actor').querySelector('.node-agent')
  assert.equal(agent.querySelector('textarea').value, draft)

  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('video:shot')])
  await settle()
  agent = nodeElement('video:shot').querySelector('.node-agent')
  assert.equal(agent.querySelector('.agent-options').querySelectorAll('.app-select').length, 1)
  agent.querySelector('[title="视频设置"]').click()
  await vue.nextTick()
  assert.equal(agent.querySelectorAll('.agent-settings-popover .app-select').length, 3)
})

test('task menu displays immutable submitted references after the live connection was removed', async () => {
  document.querySelector('[title="查看生成任务"]').click()
  await settle()
  const panel = document.querySelector('.canvas-tasks')
  assert.ok(panel)
  const rows = panel.querySelectorAll('.task-row')
  assert.ok(rows.length > 0)
  rows[0].querySelector('.task-text-button').click()
  await vue.nextTick()
  assert.equal(panel.querySelectorAll('.task-reference').length, 1)
  assert.match(panel.querySelector('.task-reference').textContent, /@图片1/)
  assert.match(panel.querySelector('.task-detail-section pre').textContent, /@图片1/)
  panel.querySelector('.task-reference').click()
  await vue.nextTick()
  assert.ok(document.querySelector('.canvas-media-preview img').src.includes('uploaded.png'))
  document.querySelector('.canvas-media-preview').click()
  panel.querySelector('[title="关闭任务菜单"]').click()
  await settle()
})

test('two nodes generate independently and stopping one leaves the other running with its draft intact', async () => {
  for (const id of ['text:text', 'character:empty']) {
    store.removeSelectedNodes()
    store.addSelectedNodes([store.findNode(id)])
    await settle()
    const agent = nodeElement(id).querySelector('.node-agent')
    agent.querySelector('[title="发送并生成"]').click()
    await settle()
  }
  assert.ok(nodeElement('text:text').querySelector('.node-uploading'))
  assert.ok(nodeElement('character:empty').querySelector('.node-uploading'))
  store.removeSelectedNodes()
  await settle()
  store.addSelectedNodes([store.findNode('text:text')])
  await settle()
  let agent = nodeElement('text:text').querySelector('.node-agent')
  assert.equal(agent.querySelector('textarea').value, 'Write text')
  agent.querySelector('[title="中断生成"]').click()
  await settle()
  assert.equal(nodeElement('text:text').querySelector('.node-uploading'), null)
  assert.ok(nodeElement('character:empty').querySelector('.node-uploading'))
  document.querySelector('[title="查看生成任务"]').click()
  await settle()
  const row = [...document.querySelectorAll('.task-row')].find(element => element.textContent.includes('Empty actor'))
  assert.ok(row)
  row.querySelectorAll('.task-text-button')[1].click()
  await settle()
  assert.equal(nodeElement('character:empty').querySelector('.node-uploading'), null)
  document.querySelector('[title="关闭任务菜单"]').click()
  app.unmount()
  await mountWorkspace()
  store.addSelectedNodes([store.findNode('character:empty')])
  await settle()
  agent = nodeElement('character:empty').querySelector('.node-agent')
  assert.equal(agent.querySelector('textarea').value, 'User can freely edit this prompt')
})

test('finishing one task refreshes its node without clearing a selected agent or another unsent draft', async () => {
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('text:text')])
  await settle()
  let agent = nodeElement('text:text').querySelector('.node-agent')
  const input = agent.querySelector('textarea')
  input.value = 'Keep this draft after generation finishes'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await vue.nextTick()
  agent.querySelector('[title="发送并生成"]').click()
  await settle()
  const job = [...generatedJobs.values()].at(-1)
  job.status = 'succeeded'
  job.updatedAt = new Date().toISOString()
  job.result = { content: 'Generated output appears in the node' }
  records.textNodes.find(node => node.id === 'text').content = job.result.content
  document.querySelector('[title="查看生成任务"]').click()
  await settle()
  document.querySelector('[title="关闭任务菜单"]').click()
  await settle()
  agent = nodeElement('text:text').querySelector('.node-agent')
  assert.ok(agent, 'the selected agent remains open after the canvas payload refreshes')
  assert.equal(agent.querySelector('textarea').value, 'Keep this draft after generation finishes')
  assert.match(nodeElement('text:text').querySelector('.node-copy').textContent, /Generated output appears/)
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('character:empty')])
  await settle()
  assert.equal(nodeElement('character:empty').querySelector('textarea').value, 'User can freely edit this prompt')
})

test('interrupting before the create response arrives is remembered and cancels as soon as the task ID is returned', async () => {
  holdNextSubmission = true
  const agent = nodeElement('character:empty').querySelector('.node-agent')
  agent.querySelector('[title="发送并生成"]').click()
  await settle()
  assert.ok(releaseSubmission)
  agent.querySelector('[title="中断生成"]').click()
  await vue.nextTick()
  assert.ok(agent.querySelector('.agent-send').disabled)
  releaseSubmission()
  await settle()
  assert.equal([...generatedJobs.values()].at(-1).status, 'cancelled')
  assert.ok(agent.querySelector('[title="发送并生成"]'))
  assert.equal(agent.querySelector('textarea').value, 'User can freely edit this prompt')
})

test('empty and generated text nodes can be edited manually without overwriting the AI instruction', async () => {
  const generationCount = requests.filter(request => request.url.endsWith('/generate')).length
  for (const id of ['empty-text', 'text']) {
    store.removeSelectedNodes()
    store.addSelectedNodes([store.findNode(`text:${id}`)])
    await settle()
    const node = nodeElement(`text:${id}`)
    const oldInstruction = node.querySelector('.node-agent textarea').value
    const oldContent = records.textNodes.find(item => item.id === id).content
    const edit = node.querySelector('[aria-label="编辑文本"]')
    assert.ok(edit)
    edit.click()
    await settle()
    let dialog = document.querySelector('.text-node-editor')
    assert.ok(dialog)
    assert.equal(dialog.querySelector('textarea').value, oldContent)
    dialog.querySelector('textarea').value = 'Discard this change'
    dialog.querySelector('textarea').dispatchEvent(new window.Event('input', { bubbles: true }))
    dialog.querySelector('.secondary-button').click()
    await settle()
    assert.equal(records.textNodes.find(item => item.id === id).content, oldContent)
    edit.click()
    await settle()
    dialog = document.querySelector('.text-node-editor')
    const nextContent = `Manually written ${id}\nSecond line, preserving whitespace.`
    dialog.querySelector('textarea').value = nextContent
    dialog.querySelector('textarea').dispatchEvent(new window.Event('input', { bubbles: true }))
    await vue.nextTick()
    rejectNextTextSave = true
    dialog.querySelector('.primary-button').click()
    await settle()
    assert.match(dialog.querySelector('[role="alert"]').textContent, /temporarily failed/)
    assert.equal(dialog.querySelector('textarea').value, nextContent)
    dialog.querySelector('.primary-button').click()
    await settle()
    assert.equal(document.querySelector('.text-node-editor'), null)
    assert.equal(records.textNodes.find(item => item.id === id).content, nextContent)
    assert.equal(nodeElement(`text:${id}`).querySelector('.node-copy').textContent.trim(), nextContent)
    assert.equal(nodeElement(`text:${id}`).querySelector('.node-agent textarea').value, oldInstruction)
    const update = requests.findLast(request => request.method === 'PUT' && request.url.endsWith(`/nodes/text/${id}`))
    assert.deepEqual(update.body, { content: nextContent })
  }
  assert.equal(requests.filter(request => request.url.endsWith('/generate')).length, generationCount)
})

test('collapse clicks never bubble to the node selection handler and every agent can be reopened', async () => {
  for (const id of ['character:actor', 'text:text', 'video:shot']) {
    store.removeSelectedNodes()
    store.addSelectedNodes([store.findNode(id)])
    await settle()
    const node = nodeElement(id)
    const prompt = node.querySelector('.node-agent textarea').value
    let bubbled = false
    const reselect = () => { bubbled = true; store.addSelectedNodes([store.findNode(id)]) }
    node.addEventListener('click', reselect)
    node.querySelector('[title="收起智能体"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    await settle()
    assert.equal(bubbled, false, 'collapse must not reselect the node through a bubbling click')
    assert.equal(nodeElement(id).querySelector('.node-agent'), null)
    assert.equal(store.findNode(id).selected, false)
    node.removeEventListener('click', reselect)
    nodeElement(id).querySelector('.node-body').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    await settle()
    assert.ok(nodeElement(id).querySelector('.node-agent'))
    assert.equal(nodeElement(id).querySelector('.node-agent textarea').value, prompt)
  }
})

test('canvas gestures are claimed from their first event without disabling panning, nested scrolling or pinch zoom', async () => {
  assert.ok(document.documentElement.classList.contains('aigc-canvas-page'))
  assert.equal(window.getComputedStyle(document.documentElement).overscrollBehavior, 'none')
  const pane = document.querySelector('.vue-flow__pane')
  const before = { ...store.viewport.value }
  const swipe = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -60, deltaY: 0, view: window })
  pane.dispatchEvent(swipe)
  await vue.nextTick()
  assert.ok(swipe.defaultPrevented, 'prevent browser history navigation')
  assert.notEqual(store.viewport.value.x, before.x, 'the same gesture must still pan the canvas')
  assert.equal(store.viewport.value.zoom, before.zoom, 'two-finger sliding must not zoom')
  for (const [deltaX,deltaY] of [[0,0],[0,40],[-2,0],[-60,20],[90,0]]) {
    const event=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX,deltaY,view:window})
    document.querySelector('.workspace-header').dispatchEvent(event)
    assert.equal(event.defaultPrevented,true,'even a zero-motion or vertical first event must be claimed')
  }
  for (const [deltaX,deltaY] of [[0,40],[0,-40],[60,0],[-60,0]]) {
    const previous={...store.viewport.value}
    pane.dispatchEvent(new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX,deltaY,view:window}))
    await vue.nextTick()
    assert.equal(store.viewport.value.zoom,previous.zoom)
    assert.notEqual(deltaX?store.viewport.value.x:store.viewport.value.y,deltaX?previous.x:previous.y,'canvas panning must work in every direction')
  }
  for (const target of [document.querySelector('.workspace-header'), document.querySelector('.canvas-sidebar'), document.body]) {
    const diagonal = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -10, deltaY: 20 })
    target.dispatchEvent(diagonal)
    assert.equal(diagonal.defaultPrevented, true, 'the first diagonal gesture must be guarded across the whole canvas page')
  }
  const pinch = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -40, deltaY: 20, ctrlKey: true })
  Object.defineProperty(pinch, 'ctrlKey', { value: true })
  document.querySelector('.workspace-header').dispatchEvent(pinch)
  assert.equal(pinch.defaultPrevented, false, 'pinch zoom is not intercepted by the history guard')
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('character:actor')])
  await settle()
  const agent = nodeElement('character:actor').querySelector('.node-agent')
  const vertical = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0, deltaY: 40 })
  agent.querySelector('textarea').dispatchEvent(vertical)
  assert.equal(vertical.defaultPrevented, true, 'a vertical start inside an agent must not release the gesture')
  const strip = agent.querySelector('.agent-reference-strip')
  Object.defineProperties(strip, { clientWidth: { configurable: true, value: 100 }, scrollWidth: { configurable: true, value: 400 } })
  strip.scrollLeft = 100
  const inside = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -25, deltaY: 0 })
  strip.dispatchEvent(inside)
  assert.equal(inside.defaultPrevented, true, 'native horizontal gestures are never released to browser history')
  assert.equal(strip.scrollLeft,75,'reference thumbnails still scroll using the same gesture')
  strip.scrollLeft = 0
  const boundary = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -25, deltaY: 0 })
  strip.dispatchEvent(boundary)
  assert.equal(boundary.defaultPrevented, true, 'at the scroll boundary, the gesture must not navigate back')
  const input = agent.querySelector('textarea')
  Object.defineProperties(input, { clientHeight: { configurable: true, value: 80 }, scrollHeight: { configurable: true, value: 300 } })
  input.scrollTop = 60
  const reading = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -2, deltaY: 35 })
  input.dispatchEvent(reading)
  assert.equal(reading.defaultPrevented, true, 'diagonal gestures are guarded even in a vertically scrollable input')
  assert.equal(input.scrollTop,95,'small horizontal jitter does not block reading long prompts')
  const plainReading=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:0,deltaY:25})
  input.dispatchEvent(plainReading)
  assert.equal(plainReading.defaultPrevented,true)
  assert.equal(input.scrollTop,120,'plain vertical scrolling is preserved through the same guarded path')
  const lineReading=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:0,deltaY:1,deltaMode:1})
  input.dispatchEvent(lineReading)
  assert.equal(lineReading.defaultPrevented,true)
  assert.ok(input.scrollTop>120,'line-based mouse wheels keep scrolling long prompts')
  input.scrollTop=220
  const atBottom=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:0,deltaY:40})
  const canvasAtBoundary={...store.viewport.value}
  input.dispatchEvent(atBottom)
  assert.equal(atBottom.defaultPrevented,true)
  assert.equal(input.scrollTop,220)
  assert.deepEqual(store.viewport.value,canvasAtBoundary,'scrolling at an agent boundary must not leak to the canvas')
  const stopped = event => event.stopPropagation()
  document.addEventListener('wheel',stopped,true)
  const earlyGuard = new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:-1,deltaY:10})
  document.body.dispatchEvent(earlyGuard)
  assert.equal(earlyGuard.defaultPrevented,true,'the window guard runs before document/node capture listeners')
  document.removeEventListener('wheel',stopped,true)
  app.unmount()
  assert.equal(document.documentElement.classList.contains('aigc-canvas-page'), false)
  assert.equal(document.body.classList.contains('aigc-canvas-page'), false)
  const afterLeaving = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -60 })
  document.body.dispatchEvent(afterLeaving)
  assert.equal(afterLeaving.defaultPrevented, false, 'the page-level guard must be removed on navigation')
  const afterLeavingVertical=new window.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:40})
  document.body.dispatchEvent(afterLeavingVertical)
  assert.equal(afterLeavingVertical.defaultPrevented,false,'normal page scrolling is restored after leaving the canvas')
  await mountWorkspace()
})

test('clearing and reconnecting text restores its prompt for every supported target, without replacing custom edits', async () => {
  const sourceText = records.textNodes.find(node => node.id === 'text').content
  async function connectText(targetId) {
    const source = nodeElement('text:text').querySelector('[data-handleid="right"]')
    const target = nodeElement(targetId)
    const point = target.getBoundingClientRect()
    document.elementFromPoint = () => target.querySelector('[data-handleid="node-drop"]')
    document.elementsFromPoint = () => [target]
    source.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, view: window }))
    await vue.nextTick()
    for (const name of ['mousemove', 'mouseup']) document.dispatchEvent(new window.MouseEvent(name, { bubbles: true, button: 0, clientX: point.left + 20, clientY: point.top + 30, view: window }))
    await settle()
  }
  async function disconnectText(targetId) {
    const [, id] = targetId.split(':')
    const link = records.links.find(link => link.sourceKind === 'text' && link.sourceId === 'text' && link.targetId === id)
    assert.ok(link)
    const edge = document.getElementById(link.id).closest('.vue-flow__edge')
    edge.querySelector('.canvas-edge-hitbox').dispatchEvent(new window.PointerEvent('pointerenter'))
    await vue.nextTick()
    document.querySelector('[aria-label="解除节点关联"]').click()
    await settle()
    assert.equal(records.links.some(item => item.id === link.id), false)
  }
  async function type(targetId, value) {
    const input = nodeElement(targetId).querySelector('.node-agent textarea')
    input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await vue.nextTick()
  }
  for (const targetId of ['character:actor', 'scene:scene', 'prop:prop', 'image:uploaded-reference', 'video:shot', 'text:empty-text']) {
    store.removeSelectedNodes()
    store.addSelectedNodes([store.findNode(targetId)])
    await settle()
    await type(targetId, '')
    await connectText(targetId)
    store.addSelectedNodes([store.findNode(targetId)])
    await settle()
    assert.equal(nodeElement(targetId).querySelector('.node-agent textarea').value, sourceText, targetId)
    await disconnectText(targetId)
    await type(targetId, '')
    const [, id] = targetId.split(':')
    const record = [...records.assets, ...records.referenceNodes, ...records.textNodes, ...records.shots].find(node => node.id === id)
    const field = targetId.startsWith('video:') ? 'universalPrompt' : 'prompt'
    assert.equal(record[field], sourceText, 'the server still holds the old prompt before the reconnect')
    const savedDraft = JSON.parse(localStorage.getItem('aigc-agent-drafts:project'))
    assert.equal(savedDraft[targetId], '', 'an explicitly empty local draft exists')
    await connectText(targetId)
    store.addSelectedNodes([store.findNode(targetId)])
    await settle()
    assert.equal(nodeElement(targetId).querySelector('.node-agent textarea').value, sourceText, `reconnect must refill ${targetId}`)
    assert.equal(record[field], sourceText)
    assert.equal(JSON.parse(localStorage.getItem('aigc-agent-drafts:project'))[targetId], sourceText)
    await disconnectText(targetId)
    const custom = `Keep my own ${targetId} prompt`
    await type(targetId, custom)
    await connectText(targetId)
    store.addSelectedNodes([store.findNode(targetId)])
    await settle()
    assert.equal(nodeElement(targetId).querySelector('.node-agent textarea').value, custom)
    assert.equal(record[field], custom, 'nonempty edits are persisted and never replaced by linked text')
    await type(targetId, '')
    store.removeSelectedNodes()
    store.addSelectedNodes([store.findNode(targetId)])
    await settle()
    assert.equal(nodeElement(targetId).querySelector('.node-agent textarea').value, '', 'clearing while connected remains intentional until a new connection')
  }
  const targetId = 'image:uploaded-reference'
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode(targetId)])
  await settle()
  await disconnectText(targetId)
  holdNextLink = true
  await connectText(targetId)
  assert.ok(releaseLink)
  store.addSelectedNodes([store.findNode(targetId)])
  await settle()
  await type(targetId, 'Typed while the connection request was pending')
  releaseLink()
  await settle()
  assert.equal(nodeElement(targetId).querySelector('.node-agent textarea').value, 'Typed while the connection request was pending')
})

test('node and mention previews share the source full-screen viewer without affecting the agent draft', async () => {
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('scene:scene')])
  await settle()
  const node = nodeElement('scene:scene')
  node.querySelector('[title="放大预览"]').click()
  await settle()
  let viewer = document.querySelector('.canvas-media-preview')
  assert.ok(viewer)
  assert.equal(viewer.parentElement, document.body, 'the viewer must not be inside the zoomed canvas')
  assert.equal(document.querySelector('.preview-dialog'), null)
  assert.equal(window.getComputedStyle(viewer).position, 'fixed')
  assert.equal(window.getComputedStyle(viewer).zIndex, '1200')
  assert.equal(window.getComputedStyle(viewer.querySelector('img')).width, 'auto')
  assert.equal(window.getComputedStyle(viewer.querySelector('img')).objectFit, 'contain')
  const original = viewer.querySelector('a')
  assert.equal(original.href, 'https://example.com/scene.png')
  assert.equal(original.target, '_blank')
  assert.match(original.rel, /noopener/)
  viewer.querySelector('img').click()
  await vue.nextTick()
  assert.ok(document.querySelector('.canvas-media-preview'), 'clicking the image must not close the viewer')
  document.querySelector('[aria-label="关闭预览"]').click()
  await settle()
  assert.equal(document.querySelector('.canvas-media-preview'), null)

  const textarea = nodeElement('scene:scene').querySelector('.node-agent textarea')
  textarea.value = 'Show this reference @图片1 without changing the text'
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
  textarea.focus()
  textarea.setSelectionRange(8, 8)
  await vue.nextTick()
  nodeElement('scene:scene').querySelector('.mention-token').click()
  await settle()
  viewer = document.querySelector('.canvas-media-preview')
  assert.ok(viewer)
  assert.ok(viewer.querySelector('img').src.includes('actor-old.png'))
  assert.match(viewer.querySelector('.canvas-media-preview-title').textContent, /@图片1/)
  document.querySelector('[aria-label="关闭预览"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await settle()
  assert.equal(document.querySelector('.canvas-media-preview'), null)
  assert.equal(nodeElement('scene:scene').querySelector('.node-agent textarea').value, 'Show this reference @图片1 without changing the text')
  assert.equal(document.activeElement, textarea)
  assert.equal(textarea.selectionStart, 8)
})

test('preview Escape closes only the viewer while leaving its underlying task details open', async () => {
  document.querySelector('[title="查看生成任务"]').click()
  await settle()
  const panel = document.querySelector('.canvas-tasks')
  const row = [...panel.querySelectorAll('.task-row')].find(row => row.textContent.includes('Actor'))
  row.querySelector('.task-text-button').click()
  await settle()
  panel.querySelector('.task-reference').click()
  await settle()
  const viewer = document.querySelector('.canvas-media-preview')
  assert.ok(viewer)
  viewer.querySelector('[aria-label="关闭预览"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await settle()
  assert.equal(document.querySelector('.canvas-media-preview'), null)
  assert.ok(document.querySelector('.task-detail-body'), 'the task dialog must not process the same Escape key')
  panel.querySelector('[title="关闭任务菜单"]').click()
  await settle()
  store.removeSelectedNodes()
  store.addSelectedNodes([store.findNode('video:shot')])
  await settle()
  nodeElement('video:shot').querySelector('[title="放大预览"]').click()
  await settle()
  assert.ok(document.querySelector('.canvas-media-preview-video[controls]'))
  document.querySelector('.canvas-media-preview').click()
  await settle()
})

test('each episode renders a script node whose editable draft survives closing and supports parallel, cancellable extraction', async () => {
  app.unmount();generatedJobs.clear();scriptFixtures=true
  records={...structuredClone(fixture),assets:[],textNodes:[],referenceNodes:[],audioNodes:[],shots:[],links:[],jobs:[]}
  records.project.episodeCount=2
  records.project.episodes=[{id:'episode-one',episodeNumber:1,title:'第 1 集',scriptContent:''},{id:'episode-two',episodeNumber:2,title:'第 2 集',scriptContent:''}]
  await mountWorkspace()
  assert.ok(nodeElement('script:episode-one'))
  assert.equal(document.querySelectorAll('.canvas-node--script').length,1)
  nodeElement('script:episode-one').querySelector('.canvas-node').click();await settle()
  const dialog=document.querySelector('.canvas-script-dialog');assert.ok(dialog);assert.equal(document.querySelector('.node-agent'),null)
  const textarea=dialog.querySelector('textarea');textarea.value='白虎与凤凰在荒原对峙，无人物、无对白。';textarea.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  for(const [label,value] of [['项目题材','玄幻修仙'],['项目视觉风格','国风二维动漫']]) {
    const input=dialog.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));
  }
  await settle()
  dialog.querySelector('[title="关闭剧本"]').click();await settle()
  nodeElement('script:episode-one').querySelector('.canvas-node').click();await settle()
  assert.equal(document.querySelector('.canvas-script-dialog textarea').value,'白虎与凤凰在荒原对峙，无人物、无对白。')
  assert.equal(document.querySelector('[aria-label="项目题材"]').value,'玄幻修仙')
  assert.equal(document.querySelector('[aria-label="项目视觉风格"]').value,'国风二维动漫')
  for(const kind of ['角色','场景','道具'])document.querySelector(`[aria-label="提取${kind}"]`).click()
  await settle(200)
  assert.equal([...generatedJobs.values()].filter(job=>job.kind==='canvas_asset_extract').length,3)
  assert.equal(records.project.genre,'玄幻修仙');assert.equal(records.project.style,'国风二维动漫')
  for(const job of generatedJobs.values()){assert.equal(job.input.genre,'玄幻修仙');assert.equal(job.input.style,'国风二维动漫')}
  for(const kind of ['角色','场景','道具'])assert.ok(document.querySelector(`[aria-label="中断提取${kind}"]`))
  document.querySelector('[title="关闭剧本"]').click();await settle();nodeElement('script:episode-one').querySelector('.canvas-node').click();await settle()
  assert.ok(document.querySelector('[aria-label="中断提取角色"]'))
  document.querySelector('[aria-label="中断提取场景"]').click();await settle()
  assert.equal([...generatedJobs.values()].find(job=>job.input.category==='scene').status,'cancelled')
  const job=[...generatedJobs.values()].find(job=>job.input.category==='character')
  records.assets.push({id:'shared-tiger',kind:'character',name:'白虎',description:'神兽',prompt:'白虎原始提示词',imageUrl:'https://example.com/tiger-shared.png',aspectRatio:'1:1',episodeNumbers:[1]})
  job.status='succeeded';job.result={content:'角色提取完成：新增 1 个，复用 0 个。',created:1,reused:0,assetIds:['shared-tiger']};job.updatedAt=new Date().toISOString()
  await settle(1700)
  assert.ok(nodeElement('character:shared-tiger').querySelector('.canvas-node--image img'))
  assert.ok(!store.getEdges.value.some(edge=>edge.source==='script:episode-one'),'extracted assets render without a default script connection')
  assert.match(document.querySelector('.script-extract-result').textContent,/新增 1 个/)
  document.querySelector('[title="关闭剧本"]').click();await settle()
})
test('switching episodes starts with an empty script/resource scope and reuses the same image node ID after extraction',async()=>{
  document.querySelector('[aria-label="选择分集"]').click();await settle()
  ;[...document.querySelectorAll('.app-select-menu [role="option"]')].find(item=>item.textContent==='第 2 集').click();await settle()
  assert.ok(nodeElement('script:episode-two'));assert.equal(nodeElement('character:shared-tiger'),undefined)
  nodeElement('script:episode-two').querySelector('.canvas-node').click();await settle()
  const textarea=document.querySelector('.canvas-script-dialog textarea');assert.equal(textarea.value,'')
  assert.equal(document.querySelector('[aria-label="项目题材"]').value,'玄幻修仙')
  assert.equal(document.querySelector('[aria-label="项目视觉风格"]').value,'国风二维动漫')
  textarea.value='白虎再次来到荒原。';textarea.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  document.querySelector('[aria-label="提取角色"]').click();await settle(200)
  const job=[...generatedJobs.values()].find(job=>job.episodeNumber===2&&job.input.category==='character');assert.ok(job);assert.equal(job.input.prompt,'白虎再次来到荒原。')
  records.assets[0].episodeNumbers.push(2)
  job.status='succeeded';job.result={content:'角色提取完成：新增 0 个，复用 1 个。',created:0,reused:1,assetIds:['shared-tiger']};job.updatedAt=new Date().toISOString();await settle(1700)
  assert.equal(records.assets.length,1);assert.ok(nodeElement('character:shared-tiger'))
  assert.equal(nodeElement('character:shared-tiger').querySelector('img').getAttribute('src'),'https://example.com/tiger-shared.png')
  assert.ok(!store.getEdges.value.some(edge=>edge.source==='script:episode-two'),'cross-episode reuse does not require a script connection')
  assert.match(document.querySelector('.script-extract-result').textContent,/复用 1 个/)
  document.querySelector('[title="关闭剧本"]').click();await settle()
})

test('the sidebar locates the current script and the episode menu creates an independent empty episode without interrupting jobs',async()=>{
  const scriptEntry=document.querySelector('.canvas-sidebar section > button')
  assert.match(scriptEntry.textContent,/第 2 集/)
  await store.setViewport({x:10000,y:8000,zoom:.4})
  scriptEntry.click();await settle(450)
  assert.equal(store.findNode('script:episode-two').selected,true)
  assert.notEqual(store.viewport.value.x,10000,'script entry recentres the infinite canvas')
  const oldScript=records.project.episodes[1].scriptContent
  const cancellations=requests.filter(request=>request.url.endsWith('/cancel')).length
  const running=[...generatedJobs.values()].filter(job=>job.status==='running').map(job=>job.id)
  const createCount=()=>requests.filter(request=>request.method==='POST'&&request.url.endsWith('/projects/project/episodes')).length
  async function openCreate(){document.querySelector('[aria-label="选择分集"]').click();await settle();const button=document.querySelector('.episode-add-button');assert.ok(button);return button}
  rejectNextEpisode=true
  ;(await openCreate()).click();await settle()
  assert.match(document.querySelector('.canvas-error').textContent,/新增剧集失败/)
  assert.ok(nodeElement('script:episode-two'),'failed creation leaves the current canvas intact')
  holdEpisode=true
  const before=createCount(),button=await openCreate();button.click();button.click();await settle()
  assert.equal(createCount(),before+1,'duplicate clicks submit once')
  assert.equal(document.querySelector('[aria-label="选择分集"]').disabled,true)
  assert.ok(document.querySelector('[aria-label="正在新增剧集"]'))
  releaseEpisode();await settle(550)
  assert.equal(records.project.episodeCount,3)
  assert.equal(document.querySelector('[aria-label="选择分集"]').textContent,'第 3 集')
  assert.ok(nodeElement('script:new-episode-3'))
  assert.equal(nodeElement('character:shared-tiger'),undefined)
  assert.equal(records.project.episodes[1].scriptContent,oldScript)
  for(const id of running)assert.equal(generatedJobs.get(id).status,'running')
  assert.equal(requests.filter(request=>request.url.endsWith('/cancel')).length,cancellations,'episode creation does not cancel other jobs')
  nodeElement('script:new-episode-3').querySelector('.canvas-node').click();await settle()
  assert.equal(document.querySelector('.canvas-script-dialog textarea').value,'')
  document.querySelector('[title="关闭剧本"]').click();await settle()
  document.querySelector('[aria-label="选择分集"]').click();await settle()
  ;[...document.querySelectorAll('[role=option]')].find(option=>option.textContent==='第 2 集').click();await settle()
  assert.ok(nodeElement('script:episode-two'))
  assert.ok(nodeElement('character:shared-tiger'))
})

test('video references render media and both disconnect paths remove mentions while keeping remaining references correctly numbered', async () => {
  app.unmount(); generatedJobs.clear(); scriptFixtures = false
  records = structuredClone(fixture)
  records.shots = [
    { id:'source-video-a',title:'Source video A',videoUrl:'https://example.com/source-a.mp4',aspectRatio:'16:9',canvasVideoNode:true },
    { id:'source-video-b',title:'Source video B',videoUrl:'https://example.com/source-b.mp4',aspectRatio:'16:9',canvasVideoNode:true },
    { id:'reference-target',title:'Reference target',videoUrl:'',aspectRatio:'16:9',canvasVideoNode:true,universalPrompt:'先@视频1，然后@视频2，画面@图片1，音色@音色1，保留文字。' },
  ]
  records.audioNodes = [{id:'voice-reference',name:'Voice',audioUrl:'https://example.com/voice.mp3'}]
  records.links = [
    {id:'video-ref-a',sourceKind:'video',sourceId:'source-video-a',targetKind:'video',targetId:'reference-target'},
    {id:'video-ref-b',sourceKind:'video',sourceId:'source-video-b',targetKind:'video',targetId:'reference-target'},
    {id:'image-ref',sourceKind:'character',sourceId:'actor',targetKind:'video',targetId:'reference-target'},
    {id:'voice-ref',sourceKind:'audio',sourceId:'voice-reference',targetKind:'video',targetId:'reference-target'},
  ]
  await mountWorkspace()
  store.addSelectedNodes([store.findNode('video:reference-target')]);await settle()
  let agent=nodeElement('video:reference-target').querySelector('.node-agent')
  const thumbnails=[...agent.querySelectorAll('.agent-reference video')]
  assert.deepEqual(thumbnails.map(video=>video.getAttribute('src')),['https://example.com/source-a.mp4','https://example.com/source-b.mp4'])
  for(const video of thumbnails){assert.ok(video.hasAttribute('muted'));assert.ok(!video.hasAttribute('autoplay'));assert.equal(video.getAttribute('preload'),'metadata')}
  document.getElementById('video-ref-a').closest('.vue-flow__edge').querySelector('.canvas-edge-hitbox').dispatchEvent(new window.PointerEvent('pointerenter'))
  await vue.nextTick();document.querySelector('[aria-label="解除节点关联"]').click();await settle()
  agent=nodeElement('video:reference-target').querySelector('.node-agent')
  assert.equal(document.getElementById('video-ref-a'),null)
  assert.equal(agent.querySelectorAll('.agent-reference video').length,1)
  assert.equal(agent.querySelector('.agent-reference video').getAttribute('src'),'https://example.com/source-b.mp4')
  assert.equal(agent.querySelector('.agent-reference span').textContent,'@视频1')
  assert.equal(agent.querySelector('textarea').value,'先，然后@视频1，画面@图片1，音色@音色1，保留文字。')
  assert.equal(records.shots.at(-1).universalPrompt,agent.querySelector('textarea').value)
  assert.ok(nodeElement('video:source-video-a'),'disconnecting must not delete the source node')
  agent.querySelector('.agent-reference-remove').click();await settle()
  agent=nodeElement('video:reference-target').querySelector('.node-agent')
  assert.equal(agent.querySelectorAll('.agent-reference video').length,0)
  assert.equal(document.getElementById('video-ref-b'),null)
  assert.deepEqual([...agent.querySelectorAll('.agent-reference span')].map(span=>span.textContent),['@图片1','@音色1'])
  assert.equal(agent.querySelector('textarea').value,'先，然后，画面@图片1，音色@音色1，保留文字。')
  const target=nodeElement('video:reference-target'),point=target.getBoundingClientRect()
  document.elementFromPoint=()=>target.querySelector('[data-handleid="node-drop"]');document.elementsFromPoint=()=>[target]
  nodeElement('video:source-video-b').querySelector('[data-handleid="right"]').dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true,button:0,clientX:point.left-100,clientY:point.top,view:window}))
  await vue.nextTick()
  for(const name of ['mousemove','mouseup'])document.dispatchEvent(new window.MouseEvent(name,{bubbles:true,button:0,clientX:point.left+100,clientY:point.top+50,view:window}))
  await settle()
  agent=nodeElement('video:reference-target').querySelector('.node-agent')
  assert.equal(agent.querySelector('.agent-reference video').getAttribute('src'),'https://example.com/source-b.mp4')
  assert.equal([...agent.querySelectorAll('.agent-reference span')].at(-1).textContent,'@视频1')
  assert.equal(agent.querySelector('textarea').value,'先，然后，画面@图片1，音色@音色1，保留文字。','reconnecting restores the pool, not a removed mention')
  app.unmount();await mountWorkspace();store.addSelectedNodes([store.findNode('video:reference-target')]);await settle()
  agent=nodeElement('video:reference-target').querySelector('.node-agent')
  assert.equal(agent.querySelectorAll('.agent-reference video').length,1)
  assert.equal(agent.querySelector('textarea').value,'先，然后，画面@图片1，音色@音色1，保留文字。')
})

test('large imported chapter directories are searchable without rendering thousands of dropdown items',async()=>{
  app.unmount();generatedJobs.clear();scriptFixtures=false
  records=structuredClone(fixture);records.project.episodeCount=250
  records.project.episodes=Array.from({length:250},(_,index)=>({id:`chapter-${index+1}`,episodeNumber:index+1,title:`第${index+1}章 标题`,scriptContent:`本集正文${index+1}`}))
  await mountWorkspace()
  document.querySelector('[aria-label="选择分集"]').click();await settle()
  assert.equal(document.querySelectorAll('.app-select-menu [role=option]').length,100)
  const search=document.querySelector('[aria-label="搜索分集"]');assert.ok(search)
  search.value='250';search.dispatchEvent(new window.Event('input',{bubbles:true}));await settle()
  assert.equal(document.querySelectorAll('.app-select-menu [role=option]').length,1)
  document.querySelector('.app-select-menu [role=option]').click();await settle()
  assert.ok(nodeElement('script:chapter-250'));assert.match(nodeElement('script:chapter-250').querySelector('.node-copy').textContent,/正文250/)
  await settle(500)
})

test('the reported project renders all persisted lines', { skip: !process.env.CANVAS_LIVE_PROJECT_ID }, async () => {
  const response = await fetch(`http://localhost:3001/api/projects/${encodeURIComponent(process.env.CANVAS_LIVE_PROJECT_ID)}/canvas?episode=1`)
  assert.ok(response.ok)
  const result = await response.json()
  app.unmount()
  scriptFixtures = false
  records = result.data
  await mountWorkspace()
  const expected = records.links.length
  assert.ok(expected > 0, 'the project must contain persisted or fixed links')
  assertVisibleEdges(expected)
  console.log(`Reported project: ${records.links.length} saved links have visible SVG paths`)
})
