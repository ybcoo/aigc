<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next'

type SelectValue = string | number
interface SelectOption {
  value: SelectValue
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: SelectValue
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  compact?: boolean
  placement?: 'auto' | 'top' | 'bottom'
  searchable?: boolean
  searchPlaceholder?: string
}>(), {
  placeholder: '请选择',
  disabled: false,
  ariaLabel: '选择选项',
  compact: false,
  placement: 'auto',
  searchable: false,
  searchPlaceholder: '搜索选项',
})
const emit = defineEmits<{
  'update:modelValue': [value: SelectValue]
  change: [value: SelectValue]
}>()

const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const open = ref(false)
const activeIndex = ref(-1)
const query = ref('')
const menuPosition = ref({ left: 0, top: 0, width: 180, maxHeight: 260, above: false })

const selectedOption = computed(() => props.options.find(option => option.value === props.modelValue))
const filteredOptions = computed(() => !props.searchable || !query.value.trim() ? props.options : props.options.filter(option => `${option.value} ${option.label}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const visibleOptions = computed(() => {
  if (!props.searchable) return props.options
  const options = filteredOptions.value.slice(0, 100)
  if (!query.value.trim() && selectedOption.value && !options.includes(selectedOption.value)) return [...options.slice(0, 99), selectedOption.value]
  return options
})
watch(query, () => { activeIndex.value = 0 })
watch(() => props.disabled, disabled => { if (disabled) open.value = false })

function updatePosition() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const gap = 6
  const availableBelow = window.innerHeight - rect.bottom - gap - 10
  const availableAbove = rect.top - gap - 10
  const above = props.placement === 'top' ? availableAbove >= 120 || availableAbove > availableBelow
    : props.placement === 'bottom' ? availableBelow < 120 && availableAbove > availableBelow
      : availableBelow < 180 && availableAbove > availableBelow
  const maxHeight = Math.max(120, Math.min(260, above ? availableAbove : availableBelow))
  const width = Math.max(rect.width, 180)
  const left = Math.min(Math.max(10, rect.left), window.innerWidth - width - 10)
  menuPosition.value = {
    left,
    top: above ? rect.top - gap : rect.bottom + gap,
    width,
    maxHeight,
    above,
  }
}

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    query.value = ''
    activeIndex.value = Math.max(0, visibleOptions.value.findIndex(option => option.value === props.modelValue))
    void nextTick(updatePosition)
  }
}

function choose(option: SelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  open.value = false
  trigger.value?.focus()
}

function close() {
  open.value = false
  trigger.value?.focus()
}

function moveActive(direction: 1 | -1) {
  if (!open.value) {
    toggle()
    return
  }
  if (!visibleOptions.value.length) return
  let next = activeIndex.value
  for (let count = 0; count < visibleOptions.value.length; count += 1) {
    next = (next + direction + visibleOptions.value.length) % visibleOptions.value.length
    if (!visibleOptions.value[next]?.disabled) break
  }
  activeIndex.value = next
  void nextTick(() => menu.value?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
  else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (!open.value) toggle()
    else if (visibleOptions.value[activeIndex.value]) choose(visibleOptions.value[activeIndex.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    trigger.value?.focus()
  }
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape' || event.key === 'ArrowDown' || event.key === 'Enter') handleKeydown(event)
}

function handleDocumentPointer(event: PointerEvent) {
  const target = event.target as Node
  if (!root.value?.contains(target) && !menu.value?.contains(target)) open.value = false
}

function handleViewportChange() {
  if (open.value) updatePosition()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer, true)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer, true)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div ref="root" class="app-select" :class="{ 'is-open': open, 'is-disabled': disabled, 'is-compact': compact }">
    <button
      ref="trigger"
      type="button"
      class="app-select-trigger"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
      @keydown="handleKeydown"
    >
      <span :class="{ 'is-placeholder': !selectedOption }">{{ selectedOption?.label || placeholder }}</span>
      <ChevronDown :size="compact ? 13 : 15" />
    </button>

    <Teleport to="body">
      <Transition name="select-menu">
        <div
          v-if="open"
          ref="menu"
          class="app-select-menu"
          :class="{ 'opens-above': menuPosition.above }"
          :style="{
            left: `${menuPosition.left}px`,
            top: `${menuPosition.top}px`,
            width: `${menuPosition.width}px`,
            maxHeight: `${menuPosition.maxHeight}px`,
            transform: menuPosition.above ? 'translateY(-100%)' : undefined,
          }"
          @keydown="handleKeydown"
        >
          <div v-if="searchable" class="app-select-search"><input v-model="query" type="search" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" @keydown.stop="onSearchKeydown"></div>
          <div class="app-select-options" role="listbox" :aria-label="ariaLabel">
          <button
            v-for="(option, index) in visibleOptions"
            :key="`${option.value}`"
            type="button"
            role="option"
            :data-index="index"
            :aria-selected="option.value === modelValue"
            :disabled="option.disabled"
            :class="{ active: index === activeIndex, selected: option.value === modelValue }"
            @pointerenter="activeIndex = index"
            @click="choose(option)"
          >
            <span>{{ option.label }}</span><Check v-if="option.value === modelValue" :size="14" />
          </button>
          <div v-if="!visibleOptions.length" class="app-select-empty">暂无可用选项</div>
          <div v-if="searchable && filteredOptions.length > visibleOptions.length" class="app-select-result-count">{{ visibleOptions.length }} / {{ filteredOptions.length }}</div>
          </div>
          <div v-if="$slots.footer" class="app-select-footer" @keydown.stop><slot name="footer" :close="close" /></div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
