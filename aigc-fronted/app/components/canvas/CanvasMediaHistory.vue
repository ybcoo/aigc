<script setup lang="ts">
import { Check, History, LoaderCircle, RotateCcw, X } from 'lucide-vue-next'
import { createCanvasService } from '~/services/canvas/canvas.service'
import type { CanvasMediaVersion, MediaHistoryTarget } from '~/types/canvas'

const props = defineProps<{ projectId: string, target: MediaHistoryTarget }>()
const emit = defineEmits<{ close: [], restored: [] }>()
const config = useRuntimeConfig()
const api = createCanvasService(config.public.apiBase)
const versions = ref<CanvasMediaVersion[]>([])
const loading = ref(true)
const restoring = ref('')
const error = ref('')
const sourceLabel: Record<string, string> = { generated: 'AI 生成', uploaded: '手动上传', existing: '已有素材' }

function mediaUrl(url: string) {
  return /^https?:\/\//.test(url) ? url : new URL(url, config.public.apiBase).href
}

async function load() {
  loading.value = true
  error.value = ''
  try { versions.value = await api.listMediaVersions(props.projectId, props.target.kind, props.target.id) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取历史版本失败' }
  finally { loading.value = false }
}

async function restore(version: CanvasMediaVersion) {
  if (restoring.value || version.isCurrent) return
  restoring.value = version.id
  error.value = ''
  try {
    await api.restoreMediaVersion(props.projectId, props.target.kind, props.target.id, version.id)
    emit('restored')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '恢复历史版本失败'
  } finally { restoring.value = '' }
}

function close() { if (!restoring.value) emit('close') }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }
onMounted(() => { void load(); document.addEventListener('keydown', onKeydown) })
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="preview-backdrop" @click.self="close">
      <section class="media-history-dialog" role="dialog" aria-modal="true" aria-labelledby="media-history-heading">
        <header><div><History :size="17" /><h2 id="media-history-heading">历史版本<span>{{ target.title }}</span></h2></div><button type="button" class="icon-button" title="关闭" :disabled="Boolean(restoring)" @click="close"><X :size="17" /></button></header>
        <div class="media-history-body">
          <p v-if="error" role="alert" class="media-history-error">{{ error }}<button v-if="!versions.length" type="button" @click="load">重试</button></p>
          <div v-if="loading" class="media-history-state"><LoaderCircle class="spin" :size="22" /><span>正在读取历史版本</span></div>
          <div v-else-if="!versions.length && !error" class="media-history-state"><History :size="30" :stroke-width="1.5" /><span>暂无历史版本</span></div>
          <div v-else class="media-history-grid">
            <article v-for="(version, index) in versions" :key="version.id" class="media-version" :class="{ 'is-current': version.isCurrent }">
              <div class="media-version-preview">
                <video v-if="version.kind === 'video'" :src="mediaUrl(version.url)" controls preload="metadata" />
                <audio v-else-if="version.kind === 'audio'" :src="mediaUrl(version.url)" controls preload="metadata" />
                <img v-else :src="mediaUrl(version.url)" :alt="`历史版本 ${versions.length - index}`" loading="lazy">
                <span v-if="version.isCurrent" class="media-current-badge"><Check :size="12" />当前版本</span>
              </div>
              <div class="media-version-footer"><div><strong>{{ version.isCurrent ? '当前版本' : `历史版本 ${versions.length - index}` }}</strong><small>{{ new Date(version.createdAt).toLocaleString('zh-CN') }} · {{ sourceLabel[version.source] || '已有素材' }}</small></div><button type="button" :class="version.isCurrent ? 'secondary-button' : 'primary-button'" :disabled="version.isCurrent || Boolean(restoring)" @click="restore(version)"><LoaderCircle v-if="restoring === version.id" :size="14" class="spin" /><RotateCcw v-else-if="!version.isCurrent" :size="14" />{{ version.isCurrent ? '使用中' : '使用此版本' }}</button></div>
            </article>
          </div>
        </div>
        <footer><button type="button" class="secondary-button" :disabled="Boolean(restoring)" @click="close">关闭</button></footer>
      </section>
    </div>
  </Teleport>
</template>
