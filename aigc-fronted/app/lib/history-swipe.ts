export function installHistorySwipeGuard(targetWindow: Window) {
  const document = targetWindow.document

  function onWheel(event: WheelEvent) {
    if (!event.cancelable || event.ctrlKey) return
    // Claim the beginning of every gesture, even before horizontal motion starts.
    event.preventDefault()
    const deltaX = event.deltaX || (event.shiftKey ? event.deltaY : 0)
    const deltaY = event.shiftKey && !event.deltaX ? 0 : event.deltaY
    const horizontal = Math.abs(deltaX) >= Math.abs(deltaY)
    const delta = horizontal ? deltaX : deltaY
    if (!delta) return

    const target = event.target as Node | null
    let element = target?.nodeType === 1 ? target as Element : target?.parentElement
    while (element) {
      const style = targetWindow.getComputedStyle(element)
      const root = element === document.scrollingElement
      const overflow = (horizontal ? style.overflowX : style.overflowY) || style.overflow
      const scrollable = root ? !/(hidden|clip)/.test(overflow) : /(auto|scroll)/.test(overflow)
      const max = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight
      if (scrollable && max > 0) {
        const position = horizontal ? element.scrollLeft : element.scrollTop
        if (delta < 0 && position > 0 || delta > 0 && position < max) {
          const pageSize = horizontal ? element.clientWidth : element.clientHeight
          const scale = event.deltaMode === 1 ? (parseFloat(style.lineHeight) || 16) : event.deltaMode === 2 ? pageSize : 1
          if (horizontal) element.scrollLeft = Math.max(0, Math.min(max, position + delta * scale))
          else element.scrollTop = Math.max(0, Math.min(max, position + delta * scale))
          event.stopPropagation()
          return
        }
        const boundary = (horizontal ? style.overscrollBehaviorX : style.overscrollBehaviorY) || style.overscrollBehavior
        if (/^(contain|none)$/.test(boundary)) {
          event.stopPropagation()
          return
        }
      }
      element = element.parentElement
    }
    // An unconsumed canvas event continues to Vue Flow's pan/pinch handlers.
  }

  targetWindow.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => targetWindow.removeEventListener('wheel', onWheel, true)
}
