import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import {
  Upload, RotateCcw, MonitorCog, Palette,
  MousePointerClick, Bookmark, Zap, Copy, BringToFront, SendToBack, Bell,
  Layers,
} from 'lucide-react'
import DashboardStage, { type LcdToast } from './DashboardStage'
import { useBackend } from './useBackend'
import { useAnimatedImage } from './useAnimatedImage'
import { useAudioSpectrum } from './useAudioSpectrum'
import { IDB_BG, IDB_BG_VIDEO, saveBgMedia, saveBgVideo } from './bgStore'
import {
  PANEL_W, PANEL_H, defaultLayout,
  type Layout, type Widget, type Sensors,
} from './types'
import { LS_KEY, loadLayout } from './layoutStore'
import { fileToDataUrl } from './imageUtils'
import { useSmoothedSensors } from './hooks/useSmoothedSensors'
import { WidgetProps } from './components/WidgetProps'
import { Presets } from './components/Presets'
import { LayerPanel } from './components/LayerPanel'
import { WidgetPalette } from './components/WidgetPalette'
import { FirstRunWizard } from './components/FirstRunWizard'
import { UpdateBell } from './components/UpdateBell'
import { LangToggle } from './components/LangToggle'
import { BgEditorModal } from './components/BgEditorModal'
import { useT } from './i18n'
import pkg from '../package.json'
import './App.css'

let idc = 0
const newId = (t: string) => `${t}-${Date.now()}-${idc++}`

