import { useState, useEffect, useRef } from 'react'

/**
 * Returns a ref to attach to the trigger element and a boolean `flipUp`
 * indicating the dropdown should open upward (not enough space below).
 * @param {boolean} open - whether the dropdown is currently open
 * @param {number} minSpaceBelow - minimum px needed below trigger (default 220)
 */
export function useFlipDropdown(open, minSpaceBelow = 220) {
  const triggerRef = useRef(null)
  const [flipUp, setFlipUp] = useState(false)

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setFlipUp(window.innerHeight - rect.bottom < minSpaceBelow)
  }, [open, minSpaceBelow])

  return { triggerRef, flipUp }
}
