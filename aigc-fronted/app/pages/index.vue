<script setup lang="ts">
import { ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileUp, Film, FolderOpen, LoaderCircle, Palette, Play, Search, Settings2, Sparkles, Trash2, X } from 'lucide-vue-next'
import { createCanvasService } from '~/services/canvas/canvas.service'
import { createAIConfigService } from '~/services/ai-config/ai-config.service'
import type { Project } from '~/types/canvas'
import type { AIConfig } from '~/types/ai-config'
import { featuredCreations } from '~/data/featured-creations'
import AIConfigDialog from '~/components/ai-config/AIConfigDialog.vue'
import CanvasMediaPreview from '~/components/canvas/CanvasMediaPreview.vue'
import HomeProjectTile from '~/components/home/HomeProjectTile.vue'
import AppSelect from '~/components/ui/AppSelect.vue'
import ScriptImportDialog from '~/components/home/ScriptImportDialog.vue'

const config = useRuntimeConfig()
const api = createCanvasService(config.public.apiBase)
const ai = createAIConfigService(config.public.apiBase)
const projects = ref<Project[]>([])
const models = ref<AIConfig[]>([])
const loading = ref(true)
const creating = ref(false)
const error = ref('')
const projectsError = ref('')
const aiConfigOpen = ref(false)
const scriptImportOpen = ref(false)
const allProjectsOpen = ref(false)
const projectSearch = ref('')
const projectToDelete = ref<Project>()
const deletingProject = ref(false)
const deleteError = ref('')
const deleteDialog = ref<HTMLElement>()
const deleteCancel = ref<HTMLButtonElement>()
let deleteTrigger: HTMLElement | undefined
const settingsOpen = ref<'style' | 'genre' | 'episodes' | ''>('')
const composer = ref<HTMLElement>()
const projectRail = ref<HTMLElement>()
const scriptInput = ref<HTMLTextAreaElement>()
const preview = ref<{ title: string, url: string, kind: string }>()
const hoveredVideo = ref('')
const readyVideo = ref('')
const failedVideo = ref('')
const previewVideos = new Map<string, HTMLVideoElement>()
let previewSession = 0
const failedPosters = reactive(new Set<string>())
const form = reactive({ script: '', textModelId: '', aspectRatio: '16:9', style: '', genre: '', episodeCount: 1 })
const settings = [{ key: 'style', label: '风格', icon: Palette }, { key: 'genre', label: '题材', icon: Sparkles }] as const
const presets = {
  style: ['写实电影', '国风动漫', '日系动漫', '3D 动画', '水彩手绘', '黏土定格'],
  genre: ['现代都市', '玄幻修仙', '古风武侠', '科幻未来', '奇幻冒险', '产品广告'],
}
const modelOptions = computed(() => models.value.filter(item => item.isActive && item.serviceType === 'text').flatMap(item =>
  (item.defaultModel ? [item.defaultModel, ...item.models.filter(model => model !== item.defaultModel)] : item.models).map(model => ({ value: `${item.id}:${model}`, label: model })),
))
const filteredProjects = computed(() => projects.value.filter(project => `${project.title || '未命名'} ${project.description}`.toLowerCase().includes(projectSearch.value.trim().toLowerCase())))
const aspectOptions = ['16:9', '9:16', '1:1'].map(value => ({ value, label: value }))
const draftKey = 'aigc-home-story-draft'

