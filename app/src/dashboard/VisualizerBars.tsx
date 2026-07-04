import { Rect, Shape } from 'react-konva'
import { type Widget } from '../types'
import { withAlpha } from './theme'

// Audio visualizer -----------------------------------------------------------
export function VisualizerBars({ w, spectrum }: {
  w: Extract<Widget, { type: 'visualizer' }>
  spectrum: number[] | null
}) {
  const n = Math.max(4, w.bars || 48)
  const centered = w.centered ?? true
  const src = spectrum ?? []
  // resample SPECTRUM_BANDS down to the widget's bar count (peak-preserving)
  const vals = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    if (!src.length) { vals[i] = 0; continue }
    const a = Math.floor((i / n) * src.length)
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * src.length))
    let m = 0
    for (let j = a; j < b; j++) m = Math.max(m, src[j])
    vals[i] = m
  }
  return (
    <>
      {/* invisible hit/bounds rect — the bars themselves are too thin to grab */}
      <Rect width={w.width} height={w.height} fill="rgba(0,0,0,0)" />
      <Shape listening={false}
        sceneFunc={(ctx, sh) => {
          const c2 = ctx._context
          const step = w.width / n
          const bw = Math.max(2, step * 0.62)
          const stub = Math.max(2, w.height * 0.012)
          ctx.beginPath()
          for (let i = 0; i < n; i++) {
            const x = i * step + (step - bw) / 2
            if (centered) {
              const half = Math.max(stub, vals[i] * w.height * 0.5)
              c2.roundRect(x, w.height / 2 - half, bw, half * 2, bw / 2)
            } else {
              const bh = Math.max(stub * 2, vals[i] * w.height)
              c2.roundRect(x, w.height - bh, bw, bh, bw / 2)
            }
          }
          ctx.fillStrokeShape(sh)
        }}
        fillLinearGradientStartPoint={{ x: 0, y: w.height }}
        fillLinearGradientEndPoint={{ x: 0, y: 0 }}
        fillLinearGradientColorStops={[0, withAlpha(w.color, 0.5), 1, w.color2 ?? w.color]}
        shadowColor={w.color} shadowBlur={10} shadowOpacity={0.45} />
    </>
  )
}
