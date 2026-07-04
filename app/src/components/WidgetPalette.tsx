import { useState, useMemo, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity, Clock as ClockIcon, Type, Gauge as GaugeIcon, ChartLine, ChartBar,
  ImagePlus, Music, CloudSun, AudioLines, Search,
} from 'lucide-react'
import type { Widget } from '../types'
import { fileToWidgetImage } from '../imageUtils'
import { useT } from '../i18n'

interface Item {
  key: string
  label: string
  icon: LucideIcon
  aliases: string[]
  make?: (id: string) => Widget    // one-shot factory
  file?: 'image'                   // opens a file picker instead
}

interface Category {
  cat: string
  catKey: 'sensor' | 'text' | 'media' | 'image'
  items: Item[]
}

// Search matches on key, label, and aliases (Japanese + English keywords).
const CATALOG: Category[] = [
  {
    cat: 'センサー', catKey: 'sensor',
    items: [
      {
        key: 'sensor', label: 'Sensor', icon: Activity,
        aliases: ['sensor', 'value', '数値', '温度', 'temp'],
        make: (id) => ({
          id, type: 'sensor', metric: 'cpuTemp', label: 'CPU', unit: '°C',
          x: 200, y: 200, fontSize: 120, color: '#00ffd0', bold: true,
        }),
      },
      {
        key: 'gauge', label: 'Gauge', icon: GaugeIcon,
        aliases: ['gauge', 'ゲージ', 'arc', 'circle', '円形'],
        make: (id) => ({
          id, type: 'gauge', metric: 'cpuLoad', max: 100, size: 300,
          color: '#00ffd0', label: 'CPU', x: 800, y: 80,
        }),
      },
      {
        key: 'graph', label: 'Graph', icon: ChartLine,
        aliases: ['graph', 'chart', 'history', 'グラフ', '推移', '折れ線'],
        make: (id) => ({
          id, type: 'graph', metric: 'gpuLoad', label: 'GPU LOAD', max: 100,
          x: 200, y: 150, width: 600, height: 220, color: '#b18cff',
        }),
      },
      {
        key: 'bar', label: 'Bar', icon: ChartBar,
        aliases: ['bar', 'percent', 'load', 'バー', '棒'],
        make: (id) => ({
          id, type: 'bar', metric: 'cpuLoad', label: 'CPU LOAD',
          x: 200, y: 300, width: 500, height: 20, max: 100, color: '#00ffd0',
        }),
      },
    ],
  },
  {
    cat: '時計・テキスト', catKey: 'text',
    items: [
      {
        key: 'clock', label: 'Clock', icon: ClockIcon,
        aliases: ['clock', 'time', '時計', '時刻'],
        make: (id) => ({
          id, type: 'clock', withDate: false, x: 200, y: 200, fontSize: 80,
          color: '#ffffff', bold: false,
        }),
      },
      {
        key: 'text', label: 'Text', icon: Type,
        aliases: ['text', 'label', 'テキスト', 'ラベル', 'template', 'テンプレ'],
        make: (id) => ({
          id, type: 'text', text: 'TEXT', x: 200, y: 200, fontSize: 60,
          color: '#ffffff', bold: false,
        }),
      },
    ],
  },
  {
    cat: 'メディア', catKey: 'media',
    items: [
      {
        key: 'media', label: 'Media', icon: Music,
        aliases: ['media', 'music', 'song', 'now playing', '再生', '曲', 'メディア'],
        make: (id) => ({
          id, type: 'media', x: 200, y: 160, width: 620, height: 160,
          color: '#4de1ff', panelBlur: 12,
        }),
      },
      {
        key: 'weather', label: 'Weather', icon: CloudSun,
        aliases: ['weather', '天気', '気温'],
        make: (id) => ({
          id, type: 'weather', place: '東京', lat: 35.6895, lon: 139.6917,
          x: 240, y: 140, width: 470, height: 170, color: '#ffd76a',
          panelBlur: 12,
        }),
      },
      {
        key: 'viz', label: 'Audio', icon: AudioLines,
        aliases: ['audio', 'visualizer', 'spectrum', '音', 'スペクトラム', 'ビジュアライザ'],
        make: (id) => ({
          id, type: 'visualizer', x: 510, y: 130, width: 900, height: 220,
          bars: 48, color: '#00ffd0', centered: true,
        }),
      },
    ],
  },
  {
    cat: '画像', catKey: 'image',
    items: [
      {
        key: 'image', label: 'Image', icon: ImagePlus,
        aliases: ['image', 'photo', 'picture', 'gif', '画像', '写真'],
        file: 'image',
      },
    ],
  },
]

function matches(item: Item, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  if (item.label.toLowerCase().includes(needle)) return true
  if (item.key.toLowerCase().includes(needle)) return true
  return item.aliases.some((a) => a.toLowerCase().includes(needle))
}

interface Props {
  newId: (t: string) => string
  onAdd: (w: Widget) => void
}

export function WidgetPalette({ newId, onAdd }: Props) {
  const t = useT()
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter the catalog against the search. Empty categories collapse away.
  const filtered = useMemo(() => {
    if (!q.trim()) return CATALOG
    return CATALOG
      .map((c) => ({ ...c, items: c.items.filter((i) => matches(i, q)) }))
      .filter((c) => c.items.length)
  }, [q])

  // Enter with a single visible result inserts it — keyboard-driven insert.
  const flat = filtered.flatMap((c) => c.items)
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && flat.length === 1 && !flat[0].file) {
      const only = flat[0]
      if (only.make) {
        onAdd(only.make(newId(only.key)))
        setQ('')
      }
    } else if (e.key === 'Escape') {
      setQ('')
      inputRef.current?.blur()
    }
  }

  const insertImage = async (file: File) => {
    const { src, w, h } = await fileToWidgetImage(file)
    const fit = Math.min(1, 400 / w, 400 / h)
    onAdd({
      id: newId('img'), type: 'image', src, x: 200, y: 100,
      width: Math.round(w * fit), height: Math.round(h * fit),
    })
  }

  return (
    <>
      <div className="palette-search">
        <Search size={13} />
        <input ref={inputRef} type="search" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('palette.searchPlaceholder')}
          aria-label={t('palette.searchLabel')} />
      </div>
      {filtered.length === 0 && (
        <p className="muted">{t('palette.empty')}</p>
      )}
      {filtered.map((c) => (
        <div key={c.cat} className="palette-cat">
          <div className="palette-cat-label">{t(`palette.cat.${c.catKey}` as const)}</div>
          <div className="btns">
            {c.items.map((item) => {
              const Icon = item.icon
              if (item.file === 'image') {
                return (
                  <label key={item.key} className="wbtn">
                    <Icon size={17} />{item.label}
                    <input type="file" accept="image/*" hidden onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) await insertImage(f)
                      e.target.value = '' // allow selecting the same file again
                    }} />
                  </label>
                )
              }
              return (
                <button key={item.key} className="wbtn"
                  onClick={() => item.make && onAdd(item.make(newId(item.key)))}>
                  <Icon size={17} />{item.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
