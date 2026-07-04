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

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      const cur = dispRef.current
      const tgt = targetRef.current
      let active = false
      let changed = false
      const next = { ...cur }
      for (const k of Object.keys(EMPTY_SENSORS) as SensorMetric[]) {
        const tv = tgt[k]
        const cv = cur[k]
        if (tv == null || cv == null) {
          if (cv !== tv) { next[k] = tv; changed = true }
          continue
        }
        const d = tv - cv
        if (Math.abs(d) < 0.05) {
          if (cv !== tv) { next[k] = tv; changed = true }
        } else {
          next[k] = cv + d * Math.min(1, dt * 7) // ~exponential glide, ≈400ms settle
          active = true
          changed = true
        }
      }
      if (changed) {
        dispRef.current = next
        setDisplay(next)
      }
      setAnimating(active)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return { display, animating }
}
