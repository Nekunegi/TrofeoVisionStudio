import { useEffect } from 'react'
import type { RefObject } from 'react'

export interface EditorShortcutArgs {
  undo: () => void
  redo: () => void
  del: () => void
  duplicate: () => void
  nudge: (dx: number, dy: number) => void
  selectedIdsRef: RefObject<string[]>
}

/** Keyboard shortcuts: arrows nudge (Shift = 10px), Delete removes,
 * Ctrl+D duplicates, Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo/redo.
 * Suppressed while a modal (bg editor, first-run wizard) is open — the
 * modal owns keyboard focus and any Delete/Ctrl+Z hitting through to the
 * underlying layout would silently destroy work. */
export function useEditorShortcuts(args: EditorShortcutArgs) {
  const { undo, redo, del, duplicate, nudge, selectedIdsRef } = args
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Any modal open? Editor / wizard block the whole shortcut set.
      if (document.querySelector('.bg-editor-backdrop, .wizard-backdrop')) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return }
      if (!selectedIdsRef.current.length) return
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicate(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); return }
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      if (dx || dy) { e.preventDefault(); nudge(dx, dy) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, del, duplicate, nudge, selectedIdsRef])
}
