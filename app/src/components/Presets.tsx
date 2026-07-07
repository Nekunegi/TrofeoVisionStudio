import { useEffect, useState } from 'react'
import { Save, Download, Upload, Trash2 } from 'lucide-react'
import {
  IDB_BG, IDB_BG_VIDEO,
  saveBgMedia, saveBgVideo, loadBgMedia, loadBgVideoBlob,
  savePreset, loadPreset, deletePreset, listPresetThumbs,
} from '../bgStore'
import { type Layout } from '../types'
import { useT } from '../i18n'

interface PresetsProps {
  layout: Layout
  onLoad: (l: Layout) => void
  // Small canvas snapshot stored with the preset for the list thumbnail.
  capture?: () => string | null
}

// Presets live in IndexedDB and embed a copy of the background media, so
// loading a preset (or importing an exported JSON) restores the full look.
export function Presets({ layout, onLoad, capture }: PresetsProps) {
  const t = useT()
  const [entries, setEntries] = useState<{ name: string; thumb: string | null }[]>([])
  const [name, setName] = useState('')
  // Two-step overwrite guard (in-app, not a native confirm dialog).
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const names = entries.map((e) => e.name)

  useEffect(() => { listPresetThumbs().then(setEntries) }, [])

  // Match plain IDB_BG or IDB_BG#<epoch>. Video sentinel is a distinct prefix.
  const isImageBg = (s: string | null | undefined) =>
    !!s && s.startsWith(IDB_BG) && !s.startsWith(IDB_BG_VIDEO)
  const isVideoBg = (s: string | null | undefined) =>
    !!s && s.startsWith(IDB_BG_VIDEO)

  const currentImageMedia = () =>
    isImageBg(layout.bgImage) ? loadBgMedia() : Promise.resolve(null)
  const currentVideoMedia = () =>
    isVideoBg(layout.bgImage) ? loadBgVideoBlob() : Promise.resolve(null)

  const save = async () => {
    const key = name.trim()
    if (!key) return
    if (names.includes(key) && confirmKey !== key) {
      // Arm the overwrite for 3s — the button relabels to make it explicit.
      setConfirmKey(key)
      setTimeout(() => setConfirmKey((c) => (c === key ? null : c)), 3000)
      return
    }
    setConfirmKey(null)
    const [media, videoMedia] = await Promise.all([currentImageMedia(), currentVideoMedia()])
    await savePreset(key, { layout, media, videoMedia, thumb: capture?.() ?? null })
    setEntries(await listPresetThumbs())
    setName('')
  }

  const load = async (key: string) => {
    const p = await loadPreset(key)
    if (!p) return
    const l = { ...p.layout }
    const stamp = `#${Date.now()}`
    if (isImageBg(l.bgImage) && p.media) {
      await saveBgMedia(p.media)
      l.bgImage = IDB_BG + stamp
    } else if (isVideoBg(l.bgImage) && p.videoMedia) {
      await saveBgVideo(p.videoMedia)
      l.bgImage = IDB_BG_VIDEO + stamp
    }
    onLoad(l)
  }

  const remove = async (key: string) => {
    await deletePreset(key)
    setEntries(await listPresetThumbs())
  }

  // Only images survive JSON export cleanly (data URL). Video is a Blob and
  // is written as a base64 chunk so importing on another machine works.
  const blobToBase64 = (b: Blob) => new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })

  const exportJson = async () => {
    const [media, videoMedia] = await Promise.all([currentImageMedia(), currentVideoMedia()])
    const payload: Record<string, unknown> = { ...layout, __bgMedia: media }
    if (videoMedia) payload.__bgVideoMedia = await blobToBase64(videoMedia)
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'lcd-layout.json'; a.click()
    URL.revokeObjectURL(url)
  }

  // Minimal shape validation before committing an imported layout.
  // Also rejects out-of-domain panelRotate values — the emit switch only
  // handles 0/90/180/270, so a stray 45 would silently blank the LCD.
  const isPlausibleLayout = (o: unknown): o is Layout => {
    if (!o || typeof o !== 'object') return false
    const l = o as Partial<Layout>
    if (typeof l.bgColor !== 'string') return false
    if (!Array.isArray(l.widgets)) return false
    if (l.panelRotate !== undefined && ![0, 90, 180, 270].includes(l.panelRotate)) return false
    return true
  }

  const clearBgTransforms = (l: Layout) => {
    l.bgImage = null
    l.bgCropT = l.bgCropR = l.bgCropB = l.bgCropL = 0
    l.bgOffsetX = l.bgOffsetY = 0
    l.bgScale = 1
    l.bgRotate = 0
    l.bgFlipX = l.bgFlipY = false
  }

  const importJson = async (f: File) => {
    try {
      const raw = JSON.parse(await f.text()) as Layout & {
        __bgMedia?: string | null
        __bgVideoMedia?: string | null
      }
      const { __bgMedia, __bgVideoMedia, ...rest } = raw
      if (!isPlausibleLayout(rest)) {
        alert('This JSON does not look like a Trofeo Vision layout.')
        return
      }
      const l = { ...rest }
      const stamp = `#${Date.now()}`
      // Sentinel-without-payload: clear the whole bg block instead of
      // silently keeping the current session's IDB media pointed at the
      // imported layout — leaking state across configurations.
      if (isImageBg(l.bgImage)) {
        if (__bgMedia) {
          await saveBgMedia(__bgMedia)
          l.bgImage = IDB_BG + stamp
        } else {
          clearBgTransforms(l)
        }
      } else if (isVideoBg(l.bgImage)) {
        if (__bgVideoMedia) {
          const blob = await (await fetch(__bgVideoMedia)).blob()
          await saveBgVideo(blob)
          l.bgImage = IDB_BG_VIDEO + stamp
        } else {
          clearBgTransforms(l)
        }
      }
      onLoad(l)
    } catch (e) {
      alert('Failed to import: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div>
      <div className="row">
        <input placeholder={t('presets.namePlaceholder')} value={name}
          onChange={(e) => { setName(e.target.value); setConfirmKey(null) }} />
        <button className={confirmKey ? 'danger' : ''} onClick={save}>
          <Save size={13} />
          {confirmKey ? t('presets.overwrite') : t('presets.save')}
        </button>
      </div>
      {entries.map(({ name: k, thumb }) => (
        <div className="preset-item" key={k}>
          <button className="name" onClick={() => load(k)}>
            {thumb && <img className="preset-thumb" src={thumb} alt="" />}
            <span>{k}</span>
          </button>
          <button className="danger x" onClick={() => remove(k)}><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="row">
        <button onClick={exportJson}><Download size={13} />{t('presets.export')}</button>
        <label className="filebtn"><Upload size={13} />{t('presets.import')}
          <input type="file" accept="application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0]; if (f) importJson(f)
          }} />
        </label>
      </div>
    </div>
  )
}
