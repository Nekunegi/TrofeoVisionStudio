import { Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import type { Widget } from '../types'

// Human-readable label for the widget's type badge.
const TYPE_LABEL: Record<Widget['type'], string> = {
  text: 'TXT', clock: 'CLK', sensor: 'SNS', bar: 'BAR',
  image: 'IMG', gauge: 'GAU', graph: 'GPH', media: 'MED',
  weather: 'WTH', visualizer: 'AUD',
}

function widgetName(w: Widget): string {
  if ('label' in w && w.label) return w.label
  if (w.type === 'text' && w.text) {
    const s = w.text.trim()
    return s.length > 26 ? s.slice(0, 26) + '…' : s
  }
  if (w.type === 'weather') return w.place || 'Weather'
  if (w.type === 'media') return 'Now Playing'
  if (w.type === 'visualizer') return 'Audio bars'
  if (w.type === 'clock') return w.withDate ? 'Clock + date' : 'Clock'
  return w.type
}

interface Props {
  widgets: Widget[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<Widget>) => void
  onDelete: (id: string) => void
  // dir: 'up' = higher z (closer to viewer); 'down' = lower z.
  onReorder: (id: string, dir: 'up' | 'down') => void
}

export function LayerPanel({
  widgets, selectedId, onSelect, onUpdate, onDelete, onReorder,
}: Props) {
  if (!widgets.length) {
    return <p className="muted">ウィジェットがありません。左上の Add widget から追加してください。</p>
  }
  // Show top-of-stack first (App renders widgets in array order — last = on top).
  const rows = widgets.slice().reverse()
  return (
    <ul className="layers">
      {rows.map((w) => {
        const active = w.id === selectedId
        return (
          <li key={w.id} className={active ? 'active' : ''}>
            <button className="row-main" title={w.id}
              onClick={() => onSelect(w.id)}>
              <span className="type">{TYPE_LABEL[w.type]}</span>
              <span className="name">{widgetName(w)}</span>
            </button>
            <button title="Bring forward" onClick={() => onReorder(w.id, 'up')}>
              <ChevronUp size={12} />
            </button>
            <button title="Send backward" onClick={() => onReorder(w.id, 'down')}>
              <ChevronDown size={12} />
            </button>
            <button title={w.hidden ? '表示に戻す' : '非表示'}
              className={w.hidden ? 'toggled' : ''}
              onClick={() => onUpdate(w.id, { hidden: !w.hidden })}>
              {w.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button title={w.locked ? 'ロック解除' : 'ロック'}
              className={w.locked ? 'toggled' : ''}
              onClick={() => onUpdate(w.id, { locked: !w.locked })}>
              {w.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <button title="削除" className="danger"
              onClick={() => onDelete(w.id)}>
              <Trash2 size={12} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
