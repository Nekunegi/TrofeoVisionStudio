import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import type { Layout, Widget } from '../types'
import { clampWidget, widgetBounds } from '../widgetGeometry'

let idc = 0
export const newId = (t: string) => `${t}-${Date.now()}-${idc++}`

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

export interface WidgetOpsArgs {
  commit: (fn: (l: Layout) => Layout) => void
  layoutRef: RefObject<Layout>
  logicalW: number
  logicalH: number
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
}

/** All widget mutations (add/move/resize/z-order/align/…), routed through the
 * undo history's commit(). Selection-wide ops (del/duplicate/align/nudge/
 * front/back) apply to EVERY selected widget in a single undoable commit.
 * selectedIdsRef mirrors the selection so the returned callbacks stay stable
 * for keyboard-handler subscriptions. */
export function useWidgetOps(args: WidgetOpsArgs) {
  const { commit, layoutRef, logicalW, logicalH, selectedIds, setSelectedIds } = args

  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  const update = useCallback((id: string, patch: Partial<Widget>) => {
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => (w.id === id ? { ...w, ...patch } as Widget : w)),
    }))
  }, [commit])

  const move = useCallback((id: string, x: number, y: number) => update(id, { x, y }), [update])

  // Group drag drop: every moved widget lands in ONE undoable commit.
  const moveMany = useCallback((moves: { id: string; x: number; y: number }[]) => {
    if (!moves.length) return
    const byId = new Map(moves.map((m) => [m.id, m]))
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => {
        const m = byId.get(w.id)
        return m ? { ...w, x: m.x, y: m.y } : w
      }),
    }))
  }, [commit])

  // Absorb transformer scale into each widget's own size fields.
  const resize = useCallback((id: string, sx: number, sy: number, x: number, y: number) => {
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => {
        if (w.id !== id) return w
        const base = { ...w, x, y }
        switch (w.type) {
          case 'text': case 'clock': case 'sensor':
            return { ...base, fontSize: Math.max(10, Math.round(w.fontSize * sy)) } as Widget
          case 'gauge':
            return { ...base, size: Math.max(60, Math.round(w.size * sx)) } as Widget
          case 'bar': case 'image': case 'graph': case 'media': case 'weather':
          case 'visualizer':
            return {
              ...base,
              width: Math.max(20, Math.round(w.width * sx)),
              height: Math.max(10, Math.round(w.height * sy)),
            } as Widget
        }
      }),
    }))
  }, [commit])

  const addWidget = useCallback((w: Widget) => {
    // WidgetPalette factories hardcode landscape (1920×480) spawn coords.
    // Clamp against the current logical canvas so portrait users don't get
    // widgets spawning off-canvas at x=800 or x=510.
    const clamped = clampWidget(w, logicalW, logicalH)
    commit((l) => ({ ...l, widgets: [...l.widgets, clamped] }))
    setSelectedIds([clamped.id])
  }, [commit, logicalW, logicalH, setSelectedIds])

  const del = useCallback(() => {
    const ids = selectedIdsRef.current
    if (!ids.length) return
    commit((l) => ({ ...l, widgets: l.widgets.filter((w) => !ids.includes(w.id)) }))
    setSelectedIds([])
  }, [commit, setSelectedIds])

  const duplicate = useCallback(() => {
    const ids = selectedIdsRef.current
    if (!ids.length) return
    const sources = layoutRef.current.widgets.filter((w) => ids.includes(w.id))
    if (!sources.length) return
    const copies = sources.map((src) => ({
      ...src, id: newId(src.type), x: src.x + 24, y: src.y + 24,
    }))
    commit((l) => ({ ...l, widgets: [...l.widgets, ...copies] }))
    setSelectedIds(copies.map((c) => c.id))
  }, [commit, layoutRef, setSelectedIds])

  // Render order = array order; front/back moves the whole selection to either
  // end, preserving its internal relative order.
  const reorder = useCallback((dir: 'front' | 'back') => {
    const ids = selectedIdsRef.current
    if (!ids.length) return
    commit((l) => {
      const picked = l.widgets.filter((x) => ids.includes(x.id))
      if (!picked.length) return l
      const rest = l.widgets.filter((x) => !ids.includes(x.id))
      return { ...l, widgets: dir === 'front' ? [...rest, ...picked] : [...picked, ...rest] }
    })
  }, [commit])

  // Move a specific widget one step in z-order (LayerPanel row arrows).
  // 'up' = closer to viewer = higher array index.
  const reorderOne = useCallback((id: string, dir: 'up' | 'down') => {
    commit((l) => {
      const idx = l.widgets.findIndex((x) => x.id === id)
      if (idx < 0) return l
      const target = dir === 'up' ? idx + 1 : idx - 1
      if (target < 0 || target >= l.widgets.length) return l
      const arr = l.widgets.slice()
      const [w] = arr.splice(idx, 1)
      arr.splice(target, 0, w)
      return { ...l, widgets: arr }
    })
  }, [commit])

  // Drop a widget at an absolute array index (LayerPanel drag & drop).
  const reorderTo = useCallback((id: string, targetIdx: number) => {
    commit((l) => {
      const idx = l.widgets.findIndex((x) => x.id === id)
      if (idx < 0) return l
      const clampedTo = Math.max(0, Math.min(l.widgets.length - 1, targetIdx))
      if (clampedTo === idx) return l
      const arr = l.widgets.slice()
      const [w] = arr.splice(idx, 1)
      arr.splice(clampedTo, 0, w)
      return { ...l, widgets: arr }
    })
  }, [commit])

  const deleteById = useCallback((id: string) => {
    commit((l) => ({ ...l, widgets: l.widgets.filter((w) => w.id !== id) }))
    const ids = selectedIdsRef.current
    if (ids.includes(id)) setSelectedIds(ids.filter((x) => x !== id))
  }, [commit, setSelectedIds])

  // Align every selected widget against the logical canvas edges/center.
  // widgetBounds is an estimate for text-like widgets (same approximation
  // the clamp path already relies on), exact for box-sized widgets.
  const align = useCallback((mode: AlignMode) => {
    const ids = selectedIdsRef.current
    if (!ids.length) return
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => {
        if (!ids.includes(w.id)) return w
        const b = widgetBounds(w)
        switch (mode) {
          case 'left': return { ...w, x: 0 }
          case 'hcenter': return { ...w, x: Math.round((logicalW - b.w) / 2) }
          case 'right': return { ...w, x: Math.round(logicalW - b.w) }
          case 'top': return { ...w, y: 0 }
          case 'vcenter': return { ...w, y: Math.round((logicalH - b.h) / 2) }
          case 'bottom': return { ...w, y: Math.round(logicalH - b.h) }
        }
      }),
    }))
  }, [commit, logicalW, logicalH])

  const nudge = useCallback((dx: number, dy: number) => {
    const ids = selectedIdsRef.current
    if (!ids.length) return
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) =>
        ids.includes(w.id) ? { ...w, x: w.x + dx, y: w.y + dy } : w),
    }))
  }, [commit])

  return {
    selectedIdsRef, update, move, moveMany, resize, addWidget, del, duplicate,
    reorder, reorderOne, reorderTo, deleteById, align, nudge,
  }
}
