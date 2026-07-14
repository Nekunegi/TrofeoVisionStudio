import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import {
  Upload, RotateCcw, MonitorCog, Palette,
  MousePointerClick, Bookmark, Zap, Copy, BringToFront, SendToBack, Bell,
  Layers, Trash2,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from 'lucide-react'
import DashboardStage from './DashboardStage'
import { useBackend } from './useBackend'
import { useAnimatedImage } from './useAnimatedImage'
import { useAudioSpectrum } from './useAudioSpectrum'
import { IDB_BG, IDB_BG_VIDEO, saveBgMedia, saveBgVideo } from './bgStore'
import { PANEL_W, PANEL_H, defaultLayout, type Sensors } from './types'
import { LS_KEY } from './layoutStore'
import { fileToDataUrl } from './imageUtils'
import { remapWidgetForRotation, clampWidget, layoutPanelRotate } from './widgetGeometry'
import { LayoutGroup, motion } from 'motion/react'
import { useSmoothedSensors } from './hooks/useSmoothedSensors'
import { useLayoutHistory } from './hooks/useLayoutHistory'
import { useWidgetOps, newId } from './hooks/useWidgetOps'
import { useEditorShortcuts } from './hooks/useEditorShortcuts'
import { useToasts } from './hooks/useToasts'
import { useStreamPipeline } from './hooks/useStreamPipeline'
import { WidgetProps } from './components/WidgetProps'
import { Presets } from './components/Presets'
import { LayerPanel } from './components/LayerPanel'
import { WidgetPalette } from './components/WidgetPalette'
import { FirstRunWizard } from './components/FirstRunWizard'
import { UpdateBell } from './components/UpdateBell'
import { LangToggle } from './components/LangToggle'
import { ThemeToggle } from './components/ThemeToggle'
import { BgEditorModal } from './components/BgEditorModal'
import { useT } from './i18n'
import pkg from '../package.json'
import './App.css'

export default function App() {
  const t = useT()
  const backend = useBackend()
  // Stable reference — the stream pipeline effect must NOT depend on `backend`
  // itself (new object every render; with an animated bg re-rendering at 20fps
  // the pipeline would be torn down before it ever fires).
  const { sendFrame } = backend
  const { layout, layoutRef, commit, undo, redo } = useLayoutHistory()
  // Multi-selection: widget ids in click order. Panels that only make sense
  // for a single widget (WidgetProps etc.) use the derived `selected` below.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectWidget = useCallback((id: string | null, additive = false) => {
    if (id === null) { setSelectedIds([]); return }
    setSelectedIds((prev) => additive
      ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
      : [id])
  }, [])
  const selectMany = useCallback((ids: string[], additive = false) => {
    setSelectedIds((prev) => (additive ? [...new Set([...prev, ...ids])] : ids))
  }, [])
  const [now, setNow] = useState(new Date())
  const [streaming, setStreaming] = useState(true)
  const [measuredFps, setMeasuredFps] = useState(0)
  const [history, setHistory] = useState<Sensors[]>([])
  // Background editor modal open state.
  const [bgEditorOpen, setBgEditorOpen] = useState(false)

  const stageRef = useRef<Konva.Stage>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const { frame: bgEl, fps: bgFps } = useAnimatedImage(layout.bgImage)
  // User-set fps ceiling ('auto' = 30fps animation cap). The adaptive logic
  // below stays — this only moves its upper bound. 30 is comfortably inside
  // the panel's measured USB capacity (avg ~12ms/frame, i.e. ~80fps) and
  // absorbs GIFs up to their 30fps decode cap without pulldown.
  const [maxFps, setMaxFps] = useState<number | 'auto'>(() => {
    const v = localStorage.getItem('lcd-maxfps')
    return v && v !== 'auto' && Number.isFinite(+v) ? +v : 'auto'
  })
  const fpsCeiling = maxFps === 'auto' ? 30 : maxFps
  // Stream rate follows the content: static layouts only change at 1Hz (clock /
  // sensors), animated backgrounds stream at their native frame rate (capped).
  const targetFps = Math.min(bgFps ?? 1, fpsCeiling)
  // Panel mounting orientation. UI-facing values (v2 scheme):
  //   0   = correctly mounted (the physical default — pump is upside-down,
  //          so the hardware buffer gets a 180° flip when we emit)
  //   90  / 270 = portrait
  //   180 = upside-down from the user's POV
  const panelRotate = layoutPanelRotate(layout)
  const isPortrait = panelRotate === 90 || panelRotate === 270
  // Physical panel size: self-reported by the device handshake (1280x480 on
  // the 6.86" model), constants until the backend reports one.
  const panelW = backend.panel?.w ?? PANEL_W
  const panelH = backend.panel?.h ?? PANEL_H
  const logicalW = isPortrait ? panelH : panelW
  const logicalH = isPortrait ? panelW : panelH

  // Smoothed sensor values drive the LCD widgets (raw 1Hz values feed history).
  // Easing pushes are capped at the stream ceiling — steps beyond what the
  // LCD can display are invisible and were burning ~1.3 cores (measured).
  const { display: displaySensors } = useSmoothedSensors(backend.sensors, fpsCeiling)

  // Keep every widget reachable when the logical canvas shrinks underneath
  // the layout — the panel size self-report arriving from the backend (1280
  // on the 6.86" model) or a rotation change. An out-of-bounds widget can't
  // be clicked on the stage. Skips the initial mount so a session that never
  // changes dims keeps intentional off-canvas placement untouched.
  const prevDimsRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${logicalW}x${logicalH}`
    const prev = prevDimsRef.current
    prevDimsRef.current = key
    if (prev === null || prev === key) return
    commit((l) => {
      let changed = false
      const widgets = l.widgets.map((w) => {
        const c = clampWidget(w, logicalW, logicalH)
        if (c !== w) changed = true
        return c
      })
      return changed ? { ...l, widgets } : l
    })
  }, [commit, logicalW, logicalH])

  // --- Windows toast overlay ------------------------------------------------
  const [notifyEnabled, setNotifyEnabled] = useState(
    () => localStorage.getItem('lcd-notify') !== 'off')
  const { toasts, pushToast } = useToasts(backend.notification, notifyEnabled)
  // Loopback audio spectrum — captured only while a visualizer widget exists.
  // The backend delivers frames at the fps ceiling so 60fps mode is real 60.
  const hasVisualizer = layout.widgets.some((w) => w.type === 'visualizer')
  const vizHz = Math.max(15, Math.min(60, fpsCeiling))
  const { bands: spectrum, error: vizError } =
    useAudioSpectrum(hasVisualizer, backend, vizHz)

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
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(layout))
      } catch (e) {
        if (!savedWarnedRef.current) {
          savedWarnedRef.current = true
          pushToast({
            id: -Date.now(),
            app: 'Trofeo Vision Studio',
            title: t('toast.saveFailTitle'),
            body: `${t('toast.saveFailBody')} (${e instanceof Error ? e.message : ''})`,
          })
        }
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, pushToast])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Rolling 1Hz sensor history for graph widgets (~2 min retained).
  useEffect(() => {
    setHistory((h) => [...h.slice(-119), backend.sensors])
  }, [backend.sensors])

  // useLayoutEffect (not useEffect) so a panel-rotate never paints once
  // at (new logicalW/H × old scale) — the scale correction is applied in
  // the same tick, before the browser paints. Also cures the cold-load
  // scale flash for portrait users (initial useState is a landscape seed).
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const bodyEl = document.querySelector('.body') as HTMLElement | null
    // Height cap tuned per orientation, both derived from the live body
    // height so preview + inspector fit ONE screen without page scroll:
    //   landscape (480 tall) — whatever height remains after the inspector
    //     masonry below (its height is static while editing since the
    //     volatile sections live in the .side panel). ~80px covers main
    //     paddings + device bezel + flex gap.
    //   portrait (1920 tall) — inspector sits BESIDE the preview, so the
    //     strip can use most of the window height.
    const maxCanvasH = () => {
      const bodyH = bodyEl?.clientHeight ?? 900
      if (isPortrait) return Math.max(500, bodyH - 60)
      const inspH = inspectorRef.current?.offsetHeight ?? 0
      return Math.max(160, Math.min(420, bodyH - inspH - 68))
    }
    // clientWidth of the wrap is set from the current scale, so use the
    // parent (.device) which is not scaled by our own output.
    const parent = el.parentElement
    const fit = () => {
      const w = parent ? parent.clientWidth : el.clientWidth
      const s = Math.min(1, w / logicalW, maxCanvasH() / logicalH)
      setScale(s)
    }
    // Watch the PARENT for width changes — our own wrap width is derived
    // from scale, so observing it would loop. The inspector is observed
    // because its masonry height decides the landscape canvas budget (its
    // height does not depend on the canvas, so this cannot loop either).
    const ro = new ResizeObserver(fit)
    fit()
    if (parent) ro.observe(parent)
    if (bodyEl) ro.observe(bodyEl)
    if (inspectorRef.current) ro.observe(inspectorRef.current)
    return () => ro.disconnect()
  }, [logicalW, logicalH, isPortrait])

  // Draw-driven LCD capture (throttled at fpsCeiling, rotation/filter
  // compositing, hidden-window sync-encode fallback) — see useStreamPipeline.
  useStreamPipeline({
    streaming, sendFrame, stageRef, layoutRef,
    link: backend.link, fpsCeiling, panelRotate, panelW, panelH,
    onMeasuredFps: setMeasuredFps,
  })

  // Exactly-one selection — the single-widget panels key off this.
  const selected = useMemo(
    () => (selectedIds.length === 1
      ? layout.widgets.find((w) => w.id === selectedIds[0]) ?? null
      : null),
    [layout, selectedIds],
  )

  // Widget mutations (add/move/resize/z-order/align/...), all routed through
  // the undo history's commit(). Stable callbacks — safe for the keyboard hook.
  const {
    selectedIdsRef, update, move, moveMany, resize, addWidget, del, duplicate,
    reorder, reorderOne, reorderTo, deleteById, align, nudge,
  } = useWidgetOps({ commit, layoutRef, logicalW, logicalH, selectedIds, setSelectedIds })

  useEditorShortcuts({ undo, redo, del, duplicate, nudge, selectedIdsRef })

  // Right-click context menu (canvas widgets): fixed-position, closes on any
  // outside press / Escape / window blur.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!ctxMenu) return
    const onPress = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.ctx-menu')) return
      setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    const onBlur = () => setCtxMenu(null)
    window.addEventListener('mousedown', onPress)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onPress)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [ctxMenu])

  // Small JPEG snapshot of the LCD content layer for preset list thumbnails.
  const captureThumb = useCallback(() => {
    const layer = stageRef.current?.getLayers()[0]
    if (!layer) return null
    try {
      return layer.toDataURL({
        pixelRatio: Math.min(224 / logicalW, 224 / logicalH),
        mimeType: 'image/jpeg', quality: 0.65,
      })
    } catch {
      return null
    }
  }, [logicalW, logicalH])

  // Two-step layout reset: first press arms for 3s, second press resets.
  const [confirmReset, setConfirmReset] = useState(false)
  const confirmResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
            {bgFps
              ? <>{t('header.target')} <b>{targetFps} fps</b> ({t('header.animatedBg')})</>
              : t('header.onDraw')}
            {measuredFps > 0 && streaming && <> · {t('header.out')}{' '}
              <b>{backend.lcdStats && Date.now() - backend.lcdStats.at < 5000
                ? backend.lcdStats.fps : measuredFps} fps</b></>}
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
          <ThemeToggle />
          <LangToggle />
          <UpdateBell />
        </div>
      </header>

      <div className="body">
        <main className={isPortrait ? 'portrait' : ''}>
        <LayoutGroup>
          <motion.div className="device" layout="position"
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <motion.div className="canvas-wrap" ref={wrapRef} layout
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              style={{
                width: logicalW * scale,
                height: logicalH * scale,
                margin: '0 auto',
              }}>
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
                  selectedIds={selectedIds}
                  onSelect={selectWidget}
                  onSelectMany={selectMany}
                  onMove={move}
                  onMoveMany={moveMany}
                  onResize={resize}
                  onWidgetMenu={(x, y) => setCtxMenu({
                    x: Math.min(x, window.innerWidth - 190),
                    y: Math.min(y, window.innerHeight - 190),
                  })}
                />
              </div>
            </motion.div>
          </motion.div>

          <motion.div className="inspector" ref={inspectorRef} layout="position"
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
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
          </section>

          <section>
            <h3><MonitorCog size={13} />{t('section.lcdAdjust')}</h3>
            <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>{t('lcd.hint')}</p>
            <label className="row"><span className="lbl">{t('lcd.panelRotate')}</span>
              <select value={panelRotate} onChange={(e) => {
                const v = +e.target.value as 0 | 90 | 180 | 270
                // Aspect-flip effects:
                //   - Stored bg crop was aspect-locked to the previous
                //     orientation; reset so DashboardStage cover-fits the
                //     raw source to the new panel aspect.
                //   - Widget positions were laid out against the previous
                //     logicalW/H; without remapping, widgets whose x > new
                //     logicalW land off-canvas and become unreachable via
                //     the stage. Rotate their centers with the panel so
                //     the layout stays roughly intact, then clamp to bounds.
                const wasPortrait = panelRotate === 90 || panelRotate === 270
                const willBePortrait = v === 90 || v === 270
                const aspectFlipped = wasPortrait !== willBePortrait
                const rotDeltaCW = (((v - panelRotate) + 360) % 360) as 0 | 90 | 180 | 270
                const nextLW = willBePortrait ? panelH : panelW
                const nextLH = willBePortrait ? panelW : panelH
                commit((l) => ({
                  ...l,
                  panelRotate: v,
                  panelRotateScheme: 'v2',
                  // Keep legacy flag consistent for older backends that read it.
                  rotate180: v === 0,
                  ...(aspectFlipped ? {
                    bgCropT: 0, bgCropR: 0, bgCropB: 0, bgCropL: 0,
                  } : {}),
                  widgets: rotDeltaCW === 0
                    ? l.widgets
                    : l.widgets.map((w) => aspectFlipped
                      ? remapWidgetForRotation(w, logicalW, logicalH, nextLW, nextLH, rotDeltaCW)
                      : clampWidget(w, nextLW, nextLH)),
                }))
              }}>
                <option value={0}>0° ({t('lcd.panelRotateDefault')})</option>
                <option value={90}>90° ({t('bg.portrait')})</option>
                <option value={180}>180°</option>
                <option value={270}>270° ({t('bg.portrait')})</option>
              </select>
            </label>
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
            <h3><Bookmark size={13} />{t('section.presets')}</h3>
            <Presets layout={layout} capture={captureThumb} onLoad={(l) => {
              // Clamp imported coords against the dims THIS layout renders at —
              // a layout exported on another panel/orientation may park
              // widgets off-canvas where the stage can't select them.
              const rot = layoutPanelRotate(l)
              const lw = rot === 90 || rot === 270 ? panelH : panelW
              const lh = rot === 90 || rot === 270 ? panelW : panelH
              commit(() => ({ ...l, widgets: l.widgets.map((w) => clampWidget(w, lw, lh)) }))
              setSelectedIds([])
            }} />
          </section>

          <section>
            <button className={confirmReset ? 'wide danger' : 'wide'} onClick={() => {
              if (!confirmReset) {
                // Arm for 3s — a stray click must not wipe the layout.
                setConfirmReset(true)
                if (confirmResetTimer.current) clearTimeout(confirmResetTimer.current)
                confirmResetTimer.current = setTimeout(() => setConfirmReset(false), 3000)
                return
              }
              if (confirmResetTimer.current) clearTimeout(confirmResetTimer.current)
              setConfirmReset(false)
              commit(() => defaultLayout()) // bg media kept in IDB so undo restores it
              setSelectedIds([])
              pushToast({
                id: -Date.now(), app: 'Trofeo Vision Studio',
                title: t('reset.doneTitle'), body: t('reset.doneBody'),
              })
            }}>
              <RotateCcw size={13} />{confirmReset ? t('reset.confirm') : t('reset.layout')}
            </button>
          </section>
          </motion.div>
        </LayoutGroup>
        </main>

        {/* Pinned right panel: the two height-volatile sections live here so
            the masonry below the canvas never reflows while editing. */}
        <aside className="side">
          <section>
            <h3><MousePointerClick size={13} />{t('section.selection')}
              {selected && <span className="tag">{selected.type}</span>}
              {selectedIds.length > 1 && <span className="tag">{selectedIds.length}</span>}
            </h3>
            {selectedIds.length === 0 && (
              <div className="hints">
                <div className="hint"><kbd>{t('hint.keyClick')}</kbd><span>{t('hint.select')}</span></div>
                <div className="hint"><kbd>{t('hint.keyShiftClick')}</kbd><span>{t('hint.multi')}</span></div>
                <div className="hint"><kbd>← ↑ ↓ →</kbd><span>{t('hint.move')}</span></div>
                <div className="hint"><kbd>Del</kbd><span>{t('hint.del')}</span></div>
                <div className="hint"><kbd>Ctrl+D</kbd><span>{t('hint.dup')}</span></div>
                <div className="hint"><kbd>Ctrl+Z / Y</kbd><span>{t('hint.undo')}</span></div>
                <div className="hint"><kbd>{t('hint.keyDrag')}</kbd><span>{t('hint.snap')}</span></div>
              </div>
            )}
            {selectedIds.length > 0 && (
              <>
                <div className="row actions">
                  <button onClick={duplicate}><Copy size={13} />{t('selection.copy')}</button>
                  <button onClick={() => reorder('front')}><BringToFront size={13} />{t('selection.front')}</button>
                  <button onClick={() => reorder('back')}><SendToBack size={13} />{t('selection.back')}</button>
                </div>
                <div className="row align-row">
                  <span className="lbl">{t('selection.align')}</span>
                  <div className="btn-group">
                    <button title={t('selection.alignLeft')} onClick={() => align('left')}><AlignStartVertical size={13} /></button>
                    <button title={t('selection.alignCenterH')} onClick={() => align('hcenter')}><AlignCenterVertical size={13} /></button>
                    <button title={t('selection.alignRight')} onClick={() => align('right')}><AlignEndVertical size={13} /></button>
                  </div>
                  <div className="btn-group">
                    <button title={t('selection.alignTop')} onClick={() => align('top')}><AlignStartHorizontal size={13} /></button>
                    <button title={t('selection.alignCenterV')} onClick={() => align('vcenter')}><AlignCenterHorizontal size={13} /></button>
                    <button title={t('selection.alignBottom')} onClick={() => align('bottom')}><AlignEndHorizontal size={13} /></button>
                  </div>
                </div>
              </>
            )}
            {selectedIds.length > 1 && (
              <>
                <p className="muted">{selectedIds.length} {t('selection.multiCount')}</p>
                <button className="wide danger" onClick={del}>
                  <Trash2 size={13} />{t('layers.delete')}
                </button>
              </>
            )}
            {selected && (
              <>
                <WidgetProps w={selected} update={update} onDelete={del} />
                {'metric' in selected && backend.link === 'open' &&
                  backend.sensors[selected.metric] == null && (
                  <p className="muted">
                    {t('selection.metricNA')}
                    {selected.metric === 'cpuTemp' ? ` ${t('selection.metricNACpu')}` : ''}
                  </p>
                )}
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
              selectedIds={selectedIds}
              onSelect={selectWidget}
              onUpdate={update}
              onDelete={deleteById}
              onReorder={reorderOne}
              onReorderTo={reorderTo}
            />
          </section>
        </aside>
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
      {ctxMenu && selectedIds.length > 0 && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button onClick={() => { duplicate(); setCtxMenu(null) }}>
            <Copy size={13} />{t('selection.copy')}
          </button>
          <button onClick={() => { reorder('front'); setCtxMenu(null) }}>
            <BringToFront size={13} />{t('selection.front')}
          </button>
          <button onClick={() => { reorder('back'); setCtxMenu(null) }}>
            <SendToBack size={13} />{t('selection.back')}
          </button>
          <button className="danger" onClick={() => { del(); setCtxMenu(null) }}>
            <Trash2 size={13} />{t('layers.delete')}
          </button>
        </div>
      )}
    </div>
  )
}
