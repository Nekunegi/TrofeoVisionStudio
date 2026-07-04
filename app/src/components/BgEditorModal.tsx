import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  RotateCcw, FlipHorizontal, FlipVertical, X, Check,
} from 'lucide-react'
import type { Layout } from '../types'
import { useT } from '../i18n'

interface Props {
  layout: Layout
  bgEl: CanvasImageSource
  logicalW: number
  logicalH: number
  onCommit: (patch: Partial<Layout>) => void
  onClose: () => void
}

interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

type HandleKey = 'nw' | 'ne' | 'sw' | 'se' | null

function readSrcDims(el: CanvasImageSource): { w: number; h: number } {
  const a = el as { naturalWidth?: number; naturalHeight?: number; width: number; height: number }
  return { w: a.naturalWidth || a.width, h: a.naturalHeight || a.height }
}

// Derive the initial crop rectangle in source pixels.
// If the current layout has explicit crop insets, use them; otherwise start
// with the largest aspect-matched rect centered on the source (cover fit).
function initialRect(layout: Partial<Layout>, srcW: number, srcH: number, panelAspect: number): CropRect {
  const hasCrop = (layout.bgCropT ?? 0) + (layout.bgCropR ?? 0) +
    (layout.bgCropB ?? 0) + (layout.bgCropL ?? 0) > 0
  if (hasCrop) {
    const x = ((layout.bgCropL ?? 0) / 100) * srcW
    const y = ((layout.bgCropT ?? 0) / 100) * srcH
    const w = srcW * (1 - (layout.bgCropL ?? 0) / 100 - (layout.bgCropR ?? 0) / 100)
    const h = srcH * (1 - (layout.bgCropT ?? 0) / 100 - (layout.bgCropB ?? 0) / 100)
    return { x, y, w, h }
  }
  // Aspect-fit inside the source. If source is wider than panel aspect,
  // the crop rect is the full height; else full width.
  const srcAspect = srcW / srcH
  if (srcAspect > panelAspect) {
    const w = srcH * panelAspect
    return { x: (srcW - w) / 2, y: 0, w, h: srcH }
  } else {
    const h = srcW / panelAspect
    return { x: 0, y: (srcH - h) / 2, w: srcW, h }
  }
}

