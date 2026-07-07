import { forwardRef, useEffect, useRef, useState } from 'react'
import {
  Stage, Layer, Rect, Text, Group, Line, Circle, Shape,
  Transformer,
} from 'react-konva'
import type Konva from 'konva'
import {
  PANEL_W, PANEL_H, METRIC_LABELS,
  type Layout, type MediaState, type Sensors, type Widget,
} from './types'
import {
  FONT_NUM, FONT_LABEL, family, LABEL_FILL, PANEL_FILL, GLASS_TINT,
  withAlpha, textW, fmt, fmtU, metricValue, GRAPH_SAMPLES, cardR, type BgEnv,
} from './dashboard/theme'
import { GlassPanel, PanelStroke, WidgetImage } from './dashboard/primitives'
import { ToastCard, type LcdToast } from './dashboard/ToastCard'
import { WeatherCard } from './dashboard/WeatherCard'
import { MediaCard } from './dashboard/MediaCard'
import { VisualizerBars } from './dashboard/VisualizerBars'
import { substituteTemplate } from './textTemplate'

const WARN_COLOR = '#ffb74d'
const CRIT_COLOR = '#ff5252'

export type { LcdToast }

function renderInner(w: Widget, sensors: Sensors, now: Date, history: Sensors[], bg: BgEnv,
  media: MediaState | null, spectrum: number[] | null) {
  switch (w.type) {
    case 'text':
      return <Text text={substituteTemplate(w.text, sensors, now)}
        fontSize={w.fontSize} fill={w.color}
        fontStyle={w.bold ? '700' : '600'} fontFamily={family(w.font, FONT_LABEL)}
        letterSpacing={w.fontSize * 0.04} />

    case 'clock': {
      const t = now.toLocaleTimeString(w.twelveHour ? 'en-US' : 'en-GB', {
        hour12: w.twelveHour ?? false,
        hour: '2-digit', minute: '2-digit',
        ...(w.showSeconds ?? true ? { second: '2-digit' } : {}),
      })
      const d = now
        .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        .toUpperCase()
      // Digits have different advances ("1" is narrow) — center the text in a
      // widest-digits reference box so the clock doesn't shift every second.
      const fam = family(w.font, FONT_NUM)
      const weight = w.bold ? '700' : '500'
      const boxW = textW(t.replace(/\d/g, '8'), w.fontSize, fam, weight)
        + w.fontSize * 0.05 * t.length // letterSpacing isn't in canvas measureText
      return (
        <>
          {w.withDate && (
            <Text text={d} y={-w.fontSize * 0.46} width={boxW} align="center"
              fontSize={w.fontSize * 0.28}
              fill={LABEL_FILL} fontFamily={FONT_LABEL} fontStyle="600"
              letterSpacing={w.fontSize * 0.06}
              shadowColor="#000" shadowBlur={4} shadowOpacity={0.8} />
          )}
          {/* dark halo, not a colored glow — the clock must survive bright backgrounds */}
          <Text text={t} width={boxW} align="center" fontSize={w.fontSize} fill={w.color}
            fontStyle={weight} fontFamily={fam}
            letterSpacing={w.fontSize * 0.05}
            shadowColor="#000" shadowBlur={w.fontSize * 0.22} shadowOpacity={0.9} />
        </>
      )
    }

    case 'sensor': {
      const v = metricValue(sensors, w.metric)
      const nd = w.unit === 'W' || w.unit === 'MB/s' ? 1 : 0
      const num = fmt(v, nd)
      const fs = w.fontSize
      const fam = family(w.font, FONT_NUM)
      const labelFs = Math.max(15, fs * 0.18)
      const numW = textW(num, fs, fam, '700')
      return (
        <>
          {/* accent tick + caption above the numeral */}
          <Rect x={2} y={-labelFs * 1.55} width={4} height={labelFs * 1.05}
            fill={w.color} cornerRadius={2}
            shadowColor={w.color} shadowBlur={6} shadowOpacity={0.8} />
          <Text x={14} y={-labelFs * 1.5} text={w.label.toUpperCase()} fontSize={labelFs}
            fill={LABEL_FILL} fontFamily={FONT_LABEL} fontStyle="600"
            letterSpacing={labelFs * 0.18} />
          <Text text={num} fontSize={fs} fill={w.color} fontFamily={fam}
            fontStyle={w.bold ? '700' : '500'}
            shadowColor={w.color} shadowBlur={fs * 0.15} shadowOpacity={0.45} />
          <Text x={numW + fs * 0.08} y={fs * 0.16} text={w.unit} fontSize={fs * 0.36}
            fill={withAlpha(w.color, 0.75)} fontFamily={FONT_LABEL} fontStyle="600" />
        </>
      )
    }

    case 'bar': {
      const v = metricValue(sensors, w.metric)
      const val = v ?? 0
      const frac = Math.max(0, Math.min(val / w.max, 1))
      const h = w.height
      const unit = METRIC_LABELS[w.metric].unit
      const rowFs = Math.max(16, Math.min(28, h * 1.1))
      // Threshold coloring: crit beats warn beats the widget's own color.
      const critHit = w.critAt != null && val >= w.critAt
      const warnHit = !critHit && w.warnAt != null && val >= w.warnAt
      const barColor = critHit ? (w.critColor ?? CRIT_COLOR)
        : warnHit ? (w.warnColor ?? WARN_COLOR)
          : w.color
      return (
        <>
          {w.label && (
            <>
              <Text y={-rowFs * 1.5} text={w.label.toUpperCase()} fontSize={rowFs}
                fill="rgba(255,255,255,0.85)" fontFamily={FONT_LABEL} fontStyle="600"
                letterSpacing={rowFs * 0.14}
                shadowColor="#000" shadowBlur={5} shadowOpacity={0.85} />
              <Text y={-rowFs * 1.5} width={w.width} align="right"
                text={fmtU(v, unit)} fontSize={rowFs} fill={barColor}
                fontFamily={FONT_NUM} fontStyle="500"
                shadowColor="#000" shadowBlur={5} shadowOpacity={0.85} />
            </>
          )}
          {(w.panelBlur ?? 0) > 0 && bg.el ? (
            <GlassPanel w={w.width} h={h} radius={h / 2}
              blur={w.panelBlur!} tint={GLASS_TINT} bg={bg} />
          ) : (
            <Rect width={w.width} height={h} cornerRadius={h / 2}
              fill="rgba(5,7,12,0.6)" />
          )}
          <Rect width={w.width} height={h} cornerRadius={h / 2}
            stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
          {frac > 0.01 && (
            <Rect x={2} y={2} width={Math.max(h - 4, (w.width - 4) * frac)} height={h - 4}
              cornerRadius={(h - 4) / 2}
              fillLinearGradientStartPoint={{ x: 0, y: 0 }}
              fillLinearGradientEndPoint={{ x: w.width, y: 0 }}
              fillLinearGradientColorStops={[0, withAlpha(barColor, 0.45), 1, barColor]}
              shadowColor={barColor} shadowBlur={8} shadowOpacity={0.5} />
          )}
        </>
      )
    }

    case 'image':
      return <WidgetImage w={w} />

    case 'gauge': {
      const v = metricValue(sensors, w.metric)
      const unit = METRIC_LABELS[w.metric].unit
      const frac = Math.max(0, Math.min((v ?? 0) / w.max, 1))
      const size = w.size
      const c = size / 2
      const th = size * 0.075 // arc stroke thickness
      const r = c - th / 2 - size * 0.02
      const start = Math.PI * 0.75 // 270° sweep opening downward
      const span = Math.PI * 1.5
      const tipA = start + span * frac
      const disp = v == null ? '--' : v.toFixed(0)
      return (
        <>
          {/* smoked/frosted-glass disc so the gauge stays readable over any background */}
          {(w.panelBlur ?? 0) > 0 && bg.el ? (
            <GlassPanel w={size} h={size} circle
              blur={w.panelBlur!} tint={GLASS_TINT} bg={bg} />
          ) : (
            <Circle x={c} y={c} radius={c} fill={PANEL_FILL} />
          )}
          <PanelStroke w={size} h={size} circle />
          {/* track */}
          <Shape
            sceneFunc={(ctx, sh) => {
              ctx.beginPath()
              ctx.arc(c, c, r, start, start + span)
              ctx.fillStrokeShape(sh)
            }}
            stroke="rgba(255,255,255,0.10)" strokeWidth={th} lineCap="round" />
          {/* tick marks just inside the track */}
          <Shape
            sceneFunc={(ctx, sh) => {
              ctx.beginPath()
              const r1 = r - th * 0.95
              const r2 = r1 - size * 0.035
              for (let i = 0; i <= 27; i++) {
                const a = start + (span * i) / 27
                ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1)
                ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2)
              }
              ctx.fillStrokeShape(sh)
            }}
            stroke="rgba(255,255,255,0.16)" strokeWidth={Math.max(1.5, size * 0.006)} />
          {/* value arc + glowing tip */}
          {frac > 0.005 && (
            <Shape
              sceneFunc={(ctx, sh) => {
                ctx.beginPath()
                ctx.arc(c, c, r, start, tipA)
                ctx.fillStrokeShape(sh)
              }}
              stroke={w.color} strokeWidth={th} lineCap="round"
              shadowColor={w.color} shadowBlur={size * 0.045} shadowOpacity={0.7} />
          )}
          <Circle x={c + Math.cos(tipA) * r} y={c + Math.sin(tipA) * r}
            radius={th * 0.26} fill="#ffffff"
            shadowColor={w.color} shadowBlur={size * 0.03} shadowOpacity={0.9} />
          {/* numeral, unit, and label in the 90° opening at the bottom */}
          <Text y={c - size * 0.175} width={size} align="center" text={disp}
            fontSize={size * 0.30} fill={w.color} fontFamily={FONT_NUM} fontStyle="700"
            shadowColor={w.color} shadowBlur={size * 0.035} shadowOpacity={0.45} />
          <Text y={c + size * 0.155} width={size} align="center" text={unit}
            fontSize={size * 0.08} fill={LABEL_FILL} fontFamily={FONT_LABEL}
            fontStyle="600" letterSpacing={size * 0.008} />
          <Text y={size - size * 0.115} width={size} align="center"
            text={w.label.toUpperCase()} fontSize={size * 0.085}
            fill="rgba(255,255,255,0.8)" fontFamily={FONT_LABEL} fontStyle="700"
            letterSpacing={size * 0.012} />
        </>
      )
    }

    case 'graph': {
      // Last GRAPH_SAMPLES 1Hz samples drawn left (oldest) to right (newest),
      // anchored to the right edge while the buffer fills.
      const vals = history.slice(-GRAPH_SAMPLES).map((h) => metricValue(h, w.metric))
      const unit = METRIC_LABELS[w.metric].unit
      const r = cardR(w.height)
      const headFs = Math.max(16, Math.min(26, w.height * 0.12))
      const padTop = headFs * 2.1 // keep the plot clear of the header row
      const plotH = w.height - padTop - 10
      const pts: number[] = []
      const n = GRAPH_SAMPLES - 1
      vals.forEach((v, i) => {
        if (v == null) return
        const frac = Math.max(0, Math.min(v / w.max, 1))
        pts.push(((GRAPH_SAMPLES - vals.length + i) / n) * w.width,
          padTop + (1 - frac) * plotH)
      })
      const last = vals.length ? vals[vals.length - 1] : null
      const lastX = pts.length ? pts[pts.length - 2] : 0
      const lastY = pts.length ? pts[pts.length - 1] : 0
      return (
        <>
          {(w.panelBlur ?? 0) > 0 && bg.el ? (
            <GlassPanel w={w.width} h={w.height} radius={r}
              blur={w.panelBlur!} tint={GLASS_TINT} bg={bg} />
          ) : (
            <Rect width={w.width} height={w.height} cornerRadius={r} fill={PANEL_FILL} />
          )}
          <PanelStroke w={w.width} h={w.height} r={r} />
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={f}
              points={[12, padTop + plotH * f, w.width - 12, padTop + plotH * f]}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1} dash={[3, 7]} />
          ))}
          {/* plot clipped to the rounded card so the curve/area never escape */}
          <Group clipFunc={(c2) => {
            c2.beginPath()
            c2.roundRect(0, 0, w.width, w.height, r)
          }}>
            {/* Threshold bands: warn covers warn->max, crit covers crit->max on top.
                Drawn below the plot line so the line always stays visible. */}
            {w.warnAt != null && w.warnAt < w.max && (() => {
              const yTop = padTop
              const yThresh = padTop + (1 - Math.min(1, w.warnAt / w.max)) * plotH
              const bandH = Math.max(0, yThresh - yTop)
              return bandH > 0.5 ? (
                <Rect x={0} y={yTop} width={w.width} height={bandH}
                  fill={withAlpha(w.warnColor ?? WARN_COLOR, 0.14)} />
              ) : null
            })()}
            {w.critAt != null && w.critAt < w.max && (() => {
              const yTop = padTop
              const yThresh = padTop + (1 - Math.min(1, w.critAt / w.max)) * plotH
              const bandH = Math.max(0, yThresh - yTop)
              return bandH > 0.5 ? (
                <Rect x={0} y={yTop} width={w.width} height={bandH}
                  fill={withAlpha(w.critColor ?? CRIT_COLOR, 0.18)} />
              ) : null
            })()}
            {pts.length >= 4 && (
              <>
                {/* straight-edged closure (tension 0) — a smoothed closing path
                    bows into the card corner and reads as a stray line */}
                <Line
                  points={[...pts, lastX, w.height + 8, pts[0], w.height + 8]}
                  closed tension={0} strokeEnabled={false}
                  fillLinearGradientStartPoint={{ x: 0, y: padTop }}
                  fillLinearGradientEndPoint={{ x: 0, y: w.height }}
                  fillLinearGradientColorStops={[
                    0, withAlpha(w.color, 0.32), 1, withAlpha(w.color, 0.02)]} />
                <Line points={pts} tension={0.3} stroke={w.color} strokeWidth={3}
                  lineCap="round" lineJoin="round"
                  shadowColor={w.color} shadowBlur={8} shadowOpacity={0.7} />
                <Circle x={lastX} y={lastY} radius={4.5} fill="#ffffff"
                  shadowColor={w.color} shadowBlur={9} shadowOpacity={0.9} />
              </>
            )}
          </Group>
          <Text x={16} y={headFs * 0.62} text={w.label.toUpperCase()} fontSize={headFs}
            fill={LABEL_FILL} fontFamily={FONT_LABEL} fontStyle="600"
            letterSpacing={headFs * 0.14} />
          <Text x={0} y={headFs * 0.62} width={w.width - 16} align="right"
            text={fmtU(last, unit)} fontSize={headFs * 1.15} fill={w.color}
            fontFamily={FONT_NUM} fontStyle="600"
            shadowColor={w.color} shadowBlur={6} shadowOpacity={0.4} />
        </>
      )
    }

    case 'media':
      return <MediaCard w={w} media={media} bg={bg} now={now} />

    case 'weather':
      return <WeatherCard w={w} bg={bg} />

    case 'visualizer':
      return <VisualizerBars w={w} spectrum={spectrum} />
  }
}

