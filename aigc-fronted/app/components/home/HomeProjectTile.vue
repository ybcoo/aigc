<script setup lang="ts">
import { Film, Trash2 } from 'lucide-vue-next'
import type { Project } from '~/types/canvas'
defineProps<{ project: Project }>()
defineEmits<{ delete: [project: Project, event: MouseEvent] }>()
function date(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>
<template>
  <article class="home-project-tile">
    <NuxtLink :to="`/projects/${project.id}`" class="home-project-link">
    <div class="home-project-tile-top"><span class="home-project-symbol"><Film :size="18" /></span></div>
    <h3 :title="project.title">{{ project.title || '未命名' }}</h3>
    <div class="home-project-tile-bottom"><span>{{ project.aspectRatio }}<i aria-hidden="true" />{{ project.episodeCount }} 集</span><time :datetime="project.updatedAt">{{ date(project.updatedAt) }}</time></div>
    </NuxtLink>
    <button type="button" class="home-project-delete" :title="`删除 ${project.title || '未命名'}`" :aria-label="`删除项目 ${project.title || '未命名'}`" @click.stop="$emit('delete', project, $event)"><Trash2 :size="15" /></button>
  </article>
</template>
