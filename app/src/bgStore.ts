// IndexedDB persistence for anything too big for localStorage (~5MB quota):
// the current background media, and presets (which embed a copy of their
// background media so loading one restores the full look).
//
// Layouts in localStorage reference the background via the 'idb:bg' sentinel.

import type { Layout } from './types'

export const IDB_BG = 'idb:bg'
// Video-backed backgrounds live under a separate sentinel + key because they
// need blob storage, not the data-URL path images take.
export const IDB_BG_VIDEO = 'idb:bg-video'

const DB_NAME = 'trofeo-studio'
const STORE = 'media'
const BG_KEY = 'bg'
const BG_VIDEO_KEY = 'bg-video'
const PRESET_PREFIX = 'preset:'

export interface PresetEntry {
  layout: Layout
  media: string | null // background data URL captured at save time (image path)
  videoMedia?: Blob | null // background video Blob captured at save time
}

// Read the current video blob back out for preset embedding.
export async function loadBgVideoBlob(): Promise<Blob | null> {
  try {
    const v = await withStore<Blob | undefined>('readonly', (s) => s.get(BG_VIDEO_KEY))
    return v ?? null
  } catch {
    return null
  }
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

// ------------------------------------------------------------- video bg
// Videos come in as Blobs and are handed to <video> via an object URL — a
// data URL would blow up in memory (33% base64 overhead) and needs data:
// in the CSP media-src, which we prefer to keep off.

export function saveBgVideo(blob: Blob): Promise<unknown> {
  return withStore('readwrite', (s) => s.put(blob, BG_VIDEO_KEY))
}

export async function loadBgVideoUrl(): Promise<string | null> {
  try {
    const v = await withStore<Blob | undefined>('readonly', (s) => s.get(BG_VIDEO_KEY))
    return v ? URL.createObjectURL(v) : null
  } catch {
    return null
  }
}

export function clearBgVideo(): Promise<unknown> {
  return withStore('readwrite', (s) => s.delete(BG_VIDEO_KEY)).catch(() => null)
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
