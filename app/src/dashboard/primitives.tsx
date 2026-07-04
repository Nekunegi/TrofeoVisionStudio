import { Rect, Circle, Shape, Image as KImage } from 'react-konva'
import { PANEL_W, PANEL_H, type Widget } from '../types'
import { srcSize, useImage, type BgEnv } from './theme'

export function WidgetImage({ w }: { w: Extract<Widget, { type: 'image' }> }) {
  const img = useImage(w.src)
  return img ? <KImage image={img} width={w.width} height={w.height} /> : null
}

/** Rounded-rect / circle panel that shows the background blurred through it.
 *  The bg sample region comes from the shape's live absolute position (so it
 *  stays correct mid-drag). Only the region behind the panel (plus blur
 *  padding) is drawn, not the whole background. */
export function GlassPanel({ x = 0, y = 0, w, h, radius = 0, circle = false, blur, tint, bg }: {
  x?: number; y?: number; w: number; h: number
  radius?: number; circle?: boolean
  blur: number
  tint: string
  bg: BgEnv
}) {
  return (
    <Shape listening={false}
      sceneFunc={(ctx, shape) => {
        const abs = shape.getAbsolutePosition()
        const ox = abs.x
        const oy = abs.y
        const c2 = ctx._context
        c2.save()
        c2.beginPath()
        if (circle) c2.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2)
        else c2.roundRect(x, y, w, h, radius)
        c2.clip()
        c2.fillStyle = bg.color
        c2.fillRect(x, y, w, h)
        if (bg.el) {
          const bpx = blur + bg.blur
          const pad = bpx * 2 // blur samples past the clip edge — draw oversized
          const { w: iw, h: ih } = srcSize(bg.el)
          c2.filter = `blur(${bpx}px)`
          c2.drawImage(bg.el,
            (ox + x - pad) * (iw / PANEL_W), (oy + y - pad) * (ih / PANEL_H),
            (w + pad * 2) * (iw / PANEL_W), (h + pad * 2) * (ih / PANEL_H),
            x - pad, y - pad, w + pad * 2, h + pad * 2)
          c2.filter = 'none'
        }
        if (bg.dim > 0) {
          c2.fillStyle = `rgba(0,0,0,${Math.min(0.9, bg.dim)})`
          c2.fillRect(x, y, w, h)
        }
        c2.fillStyle = tint
        c2.fillRect(x, y, w, h)
        c2.restore()
      }} />
  )
}

/** Border + depth for every panel: gradient stroke (bright at the top edge,
 *  like light hitting glass) casting a soft shadow. The transparent fill keeps
 *  the whole card clickable in the editor. */
export function PanelStroke({ w, h, r = 0, circle = false }: {
  w: number; h: number; r?: number; circle?: boolean
}) {
  const common = {
    fill: 'rgba(0,0,0,0)',
    strokeWidth: 1.5,
    strokeLinearGradientColorStops: [
      0, 'rgba(255,255,255,0.30)', 0.28, 'rgba(255,255,255,0.10)', 1, 'rgba(255,255,255,0.03)',
    ],
    shadowColor: '#000',
    shadowBlur: 22,
    shadowOffsetY: 6,
    shadowOpacity: 0.45,
  }
  return circle ? (
    <Circle x={w / 2} y={h / 2} radius={w / 2 - 1} {...common}
      strokeLinearGradientStartPoint={{ x: 0, y: -h / 2 }}
      strokeLinearGradientEndPoint={{ x: 0, y: h / 2 }} />
  ) : (
    <Rect width={w} height={h} cornerRadius={r} {...common}
      strokeLinearGradientStartPoint={{ x: 0, y: 0 }}
      strokeLinearGradientEndPoint={{ x: 0, y: h }} />
  )
}
