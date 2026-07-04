import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import {
  Activity, Clock as ClockIcon, Type, Gauge as GaugeIcon, ChartLine, ChartBar,
  ImagePlus, Upload, RotateCcw, MonitorCog, Palette,
  MousePointerClick, Bookmark, Zap, Copy, BringToFront, SendToBack, Bell,
  Music, CloudSun, AudioLines,
} from 'lucide-react'
import DashboardStage, { type LcdToast } from './DashboardStage'
import { useBackend } from './useBackend'
import { useAnimatedImage } from './useAnimatedImage'
import { useAudioSpectrum } from './useAudioSpectrum'
import { IDB_BG, saveBgMedia } from './bgStore'
import {
  PANEL_W, PANEL_H, defaultLayout,
  type Layout, type Widget, type Sensors,
} from './types'
import { LS_KEY, loadLayout } from './layoutStore'
import { dataUrlToBytes, fileToDataUrl, fileToWidgetImage } from './imageUtils'
import { useSmoothedSensors } from './hooks/useSmoothedSensors'
import { SensorReadout } from './components/SensorReadout'
import { WidgetProps } from './components/WidgetProps'
import { Presets } from './components/Presets'
import './App.css'

let idc = 0
const newId = (t: string) => `${t}-${Date.now()}-${idc++}`

