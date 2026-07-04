import { useEffect, useRef, useState } from 'react'
import { EMPTY_SENSORS, type SensorMetric, type Sensors } from '../types'

// Eases displayed sensor values toward the 1Hz backend readings so gauges,
// bars and numerals glide instead of stepping. Re-renders only while a
// transition is in flight; `animating` lets the stream loop raise its fps.
export function useSmoothedSensors(target: Sensors): { display: Sensors; animating: boolean } {
  const [display, setDisplay] = useState<Sensors>(target)
  const [animating, setAnimating] = useState(false)
  const targetRef = useRef(target)
  targetRef.current = target
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
