import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_SENSORS, type MediaState, type Sensors } from './types'

// Overridable for eyes-free testing against a side-by-side backend instance:
// the ?backend= query param (set by main.cjs from TROFEO_BACKEND_URL) beats
// the localStorage override beats the default port.
const URL = new URLSearchParams(location.search).get('backend')
  ?? localStorage.getItem('backend-url') ?? 'ws://localhost:8787'
// The Electron shutdown path reads this to send the LCD-blanking frame. Only
// publish it if it's a loopback WebSocket — otherwise a compromised renderer
// could steer the quit-time upload to an attacker-controlled host.
if (/^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(URL)) {
  ;(window as unknown as { __backendUrl?: string }).__backendUrl = URL
}

export type LinkState = 'connecting' | 'open' | 'closed'

export interface ToastData {
  id: number
  app: string
  title: string
  body: string
}

export interface Backend {
  link: LinkState
  device: string // 'connected' | 'disconnected' | 'unknown'
  deviceDetail: string
  // Physical panel size self-reported by the device handshake (null until the
  // first "connected" status). 1920x480 on the 9.16", 1280x480 on the 6.86".
  panel: { w: number; h: number } | null
  sensors: Sensors
  // Latest Windows toast (new object per arrival) + listener permission state.
  notification: ToastData | null
  notifyStatus: string
  // System now-playing session (null until the backend reports one).
  media: MediaState | null
  // Latest visualizer bands from the backend loopback capture + its status.
  spectrumFrame: { bands: number[]; at: number } | null
  spectrumStatus: string
  // What the panel actually achieves over USB (2s window), or null until the
  // backend reports one. `at` lets consumers ignore stale reports.
  lcdStats: { fps: number; avgMs: number; maxMs: number; skipped: number; at: number } | null
  // Returns false when the frame was dropped (socket closed / backpressure).
  sendFrame: (bytes: Uint8Array<ArrayBuffer>) => boolean
  // Send a JSON command to the backend (e.g. spectrum subscribe).
  sendCmd: (cmd: Record<string, unknown>) => void
}

