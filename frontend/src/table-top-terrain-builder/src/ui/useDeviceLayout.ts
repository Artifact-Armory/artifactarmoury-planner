// src/ui/useDeviceLayout.ts
//
// Two media-query hooks that let the planner adapt to tablets without any
// device sniffing — and without branching desktop behaviour:
//
//   useCoarsePointer() → the primary input is a finger, so keyboard-only actions
//                        (rotate, place level, delete) need on-screen buttons.
//   useCompactLayout() → the viewport is too narrow for the fixed 250px palette
//                        + 270px basket to sit either side of a usable table.
//
// Both are false on a normal desktop, so every control there is untouched.
import React from 'react'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  React.useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** True on touch-primary devices (tablets, phones); false for mouse/trackpad. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

/**
 * True when the side panels can't stay pinned open. 1100px keeps a landscape
 * iPad (1024) compact while leaving every real desktop width alone.
 */
export const useCompactLayout = () => useMediaQuery('(max-width: 1100px)')
