// localStorage persistence + version migration for the LCD layout.
import { LAYOUT_VERSION, defaultLayout, type Layout } from './types'

export const LS_KEY = 'lcd-layout'

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const l = JSON.parse(raw) as Layout
      if (l.v === LAYOUT_VERSION) return l
      // v4 -> v5 only recentered the default clock — migrate in place instead
      // of discarding the user's whole layout (background, edits, ...).
      if (l.v === 4) {
        return {
          ...l,
          v: LAYOUT_VERSION,
          widgets: l.widgets.map((w) =>
            w.id === 'clock' && w.x === 733 ? { ...w, x: 775 } : w),
        }
      }
      // Anything older predates the current widget design — retire it.
    }
  } catch { /* ignore */ }
  return defaultLayout()
}
