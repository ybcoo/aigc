<script setup lang="ts">
const props = defineProps<{ src: string, time: number, playing: boolean, volume: number, speed: number, audio?: boolean }>()
const emit = defineEmits<{ error: [] }>()
const element = ref<HTMLMediaElement>()
const ready = ref(false)
function sync() {
  const media = element.value
  if (!media || !ready.value) return
  media.volume = Math.max(0, Math.min(1, props.volume)); media.muted = props.volume <= 0; media.playbackRate = props.speed
  const target = Math.max(0, Math.min(props.time, Number.isFinite(media.duration) ? Math.max(0, media.duration - 0.025) : props.time))
  if (Math.abs(media.currentTime - target) > (props.playing ? 0.2 : 0.5 / 30)) media.currentTime = target
  if (props.playing && media.paused && props.time < media.duration) void media.play().catch(error => { if (error.name !== 'AbortError') emit('error') })
  else if (!props.playing || props.time >= media.duration) media.pause()
}
watch(() => [props.time, props.playing, props.volume, props.speed], sync)
function loaded() { ready.value = true; sync() }
onBeforeUnmount(() => element.value?.pause())
</script>
<template><audio v-if="audio" ref="element" :src="src" preload="auto" @loadeddata="loaded" @error="emit('error')" /><video v-else ref="element" :src="src" preload="auto" playsinline @loadeddata="loaded" @error="emit('error')" /></template>