async function loadProjects() {
  loading.value = true
  projectsError.value = ''
  try { projects.value = await api.listProjects() }
  catch { projectsError.value = '项目加载失败' }
  finally { loading.value = false }
}
async function loadModels() {
  try {
    models.value = await ai.list()
    if (!modelOptions.value.some(item => item.value === form.textModelId)) form.textModelId = modelOptions.value[0]?.value || ''
  } catch { models.value = [] }
}
async function askDeleteProject(project: Project, event: MouseEvent) {
  if (deletingProject.value) return
  deleteTrigger = event.currentTarget as HTMLElement
  projectToDelete.value = project
  deleteError.value = ''
  await nextTick()
  deleteCancel.value?.focus()
}
function closeDeleteProject() {
  if (deletingProject.value) return
  projectToDelete.value = undefined
  deleteError.value = ''
  if (deleteTrigger?.isConnected) deleteTrigger.focus()
  else (document.querySelector<HTMLInputElement>('.home-project-search input') || scriptInput.value)?.focus()
}
async function confirmDeleteProject() {
  if (!projectToDelete.value || deletingProject.value) return
  const id = projectToDelete.value.id
  deletingProject.value = true
  deleteError.value = ''
  try {
    await api.deleteProject(id)
    projects.value = projects.value.filter(project => project.id !== id)
    deletingProject.value = false
    await nextTick()
    closeDeleteProject()
  } catch (cause: any) {
    deleteError.value = cause?.data?.message || cause?.message || '删除失败，请重试'
  } finally { deletingProject.value = false }
}
function onDeleteKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); closeDeleteProject(); return }
  if (event.key !== 'Tab') return
  const buttons = [...deleteDialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []]
  const first = buttons[0], last = buttons.at(-1)
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function saveDraft() {
  try { localStorage.setItem(draftKey, JSON.stringify(form)) } catch {}
}
watch(form, saveDraft)

async function createProject() {
  if (creating.value || !form.script.trim()) return
  if (!Number.isInteger(form.episodeCount) || form.episodeCount < 1 || form.episodeCount > 100) {
    error.value = '剧集数量请填写 1–100 的整数'
    settingsOpen.value = 'episodes'
    return
  }
  creating.value = true
  error.value = ''
  settingsOpen.value = ''
  try {
    const scriptContent = form.script
    const project = await api.createProject({ title: '', scriptContent, textModelId: form.textModelId, aspectRatio: form.aspectRatio, genre: form.genre, style: form.style, episodeCount: form.episodeCount })
    form.script = ''
    saveDraft()
    await navigateTo(`/projects/${project.id}`)
  } catch (cause: any) { error.value = cause?.data?.message || cause?.message || '创建失败，请重试' }
  finally { creating.value = false }
}
async function onScriptImported(project: Pick<Project, 'id' | 'title' | 'episodeCount'>) {
  scriptImportOpen.value = false
  try { await navigateTo(`/projects/${project.id}`) }
  catch { error.value = '项目已导入，请从我的项目打开'; await loadProjects() }
}
function scrollProjects(direction: number) { projectRail.value?.scrollBy({ left: direction * 528, behavior: 'smooth' }) }
function closeSetting(event: PointerEvent) { if (!composer.value?.contains(event.target as Node)) settingsOpen.value = '' }
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || preview.value || aiConfigOpen.value || scriptImportOpen.value) return
  if (projectToDelete.value) { closeDeleteProject(); return }
  if (allProjectsOpen.value) allProjectsOpen.value = false
  else settingsOpen.value = ''
}
function bindPreviewVideo(id: string, element: unknown) {
  if (element) previewVideos.set(id, element as HTMLVideoElement)
  else previewVideos.delete(id)
}
async function hoverVideo(id: string) {
  if (hoveredVideo.value === id) return
  leaveVideo()
  hoveredVideo.value = id
  const session = previewSession
  await nextTick()
  if (session !== previewSession || hoveredVideo.value !== id) return
  const video = previewVideos.get(id)
  if (!video) return
  video.muted = true
  video.defaultMuted = true
  try { await video.play() }
  catch {
    if (session === previewSession && hoveredVideo.value === id) { readyVideo.value = ''; failedVideo.value = id }
  }
}
function leaveVideo() {
  previewSession++
  for (const video of previewVideos.values()) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  hoveredVideo.value = ''; readyVideo.value = ''; failedVideo.value = ''
}
function previewPlaying(id: string, event: Event) {
  if (hoveredVideo.value === id && previewVideos.get(id) === event.target) { readyVideo.value = id; failedVideo.value = '' }
}
function previewFailed(id: string, event: Event) {
  if (hoveredVideo.value === id && previewVideos.get(id) === event.target) { readyVideo.value = ''; failedVideo.value = id }
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || '{}')
    for (const key of ['script','textModelId','style','genre'] as const) if (typeof saved[key] === 'string') form[key] = saved[key].slice(0, key === 'script' ? 100000 : key === 'style' ? 1000 : 200)
    if (['16:9','9:16','1:1'].includes(saved.aspectRatio)) form.aspectRatio = saved.aspectRatio
    if (Number.isInteger(saved.episodeCount) && saved.episodeCount >= 1 && saved.episodeCount <= 100) form.episodeCount = saved.episodeCount
  } catch {}
  document.addEventListener('pointerdown', closeSetting)
  document.addEventListener('keydown', onEscape)
  void Promise.all([loadProjects(), loadModels()])
})
onBeforeUnmount(() => {
  leaveVideo()
  document.removeEventListener('pointerdown', closeSetting)
  document.removeEventListener('keydown', onEscape)
})
</script>

