<script setup lang="ts">
import { EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'
import { Scissors } from 'lucide-vue-next'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: any
  targetPosition: any
  markerStart?: string
  markerEnd?: string
  style?: Record<string, string | number>
  data?: { locked?: boolean, deleting?: boolean, pending?: boolean }
}>()
const emit = defineEmits<{ remove: [id: string] }>()
const hovered = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined

const pathData = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
  curvature: 0.62,
}))
const edgePath = computed(() => pathData.value[0])
const labelX = computed(() => pathData.value[1])
const labelY = computed(() => pathData.value[2])
const strokeColor = computed(() => String(props.style?.stroke || '#818cf8'))
const strokeWidth = computed(() => Number(props.style?.strokeWidth || 2.2))
const strokeDasharray = computed(() => props.data?.locked ? undefined : '7 5')

function showDelete() {
  if (hideTimer) clearTimeout(hideTimer)
  hovered.value = true
}

function hideDelete() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { hovered.value = false }, 120)
}

onBeforeUnmount(() => { if (hideTimer) clearTimeout(hideTimer) })
</script>

<template>
  <path
    :d="edgePath"
    class="canvas-edge-halo"
    fill="none"
    vector-effect="non-scaling-stroke"
  />
  <path
    :id="id"
    :d="edgePath"
    class="canvas-edge-visible"
    :class="{ 'is-pending': data?.pending }"
    fill="none"
    :stroke="strokeColor"
    :stroke-width="strokeWidth"
    :stroke-dasharray="strokeDasharray"
    :marker-start="markerStart"
    :marker-end="markerEnd"
    vector-effect="non-scaling-stroke"
  />
  <path
    v-if="!data?.locked"
    :d="edgePath"
    fill="none"
    stroke="transparent"
    :stroke-width="28"
    class="canvas-edge-hitbox"
    @pointerenter="showDelete"
    @pointerleave="hideDelete"
  />
  <EdgeLabelRenderer v-if="!data?.locked && (hovered || data?.deleting)">
    <button
      type="button"
      class="canvas-edge-remove nodrag nopan"
      :class="{ 'is-deleting': data?.deleting }"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      title="解除节点关联"
      aria-label="解除节点关联"
      :disabled="data?.deleting"
      @pointerenter="showDelete"
      @pointerleave="hideDelete"
      @pointerdown.stop
      @click.stop="emit('remove', id)"
    >
      <Scissors :size="14" />
    </button>
  </EdgeLabelRenderer>
</template>
