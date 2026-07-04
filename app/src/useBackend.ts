import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_SENSORS, type MediaState, type Sensors } from './types'

// Overridable for eyes-free testing against a side-by-side backend instance:
// the ?backend= query param (set by main.cjs from TROFEO_BACKEND_URL) beats
// the localStorage override beats the default port.
const URL = new URLSearchParams(location.search).get('backend')
  ?? localStorage.getItem('backend-url') ?? 'ws://localhost:8787'
// The Electron shutdown path sends its blanking frame to the same backend.
;(window as unknown as { __backendUrl?: string }).__backendUrl = URL

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
  sensors: Sensors
  // Latest Windows toast (new object per arrival) + listener permission state.
  notification: ToastData | null
  notifyStatus: string
  // System now-playing session (null until the backend reports one).
  media: MediaState | null
  // Latest visualizer bands from the backend loopback capture + its status.
  spectrumFrame: { bands: number[]; at: number } | null
  spectrumStatus: string
  sendFrame: (bytes: Uint8Array<ArrayBuffer>) => void
  // Send a JSON command to the backend (e.g. spectrum subscribe).
  sendCmd: (cmd: Record<string, unknown>) => void
}

/** Connects to the Python backend: receives sensor JSON, sends JPEG frames. */
export function useBackend(): Backend {
  const [link, setLink] = useState<LinkState>('connecting')
  const [device, setDevice] = useState('unknown')
  const [deviceDetail, setDeviceDetail] = useState('')
  const [sensors, setSensors] = useState<Sensors>(EMPTY_SENSORS)
  const [notification, setNotification] = useState<ToastData | null>(null)
  const [notifyStatus, setNotifyStatus] = useState('unknown')
  const [media, setMedia] = useState<MediaState | null>(null)
  const [spectrumFrame, setSpectrumFrame] = useState<{ bands: number[]; at: number } | null>(null)
  const [spectrumStatus, setSpectrumStatus] = useState('unknown')
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
        const msg = JSON.parse(ev.data)
        if (msg.type === 'sensors') setSensors(msg.data as Sensors)
        else if (msg.type === 'status') {
          setDevice(msg.device)
          setDeviceDetail(msg.detail ?? '')
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // Backpressure: if the backend stalls (USB retry etc.), drop frames instead
    // of queueing them without bound in the socket buffer.
    if (ws.bufferedAmount > 3 * 1024 * 1024) return
    ws.send(bytes)
  }, [])

  const sendCmd = useCallback((cmd: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(cmd))
  }, [])

  // Eyes-free debugging: inject a fake now-playing state from DEBUG_EVAL —
  // directly (__injectMedia) or via a one-shot localStorage key that survives
  // the seed-then-reload pattern ('debug-media').
  useEffect(() => {
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

  return {
    link, device, deviceDetail, sensors, notification, notifyStatus, media,
    spectrumFrame, spectrumStatus, sendFrame, sendCmd,
  }
}