<template>
  <main class="studio-home">
    <section class="home-create home-width" aria-labelledby="home-title">
      <div class="home-identity"><div class="home-wordmark"><img src="https://file.ybcfish.cloud/fishybc.png" alt="" width="35" height="35" draggable="false"><h1 id="home-title">AIGC Studio</h1></div><button class="home-settings" type="button" title="AI 配置" aria-label="AI 配置" @click="aiConfigOpen = true"><Settings2 :size="18" /></button></div>
      <form ref="composer" class="home-composer" :class="{ 'is-submitting': creating }" @submit.prevent="createProject">
        <textarea ref="scriptInput" v-model="form.script" aria-label="创作剧本" placeholder="输入你的故事剧本" maxlength="100000" :disabled="creating" @keydown.meta.enter.prevent="createProject" @keydown.ctrl.enter.prevent="createProject" />
        <div class="home-composer-bottom">
          <div class="home-composer-options">
            <div class="home-model-control"><Sparkles :size="14" /><AppSelect v-model="form.textModelId" :options="modelOptions" :disabled="creating || !modelOptions.length" placeholder="文本模型" aria-label="文本模型" placement="bottom" compact /></div>
            <span class="home-option-divider" aria-hidden="true" />
            <AppSelect v-model="form.aspectRatio" :options="aspectOptions" :disabled="creating" aria-label="创作画幅" compact />
            <div v-for="setting in settings" :key="setting.key" class="home-setting-wrap">
              <button type="button" class="home-option-button" :disabled="creating" :title="form[setting.key] || setting.label" :aria-label="`设置${setting.label}`" :aria-expanded="settingsOpen === setting.key" @click="settingsOpen = settingsOpen === setting.key ? '' : setting.key"><component :is="setting.icon" :size="14" /><span>{{ form[setting.key] || setting.label }}</span><ChevronDown :size="12" /></button>
              <div v-if="settingsOpen === setting.key" class="home-setting-popover">
                <label :for="`home-${setting.key}`">{{ setting.key === 'style' ? '视觉风格' : '故事题材' }}</label>
                <input :id="`home-${setting.key}`" v-model="form[setting.key]" :aria-label="setting.key === 'style' ? '视觉风格' : '故事题材'" :maxlength="setting.key === 'style' ? 1000 : 200" placeholder="自定义或选择" @keydown.enter.prevent="settingsOpen = ''">
                <div class="home-setting-presets" role="group" :aria-label="`${setting.label}选项`"><button v-for="value in ['', ...presets[setting.key]]" :key="value" type="button" :class="{ selected: form[setting.key] === value }" :aria-pressed="form[setting.key] === value" @click="form[setting.key] = value; settingsOpen = ''"><span>{{ value || '自动' }}</span><Check v-if="form[setting.key] === value" :size="13" /></button></div>
              </div>
            </div>
            <div class="home-setting-wrap">
              <button type="button" class="home-option-button" :disabled="creating" aria-label="设置剧集数量" :aria-expanded="settingsOpen === 'episodes'" @click="settingsOpen = settingsOpen === 'episodes' ? '' : 'episodes'"><Film :size="14" /><span>{{ form.episodeCount }} 集</span><ChevronDown :size="12" /></button>
              <div v-if="settingsOpen === 'episodes'" class="home-setting-popover home-episode-popover"><label for="home-episodes">剧集数量</label><input id="home-episodes" v-model.number="form.episodeCount" aria-label="剧集数量" type="number" min="1" max="100" step="1" @keydown.enter.prevent="settingsOpen = ''"><div class="home-setting-presets"><button v-for="value in [1,3,5,10]" :key="value" type="button" :class="{ selected: form.episodeCount === value }" @click="form.episodeCount = value; settingsOpen = ''">{{ value }} 集</button></div></div>
            </div>
            <button type="button" class="home-option-button home-import-button" title="导入 TXT 剧本" aria-label="导入 TXT 剧本" :disabled="creating" @click="settingsOpen = ''; scriptImportOpen = true"><FileUp :size="14" /><span>导入 TXT</span></button>
          </div>
          <button class="home-send" type="submit" :disabled="creating || !form.script.trim()" :title="creating ? '正在创建' : '开始创作'" aria-label="开始创作"><LoaderCircle v-if="creating" :size="20" class="spin" /><ArrowUp v-else :size="22" :stroke-width="2" /></button>
        </div>
      </form>
      <p v-if="error" class="home-error" role="alert">{{ error }}</p>
    </section>
    <section class="home-projects home-width" aria-labelledby="home-projects-title">
      <div class="home-section-heading"><div><h2 id="home-projects-title">我的项目</h2><span v-if="projects.length" class="home-count">{{ projects.length }}</span></div><div class="home-section-actions"><button type="button" class="home-rail-arrow" title="向前滚动项目" :disabled="projects.length < 4" @click="scrollProjects(-1)"><ChevronLeft :size="16" /></button><button type="button" class="home-rail-arrow" title="向后滚动项目" :disabled="projects.length < 4" @click="scrollProjects(1)"><ChevronRight :size="16" /></button><button type="button" class="home-view-all" @click="allProjectsOpen = true">查看全部<ArrowRight :size="14" /></button></div></div>
      <div v-if="loading" class="home-project-status" role="status"><LoaderCircle :size="18" class="spin" />正在加载</div>
      <div v-else-if="projectsError" class="home-project-status"><span>{{ projectsError }}</span><button type="button" @click="loadProjects">重新加载</button></div>
      <div v-else-if="!projects.length" class="home-project-status home-project-empty"><FolderOpen :size="21" /><span>暂无项目</span></div>
      <div v-else ref="projectRail" class="home-project-rail"><HomeProjectTile v-for="project in projects.slice(0, 12)" :key="project.id" :project="project" @delete="askDeleteProject" /></div>
    </section>
    <section class="home-featured home-width" aria-labelledby="home-featured-title">
      <div class="home-section-heading"><div><h2 id="home-featured-title">创作精选</h2><span class="home-section-note">灵感放映室</span></div><span class="home-featured-label">OPEN MOVIES</span></div>
      <div class="home-featured-grid">
        <article v-for="item in featuredCreations" :key="item.id" class="home-featured-item">
          <button type="button" class="home-featured-media" :class="{ 'is-previewing': readyVideo === item.id }" :aria-busy="hoveredVideo === item.id && readyVideo !== item.id && failedVideo !== item.id" :aria-label="`播放 ${item.title}`" @mouseenter="hoverVideo(item.id)" @mouseleave="leaveVideo" @focus="hoverVideo(item.id)" @blur="leaveVideo" @click="leaveVideo(); preview = { title: item.title, url: item.videoUrl, kind: 'video' }">
            <img v-if="!failedPosters.has(item.id)" :src="item.poster" :alt="item.title" width="640" height="360" loading="lazy" @error="failedPosters.add(item.id)"><div v-else class="home-poster-fallback"><Film :size="32" /><span>{{ item.title }}</span></div>
            <video v-if="hoveredVideo === item.id" :ref="element => bindPreviewVideo(item.id, element)" :src="item.videoUrl" muted loop playsinline preload="auto" :class="{ ready: readyVideo === item.id }" @playing="previewPlaying(item.id, $event)" @error="previewFailed(item.id, $event)" />
            <span class="home-featured-play"><LoaderCircle v-if="hoveredVideo === item.id && readyVideo !== item.id && failedVideo !== item.id" :size="18" class="spin" /><Play v-else :size="18" fill="currentColor" /></span><span class="home-featured-duration">{{ item.duration }}</span>
          </button>
          <div class="home-featured-caption"><div><h3>{{ item.title }}</h3><span>{{ item.genre }}</span></div><a :href="item.sourceUrl" target="_blank" rel="noopener noreferrer" :title="`${item.title} · Blender Studio 原作`" :aria-label="`${item.title} 原作来源`">Blender Studio<ExternalLink :size="11" /></a></div>
        </article>
      </div>
    </section>
    <Teleport to="body"><div v-if="allProjectsOpen" class="preview-backdrop" @click.self="allProjectsOpen = false"><section class="home-project-dialog" role="dialog" aria-modal="true" aria-labelledby="all-projects-title"><header><h2 id="all-projects-title">我的项目 <span>{{ projects.length }}</span></h2><button type="button" class="icon-button" title="关闭项目列表" @click="allProjectsOpen = false"><X :size="17" /></button></header><div class="home-project-search"><Search :size="16" /><input v-model="projectSearch" aria-label="搜索项目" placeholder="搜索项目"></div><div class="home-project-dialog-body"><div v-if="loading" class="home-project-status"><LoaderCircle :size="18" class="spin" />正在加载</div><div v-else-if="projectsError" class="home-project-status"><span>{{ projectsError }}</span><button type="button" @click="loadProjects">重新加载</button></div><div v-else-if="!filteredProjects.length" class="home-project-status">{{ projects.length ? '未找到相关项目' : '暂无项目' }}</div><div v-else class="home-all-projects-grid"><HomeProjectTile v-for="project in filteredProjects" :key="project.id" :project="project" @delete="askDeleteProject" /></div></div></section></div></Teleport>
    <Teleport to="body">
      <div v-if="projectToDelete" class="preview-backdrop home-delete-backdrop" @click.self="closeDeleteProject">
        <section ref="deleteDialog" class="home-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description" :aria-busy="deletingProject" tabindex="-1" @keydown="onDeleteKeydown">
          <h2 id="delete-project-title">删除项目</h2>
          <p id="delete-project-description">确定删除「<strong>{{ projectToDelete.title || '未命名' }}</strong>」？项目中的剧本、画布节点及生成历史将一并删除，此操作无法撤销。</p>
          <p v-if="deleteError" class="home-error" role="alert">{{ deleteError }}</p>
          <footer><button ref="deleteCancel" type="button" :disabled="deletingProject" @click="closeDeleteProject">取消</button><button type="button" :disabled="deletingProject" @click="confirmDeleteProject"><LoaderCircle v-if="deletingProject" :size="14" class="spin" /><Trash2 v-else :size="14" />{{ deletingProject ? '正在删除' : '确认删除' }}</button></footer>
        </section>
      </div>
    </Teleport>
    <CanvasMediaPreview v-if="preview" :target="preview" @close="preview = undefined" />
    <AIConfigDialog :open="aiConfigOpen" @close="aiConfigOpen = false" @changed="loadModels" />
    <ScriptImportDialog v-if="scriptImportOpen" :settings="{ textModelId: form.textModelId, aspectRatio: form.aspectRatio, genre: form.genre, style: form.style }" @close="scriptImportOpen = false" @imported="onScriptImported" />
  </main>
</template>
