import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { geocode } from '../weather'
import {
  METRIC_LABELS,
  type Widget, type SensorMetric, type WidgetFont,
} from '../types'
import { TEMPLATE_HINTS } from '../textTemplate'

export function WidgetProps({ w, update, onDelete }:
{ w: Widget; update: (id: string, p: Partial<Widget>) => void; onDelete: () => void }) {
  const metrics = Object.keys(METRIC_LABELS) as SensorMetric[]
  return (
    <div className="props">
      {'color' in w && (
        <label className="row"><span className="lbl">Color</span>
          <input type="color" value={w.color}
            onChange={(e) => update(w.id, { color: e.target.value })} />
        </label>
      )}
      {'fontSize' in w && (
        <label className="row"><span className="lbl">Size</span>
          <input type="range" min={20} max={260} value={w.fontSize}
            onChange={(e) => update(w.id, { fontSize: +e.target.value })} />
          <span className="val">{w.fontSize}</span>
        </label>
      )}
      {(w.type === 'text' || w.type === 'clock' || w.type === 'sensor') && (
        <label className="row"><span className="lbl">Font</span>
          <select value={w.font ?? (w.type === 'text' ? 'rajdhani' : 'orbitron')}
            onChange={(e) => update(w.id, { font: e.target.value as WidgetFont })}>
            <option value="orbitron">Orbitron</option>
            <option value="rajdhani">Rajdhani</option>
            <option value="inter">Inter</option>
          </select>
        </label>
      )}
      <label className="row"><span className="lbl">Opacity</span>
        <input type="range" min={0.1} max={1} step={0.05} value={w.opacity ?? 1}
          onChange={(e) => update(w.id, { opacity: +e.target.value })} />
        <span className="val">{Math.round((w.opacity ?? 1) * 100)}%</span>
      </label>
      {(w.type === 'sensor' || w.type === 'bar' || w.type === 'gauge' || w.type === 'graph') && (
        <label className="row"><span className="lbl">Metric</span>
          <select value={w.metric}
            onChange={(e) => {
              const m = e.target.value as SensorMetric
              update(w.id, w.type === 'sensor'
                ? { metric: m, unit: METRIC_LABELS[m].unit, label: METRIC_LABELS[m].label }
                : w.type === 'gauge' || w.type === 'graph'
                  ? { metric: m, label: METRIC_LABELS[m].label }
                  : { metric: m })
            }}>
            {metrics.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}
      {(w.type === 'sensor' || w.type === 'gauge' || w.type === 'graph' || w.type === 'bar') && (
        <label className="row"><span className="lbl">Label</span>
          <input value={w.label ?? ''}
            onChange={(e) => update(w.id, { label: e.target.value })} />
        </label>
      )}
      {w.type === 'gauge' && (
        <label className="row"><span className="lbl">Size</span>
          <input type="range" min={100} max={460} value={w.size}
            onChange={(e) => update(w.id, { size: +e.target.value })} />
          <span className="val">{w.size}</span>
        </label>
      )}
      {(w.type === 'bar' || w.type === 'image' || w.type === 'graph'
        || w.type === 'media' || w.type === 'weather' || w.type === 'visualizer') && (
        <>
          <label className="row"><span className="lbl">Width</span>
            <input type="number" min={10} value={w.width}
              onChange={(e) => update(w.id, { width: Math.max(10, +e.target.value || 10) })} />
          </label>
          <label className="row"><span className="lbl">Height</span>
            <input type="number" min={10} value={w.height}
              onChange={(e) => update(w.id, { height: Math.max(10, +e.target.value || 10) })} />
          </label>
        </>
      )}
      {w.type === 'text' && (
        <>
          <label className="row"><span className="lbl">Text</span>
            <input value={w.text} onChange={(e) => update(w.id, { text: e.target.value })} />
          </label>
          <div className="row">
            <span className="lbl">Vars</span>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 3, flex: 1, minWidth: 0,
            }}>
              {TEMPLATE_HINTS.map((h) => (
                <button key={h} type="button"
                  onClick={() => update(w.id, { text: (w.text ?? '') + h })}
                  style={{
                    fontSize: 10, padding: '2px 5px', opacity: 0.8,
                    fontFamily: 'ui-monospace, Menlo, monospace',
                  }}>{h}</button>
              ))}
            </div>
          </div>
        </>
      )}
      {w.type === 'clock' && (
        <>
          <label className="row"><span className="lbl">Date</span>
            <input type="checkbox" checked={w.withDate}
              onChange={(e) => update(w.id, { withDate: e.target.checked })} />
          </label>
          <label className="row"><span className="lbl">Seconds</span>
            <input type="checkbox" checked={w.showSeconds ?? true}
              onChange={(e) => update(w.id, { showSeconds: e.target.checked })} />
          </label>
          <label className="row"><span className="lbl">12-hour</span>
            <input type="checkbox" checked={w.twelveHour ?? false}
              onChange={(e) => update(w.id, { twelveHour: e.target.checked })} />
          </label>
        </>
      )}
      {(w.type === 'bar' || w.type === 'gauge' || w.type === 'graph') && (
        <label className="row"><span className="lbl">Max</span>
          <input type="number" value={w.max}
            onChange={(e) => update(w.id, { max: Math.max(1, +e.target.value) })} />
        </label>
      )}
      {(w.type === 'bar' || w.type === 'graph') && (
        <>
          <label className="row"><span className="lbl">Warn ≥</span>
            <input type="number" value={w.warnAt ?? ''} placeholder="off"
              onChange={(e) => update(w.id, {
                warnAt: e.target.value === '' ? undefined : +e.target.value,
              })} />
            <input type="color" value={w.warnColor ?? '#ffb74d'}
              onChange={(e) => update(w.id, { warnColor: e.target.value })}
              disabled={w.warnAt == null}
              style={{ width: 32, opacity: w.warnAt == null ? 0.4 : 1 }} />
          </label>
          <label className="row"><span className="lbl">Crit ≥</span>
            <input type="number" value={w.critAt ?? ''} placeholder="off"
              onChange={(e) => update(w.id, {
                critAt: e.target.value === '' ? undefined : +e.target.value,
              })} />
            <input type="color" value={w.critColor ?? '#ff5252'}
              onChange={(e) => update(w.id, { critColor: e.target.value })}
              disabled={w.critAt == null}
              style={{ width: 32, opacity: w.critAt == null ? 0.4 : 1 }} />
          </label>
        </>
      )}
      {(w.type === 'bar' || w.type === 'gauge' || w.type === 'graph'
        || w.type === 'media' || w.type === 'weather') && (
        <label className="row"><span className="lbl">Glass</span>
          <input type="range" min={0} max={30} value={w.panelBlur ?? 0}
            onChange={(e) => update(w.id, { panelBlur: +e.target.value })} />
          <span className="val">{w.panelBlur ?? 0}px</span>
        </label>
      )}
      {w.type === 'weather' && <WeatherPlaceField w={w} update={update} />}
      {w.type === 'visualizer' && (
        <>
          <label className="row"><span className="lbl">Bars</span>
            <input type="range" min={12} max={96} step={4} value={w.bars}
              onChange={(e) => update(w.id, { bars: +e.target.value })} />
            <span className="val">{w.bars}</span>
          </label>
          <label className="row"><span className="lbl">Color 2</span>
            <input type="color" value={w.color2 ?? w.color}
              onChange={(e) => update(w.id, { color2: e.target.value })} />
          </label>
          <label className="row"><span className="lbl">Centered</span>
            <input type="checkbox" checked={w.centered ?? true}
              onChange={(e) => update(w.id, { centered: e.target.checked })} />
          </label>
        </>
      )}
      <button className="danger wide" onClick={onDelete}><Trash2 size={13} />Delete</button>
    </div>
  )
}

// City search for weather widgets: free-text -> Open-Meteo geocoding -> lat/lon.
function WeatherPlaceField({ w, update }: {
  w: Extract<Widget, { type: 'weather' }>
  update: (id: string, p: Partial<Widget>) => void
}) {
  const [q, setQ] = useState(w.place)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setQ(w.place); setErr('') }, [w.id, w.place])
  const search = async () => {
    const query = q.trim()
    if (!query || busy) return
    setBusy(true)
    setErr('')
    const r = await geocode(query)
    setBusy(false)
    if (r) update(w.id, { place: r.name, lat: r.lat, lon: r.lon } as Partial<Widget>)
    else setErr('見つかりませんでした')
  }
  return (
    <>
      <label className="row"><span className="lbl">City</span>
        <input value={q} placeholder="東京 / Tokyo"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }} />
        <button onClick={search} disabled={busy}>{busy ? '…' : 'Set'}</button>
      </label>
      {err && <p className="muted">{err}</p>}
    </>
  )
}
