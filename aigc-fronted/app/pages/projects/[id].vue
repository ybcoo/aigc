<script setup lang="ts">
import CanvasWorkspace from '~/components/canvas/CanvasWorkspace.vue'
import VideoEditorWorkspace from '~/components/editor/VideoEditorWorkspace.vue'

const route = useRoute()
const episode = computed(() => Math.max(1, Number(route.query.episode) || 1))
</script>

<template>
  <VideoEditorWorkspace v-if="route.query.view === 'edit'" :key="`${route.params.id}:${episode}`" :project-id="String(route.params.id)" :episode="episode" />
  <CanvasWorkspace v-else :project-id="String(route.params.id)" :initial-episode="episode" />
</template>
