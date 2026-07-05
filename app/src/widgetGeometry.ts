import type { Widget } from './types'

// Approximate widget bounding box in logical pixels. Used when clamping
// widget positions after a panel-rotate aspect flip (widgets sized for
// landscape 1920×480 must fit inside portrait 480×1920, and vice versa).
//
// Text-based widgets don't store their rendered width, so we estimate from
// content length × font size × the average glyph width factor for the
// mono / semi-mono fonts in use (Orbitron ≈ 0.55, Rajdhani ≈ 0.5).
export function widgetBounds(w: Widget): { w: number; h: number } {
  switch (w.type) {
    case 'text':
      return {
        w: Math.max(20, w.text.length * w.fontSize * 0.55),
        h: w.fontSize * 1.2,
      }
    case 'clock': {
      // "HH:MM:SS" (8) or "YYYY-MM-DD HH:MM:SS" (19). Seconds optional.
      const len = w.withDate ? 19 : (w.showSeconds === false ? 5 : 8)
      return { w: len * w.fontSize * 0.6, h: w.fontSize * 1.2 }
    }
    case 'sensor':
      // "LABEL 99.9°C" — label + separator + 4 digits of value + unit.
      return {
        w: (w.label.length + w.unit.length + 5) * w.fontSize * 0.6,
        h: w.fontSize * 1.2,
      }
    case 'gauge':
      return { w: w.size, h: w.size }
    case 'bar':
    case 'graph':
    case 'image':
    case 'media':
    case 'weather':
    case 'visualizer':
      return { w: w.width, h: w.height }
  }
}

// Clamp widget position to the given logical canvas bounds. Widgets larger
// than the canvas anchor to top-left (0, 0) so their content stays reachable.
export function clampWidget(w: Widget, logW: number, logH: number): Widget {
  const b = widgetBounds(w)
  const nx = Math.max(0, Math.min(w.x, Math.max(0, logW - b.w)))
  const ny = Math.max(0, Math.min(w.y, Math.max(0, logH - b.h)))
  if (nx === w.x && ny === w.y) return w
  return { ...w, x: nx, y: ny }
}

// Remap a widget's position through a panel-rotation aspect flip. Preserves
// the widget's relative center-of-mass, then clamps to the new bounds.
//
// For a 90° CW panel rotation the "right side" of landscape becomes the
// "top side" of portrait, so a widget at (x=1500, y=100) in [1920, 480]
// should sit near the top of the new [480, 1920] panel — matching the
// visual intuition of physically rotating the monitor.
export function remapWidgetForRotation(
  w: Widget,
  oldLW: number,
  oldLH: number,
  newLW: number,
  newLH: number,
  rotDeltaCW: 0 | 90 | 180 | 270,
): Widget {
  if (rotDeltaCW === 0) return w
  const b = widgetBounds(w)
  const cxPct = (w.x + b.w / 2) / oldLW
  const cyPct = (w.y + b.h / 2) / oldLH
  let ncxPct = cxPct, ncyPct = cyPct
  if (rotDeltaCW === 90) {
    // 90° CW: (cx, cy) → (1 - cy, cx). Was on the right → now at the top.
    ncxPct = 1 - cyPct
    ncyPct = cxPct
  } else if (rotDeltaCW === 180) {
    ncxPct = 1 - cxPct
    ncyPct = 1 - cyPct
  } else if (rotDeltaCW === 270) {
    // 90° CCW: (cx, cy) → (cy, 1 - cx). Was on the right → now at the bottom.
    ncxPct = cyPct
    ncyPct = 1 - cxPct
  }
  const nx = ncxPct * newLW - b.w / 2
  const ny = ncyPct * newLH - b.h / 2
  return clampWidget({ ...w, x: Math.round(nx), y: Math.round(ny) }, newLW, newLH)
}