interface Props {
  layout: Layout
  sensors: Sensors
  now: Date
  // Rolling 1Hz sensor history (oldest first) for graph widgets.
  history: Sensors[]
  // Active Windows toasts overlaid top-right on the LCD (max ~3).
  toasts?: LcdToast[]
  // Current background frame (from useAnimatedImage — advances GIF frames itself).
  bgEl?: CanvasImageSource | null
  // Now-playing session for media widgets.
  media?: MediaState | null
  // Loopback audio spectrum (SPECTRUM_BANDS values, 0..1) for visualizer widgets.
  spectrum?: number[] | null
  editable?: boolean
  selectedIds?: string[]
  // additive = Shift/Ctrl held: toggles the id in/out of the selection.
  onSelect?: (id: string | null, additive?: boolean) => void
  // Rubber-band result. additive keeps the existing selection.
  onSelectMany?: (ids: string[], additive?: boolean) => void
  onMove?: (id: string, x: number, y: number) => void
  // Group-drag drop: every selected widget's final position in one batch
  // (one undo step).
  onMoveMany?: (moves: { id: string; x: number; y: number }[]) => void
  // Fired when the user resizes via the transformer handles: scale factors the
  // widget should absorb into its own size fields, plus the (possibly moved) origin.
  onResize?: (id: string, sx: number, sy: number, x: number, y: number) => void
  // Right-click on a widget (after it joins the selection): screen coords for
  // the caller's context menu.
  onWidgetMenu?: (clientX: number, clientY: number) => void
  // Logical panel dims — default landscape (1920x480) but the caller can pass
  // portrait (480x1920) when the physical panel is mounted rotated 90/270°.
  logicalW?: number
  logicalH?: number
}

