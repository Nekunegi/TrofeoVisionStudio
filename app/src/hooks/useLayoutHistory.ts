import { useCallback, useRef, useState } from 'react'
import type { Layout } from '../types'
import { loadLayout } from '../layoutStore'

/** Layout state with undo/redo. All mutations go through commit() (never bare
 * setLayout), which snapshots the previous state. layoutRef keeps commit()
 * usable from stable callbacks without re-subscribing keyboard handlers on
 * every edit. */
export function useLayoutHistory() {
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const past = useRef<Layout[]>([])
  const future = useRef<Layout[]>([])

  const commit = useCallback((fn: (l: Layout) => Layout) => {
    const cur = layoutRef.current
    const next = fn(cur)
    if (next === cur) return
    past.current = [...past.current.slice(-99), cur]
    future.current = []
    layoutRef.current = next
    setLayout(next)
  }, [])

  const undo = useCallback(() => {
    const p = past.current.pop()
    if (!p) return
    future.current.push(layoutRef.current)
    layoutRef.current = p
    setLayout(p)
  }, [])

  const redo = useCallback(() => {
    const f = future.current.pop()
    if (!f) return
    past.current.push(layoutRef.current)
    layoutRef.current = f
    setLayout(f)
  }, [])

  return { layout, layoutRef, commit, undo, redo }
}
