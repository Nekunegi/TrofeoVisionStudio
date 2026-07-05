import { useEffect, useState } from 'react'
import { loadBgMedia, loadBgVideoUrl, IDB_BG_VIDEO } from './bgStore'
import { compositorStalled } from './rafShim'

// Decode an image (animated GIF/WebP or static) and return the current frame as
// a CanvasImageSource plus the source's native frame rate, advancing on our own
// clock at the source's real timings. We drive frames ourselves because Chrome
// throttles a plain <img>'s animation when it isn't the focused/visible tab;
// the WebCodecs ImageDecoder + our own timer keeps playback at full speed in a
// focused window / Electron (backgroundThrottling: false).
//
// Frames are decoded ON DEMAND (sequentially, one per tick) instead of being
// pre-decoded: an 80-frame 1920x480 GIF pre-decoded to ImageBitmaps costs
// ~300MB of RAM, while just-in-time decoding holds only the encoded buffer
// plus two canvases (~7MB).
//
// Each decoded VideoFrame is immediately blitted into one of two persistent
// canvases (double buffer) and closed — Konva only ever sees canvases, which
// can't be invalidated. Handing VideoFrames to Konva directly caused visible
// flicker on the panel: a frame could be close()d while a capture was drawing
// it, yielding an intermittent background-less (dark) frame every ~0.5-1s.

export interface AnimatedImage {
  frame: CanvasImageSource | null
  // Native frame rate of the source, or null for static images / no image.
  // The stream loop uses this to match the LCD update rate to the animation.
  fps: number | null
}