// Text-like widgets scale uniformly (fontSize); box-like ones resize freely.
function keepRatio(w: Widget): boolean {
  return w.type === 'text' || w.type === 'clock' || w.type === 'sensor' || w.type === 'gauge'
}

/** The 1920x480 Konva stage: interactive editor AND the frame source.
 *  Layer 0 holds the LCD content (captured via toDataURL); editor chrome
 *  (the resize transformer) lives on layer 1 so it never reaches the panel. */
// Drag snapping: widget edges/centers attract to canvas edges/center and to
// other widgets' edges/centers within this many px.
const SNAP_PX = 8

const DashboardStage = forwardRef<Konva.Stage, Props>(function DashboardStage(
  { layout, sensors, now, history, toasts = [], bgEl, media = null, spectrum = null,
    editable = false, selectedIds = [], onSelect, onSelectMany, onMove, onMoveMany,
    onResize, onWidgetMenu, logicalW = PANEL_W, logicalH = PANEL_H }, ref,
) {
  const trRef = useRef<Konva.Transformer>(null)
  const groupRefs = useRef(new Map<string, Konva.Group>())
  // The transformer (resize handles) only serves single selection; a multi
  // selection gets per-widget dashed outlines instead.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selected = layout.widgets.find((w) => w.id === selectedId)
  // Guide lines shown while a drag is snapped (editor chrome layer only).
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  // Rubber-band selection rect (stage coords) while dragging on empty canvas.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const marqueeRef = useRef<{ x0: number; y0: number; additive: boolean } | null>(null)
  // Rect mirrored in a ref — mouseup can fire before React commits the last
  // mousemove's setState, and a fast drag must not read a stale null.
  const marqueeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  // Dashed outlines around every widget of a multi selection.
  const [outlines, setOutlines] = useState<{ x: number; y: number; width: number; height: number }[]>([])
  // Group drag state: start positions of the co-selected widgets so they
  // follow the dragged one 1:1 (snapping applies to the dragged node only).
  const groupDragRef = useRef<{
    anchorId: string
    from: { x: number; y: number }
    others: Map<string, { x: number; y: number }>
  } | null>(null)
  // Konva suppresses click after an actual drag, but guard explicitly so a
  // group drag can never collapse the selection on drop.
  const draggedRef = useRef(false)
  // Offscreen bg canvas: the bg Shape below draws the transformed background
  // into this alongside the main stage, so GlassPanel can sample it 1:1
  // and its blur matches the visible bg exactly. Sized to logicalW/H so a
  // panel-rotate resizes it too.
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!bgCanvasRef.current) bgCanvasRef.current = document.createElement('canvas')
  if (bgCanvasRef.current.width !== logicalW) bgCanvasRef.current.width = logicalW
  if (bgCanvasRef.current.height !== logicalH) bgCanvasRef.current.height = logicalH
  const bgEnv: BgEnv = {
    el: bgEl ?? null,
    color: layout.bgColor,
    blur: layout.bgBlur ?? 0,
    dim: layout.bgDim ?? 0,
    panelW: logicalW,
    panelH: logicalH,
    bgCanvas: bgEl ? bgCanvasRef.current : null,
  }

  const snapDragMove = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    // Alt = precision drag, no snapping
    if (e.evt?.altKey) { setGuides({ v: [], h: [] }); return }
    const node = e.target
    const skip = { skipShadow: true, skipStroke: true }
    const r = node.getClientRect(skip)
    const vTargets = [0, logicalW / 2, logicalW]
    const hTargets = [0, logicalH / 2, logicalH]
    // Co-selected widgets move with the drag — they are not stationary
    // snap targets.
    const moving = groupDragRef.current
      ? new Set([id, ...groupDragRef.current.others.keys()])
      : new Set([id])
    for (const other of layout.widgets) {
      if (moving.has(other.id)) continue
      const g = groupRefs.current.get(other.id)
      if (!g) continue
      const o = g.getClientRect(skip)
      vTargets.push(o.x, o.x + o.width / 2, o.x + o.width)
      hTargets.push(o.y, o.y + o.height / 2, o.y + o.height)
    }
    let bestV: { delta: number; line: number } | null = null
    for (const line of vTargets) {
      for (const edge of [r.x, r.x + r.width / 2, r.x + r.width]) {
        const d = line - edge
        if (Math.abs(d) <= SNAP_PX && (!bestV || Math.abs(d) < Math.abs(bestV.delta))) {
          bestV = { delta: d, line }
        }
      }
    }
    let bestH: { delta: number; line: number } | null = null
    for (const line of hTargets) {
      for (const edge of [r.y, r.y + r.height / 2, r.y + r.height]) {
        const d = line - edge
        if (Math.abs(d) <= SNAP_PX && (!bestH || Math.abs(d) < Math.abs(bestH.delta))) {
          bestH = { delta: d, line }
        }
      }
    }
    if (bestV) node.x(node.x() + bestV.delta)
    if (bestH) node.y(node.y() + bestH.delta)
    setGuides({ v: bestV ? [bestV.line] : [], h: bestH ? [bestH.line] : [] })
  }

  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    // Don't attach handles for locked or hidden widgets — LayerPanel still lets
    // the user select them (to unlock / unhide), but stage-side stays inert.
    const inert = !selected || selected.locked || selected.hidden
    const node = selectedId && !inert ? groupRefs.current.get(selectedId) : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, selected, layout])

  // Multi-selection outlines (chrome layer): client rects of every selected
  // widget, recomputed after each layout/selection change.
  useEffect(() => {
    if (!editable || selectedIds.length <= 1) {
      setOutlines((o) => (o.length ? [] : o))
      return
    }
    const skip = { skipShadow: true, skipStroke: true }
    setOutlines(selectedIds
      .map((id) => groupRefs.current.get(id)?.getClientRect(skip))
      .filter((r): r is NonNullable<typeof r> => !!r))
  }, [editable, selectedIds, layout])

  // Finish (or abandon) a rubber-band drag: select every widget whose client
  // rect intersects the marquee; a sub-3px drag counts as a plain click.
  const endMarquee = () => {
    const start = marqueeRef.current
    marqueeRef.current = null
    if (!start) return
    const m = marqueeRectRef.current
    marqueeRectRef.current = null
    setMarquee(null)
    if (!m || (m.w < 3 && m.h < 3)) {
      if (!start.additive) onSelect?.(null)
      return
    }
    const skip = { skipShadow: true, skipStroke: true }
    const hits: string[] = []
    for (const w of layout.widgets) {
      if (w.hidden || w.locked) continue
      const g = groupRefs.current.get(w.id)
      if (!g) continue
      const r = g.getClientRect(skip)
      if (r.x < m.x + m.w && r.x + r.width > m.x &&
          r.y < m.y + m.h && r.y + r.height > m.y) hits.push(w.id)
    }
    onSelectMany?.(hits, start.additive)
  }

  return (
    <Stage
      ref={ref}
      width={logicalW}
      height={logicalH}
      onMouseDown={(e) => {
        if (!editable || e.target !== e.target.getStage()) return
        if (e.evt.button !== 0) return
        const pos = e.target.getStage()!.getPointerPosition()
        if (!pos) return
        marqueeRef.current = {
          x0: pos.x, y0: pos.y,
          additive: e.evt.shiftKey || e.evt.ctrlKey,
        }
      }}
      onMouseMove={(e) => {
        const start = marqueeRef.current
        if (!start) return
        const pos = e.target.getStage()?.getPointerPosition()
        if (!pos) return
        const rect = {
          x: Math.min(start.x0, pos.x), y: Math.min(start.y0, pos.y),
          w: Math.abs(pos.x - start.x0), h: Math.abs(pos.y - start.y0),
        }
        marqueeRectRef.current = rect
        setMarquee(rect)
      }}
      onMouseUp={endMarquee}
      onMouseLeave={endMarquee}
      onContextMenu={(e) => { if (editable) e.evt.preventDefault() }}
    >
      <Layer>
        <Rect width={logicalW} height={logicalH} fill={layout.bgColor} listening={false} />
        {bgEl && (
          <Shape listening={false} sceneFunc={(ctx) => {
            const blur = layout.bgBlur ?? 0
            const scale = layout.bgScale ?? 1
            const rotDeg = layout.bgRotate ?? 0
            const rot = (rotDeg * Math.PI) / 180
            const flipX = layout.bgFlipX ? -1 : 1
            const flipY = layout.bgFlipY ? -1 : 1
            const offX = ((layout.bgOffsetX ?? 0) / 100) * logicalW
            const offY = ((layout.bgOffsetY ?? 0) / 100) * logicalH

            // Intrinsic source size — HTMLImageElement uses naturalWidth/Height;
            // canvases and video-frame canvases just use width/height.
            const anyEl = bgEl as { naturalWidth?: number; naturalHeight?: number; width: number; height: number }
            const srcWFull = anyEl.naturalWidth || anyEl.width
            const srcHFull = anyEl.naturalHeight || anyEl.height
            // Crop insets (%). Clamp so we always have at least a 10% window.
            const cT = Math.min(90, Math.max(0, layout.bgCropT ?? 0))
            const cR = Math.min(90, Math.max(0, layout.bgCropR ?? 0))
            const cB = Math.min(90, Math.max(0, layout.bgCropB ?? 0))
            const cL = Math.min(90, Math.max(0, layout.bgCropL ?? 0))
            const sX = (cL / 100) * srcWFull
            const sY = (cT / 100) * srcHFull
            const srcW = srcWFull * (1 - (cL + cR) / 100)
            const srcH = srcHFull * (1 - (cT + cB) / 100)
            // "cover the panel" base fit. For arbitrary bgRotate the rotated
            // source occupies (|cosθ|w + |sinθ|h) × (|sinθ|w + |cosθ|h) on
            // the panel, so cover must fit that rotated AABB — otherwise
            // 90°/270° rotations expose bgColor bands at the top/bottom.
            const absCos = Math.abs(Math.cos(rot))
            const absSin = Math.abs(Math.sin(rot))
            const rotW = srcW * absCos + srcH * absSin
            const rotH = srcW * absSin + srcH * absCos
            const baseFit = Math.max(logicalW / rotW, logicalH / rotH)
            const drawW = srcW * baseFit * scale
            const drawH = srcH * baseFit * scale

            const drawBg = (target: CanvasRenderingContext2D) => {
              target.save()
              // Clip to panel so rotation/zoom overflow doesn't leak into the
              // stage bounds where widgets live.
              target.beginPath()
              target.rect(0, 0, logicalW, logicalH)
              target.clip()
              if (blur > 0) target.filter = `blur(${blur}px)`
              target.translate(logicalW / 2 + offX, logicalH / 2 + offY)
              target.rotate(rot)
              target.scale(flipX, flipY)
              if (sX || sY || srcW !== srcWFull || srcH !== srcHFull) {
                target.drawImage(bgEl, sX, sY, srcW, srcH, -drawW / 2, -drawH / 2, drawW, drawH)
              } else {
                target.drawImage(bgEl, -drawW / 2, -drawH / 2, drawW, drawH)
              }
              target.restore()
            }
            drawBg(ctx._context)
            // Mirror onto the offscreen canvas the same frame so GlassPanel
            // sampling this frame matches what the user actually sees. Base
            // color goes underneath in case the bg has transparency.
            const off = bgCanvasRef.current
            if (off) {
              const oc = off.getContext('2d')!
              oc.clearRect(0, 0, off.width, off.height)
              oc.fillStyle = layout.bgColor
              oc.fillRect(0, 0, off.width, off.height)
              drawBg(oc)
            }
          }} />
        )}
        {bgEl && (layout.bgDim ?? 0) > 0 && (
          <Rect width={logicalW} height={logicalH} fill="#000" listening={false}
            opacity={Math.min(0.9, layout.bgDim ?? 0)} />
        )}
        {layout.widgets.map((w) => {
          if (w.hidden) return null
          const interactive = editable && !w.locked
          return (
            <Group
              key={w.id}
              ref={(node) => {
                if (node) groupRefs.current.set(w.id, node)
                else groupRefs.current.delete(w.id)
              }}
              x={w.x}
              y={w.y}
              opacity={w.opacity ?? 1}
              draggable={interactive}
              onMouseDown={(e) => {
                if (!interactive) return
                const additive = e.evt.shiftKey || e.evt.ctrlKey
                if (additive) onSelect?.(w.id, true)
                // A member of a multi selection keeps the group on mousedown
                // so it can be group-dragged; a plain click (no drag) narrows
                // to it in onClick below.
                else if (!selectedIds.includes(w.id)) onSelect?.(w.id)
              }}
              onClick={(e) => {
                if (!interactive || draggedRef.current) return
                if (!e.evt.shiftKey && !e.evt.ctrlKey &&
                    selectedIds.length > 1 && selectedIds.includes(w.id)) {
                  onSelect?.(w.id)
                }
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault()
                if (!interactive) return
                if (!selectedIds.includes(w.id)) onSelect?.(w.id)
                onWidgetMenu?.(e.evt.clientX, e.evt.clientY)
              }}
              onDragStart={() => {
                draggedRef.current = true
                if (selectedIds.length > 1 && selectedIds.includes(w.id)) {
                  const others = new Map<string, { x: number; y: number }>()
                  for (const id of selectedIds) {
                    if (id === w.id) continue
                    const g = groupRefs.current.get(id)
                    if (g) others.set(id, { x: g.x(), y: g.y() })
                  }
                  groupDragRef.current = { anchorId: w.id, from: { x: w.x, y: w.y }, others }
                } else {
                  groupDragRef.current = null
                }
              }}
              onDragMove={(e) => {
                if (!interactive) return
                snapDragMove(w.id, e)
                const gd = groupDragRef.current
                if (gd && gd.anchorId === w.id) {
                  const dx = e.target.x() - gd.from.x
                  const dy = e.target.y() - gd.from.y
                  for (const [id, p] of gd.others) {
                    groupRefs.current.get(id)?.position({ x: p.x + dx, y: p.y + dy })
                  }
                }
              }}
              onDragEnd={(e) => {
                setGuides({ v: [], h: [] })
                setTimeout(() => { draggedRef.current = false })
                const gd = groupDragRef.current
                groupDragRef.current = null
                if (gd && gd.anchorId === w.id && onMoveMany) {
                  const dx = e.target.x() - gd.from.x
                  const dy = e.target.y() - gd.from.y
                  onMoveMany([
                    { id: w.id, x: Math.round(e.target.x()), y: Math.round(e.target.y()) },
                    ...[...gd.others].map(([id, p]) => ({
                      id, x: Math.round(p.x + dx), y: Math.round(p.y + dy),
                    })),
                  ])
                } else {
                  onMove?.(w.id, Math.round(e.target.x()), Math.round(e.target.y()))
                }
              }}
              onTransformEnd={(e) => {
                const node = e.target
                onResize?.(w.id, node.scaleX(), node.scaleY(),
                  Math.round(node.x()), Math.round(node.y()))
                node.scale({ x: 1, y: 1 })
              }}
            >
              {renderInner(w, sensors, now, history, bgEnv, media, spectrum)}
            </Group>
          )
        })}
        {toasts.map((t, i) => <ToastCard key={t.id} t={t} index={i} bg={bgEnv} panelW={logicalW} />)}
      </Layer>
      {editable && (
        <Layer>
          {guides.v.map((x) => (
            <Line key={`v${x}`} points={[x, 0, x, logicalH]}
              stroke="#ff4dd2" strokeWidth={1.5} dash={[6, 6]} listening={false} />
          ))}
          {guides.h.map((y) => (
            <Line key={`h${y}`} points={[0, y, logicalW, y]}
              stroke="#ff4dd2" strokeWidth={1.5} dash={[6, 6]} listening={false} />
          ))}
          {outlines.map((r, i) => (
            <Rect key={`sel${i}`} x={r.x} y={r.y} width={r.width} height={r.height}
              stroke="#4de1ff" strokeWidth={1.5} dash={[7, 5]} listening={false} />
          ))}
          {marquee && (marquee.w > 2 || marquee.h > 2) && (
            <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
              stroke="#4de1ff" strokeWidth={1.5} dash={[5, 4]}
              fill="rgba(77,225,255,0.08)" listening={false} />
          )}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            flipEnabled={false}
            keepRatio={selected ? keepRatio(selected) : true}
            enabledAnchors={selected && !keepRatio(selected)
              ? undefined /* all anchors */
              : ['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            anchorStroke="#4de1ff"
            anchorFill="#0b0d12"
            anchorCornerRadius={5}
            anchorSize={11}
            borderStroke="#4de1ff"
            borderDash={[7, 5]}
          />
        </Layer>
      )}
    </Stage>
  )
})

export default DashboardStage
