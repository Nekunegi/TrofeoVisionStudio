import { useEffect, useRef, useState } from 'react'
import type { Backend } from './useBackend'

// Spectrum resolution (must match trofeo/audio.py BANDS) — visualizer widgets
// resample this down to their own bar count.
export const SPECTRUM_BANDS = 96
const ACTIVE_HOLD_MS = 1200 // stay "active" through brief silence between beats
const LOCAL_RETRY_MS = 15000
const BACKEND_STALE_MS = 4000 // backend heartbeats at 1Hz even when silent
const BACKEND_GRACE_MS = 6000 // wait this long for the backend before falling back
const F_LO = 40
const F_HI = 16000

// PRIMARY source is the backend's WASAPI loopback capture (works in the
// elevated resident app, where Chromium desktop capture is denied with
// NotReadableError). The in-renderer capture below is only a fallback for
// running against an older backend.
async function getLoopbackStream(): Promise<MediaStream> {
  const md = navigator.mediaDevices as unknown as {
    getUserMedia: (c: unknown) => Promise<MediaStream>
    getDisplayMedia: (c: unknown) => Promise<MediaStream>
  }
  try {
    return await md.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop' } },
    })
  } catch (e1) {
    try {
      return await md.getDisplayMedia({ audio: true, video: true })
    } catch (e2) {
      throw new Error(`desktop: ${e1}; displayMedia: ${e2}`)
    }
  }
}

/** System-audio spectrum for visualizer widgets: subscribes to the backend
 *  capture while `enabled`, falls back to in-renderer capture if the backend
 *  can't deliver. `active` is true while there is audible signal — the stream
 *  loop uses it to raise its fps. */
export function useAudioSpectrum(enabled: boolean, backend: Backend, hz = 30):
{ bands: number[] | null; active: boolean; error: string | null; source: 'backend' | 'local' | null } {
  const { link, spectrumFrame, spectrumStatus, sendCmd } = backend
  const [localBands, setLocalBands] = useState<number[] | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [useLocal, setUseLocal] = useState(false)
  const [active, setActive] = useState(false)

  // ask the backend to run its loopback capture while we need it
  useEffect(() => {
    if (!enabled || link !== 'open') return
    sendCmd({ cmd: 'spectrum', on: true, hz })
    return () => sendCmd({ cmd: 'spectrum', on: false })
  }, [enabled, link, sendCmd, hz])

  const frameRef = useRef(spectrumFrame)
  frameRef.current = spectrumFrame
  const statusRef = useRef(spectrumStatus)
  statusRef.current = spectrumStatus

  // fall back to local capture when the backend reports an error or just
  // never delivers (old backend without spectrum support)
  useEffect(() => {
    if (!enabled) {
      setUseLocal(false)
      return
    }
    const started = Date.now()
    const check = () => {
      const f = frameRef.current
      const fresh = !!f && Date.now() - f.at < BACKEND_STALE_MS
      const errored = statusRef.current.startsWith('error')
      setUseLocal(!fresh && (errored || Date.now() - started > BACKEND_GRACE_MS))
    }
    check()
    const t = setInterval(check, 1500)
    return () => clearInterval(t)
  }, [enabled, link])

  // ---- local (in-renderer) fallback engine --------------------------------
  useEffect(() => {
    if (!enabled || !useLocal) {
      setLocalBands(null)
      setLocalError(null)
      return
    }
    let stopped = false
    let raf = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let stream: MediaStream | null = null
    let audioCtx: AudioContext | null = null

    const stopCapture = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      audioCtx?.close().catch(() => {})
      audioCtx = null
    }

    const start = async () => {
      try {
        stream = await getLoopbackStream()
      } catch (e) {
        console.warn('[viz] local loopback capture failed:', e)
        if (!stopped) {
          setLocalError(e instanceof Error ? e.message : String(e))
          retry = setTimeout(start, LOCAL_RETRY_MS)
        }
        return
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      console.log('[viz] local loopback capture started')
      setLocalError(null)
      stream.getVideoTracks().forEach((t) => t.stop())
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.onended = () => {
          if (stopped) return
          stopCapture()
          retry = setTimeout(start, 1000)
        }
      }
      audioCtx = new AudioContext()
      const src = audioCtx.createMediaStreamSource(stream)
      const an = audioCtx.createAnalyser()
      an.fftSize = 2048
      an.smoothingTimeConstant = 0.7
      src.connect(an)
      const freq = new Uint8Array(an.frequencyBinCount)
      const binHz = audioCtx.sampleRate / an.fftSize
      const edges: number[] = []
      for (let i = 0; i <= SPECTRUM_BANDS; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / SPECTRUM_BANDS)
        edges.push(Math.min(an.frequencyBinCount - 1, Math.max(1, Math.round(f / binHz))))
      }
      const pushMs = 1000 / hz
      let lastPush = 0
      let wasSilent = false
      const tick = (t: number) => {
        raf = requestAnimationFrame(tick)
        if (t - lastPush < pushMs) return
        lastPush = t
        an.getByteFrequencyData(freq)
        const out = new Array<number>(SPECTRUM_BANDS)
        let audible = false
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const a = edges[i]
          const b = Math.max(a + 1, edges[i + 1])
          let m = 0
          for (let j = a; j < b; j++) m = Math.max(m, freq[j])
          let v = Math.max(0, m / 255 - 0.04) / 0.96
          v = Math.min(1, v * (0.75 + 0.65 * (i / SPECTRUM_BANDS)))
          out[i] = Math.pow(v, 1.25)
          if (out[i] > 0.04) audible = true
        }
        const silent = !audible
        if (!(silent && wasSilent)) setLocalBands(out)
        wasSilent = silent
      }
      raf = requestAnimationFrame(tick)
    }
    start()

    return () => {
      stopped = true
      clearTimeout(retry)
      stopCapture()
      setLocalBands(null)
      setLocalError(null)
    }
  }, [enabled, useLocal, hz])

  // ---- merge ---------------------------------------------------------------
  const fresh = !!spectrumFrame && Date.now() - spectrumFrame.at < BACKEND_STALE_MS
  const bands = enabled ? (fresh ? spectrumFrame!.bands : localBands) : null
  const source: 'backend' | 'local' | null = !enabled ? null
    : fresh ? 'backend' : localBands ? 'local' : null

  const lastAudibleRef = useRef(-1e9)
  useEffect(() => {
    if (bands && bands.some((v) => v > 0.04)) lastAudibleRef.current = Date.now()
    ;(window as unknown as { __spectrum?: number[] | null; __spectrumSrc?: string | null })
      .__spectrum = bands
    ;(window as unknown as { __spectrumSrc?: string | null }).__spectrumSrc = source
  })
  useEffect(() => {
    if (!enabled) {
      setActive(false)
      return
    }
    const t = setInterval(
      () => setActive(Date.now() - lastAudibleRef.current < ACTIVE_HOLD_MS), 250)
    return () => clearInterval(t)
  }, [enabled])

  const error = bands ? null
    : spectrumStatus.startsWith('error') ? `backend: ${spectrumStatus}`
    : localError
  return { bands, active, error, source }
}