export default function App() {
  const t = useT()
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
  // Background editor modal open state.
  const [bgEditorOpen, setBgEditorOpen] = useState(false)

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
  // Panel mounting orientation. Legacy `rotate180` maps to 180°; new field
  // `panelRotate` supersedes it and adds 90/270 for portrait mounting.
  const panelRotate: 0 | 90 | 180 | 270 =
    layout.panelRotate ?? (layout.rotate180 === false ? 0 : 180)
  const isPortrait = panelRotate === 90 || panelRotate === 270
  const logicalW = isPortrait ? PANEL_H : PANEL_W
  const logicalH = isPortrait ? PANEL_W : PANEL_H

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

  // Debounce the layout save — otherwise every mouse-move during a drag
  // stringifies and rewrites the layout (~60 writes/sec), which slows the
  // main thread and pointlessly wears localStorage.
  const savedWarnedRef = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(layout))
      } catch (e) {
        if (!savedWarnedRef.current) {
          savedWarnedRef.current = true
          pushToast({
            id: -Date.now(),
            app: 'Trofeo Vision Studio',
            title: 'レイアウト保存失敗',
            body: `localStorage の容量を超えました — 再起動でリセットされます (${e instanceof Error ? e.message : ''})`,
          })
        }
      }
    }, 300)
    return () => clearTimeout(t)
  }, [layout, pushToast])

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
    // Fit both dimensions: portrait would be 480×1920 (way taller than wide),
    // so we cap by height too — 420px is a comfortable viewport slice.
    const MAX_H = 420
    const fit = () => {
      const s = Math.min(1, el.clientWidth / logicalW, MAX_H / logicalH)
      setScale(s)
    }
    const ro = new ResizeObserver(fit)
    fit()
    ro.observe(el)
    return () => ro.disconnect()
  }, [logicalW, logicalH])

  // Reused offscreen canvas for the panel-rotation compositing (editor stays
  // in logical coords; this canvas is the physical 1920×480 hardware buffer).
  const rotCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // Keep dynamic scheduling parameters in refs so we can read the latest
  // value inside a long-lived setTimeout chain WITHOUT tearing down the loop
  // every time streamFps flips (which happens 20+ times/sec as sensors ease).
  const streamFpsRef = useRef(streamFps)
  const panelRotateRef = useRef<0 | 90 | 180 | 270>(panelRotate)
  const linkRef = useRef(backend.link)
  streamFpsRef.current = streamFps
  panelRotateRef.current = panelRotate
  linkRef.current = backend.link

  useEffect(() => {
    if (!streaming) return
    let n = 0
    const t0 = performance.now()
    let lastReport = t0
    let cancelled = false
    let handle: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      if (cancelled) return
      const stage = stageRef.current
      if (!stage) { handle = setTimeout(tick, 100); return }
      // Skip encoding entirely if the backend socket is dead — sendFrame
      // would silently drop the bytes anyway. Poll at 1Hz to catch reconnect.
      if (linkRef.current !== 'open') {
        handle = setTimeout(tick, 1000)
        return
      }
      const l = layoutRef.current
      const contrast = l.lcdContrast ?? 1
      const saturation = l.lcdSaturation ?? 1
      const brightness = l.lcdBrightness ?? 1
      const needsFilter = contrast !== 1 || saturation !== 1 || brightness !== 1
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
      if (needsFilter) {
        ctx.filter = `contrast(${contrast}) saturate(${saturation}) brightness(${brightness})`
      }
      const rot = panelRotateRef.current
      switch (rot) {
        case 0:
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PANEL_W, PANEL_H)
          break
        case 90:
          ctx.translate(PANEL_W, 0)
          ctx.rotate(Math.PI / 2)
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PANEL_H, PANEL_W)
          break
        case 180:
          ctx.translate(PANEL_W, PANEL_H)
          ctx.rotate(Math.PI)
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PANEL_W, PANEL_H)
          break
        case 270:
          ctx.translate(0, PANEL_H)
          ctx.rotate(-Math.PI / 2)
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PANEL_H, PANEL_W)
          break
      }
      ctx.restore()

      const emitAt = performance.now()
      rc.toBlob(async (blob) => {
        if (cancelled) return
        if (blob) {
          const buf = await blob.arrayBuffer()
          if (cancelled) return
          sendFrame(new Uint8Array(buf))
          n++
          const p = performance.now()
          if (p - lastReport >= 1000) {
            setMeasuredFps(Math.round((n / ((p - t0) / 1000)) * 10) / 10)
            lastReport = p
          }
        }
        // Self-schedule the next tick against the CURRENT streamFps target.
        // Reading through a ref avoids the effect-teardown thrash that
        // happens whenever sensors flip sensorsAnimating on/off.
        const nextIn = Math.max(15, Math.round(1000 / streamFpsRef.current) - (performance.now() - emitAt))
        if (!cancelled) handle = setTimeout(tick, Math.max(0, nextIn))
      }, 'image/jpeg', 0.72)
    }
    handle = setTimeout(tick, 0)
    return () => { cancelled = true; if (handle) clearTimeout(handle) }
  }, [streaming, sendFrame])

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

  // Move a specific widget one step in z-order (LayerPanel row arrows).
  // 'up' = closer to viewer = higher array index.
  const reorderOne = useCallback((id: string, dir: 'up' | 'down') => {
    commit((l) => {
      const idx = l.widgets.findIndex((x) => x.id === id)
      if (idx < 0) return l
      const target = dir === 'up' ? idx + 1 : idx - 1
      if (target < 0 || target >= l.widgets.length) return l
      const arr = l.widgets.slice()
      const [w] = arr.splice(idx, 1)
      arr.splice(target, 0, w)
      return { ...l, widgets: arr }
    })
  }, [commit])

  const deleteById = useCallback((id: string) => {
    commit((l) => ({ ...l, widgets: l.widgets.filter((w) => w.id !== id) }))
    if (selectedIdRef.current === id) setSelectedId(null)
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
  // Suppressed while a modal (bg editor, first-run wizard) is open — the
  // modal owns keyboard focus and any Delete/Ctrl+Z hitting through to the
  // underlying layout would silently destroy work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Any modal open? Editor / wizard block the whole shortcut set.
      if (document.querySelector('.bg-editor-backdrop, .wizard-backdrop')) return
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
      <FirstRunWizard backend={backend} />
      <header>
        <div className="brand">
          <b>Trofeo Vision <small>STUDIO</small></b>
          <span className="ver">v{pkg.version}</span>
        </div>
        <span className={`pill ${backend.link}`}>
          <span className="dot" />{backend.link === 'open' ? t('backend.online')
            : backend.link === 'connecting' ? t('backend.connecting')
            : t('backend.closed')}
        </span>
        <span className={`pill ${backend.device === 'connected' ? 'open' : 'closed'}`}>
          <span className="dot" />{backend.device === 'connected' ? t('lcd.connected') : t('lcd.notFound')}
        </span>
        <div className="head-right">
          <span className="fpsinfo">
            {t('header.target')} <b>{targetFps} fps</b> ({bgFps ? t('header.animatedBg') : t('header.staticBg')})
            {measuredFps > 0 && streaming && <> · {t('header.out')} <b>{measuredFps} fps</b></>}
          </span>
          <label className="fpsmax">{t('header.maxFps')}
            <select value={String(maxFps)} onChange={(e) => {
              const next = e.target.value === 'auto' ? 'auto' as const : +e.target.value
              setMaxFps(next)
              localStorage.setItem('lcd-maxfps', String(next))
            }}>
              <option value="auto">{t('header.auto')}</option>
              {[5, 10, 15, 20, 30, 60].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="switch">
            <input type="checkbox" checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)} />
            <span className="track" />
            {t('header.stream')}
          </label>
          <LangToggle />
          <UpdateBell />
        </div>
      </header>

      <div className="body">
        <main>
          <div className="device">
            <div className="canvas-wrap" ref={wrapRef} style={{ height: logicalH * scale, width: isPortrait ? logicalW * scale : undefined, margin: isPortrait ? '0 auto' : undefined }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <DashboardStage
                  ref={stageRef}
                  logicalW={logicalW}
                  logicalH={logicalH}
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

          <div className="inspector">
          <section>
            <h3><Zap size={13} />{t('section.addWidget')}</h3>
            <WidgetPalette newId={newId} onAdd={addWidget} />
          </section>

          <section>
            <h3><Palette size={13} />{t('section.background')}</h3>
            <label className="row"><span className="lbl">{t('bg.color')}</span>
              <input type="color" value={layout.bgColor}
                onChange={(e) => commit((l) => ({ ...l, bgColor: e.target.value }))} />
            </label>
            <div className="row">
              <label className="filebtn"><Upload size={13} />{t('bg.setMedia')}
                <input type="file" accept="image/*,video/*" hidden onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return
                  // `#<epoch>` forces useAnimatedImage to re-run its effect
                  // even when the previous bgImage was the same sentinel type
                  // (React deps compare with Object.is on the string).
                  const stamp = `#${Date.now()}`
                  if (f.type.startsWith('video/')) {
                    await saveBgVideo(f)
                    commit((l) => ({
                      ...l, bgImage: IDB_BG_VIDEO + stamp,
                      // Reset transforms so the editor opens against a clean slate.
                      bgOffsetX: 0, bgOffsetY: 0, bgScale: 1, bgRotate: 0,
                      bgFlipX: false, bgFlipY: false,
                      bgCropT: 0, bgCropR: 0, bgCropB: 0, bgCropL: 0,
                    }))
                  } else {
                    const src = await fileToDataUrl(f)
                    await saveBgMedia(src)
                    commit((l) => ({
                      ...l, bgImage: IDB_BG + stamp,
                      bgOffsetX: 0, bgOffsetY: 0, bgScale: 1, bgRotate: 0,
                      bgFlipX: false, bgFlipY: false,
                      bgCropT: 0, bgCropR: 0, bgCropB: 0, bgCropL: 0,
                    }))
                  }
                  // Allow re-selecting the same file later, and open the editor
                  // once the frame is decoded (useAnimatedImage populates bgEl
                  // asynchronously — the modal render gate handles the wait).
                  e.target.value = ''
                  setBgEditorOpen(true)
                }} />
              </label>
              {layout.bgImage && (
                <button onClick={() => commit((l) => ({ ...l, bgImage: null }))}>
                  {t('bg.clear')}
                </button>
              )}
            </div>

            {layout.bgImage && (
              <>
                <button
                  className="wide bg-edit-btn"
                  onClick={() => setBgEditorOpen(true)}
                  disabled={!bgEl}
                >
                  {t('bg.editPreview')}
                </button>
                <label className="row"><span className="lbl">{t('bg.dim')}</span>
                  <input type="range" min={0} max={0.8} step={0.05} value={layout.bgDim ?? 0}
                    onChange={(e) => commit((l) => ({ ...l, bgDim: +e.target.value }))} />
                  <span className="val">{Math.round((layout.bgDim ?? 0) * 100)}%</span>
                </label>
                <label className="row"><span className="lbl">{t('bg.blur')}</span>
                  <input type="range" min={0} max={40} step={1} value={layout.bgBlur ?? 0}
                    onChange={(e) => commit((l) => ({ ...l, bgBlur: +e.target.value }))} />
                  <span className="val">{layout.bgBlur ?? 0}px</span>
                </label>
              </>
            )}

            <label className="row"><span className="lbl">{t('bg.panelRotate')}</span>
              <select value={panelRotate} onChange={(e) => {
                const v = +e.target.value as 0 | 90 | 180 | 270
                commit((l) => ({ ...l, panelRotate: v, rotate180: v === 180 }))
              }}>
                <option value={0}>0°</option>
                <option value={90}>90° ({t('bg.portrait')})</option>
                <option value={180}>180°</option>
                <option value={270}>270° ({t('bg.portrait')})</option>
              </select>
            </label>
          </section>

          <section>
            <h3><MonitorCog size={13} />{t('section.lcdAdjust')}</h3>
            <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>{t('lcd.hint')}</p>
            <label className="row"><span className="lbl">{t('lcd.contrast')}</span>
              <input type="range" min={0.7} max={1.6} step={0.05}
                value={layout.lcdContrast ?? 1}
                onChange={(e) => commit((l) => ({ ...l, lcdContrast: +e.target.value }))} />
              <span className="val">{(layout.lcdContrast ?? 1).toFixed(2)}</span>
            </label>
            <label className="row"><span className="lbl">{t('lcd.saturation')}</span>
              <input type="range" min={0.7} max={1.6} step={0.05}
                value={layout.lcdSaturation ?? 1}
                onChange={(e) => commit((l) => ({ ...l, lcdSaturation: +e.target.value }))} />
              <span className="val">{(layout.lcdSaturation ?? 1).toFixed(2)}</span>
            </label>
            <label className="row"><span className="lbl">{t('lcd.brightness')}</span>
              <input type="range" min={0.7} max={1.6} step={0.05}
                value={layout.lcdBrightness ?? 1}
                onChange={(e) => commit((l) => ({ ...l, lcdBrightness: +e.target.value }))} />
              <span className="val">{(layout.lcdBrightness ?? 1).toFixed(2)}</span>
            </label>
            <div className="row">
              <button onClick={() => commit((l) => ({
                ...l, lcdContrast: 1, lcdSaturation: 1, lcdBrightness: 1,
              }))}>{t('lcd.reset')}</button>
            </div>
          </section>

          <section>
            <h3><Bell size={13} />{t('section.notifications')}</h3>
            <label className="row"><span className="lbl">{t('notify.show')}</span>
              <input type="checkbox" checked={notifyEnabled}
                onChange={(e) => {
                  setNotifyEnabled(e.target.checked)
                  localStorage.setItem('lcd-notify', e.target.checked ? 'on' : 'off')
                }} />
            </label>
            {backend.notifyStatus === 'denied' && (
              <p className="muted">{t('notify.denied')}</p>
            )}
            {backend.notifyStatus.startsWith('unsupported') && (
              <p className="muted">{t('notify.unsupported')}</p>
            )}
            <button onClick={() => pushToast({
              id: -Date.now(), app: 'Trofeo Vision Studio',
              title: t('notify.testTitle'), body: t('notify.testBody'),
            })}>{t('notify.test')}</button>
          </section>

          <section>
            <h3><MousePointerClick size={13} />{t('section.selection')}
              {selected && <span className="tag">{selected.type}</span>}
            </h3>
            {!selected && (
              <p className="muted" style={{ whiteSpace: 'pre-line' }}>{t('selection.hint')}</p>
            )}
            {selected && (
              <>
                <div className="row">
                  <button onClick={duplicate}><Copy size={13} />{t('selection.copy')}</button>
                  <button onClick={() => reorder('front')}><BringToFront size={13} />{t('selection.front')}</button>
                  <button onClick={() => reorder('back')}><SendToBack size={13} />{t('selection.back')}</button>
                </div>
                <WidgetProps w={selected} update={update} onDelete={del} />
                {selected.type === 'visualizer' && (
                  vizError ? (
                    <p className="muted">
                      {t('selection.vizError')} {vizError.slice(0, 160)}
                    </p>
                  ) : spectrum == null ? (
                    <p className="muted">{t('selection.vizStarting')}</p>
                  ) : null
                )}
              </>
            )}
          </section>

          <section>
            <h3><Layers size={13} />{t('section.layers')} <span className="tag">{layout.widgets.length}</span></h3>
            <LayerPanel
              widgets={layout.widgets}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUpdate={update}
              onDelete={deleteById}
              onReorder={reorderOne}
            />
          </section>

          <section>
            <h3><Bookmark size={13} />{t('section.presets')}</h3>
            <Presets layout={layout} onLoad={(l) => { commit(() => l); setSelectedId(null) }} />
          </section>

          <section>
            <button className="wide" onClick={() => {
              commit(() => defaultLayout()) // bg media kept in IDB so undo restores it
              setSelectedId(null)
            }}>
              <RotateCcw size={13} />{t('reset.layout')}
            </button>
          </section>
          </div>
        </main>
      </div>
      {bgEditorOpen && bgEl && (
        <BgEditorModal
          layout={layout}
          bgEl={bgEl}
          logicalW={logicalW}
          logicalH={logicalH}
          onCommit={(patch) => commit((l) => ({ ...l, ...patch }))}
          onClose={() => setBgEditorOpen(false)}
        />
      )}
    </div>
  )
}
