import { useState } from 'react'
import { Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import type { Widget } from '../types'
import { useT } from '../i18n'

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
  selectedIds: string[]
  // additive = Ctrl/Shift held: toggle the row in/out of the selection.
  onSelect: (id: string | null, additive?: boolean) => void
  onUpdate: (id: string, patch: Partial<Widget>) => void
  onDelete: (id: string) => void
  // dir: 'up' = higher z (closer to viewer); 'down' = lower z.
  onReorder: (id: string, dir: 'up' | 'down') => void
  // Drag & drop: move the widget to an absolute array index.
  onReorderTo: (id: string, arrayIdx: number) => void
}

export function LayerPanel({
  widgets, selectedIds, onSelect, onUpdate, onDelete, onReorder, onReorderTo,
}: Props) {
  const t = useT()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  if (!widgets.length) {
    return <p className="muted">{t('layers.empty')}</p>
  }
  // Show top-of-stack first (App renders widgets in array order — last = on top).
  const rows = widgets.slice().reverse()
  // Display row i ↔ widget array index (rows are reversed).
  const arrayIdxOf = (rowIdx: number) => widgets.length - 1 - rowIdx
  return (
    <ul className="layers">
      {rows.map((w, rowIdx) => {
        const active = selectedIds.includes(w.id)
        const cls = [
          active ? 'active' : '',
          overIdx === rowIdx && dragId && dragId !== w.id ? 'drag-over' : '',
        ].filter(Boolean).join(' ')
        return (
          <li key={w.id} className={cls}
            draggable
            onDragStart={(e) => {
              setDragId(w.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => { setDragId(null); setOverIdx(null) }}
            onDragOver={(e) => {
              if (!dragId || dragId === w.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOverIdx(rowIdx)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dragId !== w.id) onReorderTo(dragId, arrayIdxOf(rowIdx))
              setDragId(null)
              setOverIdx(null)
            }}>
            <button className="row-main" title={w.id}
              onClick={(e) => onSelect(w.id, e.ctrlKey || e.shiftKey)}>
              <span className="type">{TYPE_LABEL[w.type]}</span>
              <span className="name">{widgetName(w)}</span>
            </button>
            <button title={t('layers.up')} onClick={() => onReorder(w.id, 'up')}>
              <ChevronUp size={12} />
            </button>
            <button title={t('layers.down')} onClick={() => onReorder(w.id, 'down')}>
              <ChevronDown size={12} />
            </button>
            <button title={w.hidden ? t('layers.show') : t('layers.hide')}
              className={w.hidden ? 'toggled' : ''}
              onClick={() => onUpdate(w.id, { hidden: !w.hidden })}>
              {w.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button title={w.locked ? t('layers.unlock') : t('layers.lock')}
              className={w.locked ? 'toggled' : ''}
              onClick={() => onUpdate(w.id, { locked: !w.locked })}>
              {w.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <button title={t('layers.delete')} className="danger"
              onClick={() => onDelete(w.id)}>
              <Trash2 size={12} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
