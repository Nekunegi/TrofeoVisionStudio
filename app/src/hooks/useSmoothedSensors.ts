import { useEffect, useRef, useState } from 'react'
import { EMPTY_SENSORS, type SensorMetric, type Sensors } from '../types'

// Eases displayed sensor values toward the 1Hz backend readings so gauges,
// bars and numerals glide instead of stepping. Re-renders only while a
// transition is in flight; `animating` lets the stream loop raise its fps.
//
// maxFps caps the state-push rate. Without it the loop pushed at the full
// rAF rate (85fps hidden via the shim, up to the monitor refresh visible),
// and every push is a full App re-render + Konva layer redraw — measured at
// ~1.3 cores of continuous CPU. The LCD can only display fpsCeiling frames,
// so easing steps beyond that are invisible; capping them cuts the cost
// without changing the glide trajectory (dt-based exponential).
export function useSmoothedSensors(
  target: Sensors, maxFps = 30,
): { display: Sensors; animating: boolean } {
  const [display, setDisplay] = useState<Sensors>(target)
  const [animating, setAnimating] = useState(false)
  const targetRef = useRef(target)
  targetRef.current = target
  const maxFpsRef = useRef(maxFps)
  maxFpsRef.current = maxFps
  const dispRef = useRef<Sensors>(target)
  const rafRef = useRef(0)

  // Kick a rAF loop only while there's actual work to do — when target
  // changes AND display doesn't already match. The loop halts itself once
  // every value is settled, so idle steady-state costs 0 CPU per frame.
  useEffect(() => {
    // Any diff between current display and new target that's beyond the
    // snap threshold means we need to animate.
    const cur = dispRef.current
    let needs = false
    for (const k of Object.keys(EMPTY_SENSORS) as SensorMetric[]) {
      const tv = target[k]
      const cv = cur[k]
      if (tv == null || cv == null) {
        if (tv !== cv) { needs = true; break }
        continue
      }
      if (Math.abs(tv - cv) > 0.05) { needs = true; break }
    }
    if (!needs) return

    let last = performance.now()
    const tick = (t: number) => {
      // Skip rAF ticks that arrive faster than the push cap — dt accumulates
      // across skipped ticks, so the eased values land in the same place.
      const minInterval = 1000 / Math.max(1, maxFpsRef.current)
      if (t - last < minInterval - 1) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      const c = dispRef.current
      const tgt = targetRef.current
      let active = false
      let changed = false
      const next = { ...c }
      for (const k of Object.keys(EMPTY_SENSORS) as SensorMetric[]) {
        const tv = tgt[k]
        const cv = c[k]
        if (tv == null || cv == null) {
          if (cv !== tv) { next[k] = tv; changed = true }
          continue
        }
        const d = tv - cv
        if (Math.abs(d) < 0.05) {
          if (cv !== tv) { next[k] = tv; changed = true }
        } else {
          next[k] = cv + d * Math.min(1, dt * 7)
          active = true
          changed = true
        }
      }
      if (changed) {
        dispRef.current = next
        setDisplay(next)
      }
      if (active) {
        setAnimating(true)
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setAnimating(false)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  return { display, animating }
}