export function BgEditorModal({ layout, bgEl, logicalW, logicalH, onCommit, onClose }: Props) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 500 })
  const src = useMemo(() => readSrcDims(bgEl), [bgEl])
  const panelAspect = logicalW / logicalH
  const [rect, setRect] = useState<CropRect>(() =>
    initialRect(layout, src.w, src.h, panelAspect))
  const [rotate, setRotate] = useState(layout.bgRotate ?? 0)
  const [flipX, setFlipX] = useState(!!layout.bgFlipX)
  const [flipY, setFlipY] = useState(!!layout.bgFlipY)

  // If the source dimensions change after mount (async image decode completing
  // AFTER the modal opened), re-anchor the crop rect. Otherwise the rect
  // would still reflect the OLD image's aspect. src is stable across GIF
  // frame flips because the underlying canvas keeps its dimensions.
  useEffect(() => {
    if (src.w && src.h) {
      setRect(initialRect(layout, src.w, src.h, panelAspect))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.w, src.h])

  // Fit the source to the canvas viewport (letterbox — full source always visible).
  const viewScale = Math.min(canvasSize.w / src.w, canvasSize.h / src.h) * 0.92
  const viewX = (canvasSize.w - src.w * viewScale) / 2
  const viewY = (canvasSize.h - src.h * viewScale) / 2

  // Resize the canvas to its container as it changes with the modal.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setCanvasSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Render source + mask + rect + handles every time anything changes.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = canvasSize.w
    c.height = canvasSize.h
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)

    // Draw source with rotate/flip applied around its center.
    ctx.save()
    ctx.translate(viewX + (src.w * viewScale) / 2, viewY + (src.h * viewScale) / 2)
    ctx.rotate((rotate * Math.PI) / 180)
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
    ctx.drawImage(
      bgEl,
      -(src.w * viewScale) / 2,
      -(src.h * viewScale) / 2,
      src.w * viewScale,
      src.h * viewScale,
    )
    ctx.restore()

    // Mask outside the crop rect (dim the non-selected area).
    const rx = viewX + rect.x * viewScale
    const ry = viewY + rect.y * viewScale
    const rw = rect.w * viewScale
    const rh = rect.h * viewScale
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.beginPath()
    ctx.rect(0, 0, c.width, c.height)
    ctx.rect(rx + rw, ry, -rw, rh) // reverse winding → cutout
    ctx.fill('evenodd')
    ctx.restore()

    // Rule-of-thirds guides inside the rect.
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
    ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      const gx = rx + (rw * i) / 3
      const gy = ry + (rh * i) / 3
      ctx.beginPath(); ctx.moveTo(gx, ry); ctx.lineTo(gx, ry + rh); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(rx, gy); ctx.lineTo(rx + rw, gy); ctx.stroke()
    }
    ctx.restore()

    // Border + corner handles.
    ctx.save()
    ctx.strokeStyle = '#ffd15a'
    ctx.lineWidth = 2
    ctx.strokeRect(rx, ry, rw, rh)
    const H = 10
    ctx.fillStyle = '#ffd15a'
    for (const [px, py] of [
      [rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh],
    ]) {
      ctx.fillRect(px - H / 2, py - H / 2, H, H)
    }
    ctx.restore()
  }, [bgEl, canvasSize, rect, rotate, flipX, flipY, viewScale, viewX, viewY, src.w, src.h])

  // Pointer interaction: figure out which handle (if any) the user grabbed,
  // then track drag deltas in source pixels.
  const dragRef = useRef<{ mode: 'move' | HandleKey; startX: number; startY: number; init: CropRect } | null>(null)
  const hitHandle = (px: number, py: number): HandleKey => {
    const H = 14
    const rx = viewX + rect.x * viewScale
    const ry = viewY + rect.y * viewScale
    const rw = rect.w * viewScale
    const rh = rect.h * viewScale
    if (Math.abs(px - rx) < H && Math.abs(py - ry) < H) return 'nw'
    if (Math.abs(px - (rx + rw)) < H && Math.abs(py - ry) < H) return 'ne'
    if (Math.abs(px - rx) < H && Math.abs(py - (ry + rh)) < H) return 'sw'
    if (Math.abs(px - (rx + rw)) < H && Math.abs(py - (ry + rh)) < H) return 'se'
    return null
  }
  const insideRect = (px: number, py: number): boolean => {
    const rx = viewX + rect.x * viewScale
    const ry = viewY + rect.y * viewScale
    return px >= rx && px <= rx + rect.w * viewScale &&
      py >= ry && py <= ry + rect.h * viewScale
  }

  const canvasCoords = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { px: e.clientX - r.left, py: e.clientY - r.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const { px, py } = canvasCoords(e)
    const handle = hitHandle(px, py)
    if (handle) {
      dragRef.current = { mode: handle, startX: px, startY: py, init: rect }
    } else if (insideRect(px, py)) {
      dragRef.current = { mode: 'move', startX: px, startY: py, init: rect }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const { px, py } = canvasCoords(e)
    const dx = (px - d.startX) / viewScale
    const dy = (py - d.startY) / viewScale
    if (d.mode === 'move') {
      const x = Math.max(0, Math.min(src.w - d.init.w, d.init.x + dx))
      const y = Math.max(0, Math.min(src.h - d.init.h, d.init.y + dy))
      setRect({ x, y, w: d.init.w, h: d.init.h })
    } else {
      // Aspect-locked resize from a corner. We compute the anchor (opposite
      // corner, fixed) and the target (moving corner). The moving corner is
      // clamped to the source bounds FIRST — so the rect can never exceed
      // the image — then a panel-aspect rect is fitted inside that box.
      let ax = d.init.x, ay = d.init.y
      let tx = d.init.x + d.init.w, ty = d.init.y + d.init.h
      switch (d.mode) {
        case 'nw':
          ax = d.init.x + d.init.w; ay = d.init.y + d.init.h
          tx = d.init.x + dx; ty = d.init.y + dy
          break
        case 'ne':
          ax = d.init.x; ay = d.init.y + d.init.h
          tx = d.init.x + d.init.w + dx; ty = d.init.y + dy
          break
        case 'sw':
          ax = d.init.x + d.init.w; ay = d.init.y
          tx = d.init.x + dx; ty = d.init.y + d.init.h + dy
          break
        case 'se':
          ax = d.init.x; ay = d.init.y
          tx = d.init.x + d.init.w + dx; ty = d.init.y + d.init.h + dy
          break
      }
      // Clamp the moving corner to the source rect so the aspect fit below
      // has no way to produce an over-flowing rectangle.
      tx = Math.max(0, Math.min(src.w, tx))
      ty = Math.max(0, Math.min(src.h, ty))
      const rawW = Math.abs(tx - ax)
      const rawH = Math.abs(ty - ay)
      // Fit panel aspect inside the raw box (contain, not cover).
      let w = rawW, h = rawH
      if (w / h > panelAspect) w = h * panelAspect
      else h = w / panelAspect
      const MIN = 20
      if (w < MIN || h < MIN / panelAspect) {
        w = MIN
        h = MIN / panelAspect
      }
      const nx = tx < ax ? ax - w : ax
      const ny = ty < ay ? ay - h : ay
      setRect({ x: nx, y: ny, w, h })
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  const apply = () => {
    const cropL = (rect.x / src.w) * 100
    const cropT = (rect.y / src.h) * 100
    const cropR = ((src.w - rect.x - rect.w) / src.w) * 100
    const cropB = ((src.h - rect.y - rect.h) / src.h) * 100
    onCommit({
      bgCropL: Math.round(cropL * 10) / 10,
      bgCropT: Math.round(cropT * 10) / 10,
      bgCropR: Math.round(cropR * 10) / 10,
      bgCropB: Math.round(cropB * 10) / 10,
      bgRotate: Math.round(rotate),
      bgFlipX: flipX,
      bgFlipY: flipY,
      // Crop expresses the full transform, so zero out pan/zoom.
      bgOffsetX: 0,
      bgOffsetY: 0,
      bgScale: 1,
    })
    onClose()
  }

  const resetAll = () => {
    setRect(initialRect({}, src.w, src.h, panelAspect))
    setRotate(0)
    setFlipX(false)
    setFlipY(false)
  }

  // Escape = cancel, Enter = apply. Focus lives on the modal container
  // (tabIndex=-1) so keys don't reach the underlying stage.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault(); apply()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, rotate, flipX, flipY])

  return (
    <div className="bg-editor-backdrop" onClick={onClose}>
      <div className="bg-editor" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="bg-editor-head">
          <h2>{t('bgEditor.title')}</h2>
          <button className="bg-editor-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="bg-editor-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <div className="bg-editor-controls">
          <div className="row">
            <span className="lbl">{t('bgEditor.rotate')}</span>
            <input type="range" min={0} max={359} step={1} value={rotate}
              onChange={(e) => setRotate(+e.target.value)} />
            <span className="val">{rotate}°</span>
          </div>
          <div className="row zoom-presets">
            {[0, 90, 180, 270].map((d) => (
              <button key={d} onClick={() => setRotate(d)}>{d}°</button>
            ))}
          </div>
          <div className="row">
            <button className={`chip ${flipX ? 'on' : ''}`} onClick={() => setFlipX((v) => !v)}>
              <FlipHorizontal size={13} /> {t('bg.flipX')}
            </button>
            <button className={`chip ${flipY ? 'on' : ''}`} onClick={() => setFlipY((v) => !v)}>
              <FlipVertical size={13} /> {t('bg.flipY')}
            </button>
            <button className="chip" onClick={resetAll}>
              <RotateCcw size={13} /> {t('bgEditor.reset')}
            </button>
          </div>
        </div>

        <div className="bg-editor-foot">
          <button onClick={onClose}>{t('bgEditor.cancel')}</button>
          <button className="bg-editor-ok" onClick={apply}>
            <Check size={14} /> {t('bgEditor.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
