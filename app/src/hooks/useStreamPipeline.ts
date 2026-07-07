import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import type { RefObject } from 'react'
import type { Layout } from '../types'
import type { LinkState } from '../useBackend'
import { compositorStalled } from '../rafShim'

export interface StreamPipelineOpts {
  streaming: boolean
  sendFrame: (bytes: Uint8Array<ArrayBuffer>) => boolean
  stageRef: RefObject<Konva.Stage | null>
  layoutRef: RefObject<Layout>
  link: LinkState
  fpsCeiling: number
  /** UI-facing panel rotation (v2 scheme, 0 = correctly mounted). */
  panelRotate: 0 | 90 | 180 | 270
  /** Physical hardware buffer size (1920x480, or 1280x480 on the 6.86"). */
  panelW: number
  panelH: number
  onMeasuredFps: (fps: number) => void
}

/** Draw-driven LCD capture: the panel gets a frame when (and only when) the
 * Konva content layer actually redrew — GIF flip, sensor easing, toast motion,
 * visualizer bands, editor drags. A free-running timer here caused the
 * long-standing judder: sampling a 20fps GIF with an independent 30/60fps
 * clock duplicates/skips source frames on a drifting beat, and even at a
 * matched 20/20 the two clocks slid past each other (periodic dropped frame).
 * Phase-locking capture to the redraw removes the beat entirely; fpsCeiling
 * only acts as a throttle. */
