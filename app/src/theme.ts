import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const LS_KEY = 'editor-theme'

function initialTheme(): Theme {
  return localStorage.getItem(LS_KEY) === 'light' ? 'light' : 'dark'
}

let current: Theme = initialTheme()
// The theme lives on <html> so index.css (body background) and the global
// scrollbar styles resolve the same variable set as everything under .app.
document.documentElement.dataset.theme = current
const listeners = new Set<() => void>()

function setTheme(t: Theme) {
  if (t === current) return
  current = t
  localStorage.setItem(LS_KEY, t)
  document.documentElement.dataset.theme = t
  listeners.forEach((cb) => cb())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const t = useSyncExternalStore(subscribe, () => current)
  return [t, setTheme]
}