/** Connects to the Python backend: receives sensor JSON, sends JPEG frames. */
export function useBackend(): Backend {
  const [link, setLink] = useState<LinkState>('connecting')
  const [device, setDevice] = useState('unknown')
  const [deviceDetail, setDeviceDetail] = useState('')
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null)
  const [sensors, setSensors] = useState<Sensors>(EMPTY_SENSORS)
  const [notification, setNotification] = useState<ToastData | null>(null)
  const [notifyStatus, setNotifyStatus] = useState('unknown')
  const [media, setMedia] = useState<MediaState | null>(null)
  const [spectrumFrame, setSpectrumFrame] = useState<{ bands: number[]; at: number } | null>(null)
  const [spectrumStatus, setSpectrumStatus] = useState('unknown')
  const [lcdStats, setLcdStats] =
    useState<{ fps: number; avgMs: number; maxMs: number; skipped: number; at: number } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      const ws = new WebSocket(URL)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      // Exposed for the Electron shutdown path: it closes this socket to stop
      // the stream loop before sending the final blanking frame.
      ;(window as unknown as { __trofeoWs?: WebSocket }).__trofeoWs = ws
      setLink('connecting')

      ws.onopen = () => setLink('open')
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        // A malformed frame from any source (dev proxy, injected fuzzer,
        // half-migrated backend) should not crash the whole handler.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
        if (msg.type === 'sensors') setSensors(msg.data as Sensors)
        else if (msg.type === 'status') {
          setDevice(msg.device)
          setDeviceDetail(msg.detail ?? '')
          // Panel size rides the "connected" status. Kept across disconnects —
          // the physical panel doesn't change, and dropping it would bounce
          // the editor canvas on every backend restart.
          const w = +msg.width, h = +msg.height
          if (w >= 240 && w <= 4096 && h >= 240 && h <= 4096) {
            setPanel((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }))
          }
        } else if (msg.type === 'notification') {
          setNotification({ ...(msg.data as ToastData) })
        } else if (msg.type === 'notifyStatus') {
          setNotifyStatus(msg.status ?? 'unknown')
        } else if (msg.type === 'media') {
          const d = msg.data as Partial<MediaState>
          // the backend includes "thumb" only when the art changed — keep the
          // cached art otherwise
          setMedia((prev) => ({
            hasMedia: !!d.hasMedia,
            app: d.app ?? '', title: d.title ?? '',
            artist: d.artist ?? '', album: d.album ?? '',
            playing: !!d.playing, pos: d.pos ?? 0, dur: d.dur ?? 0,
            thumb: 'thumb' in d ? (d.thumb ?? null) : (prev?.thumb ?? null),
            receivedAt: Date.now(),
          }))
        } else if (msg.type === 'spectrum') {
          setSpectrumFrame({ bands: msg.data as number[], at: Date.now() })
        } else if (msg.type === 'spectrumStatus') {
          setSpectrumStatus(msg.status ?? 'unknown')
        } else if (msg.type === 'lcdfps') {
          setLcdStats({
            fps: +msg.fps || 0, avgMs: +msg.avgMs || 0, maxMs: +msg.maxMs || 0,
            skipped: +msg.skipped || 0, at: Date.now(),
          })
        }
      }
      ws.onclose = () => {
        // an abandoned socket (effect re-run / unmount) must not touch state —
        // in dev, StrictMode's ghost connection would wipe it after the fact
        if (closed) return
        setLink('closed')
        // the device status came from this (now dead) backend — don't show a
        // stale "connected" pill while reconnecting
        setDevice('unknown')
        setDeviceDetail('')
        setMedia(null) // now-playing state from the dead backend is stale
        // Sensors, notify/spectrum status must also reset — otherwise the
        // first-run wizard's "backend connection" light stays green (via CPU
        // temp still showing a value) and the notify pill lies about the
        // subscription being alive after the socket died.
        setSensors(EMPTY_SENSORS)
        setNotifyStatus('unknown')
        setSpectrumStatus('unknown')
        setSpectrumFrame(null)
        setLcdStats(null)
        retry = setTimeout(connect, 1500)
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [])

  const sendFrame = useCallback((bytes: Uint8Array<ArrayBuffer>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    // Backpressure: the backend drains the socket eagerly and skips stale
    // frames itself, so a growing buffer means it is stalled or gone — drop
    // instead of queueing seconds of latency. ~1MB is a handful of frames.
    if (ws.bufferedAmount > 1024 * 1024) return false
    ws.send(bytes)
    return true
  }, [])

  const sendCmd = useCallback((cmd: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(cmd))
  }, [])

  // Eyes-free debugging: inject a fake now-playing state from DEBUG_EVAL —
  // directly (__injectMedia) or via a one-shot localStorage key that survives
  // the seed-then-reload pattern ('debug-media').
  // Dev-only surface — packaged prod builds must not leak a global sensor
  // override, otherwise any XSS could spoof the streamed LCD content.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const inject = (d: Partial<MediaState>) => setMedia({
      hasMedia: true, app: '', title: '', artist: '', album: '',
      playing: false, pos: 0, dur: 0, thumb: null,
      ...d, receivedAt: Date.now(),
    })
    ;(window as unknown as { __injectMedia?: typeof inject }).__injectMedia = inject
    const dbg = localStorage.getItem('debug-media')
    if (dbg) {
      localStorage.removeItem('debug-media')
      try { inject(JSON.parse(dbg)) } catch { /* malformed — ignore */ }
    }
  }, [])

  // Eyes-free debugging: synthetic sensor overrides for screenshots / demos
  // when the backend can't reach real values (e.g. a non-elevated test
  // instance can't read CPU temperature via PawnIO). Same shape as __injectMedia:
  // window.__injectSensors({cpuTemp: 52, gpuLoad: 78, ...}) or a one-shot
  // 'debug-sensors' localStorage key that survives a location.reload().
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const inject = (d: Partial<Sensors>) =>
      setSensors((prev) => ({ ...prev, ...d } as Sensors))
    ;(window as unknown as { __injectSensors?: typeof inject }).__injectSensors = inject
    const dbg = localStorage.getItem('debug-sensors')
    if (dbg) {
      localStorage.removeItem('debug-sensors')
      try { inject(JSON.parse(dbg)) } catch { /* malformed — ignore */ }
    }
  }, [])

  return {
    link, device, deviceDetail, panel, sensors, notification, notifyStatus, media,
    spectrumFrame, spectrumStatus, lcdStats, sendFrame, sendCmd,
  }
}