export default function App() {
  const backend = useBackend()
  // Stable reference — the stream interval effect must NOT depend on `backend`
  // itself (new object every render; with an animated bg re-rendering at 20fps
  // the interval would be torn down before it ever fires).
  const { sendFrame } = backend
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // --- undo/redo -----------------------------------------------------------
  // All layout mutations go through commit() (never bare setLayout), which
  // snapshots the previous state. layoutRef keeps commit() usable from stable
  // callbacks without re-subscribing keyboard handlers on every edit.
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const past = useRef<Layout[]>([])
  const future = useRef<Layout[]>([])

  const commit = useCallback((fn: (l: Layout) => Layout) => {
    const cur = layoutRef.current
    const next = fn(cur)
    if (next === cur) return
    past.current = [...past.current.slice(-99), cur]
    future.current = []
    layoutRef.current = next
    setLayout(next)
  }, [])

  const undo = useCallback(() => {
    const p = past.current.pop()
    if (!p) return
    future.current.push(layoutRef.current)
    layoutRef.current = p
    setLayout(p)
  }, [])

  const redo = useCallback(() => {
    const f = future.current.pop()
    if (!f) return
    past.current.push(layoutRef.current)
    layoutRef.current = f
    setLayout(f)
  }, [])
  const [now, setNow] = useState(new Date())
  const [streaming, setStreaming] = useState(true)
  const [measuredFps, setMeasuredFps] = useState(0)
  const [history, setHistory] = useState<Sensors[]>([])

  const stageRef = useRef<Konva.Stage>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const { frame: bgEl, fps: bgFps } = useAnimatedImage(layout.bgImage)
  // User-set fps ceiling ('auto' = the classic 20fps animation cap). The
  // adaptive logic below stays — this only moves its upper bound.
  const [maxFps, setMaxFps] = useState<number | 'auto'>(() => {
    const v = localStorage.getItem('lcd-maxfps')
    return v && v !== 'auto' && Number.isFinite(+v) ? +v : 'auto'
  })
  const fpsCeiling = maxFps === 'auto' ? 20 : maxFps
  // Stream rate follows the content: static layouts only change at 1Hz (clock /
  // sensors), animated backgrounds stream at their native frame rate (capped).
  const targetFps = Math.min(bgFps ?? 1, fpsCeiling)
  // Panel mounting is upside-down by default — see Layout.rotate180.
  const rotate180 = layout.rotate180 ?? true

  // Smoothed sensor values drive the LCD widgets (raw 1Hz values feed history).
  const { display: displaySensors, animating: sensorsAnimating } = useSmoothedSensors(backend.sensors)

  // --- Windows toast overlay ------------------------------------------------
  const TOAST_MS = 8000
  const [notifyEnabled, setNotifyEnabled] = useState(
    () => localStorage.getItem('lcd-notify') !== 'off')
  const [toasts, setToasts] = useState<LcdToast[]>([])
  const pushToast = useCallback((t: Omit<LcdToast, 'born' | 'until' | 'total'>) => {
    setToasts((ts) => [...ts.slice(-4),
      { ...t, born: Date.now(), until: Date.now() + TOAST_MS, total: TOAST_MS }])
  }, [])
  useEffect(() => {
    const n = backend.notification
    if (n && notifyEnabled) pushToast(n)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.notification])
  useEffect(() => {
    if (!toasts.length) return
    // always a fresh array: this tick doubles as the animation clock for the
    // toast slide/fade (re-render → new eased positions → streamed frame)
    const t = setInterval(() =>
      setToasts((ts) => ts.filter((x) => x.until > Date.now()).slice()), 50)
    return () => clearInterval(t)
  }, [toasts.length])
  // Loopback audio spectrum — captured only while a visualizer widget exists.
  // The backend delivers frames at the fps ceiling so 60fps mode is real 60.
  const hasVisualizer = layout.widgets.some((w) => w.type === 'visualizer')
  const vizHz = Math.max(15, Math.min(60, fpsCeiling))
  const { bands: spectrum, active: audioActive, error: vizError } =
    useAudioSpectrum(hasVisualizer, backend, vizHz)

  // Adaptive stream rate: idle static layouts stay at 1fps, but anything in
  // motion (toast slide/fade, sensor easing, audio bars) streams at animation speed.
  const streamFps = (toasts.length || sensorsAnimating || audioActive)
    ? Math.max(targetFps, fpsCeiling)
    : targetFps

  // Canvas text never triggers @font-face downloads — force-load the LCD fonts,
  // then re-render so Konva redraws (and re-measures) with the real glyphs.
  const [, setFontEpoch] = useState(0)
  useEffect(() => {
    Promise.all([
      document.fonts.load('500 16px Orbitron'),
      document.fonts.load('600 16px Orbitron'),
      document.fonts.load('700 16px Orbitron'),
      document.fonts.load('600 16px Rajdhani'),
      document.fonts.load('700 16px Rajdhani'),
    ]).then(() => setFontEpoch((e) => e + 1))
  }, [])

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(layout)) }
    catch { /* quota exceeded (large embedded media) — skip persistence */ }
  }, [layout])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Rolling 1Hz sensor history for graph widgets (~2 min retained).
  useEffect(() => {
    setHistory((h) => [...h.slice(-119), backend.sensors])
  }, [backend.sensors])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / PANEL_W)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reused offscreen canvas for the 180° output rotation (editor stays upright).
  const rotCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!streaming) return
    let n = 0
    const t0 = performance.now()
    let lastReport = t0
    const t = setInterval(() => {
      const stage = stageRef.current
      if (!stage) return
      // Capture only the content layer — layer 1 holds editor chrome (resize
      // handles) that must never reach the panel.
      let url: string
      if (rotate180) {
        // Konva's backing canvas may be devicePixelRatio-scaled; drawImage with
        // explicit destination size normalizes it back to panel resolution.
        const src = stage.getLayers()[0].getCanvas()._canvas
        let rc = rotCanvasRef.current
        if (!rc) {
          rc = document.createElement('canvas')
          rc.width = PANEL_W
          rc.height = PANEL_H
          rotCanvasRef.current = rc
        }
        const ctx = rc.getContext('2d')!
        ctx.save()
        ctx.translate(PANEL_W, PANEL_H)
        ctx.rotate(Math.PI)
        ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PANEL_W, PANEL_H)
        ctx.restore()
        url = rc.toDataURL('image/jpeg', 0.72)
      } else {
        url = stage.getLayers()[0].toDataURL({
          mimeType: 'image/jpeg', quality: 0.72, pixelRatio: 1,
          x: 0, y: 0, width: PANEL_W, height: PANEL_H,
        })
      }
      sendFrame(dataUrlToBytes(url))
      n++
      const p = performance.now()
      if (p - lastReport >= 1000) {
        setMeasuredFps(Math.round((n / ((p - t0) / 1000)) * 10) / 10)
        lastReport = p
      }
    }, Math.max(15, Math.round(1000 / streamFps))) // 15ms floor ≈ the 60fps cap
    return () => clearInterval(t)
  }, [streaming, sendFrame, streamFps, rotate180])

  const selected = useMemo(
    () => layout.widgets.find((w) => w.id === selectedId) ?? null,
    [layout, selectedId],
  )

  const update = useCallback((id: string, patch: Partial<Widget>) => {
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => (w.id === id ? { ...w, ...patch } as Widget : w)),
    }))
  }, [commit])

  const move = useCallback((id: string, x: number, y: number) => update(id, { x, y }), [update])

  // Absorb transformer scale into each widget's own size fields.
  const resize = useCallback((id: string, sx: number, sy: number, x: number, y: number) => {
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => {
        if (w.id !== id) return w
        const base = { ...w, x, y }
        switch (w.type) {
          case 'text': case 'clock': case 'sensor':
            return { ...base, fontSize: Math.max(10, Math.round(w.fontSize * sy)) } as Widget
          case 'gauge':
            return { ...base, size: Math.max(60, Math.round(w.size * sx)) } as Widget
          case 'bar': case 'image': case 'graph': case 'media': case 'weather':
          case 'visualizer':
            return {
              ...base,
              width: Math.max(20, Math.round(w.width * sx)),
              height: Math.max(10, Math.round(w.height * sy)),
            } as Widget
        }
      }),
    }))
  }, [commit])

  const addWidget = useCallback((w: Widget) => {
    commit((l) => ({ ...l, widgets: [...l.widgets, w] }))
    setSelectedId(w.id)
  }, [commit])

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const del = useCallback(() => {
    const id = selectedIdRef.current
    if (!id) return
    commit((l) => ({ ...l, widgets: l.widgets.filter((w) => w.id !== id) }))
    setSelectedId(null)
  }, [commit])

  const duplicate = useCallback(() => {
    const id = selectedIdRef.current
    if (!id) return
    const src = layoutRef.current.widgets.find((w) => w.id === id)
    if (!src) return
    const copy = { ...src, id: newId(src.type), x: src.x + 24, y: src.y + 24 }
    commit((l) => ({ ...l, widgets: [...l.widgets, copy] }))
    setSelectedId(copy.id)
  }, [commit])

  // Render order = array order; front/back moves the widget to either end.
  const reorder = useCallback((dir: 'front' | 'back') => {
    const id = selectedIdRef.current
    if (!id) return
    commit((l) => {
      const w = l.widgets.find((x) => x.id === id)
      if (!w) return l
      const rest = l.widgets.filter((x) => x.id !== id)
      return { ...l, widgets: dir === 'front' ? [...rest, w] : [w, ...rest] }
    })
  }, [commit])

  const nudge = useCallback((dx: number, dy: number) => {
    const id = selectedIdRef.current
    if (!id) return
    commit((l) => ({
      ...l,
      widgets: l.widgets.map((w) => (w.id === id ? { ...w, x: w.x + dx, y: w.y + dy } : w)),
    }))
  }, [commit])

  // Keyboard shortcuts: arrows nudge (Shift = 10px), Delete removes,
  // Ctrl+D duplicates, Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return }
      if (!selectedIdRef.current) return
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicate(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); return }
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      if (dx || dy) { e.preventDefault(); nudge(dx, dy) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, del, duplicate, nudge])

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo"><MonitorCog size={15} strokeWidth={2.2} /></span>
          <b>Trofeo Vision <small>STUDIO</small></b>
        </div>
        <span className={`pill ${backend.link}`}>
          <span className="dot" />Backend {backend.link === 'open' ? 'online' : backend.link}
        </span>
        <span className={`pill ${backend.device === 'connected' ? 'open' : 'closed'}`}>
          <span className="dot" />LCD {backend.device}
        </span>
        <div className="head-right">
          <span className="fpsinfo">
            target <b>{targetFps} fps</b> ({bgFps ? 'animated bg' : 'static'})
            {measuredFps > 0 && streaming && <> · out <b>{measuredFps} fps</b></>}
          </span>
          <label className="fpsmax">Max fps
            <select value={String(maxFps)} onChange={(e) => {
              const next = e.target.value === 'auto' ? 'auto' as const : +e.target.value
              setMaxFps(next)
              localStorage.setItem('lcd-maxfps', String(next))
            }}>
              <option value="auto">Auto</option>
              {[5, 10, 15, 20, 30, 60].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="switch">
            <input type="checkbox" checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)} />
            <span className="track" />
            Stream
          </label>
        </div>
      </header>

      <div className="body">
        <main>
          <div className="device">
            <div className="canvas-wrap" ref={wrapRef} style={{ height: PANEL_H * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <DashboardStage
                  ref={stageRef}
                  layout={layout}
                  sensors={displaySensors}
                  now={now}
                  history={history}
                  toasts={toasts.slice(-3)}
                  bgEl={bgEl}
                  media={backend.media}
                  spectrum={spectrum}
                  editable
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onMove={move}
                  onResize={resize}
                />
              </div>
            </div>
          </div>
          <SensorReadout backend={backend} />
        </main>

        <aside>
          <section>
            <h3><Zap size={13} />Add widget</h3>
            <div className="btns">
              <button className="wbtn" onClick={() => addWidget({ id: newId('sensor'), type: 'sensor',
                metric: 'cpuTemp', label: 'CPU', unit: '°C', x: 200, y: 200, fontSize: 120,
                color: '#00ffd0', bold: true })}><Activity size={17} />Sensor</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('gauge'), type: 'gauge',
                metric: 'cpuLoad', max: 100, size: 300, color: '#00ffd0', label: 'CPU',
                x: 800, y: 80 })}><GaugeIcon size={17} />Gauge</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('graph'), type: 'graph',
                metric: 'gpuLoad', label: 'GPU LOAD', max: 100, x: 200, y: 150,
                width: 600, height: 220, color: '#b18cff' })}><ChartLine size={17} />Graph</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('bar'), type: 'bar',
                metric: 'cpuLoad', label: 'CPU LOAD', x: 200, y: 300, width: 500, height: 20,
                max: 100, color: '#00ffd0' })}><ChartBar size={17} />Bar</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('clock'), type: 'clock',
                withDate: false, x: 200, y: 200, fontSize: 80, color: '#ffffff',
                bold: false })}><ClockIcon size={17} />Clock</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('text'), type: 'text',
                text: 'TEXT', x: 200, y: 200, fontSize: 60, color: '#ffffff',
                bold: false })}><Type size={17} />Text</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('media'), type: 'media',
                x: 200, y: 160, width: 620, height: 160, color: '#4de1ff',
                panelBlur: 12 })}><Music size={17} />Media</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('weather'), type: 'weather',
                place: '東京', lat: 35.6895, lon: 139.6917, x: 240, y: 140,
                width: 470, height: 170, color: '#ffd76a',
                panelBlur: 12 })}><CloudSun size={17} />Weather</button>
              <button className="wbtn" onClick={() => addWidget({ id: newId('viz'), type: 'visualizer',
                x: 510, y: 130, width: 900, height: 220, bars: 48, color: '#00ffd0',
                centered: true })}><AudioLines size={17} />Audio</button>
              <label className="wbtn"><ImagePlus size={17} />Image
                <input type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  const { src, w, h } = await fileToWidgetImage(f)
                  const fit = Math.min(1, 400 / w, 400 / h) // drop in at a sane size
                  addWidget({ id: newId('img'), type: 'image', src, x: 200, y: 100,
                    width: Math.round(w * fit), height: Math.round(h * fit) })
                }} />
              </label>
            </div>
          </section>

          <section>
            <h3><Palette size={13} />Background</h3>
            <label className="row"><span className="lbl">Color</span>
              <input type="color" value={layout.bgColor}
                onChange={(e) => commit((l) => ({ ...l, bgColor: e.target.value }))} />
            </label>
            <div className="row">
              <label className="filebtn"><Upload size={13} />Set image / GIF
                <input type="file" accept="image/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  const src = await fileToDataUrl(f)
                  // media goes to IndexedDB (localStorage can't hold a GIF)
                  await saveBgMedia(src)
                  commit((l) => ({ ...l, bgImage: IDB_BG }))
                }} />
              </label>
              {layout.bgImage && (
                // media stays in IndexedDB (overwritten on next Set) so that
                // undoing the clear brings the background back intact
                <button onClick={() => commit((l) => ({ ...l, bgImage: null }))}>
                  Clear
                </button>
              )}
            </div>
            <label className="row"><span className="lbl">Dim</span>
              <input type="range" min={0} max={0.8} step={0.05} value={layout.bgDim ?? 0}
                onChange={(e) => commit((l) => ({ ...l, bgDim: +e.target.value }))} />
              <span className="val">{Math.round((layout.bgDim ?? 0) * 100)}%</span>
            </label>
            <label className="row"><span className="lbl">Blur</span>
              <input type="range" min={0} max={40} step={1} value={layout.bgBlur ?? 0}
                onChange={(e) => commit((l) => ({ ...l, bgBlur: +e.target.value }))} />
              <span className="val">{layout.bgBlur ?? 0}px</span>
            </label>
            <label className="row"><span className="lbl">Rotate output 180°</span>
              <input type="checkbox" checked={rotate180}
                onChange={(e) => commit((l) => ({ ...l, rotate180: e.target.checked }))} />
            </label>
          </section>

          <section>
            <h3><Bell size={13} />Notifications</h3>
            <label className="row"><span className="lbl">Show on LCD</span>
              <input type="checkbox" checked={notifyEnabled}
                onChange={(e) => {
                  setNotifyEnabled(e.target.checked)
                  localStorage.setItem('lcd-notify', e.target.checked ? 'on' : 'off')
                }} />
            </label>
            {backend.notifyStatus === 'denied' && (
              <p className="muted">
                Windowsの設定 → プライバシーとセキュリティ → 通知 →
                「アプリからの通知へのアクセス」を許可してください
              </p>
            )}
            {backend.notifyStatus.startsWith('unsupported') && (
              <p className="muted">この環境では通知の取得がサポートされていません</p>
            )}
            <button onClick={() => pushToast({
              id: -Date.now(), app: 'Trofeo Vision Studio',
              title: 'テスト通知', body: 'ゲーム中でもここに通知が表示されます',
            })}>Test toast</button>
          </section>

          <section>
            <h3><MousePointerClick size={13} />Selection
              {selected && <span className="tag">{selected.type}</span>}
            </h3>
            {!selected && (
              <p className="muted">
                キャンバスのウィジェットをクリックで選択<br />
                矢印キー: 移動 (Shift=10px) · Del: 削除<br />
                Ctrl+D: 複製 · Ctrl+Z/Y: 元に戻す/やり直し<br />
                Alt+ドラッグ: スナップ無効
              </p>
            )}
            {selected && (
              <>
                <div className="row">
                  <button onClick={duplicate}><Copy size={13} />Copy</button>
                  <button onClick={() => reorder('front')}><BringToFront size={13} />Front</button>
                  <button onClick={() => reorder('back')}><SendToBack size={13} />Back</button>
                </div>
                <WidgetProps w={selected} update={update} onDelete={del} />
                {selected.type === 'visualizer' && (
                  vizError ? (
                    <p className="muted">
                      ⚠ 音声キャプチャ失敗(15秒ごとに再試行中): {vizError.slice(0, 160)}
                    </p>
                  ) : spectrum == null ? (
                    <p className="muted">音声キャプチャを開始しています…</p>
                  ) : null
                )}
              </>
            )}
          </section>

          <section>
            <h3><Bookmark size={13} />Presets</h3>
            <Presets layout={layout} onLoad={(l) => { commit(() => l); setSelectedId(null) }} />
          </section>

          <section>
            <button className="wide" onClick={() => {
              commit(() => defaultLayout()) // bg media kept in IDB so undo restores it
              setSelectedId(null)
            }}>
              <RotateCcw size={13} />Reset layout
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
