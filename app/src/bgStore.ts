// IndexedDB persistence for anything too big for localStorage (~5MB quota):
// the current background media, and presets (which embed a copy of their
// background media so loading one restores the full look).
//
// Layouts in localStorage reference the background via the 'idb:bg' sentinel.

import type { Layout } from './types'

export const IDB_BG = 'idb:bg'

const DB_NAME = 'trofeo-studio'
const STORE = 'media'
const BG_KEY = 'bg'
const PRESET_PREFIX = 'preset:'

export interface PresetEntry {
  layout: Layout
  media: string | null // background data URL captured at save time
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onerror = () => { db.close(); reject(req.error) }
      req.onsuccess = () => { db.close(); resolve(req.result) }
    }
  })
}

export function saveBgMedia(dataUrl: string): Promise<unknown> {
  return withStore('readwrite', (s) => s.put(dataUrl, BG_KEY))
}

export async function loadBgMedia(): Promise<string | null> {
  try {
    const v = await withStore<string | undefined>('readonly', (s) => s.get(BG_KEY))
    return v ?? null
  } catch {
    return null
  }
}

export function clearBgMedia(): Promise<unknown> {
  return withStore('readwrite', (s) => s.delete(BG_KEY)).catch(() => null)
}

// ------------------------------------------------------------------ presets

export function savePreset(name: string, entry: PresetEntry): Promise<unknown> {
  return withStore('readwrite', (s) => s.put(entry, PRESET_PREFIX + name))
}

export async function loadPreset(name: string): Promise<PresetEntry | null> {
  try {
    const v = await withStore<PresetEntry | undefined>(
      'readonly', (s) => s.get(PRESET_PREFIX + name))
    return v ?? null
  } catch {
    return null
  }
}

export function deletePreset(name: string): Promise<unknown> {
  return withStore('readwrite', (s) => s.delete(PRESET_PREFIX + name)).catch(() => null)
}

export async function listPresets(): Promise<string[]> {
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    return keys
      .filter((k): k is string => typeof k === 'string' && k.startsWith(PRESET_PREFIX))
      .map((k) => k.slice(PRESET_PREFIX.length))
      .sort()
  } catch {
    return []
  }
}