export function useStreamPipeline(opts: StreamPipelineOpts) {
  const { streaming, sendFrame } = opts

  // Reused offscreen canvas for the panel-rotation compositing (editor stays
  // in logical coords; this canvas is the physical hardware buffer).
  const rotCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // Keep dynamic parameters in refs so the long-lived capture pipeline reads
  // the latest value without re-running the effect on every render.
  const stageRef = opts.stageRef
  const layoutRef = opts.layoutRef
  const fpsCeilingRef = useRef(opts.fpsCeiling)
  const panelRotateRef = useRef(opts.panelRotate)
  const panelSizeRef = useRef<[number, number]>([opts.panelW, opts.panelH])
  const linkRef = useRef(opts.link)
  const onFpsRef = useRef(opts.onMeasuredFps)
  fpsCeilingRef.current = opts.fpsCeiling
  panelRotateRef.current = opts.panelRotate
  panelSizeRef.current = [opts.panelW, opts.panelH]
  linkRef.current = opts.link
  onFpsRef.current = opts.onMeasuredFps

  useEffect(() => {
    if (!streaming) return
    let cancelled = false
    // measuredFps is a rolling 1-second window (frames emitted / window
    // duration), not a cumulative session average — otherwise a rate change
    // (5→60) takes tens of seconds to converge and any earlier stall gets
    // baked into the reported number forever.
    let winStart = performance.now()
    let winFrames = 0
    let lastCap = 0        // when the last capture started (throttle anchor)
    let dirty = false      // a redraw happened since the last capture
    let encoding = false   // JPEG encode in flight — captures are serialized
    let trailing: ReturnType<typeof setTimeout> | null = null

    const capture = () => {
      const stage = stageRef.current
      if (!stage) return
      lastCap = performance.now()
      // Skip encoding entirely if the backend socket is dead — sendFrame
      // would drop the bytes anyway. The keepalive below pushes a frame
      // shortly after reconnect. Reset the rolling window so downtime
      // doesn't drag the reported fps down after reconnect.
      if (linkRef.current !== 'open') {
        winStart = performance.now()
        winFrames = 0
        return
      }
      const l = layoutRef.current
      const contrast = l.lcdContrast ?? 1
      const saturation = l.lcdSaturation ?? 1
      const brightness = l.lcdBrightness ?? 1
      const needsFilter = contrast !== 1 || saturation !== 1 || brightness !== 1
      const src = stage.getLayers()[0].getCanvas()._canvas
      const [PW, PH] = panelSizeRef.current
      let rc = rotCanvasRef.current
      if (!rc) {
        rc = document.createElement('canvas')
        rotCanvasRef.current = rc
      }
      if (rc.width !== PW || rc.height !== PH) {
        rc.width = PW
        rc.height = PH
      }
      const ctx = rc.getContext('2d')!
      ctx.save()
      if (needsFilter) {
        ctx.filter = `contrast(${contrast}) saturate(${saturation}) brightness(${brightness})`
      }
      // Convert UI-facing rotation to hardware rotation: the panel is
      // physically mounted 180° out from what the user sees, so we always
      // add 180° when emitting to the LCD buffer.
      const rot = ((panelRotateRef.current + 180) % 360) as 0 | 90 | 180 | 270
      switch (rot) {
        case 0:
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PW, PH)
          break
        case 90:
          ctx.translate(PW, 0)
          ctx.rotate(Math.PI / 2)
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PH, PW)
          break
        case 180:
          ctx.translate(PW, PH)
          ctx.rotate(Math.PI)
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PW, PH)
          break
        case 270:
          ctx.translate(0, PH)
          ctx.rotate(-Math.PI / 2)
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PH, PW)
          break
        default:
          // Corrupt panelRotate (e.g. imported preset with a stray 45°) — fall
          // back to identity so we still emit A frame rather than a blank one.
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, PW, PH)
          break
      }
      ctx.restore()

      const deliver = (bytes: Uint8Array<ArrayBuffer>) => {
        // Count only frames the socket accepted — backpressure drops must not
        // inflate the reported rate.
        if (!sendFrame(bytes)) return
        const p = performance.now()
        winFrames++
        if (p - winStart >= 1000) {
          onFpsRef.current(Math.round(winFrames * 1000 / (p - winStart) * 10) / 10)
          winStart = p
          winFrames = 0
        }
      }
      encoding = true
      const done = () => { encoding = false; pump() }
      if (compositorStalled()) {
        // Hidden window (tray-resident logon start): Chromium schedules the
        // async encoders (toBlob / OffscreenCanvas.convertToBlob) as idle
        // tasks, and a hidden renderer only reaches them ~once per second —
        // the loop serialized on the callback, so the LCD froze to ~1fps
        // until the editor was opened. Synchronous toDataURL (~20ms) is
        // immune; the base64 detour only runs while the window is hidden.
        const url = rc.toDataURL('image/jpeg', 0.72)
        const bin = atob(url.slice(url.indexOf(',') + 1))
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        deliver(bytes)
        done()
      } else {
        rc.toBlob(async (blob) => {
          if (cancelled) return
          if (blob) {
            const buf = await blob.arrayBuffer()
            if (cancelled) return
            deliver(new Uint8Array(buf))
          }
          done()
        }, 'image/jpeg', 0.72)
      }
    }

    // Throttle-with-trailing at the fps ceiling: a redraw inside the
    // min-interval isn't dropped, it's captured the moment the interval
    // elapses (the canvas then holds the newest content). The 4ms tolerance
    // absorbs timer jitter so a 20fps GIF against a 20fps ceiling never
    // defers a whole extra period.
    const pump = () => {
      if (cancelled || !dirty || encoding) return
      const minInterval = 1000 / Math.max(1, fpsCeilingRef.current)
      const wait = lastCap + minInterval - performance.now()
      if (wait > 4) {
        if (!trailing) trailing = setTimeout(() => { trailing = null; pump() }, wait)
        return
      }
      dirty = false
      capture()
      if (!encoding) pump() // capture bailed (no stage / link down) — don't stall
    }
    const onDraw = () => { dirty = true; pump() }

    // The content layer persists (Stage has no key), but re-bind defensively
    // from the keepalive in case react-konva ever recreates it.
    let boundLayer: Konva.Layer | null = null
    const bind = () => {
      const layer = stageRef.current?.getLayers()[0] ?? null
      if (layer === boundLayer) return
      boundLayer?.off('draw.stream')
      boundLayer = layer
      layer?.on('draw.stream', onDraw)
    }
    bind()
    onDraw() // first frame right away

    // ~1Hz keepalive: fully-static scenes and backend reconnects still get a
    // frame even though nothing redraws.
    const keep = setInterval(() => {
      bind()
      if (performance.now() - lastCap > 1000) { dirty = true; pump() }
    }, 250)

    return () => {
      cancelled = true
      clearInterval(keep)
      if (trailing) clearTimeout(trailing)
      boundLayer?.off('draw.stream')
    }
  }, [streaming, sendFrame, stageRef, layoutRef])
}
