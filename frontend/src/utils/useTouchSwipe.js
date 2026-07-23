import { useRef } from 'react'

/**
 * Returns touch handlers for swipe detection.
 * @param {object} opts
 * @param {Function} [opts.onSwipeLeft]
 * @param {Function} [opts.onSwipeRight]
 * @param {number}   [opts.threshold=50] minimum px for a valid swipe
 * @param {number}   [opts.edgeOnly]     if set, only fires when touch starts within edgeOnly px from left
 */
export function useTouchSwipe({ onSwipeLeft, onSwipeRight, threshold = 50, edgeOnly } = {}) {
  const start = useRef(null)

  const onTouchStart = (e) => {
    const t = e.touches[0]
    if (edgeOnly !== undefined && t.clientX > edgeOnly) return
    start.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e) => {
    if (!start.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    start.current = null
    if (Math.abs(dy) > Math.abs(dx) * 0.75) return
    if (Math.abs(dx) < threshold) return
    if (dx < 0) onSwipeLeft?.()
    else onSwipeRight?.()
  }

  return { onTouchStart, onTouchEnd }
}
