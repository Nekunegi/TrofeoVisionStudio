import { useEffect, useState } from 'react'
import { PANEL_W, PANEL_H, type Sensors, type WidgetFont } from '../types'

// LCD design language: Orbitron for numerals (wide, techy), Rajdhani for
// labels/captions. Both are bundled via @fontsource and explicitly preloaded in
// App (canvas text does NOT trigger @font-face downloads by itself).
export const FONT_NUM = 'Orbitron'
export const FONT_LABEL = 'Rajdhani'
const FONT_FAMILIES: Record<WidgetFont, string> = {
  orbitron: 'Orbitron', rajdhani: 'Rajdhani', inter: 'Inter',
}
export function family(f: WidgetFont | undefined, fallback: string): string {
  return f ? FONT_FAMILIES[f] : fallback
}
export const LABEL_FILL = 'rgba(255,255,255,0.62)'
// Panels must stay dark over arbitrarily bright animated backgrounds.
export const PANEL_FILL = 'rgba(5,7,12,0.74)'
export const GLASS_TINT = 'rgba(5,7,12,0.45)'

export function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

// Offscreen 2d context for text measurement (unit placement after a numeral).
const _measure = document.createElement('canvas').getContext('2d')!
export function textW(text: string, px: number, family: string, weight = '400'): number {
  _measure.font = `${weight} ${px}px ${family}`
  return _measure.measureText(text).width
}

export function useImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!src) { setImg(null); return }
    const im = new window.Image()
    im.src = src
    im.onload = () => setImg(im)
  }, [src])
  return img
}

export function fmt(v: number | null, nd = 0): string {
  return v == null ? '--' : v.toFixed(nd)
}

// Value + unit with per-unit decimals (rates get one decimal).
export function fmtU(v: number | null, unit: string): string {
  return `${fmt(v, unit === 'W' || unit === 'MB/s' ? 1 : 0)}${unit}`
}

export function metricValue(s: Sensors, m: keyof Sensors): number | null {
  return s[m]
}

// How many 1Hz samples a graph shows across its width.
export const GRAPH_SAMPLES = 60

// Frosted-glass panels ----------------------------------------------------
// What the background looks like under this stage — glass panels re-draw the
// region behind themselves blurred, then tint it.
export interface BgEnv {
  el: CanvasImageSource | null
  color: string
  blur: number // layout-level bg blur (glass adds its own on top)
  dim: number  // layout-level bg dim
}

export function srcSize(el: CanvasImageSource): { w: number; h: number } {
  const a = el as unknown as Record<string, number>
  return {
    w: a.naturalWidth || a.videoWidth || a.displayWidth || a.width || PANEL_W,
    h: a.naturalHeight || a.videoHeight || a.displayHeight || a.height || PANEL_H,
  }
}

// Modern card language: big radii, a top-lit 1.5px edge, a soft drop shadow.
// ~24% of card height, iOS-widget territory (user asked twice for rounder).
export function cardR(h: number): number {
  return Math.min(44, Math.round(h * 0.24))
}

// Windows toast overlay --------------------------------------------------
// Toast text is often Japanese; Rajdhani/Orbitron have no CJK glyphs, so the
// canvas falls back per-glyph to Yu Gothic.
export const TOAST_FONT = "Rajdhani, 'Yu Gothic UI', Meiryo, sans-serif"
