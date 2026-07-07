import { describe, it, expect } from 'vitest'
import { widgetBounds, clampWidget, remapWidgetForRotation } from './widgetGeometry'
import type { BarWidget, GaugeWidget, TextWidget } from './types'

const bar = (x = 0, y = 0, width = 300, height = 40): BarWidget => ({
  id: 'bar-1', type: 'bar', metric: 'cpuLoad', x, y, width, height,
  max: 100, color: '#fff',
})

const gauge = (x = 0, y = 0, size = 200): GaugeWidget => ({
  id: 'gauge-1', type: 'gauge', metric: 'gpuTemp', x, y, size,
  max: 100, color: '#fff', label: 'GPU',
})

const text = (x = 0, y = 0): TextWidget => ({
  id: 'text-1', type: 'text', x, y, text: 'HELLO', fontSize: 40,
  color: '#fff', bold: false,
})

describe('widgetBounds', () => {
  it('returns exact box size for box widgets', () => {
    expect(widgetBounds(bar())).toEqual({ w: 300, h: 40 })
    expect(widgetBounds(gauge())).toEqual({ w: 200, h: 200 })
  })

  it('estimates text width from content length and font size', () => {
    const b = widgetBounds(text())
    expect(b.w).toBeCloseTo(5 * 40 * 0.55)
    expect(b.h).toBeCloseTo(40 * 1.2)
  })
})

describe('clampWidget', () => {
  it('returns the SAME reference when already in bounds (no spurious commits)', () => {
    const w = bar(100, 100)
    expect(clampWidget(w, 1920, 480)).toBe(w)
  })

  it('pulls an off-canvas widget back inside', () => {
    const w = clampWidget(bar(1900, 470), 1920, 480)
    expect(w.x).toBe(1920 - 300)
    expect(w.y).toBe(480 - 40)
  })

  it('anchors widgets larger than the canvas to the top-left', () => {
    const w = clampWidget(bar(50, 50, 3000, 600), 1920, 480)
    expect(w.x).toBe(0)
    expect(w.y).toBe(0)
  })
})

describe('remapWidgetForRotation', () => {
  it('is identity for rotDelta 0', () => {
    const w = bar(500, 100)
    expect(remapWidgetForRotation(w, 1920, 480, 1920, 480, 0)).toBe(w)
  })

  it('remaps a right-side widget onto the long axis on 90° (landscape→portrait)', () => {
    // Shipped mapping: (cx, cy) → (1 - cy, cx). A widget 88.5% across the
    // landscape panel keeps that 88.5% along the portrait panel's long axis
    // (and its old vertical center becomes the new horizontal position).
    const w = gauge(1600, 140) // center ≈ (1700, 240) → cx 88.5%, cy 50%
    const r = remapWidgetForRotation(w, 1920, 480, 480, 1920, 90)
    expect(r.y + 100).toBeCloseTo((1700 / 1920) * 1920, 0) // = 1700
    expect(r.x + 100).toBeCloseTo((1 - 240 / 480) * 480, 0) // = 240
  })

  it('mirrors both axes on 180°', () => {
    const w = gauge(100, 40) // center (200, 140)
    const r = remapWidgetForRotation(w, 1920, 480, 1920, 480, 180)
    expect(r.x + 100).toBeCloseTo(1920 - 200, 0)
    expect(r.y + 100).toBeCloseTo(480 - 140, 0)
  })

  it('clamps the remapped position to the new bounds', () => {
    const w = bar(0, 0, 800, 40) // 800 wide can't center in a 480-wide portrait
    const r = remapWidgetForRotation(w, 1920, 480, 480, 1920, 90)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.x + 0).toBeLessThanOrEqual(480)
  })
})
