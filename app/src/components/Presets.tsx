import { useEffect, useState } from 'react'
import { Save, Download, Upload, Trash2 } from 'lucide-react'
import {
  IDB_BG, saveBgMedia, loadBgMedia,
  savePreset, loadPreset, deletePreset, listPresets,
} from '../bgStore'
import { type Layout } from '../types'

// Presets live in IndexedDB and embed a copy of the background media, so
// loading a preset (or importing an exported JSON) restores the full look.
export function Presets({ layout, onLoad }: { layout: Layout; onLoad: (l: Layout) => void }) {
  const [names, setNames] = useState<string[]>([])
  const [name, setName] = useState('')

  useEffect(() => { listPresets().then(setNames) }, [])

  const currentMedia = () =>
    layout.bgImage === IDB_BG ? loadBgMedia() : Promise.resolve(null)

  const save = async () => {
    const key = name.trim()
    if (!key) return
    await savePreset(key, { layout, media: await currentMedia() })
    setNames(await listPresets())
    setName('')
  }

  const load = async (key: string) => {
    const p = await loadPreset(key)
    if (!p) return
    if (p.layout.bgImage === IDB_BG && p.media) await saveBgMedia(p.media)
    onLoad(p.layout)
  }

  const remove = async (key: string) => {
    await deletePreset(key)
    setNames(await listPresets())
  }

  const exportJson = async () => {
    const payload = { ...layout, __bgMedia: await currentMedia() }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'lcd-layout.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (f: File) => {
    try {
      const { __bgMedia, ...l } = JSON.parse(await f.text()) as Layout & { __bgMedia?: string | null }
      if (l.bgImage === IDB_BG && __bgMedia) await saveBgMedia(__bgMedia)
      onLoad(l as Layout)
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="row">
        <input placeholder="preset name" value={name}
          onChange={(e) => setName(e.target.value)} />
        <button onClick={save}><Save size={13} />Save</button>
      </div>
      {names.map((k) => (
        <div className="preset-item" key={k}>
          <button className="name" onClick={() => load(k)}>{k}</button>
          <button className="danger x" onClick={() => remove(k)}><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="row">
        <button onClick={exportJson}><Download size={13} />Export</button>
        <label className="filebtn"><Upload size={13} />Import
          <input type="file" accept="application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0]; if (f) importJson(f)
          }} />
        </label>
      </div>
    </div>
  )
}