function mimeOf(src: string): string {
  if (src.startsWith('data:')) return src.slice(5, src.indexOf(';'))
  const s = src.toLowerCase()
  if (s.endsWith('.gif')) return 'image/gif'
  if (s.endsWith('.png')) return 'image/png'
  if (s.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

export function useAnimatedImage(src: string | null): AnimatedImage {
  const [frame, setFrame] = useState<CanvasImageSource | null>(null)
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    // Clear the previous frame immediately on src change so downstream
    // consumers (like the bg editor modal) don't measure the OLD image while
    // the new one is still decoding.
    setFrame(null)
    setFps(null)
    if (!src) return
    let cancelled = false
    let raf = 0
    let dec: any = null
    let buffers: [HTMLCanvasElement, HTMLCanvasElement] | null = null
    let flip = 0

    // Blit the frame into the least-recently-shown buffer and release it.
    // Alternating canvas references also makes react-konva redraw the layer.
    const show = (vf: VideoFrame) => {
      if (!buffers) {
        buffers = [document.createElement('canvas'), document.createElement('canvas')]
        for (const c of buffers) {
          c.width = vf.displayWidth
          c.height = vf.displayHeight
        }
      }
      flip ^= 1
      const c = buffers[flip]
      c.getContext('2d')!.drawImage(vf, 0, 0)
      vf.close()
      setFrame(c)
    }

    const fallbackStatic = (actual: string) => {
      const img = new Image()
      img.onload = () => { if (!cancelled) { setFrame(img); setFps(null) } }
      img.src = actual
    }

    // Video-backed background: <video> plays off-screen and its current frame
    // is blitted to a canvas that Konva reads. requestVideoFrameCallback keeps
    // the paint in sync with actual decode ticks; rAF is a fallback for older
    // Chromium builds.
    // Two separate handle vars because vfc and rAF live in different ID
    // namespaces — mixing cancelAnimationFrame with a vfc handle silently
    // no-ops (or cancels the wrong callback).
    let vid: HTMLVideoElement | null = null
    let vfcHandle = 0
    let vidRafHandle = 0
    let objectUrl: string | null = null
    let vidBuffers: [HTMLCanvasElement, HTMLCanvasElement] | null = null
    let vidFlip = 0

    async function runVideo() {
      const url = await loadBgVideoUrl()
      if (!url || cancelled) { setFrame(null); setFps(null); return }
      objectUrl = url
      vid = document.createElement('video')
      vid.src = url
      vid.muted = true
      vid.loop = true
      vid.playsInline = true
      vid.autoplay = true
      try { await vid.play() } catch { /* browser autoplay policy — muted video should be fine */ }

      await new Promise<void>((res) => {
        if (vid!.readyState >= 2) res()
        else vid!.addEventListener('loadeddata', () => res(), { once: true })
      })
      if (cancelled) return

      const w = vid.videoWidth || 1920
      const h = vid.videoHeight || 480
      // Double buffer so setFrame receives a NEW canvas ref each tick —
      // React useState bails on Object.is equality, so reusing the same
      // canvas causes zero re-renders and Konva paints a static frame.
      vidBuffers = [document.createElement('canvas'), document.createElement('canvas')]
      for (const c of vidBuffers) { c.width = w; c.height = h }
      setFps(30) // fps isn't exposed by <video>; 30 is a reasonable target

      const AnyVid = vid as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
        cancelVideoFrameCallback?: (h: number) => void
      }
      const useVfc = typeof AnyVid.requestVideoFrameCallback === 'function'
      // Skip the blit when the playhead hasn't advanced — the paint may be
      // driven by both the vfc chain and the rAF watchdog below.
      let lastTime = -1
      const paint = () => {
        if (cancelled || !vid || !vidBuffers) return
        if (vid.currentTime === lastTime) return
        lastTime = vid.currentTime
        vidFlip ^= 1
        const c = vidBuffers[vidFlip]
        c.getContext('2d')!.drawImage(vid, 0, 0, w, h)
        setFrame(c)
      }
      if (useVfc) {
        const onVfc = () => {
          if (cancelled) return
          paint()
          vfcHandle = AnyVid.requestVideoFrameCallback!(onVfc)
        }
        vfcHandle = AnyVid.requestVideoFrameCallback!(onVfc)
      }
      // requestVideoFrameCallback only fires when a frame is PRESENTED, and a
      // hidden window presents nothing — the video kept playing but the bg
      // froze on whatever frame was up when the window was hidden. The shimmed
      // rAF loop keeps painting while the compositor is stalled (and is the
      // only driver when vfc is unsupported).
      const rafLoop = () => {
        if (cancelled) return
        if (!useVfc || compositorStalled()) paint()
        vidRafHandle = requestAnimationFrame(rafLoop)
      }
      paint()
      vidRafHandle = requestAnimationFrame(rafLoop)
    }

    async function run() {
      // Video path: sentinel signals a Blob is in IndexedDB. The sentinel
      // may carry a `#<epoch>` suffix that forces this effect to re-run
      // when the same-type media is replaced (React dep compare would
      // otherwise see the same string and skip the effect entirely).
      if (src!.startsWith(IDB_BG_VIDEO)) { runVideo(); return }
      // 'idb:bg' is the sentinel for user media persisted in IndexedDB
      // (background GIFs blow the localStorage quota) — resolve it first.
      const actual = src!.startsWith('idb:') ? await loadBgMedia() : src!
      if (!actual || cancelled) { setFrame(null); setFps(null); return }
      const AnyWin = window as unknown as { ImageDecoder?: any }
      if (!AnyWin.ImageDecoder) { fallbackStatic(actual); return }
      try {
        const buf = await (await fetch(actual)).arrayBuffer()
        dec = new AnyWin.ImageDecoder({ data: buf, type: mimeOf(actual) })
        await dec.tracks.ready
        const count = dec.tracks.selectedTrack?.frameCount ?? 1
        if (cancelled) return

        const first = await dec.decode({ frameIndex: 0 })
        if (cancelled) { first.image.close(); return }

        if (count <= 1) {
          // Static image: keep a bitmap, release the decoder.
          const bmp = await createImageBitmap(first.image)
          first.image.close()
          dec.close?.(); dec = null
          if (cancelled) { bmp.close(); return }
          setFrame(bmp); setFps(null)
          return
        }

        let durMs = (first.image.duration ?? 100000) / 1000 // µs -> ms
        setFps(Math.min(30, Math.max(1, Math.round(1000 / Math.max(durMs, 10)))))
        show(first.image)

        let idx = 0
        let nextAt = performance.now() + durMs
        let decoding = false
        const tick = (t: number) => {
          if (cancelled) return
          if (t >= nextAt && !decoding) {
            decoding = true
            idx = (idx + 1) % count
            dec.decode({ frameIndex: idx }).then(({ image }: { image: VideoFrame }) => {
              decoding = false
              if (cancelled) { image.close(); return }
              durMs = (image.duration ?? 50000) / 1000
              nextAt += durMs
              // resync after a long stall (window hidden without throttling off, etc.)
              if (performance.now() - nextAt > 1000) nextAt = performance.now() + durMs
              show(image)
            }).catch(() => { decoding = false })
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        fallbackStatic(actual)
      }
    }

    run()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      dec?.close?.()
      if (vid) {
        const AnyVid = vid as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }
        if (vfcHandle) AnyVid.cancelVideoFrameCallback?.(vfcHandle)
        if (vidRafHandle) cancelAnimationFrame(vidRafHandle)
        vid.pause()
        vid.removeAttribute('src')
        vid.load()
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  return { frame, fps }
}
