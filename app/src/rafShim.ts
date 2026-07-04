// requestAnimationFrame fallback for hidden windows.
//
// The tray-resident app runs with its window hidden (logon autostart uses
// --hidden), and Chromium throttles the compositor's BeginFrame stream of an
// invisible window to ~1fps — even with backgroundThrottling:false and
// occlusion detection disabled (measured: 1.2fps). Everything that animates
// (Konva batchDraw, sensor easing, animated backgrounds, the visualizer) is
// rAF-paced, so the LCD stream froze to 1fps whenever the window was hidden.
//
// The shim arms BOTH the native rAF and a setTimeout for every frame and lets
// the first one win. setTimeout is exempt from throttling in this app, so
// hidden windows keep animating at ~60fps; while the window is visible the
// native callback always fires first and vsync pacing is untouched.
//
// MUST be imported before konva: Konva captures the global into a const at
// module-load time (node_modules/konva/lib/Util.js `const req = ...`).

const nativeRAF = window.requestAnimationFrame.bind(window)
const nativeCAF = window.cancelAnimationFrame.bind(window)

// Compositor health probe: a permanent native rAF loop, never cancelled. When
// the window is visible it beats every ~16.7ms; hidden it drops to ~1fps.
// Both the gap and the recency test are needed — right after a 1fps beat the
// beat looks recent, but the gap says the compositor is throttled.
let prevBeat = 0
let beatGap = Infinity
;(function beat() {
  nativeRAF((t) => {
    beatGap = t - prevBeat
    prevBeat = t
    beat()
  })
})()

function compositorStalled(): boolean {
  return beatGap > 100 || performance.now() - prevBeat > 200
}

type FrameCb = (t: number) => void
let queue = new Map<number, FrameCb>()
let nextId = 1
let armed = false
let rafId = 0
let timerId: ReturnType<typeof setTimeout> | undefined

function pump(t: number) {
  armed = false
  nativeCAF(rafId)
  clearTimeout(timerId)
  const cbs = queue
  queue = new Map() // callbacks re-registering during the pump land in a fresh frame
  cbs.forEach((cb) => {
    try { cb(t) } catch (e) { console.error('[rafShim] frame callback failed:', e) }
  })
}

function arm() {
  if (armed) return
  armed = true
  rafId = nativeRAF(pump)
  // Healthy compositor: the timer is only a safety net and never fires.
  // Stalled: hidden renderers get no high-resolution timers, so delays are
  // quantized to the ~15.6ms Windows tick — a 16ms request rounds to TWO
  // ticks (~32ms → 32fps). A 4ms deadline lands on the NEXT tick: ~64fps.
  timerId = setTimeout(() => pump(performance.now()), compositorStalled() ? 4 : 250)
}

window.requestAnimationFrame = (cb: FrameCb): number => {
  const id = nextId++
  queue.set(id, cb)
  arm()
  return id
}
window.cancelAnimationFrame = (id: number) => { queue.delete(id) }

export {}
