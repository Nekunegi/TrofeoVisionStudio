// Electron shell: launches the Python backend, hosts the editor renderer, and
// keeps streaming to the LCD while minimized to the tray (headless resident mode).
const {
  app, BrowserWindow, Tray, Menu, nativeImage, protocol, net, session, desktopCapturer,
} = require('electron')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const isDev = !app.isPackaged

// Eyes-free debugging: run a second (packaged) instance against a throwaway
// profile so it can't fight the resident app over the Chromium profile lock.
if (process.env.USER_DATA_DIR) app.setPath('userData', process.env.USER_DATA_DIR)
// Backend (server.py + trofeo/ + libs/) lives at the repo root in dev, and is
// bundled under resources/backend in the packaged app (see extraResources).
const BACKEND_DIR = isDev
  ? path.join(__dirname, '..', '..')
  : path.join(process.resourcesPath, 'backend')
const DIST = path.join(__dirname, '..', 'dist')
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

let win = null
let tray = null
let py = null

// The renderer fetches assets (e.g. the animated bg) with fetch(), which is
// blocked on file:// pages — so production serves dist/ over a custom app://
// scheme instead of loadFile.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function resolvePython() {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  return 'python' // last resort; on this machine the bare name may be the Store stub
}

function isElevated() {
  // `net session` succeeds only with an admin token.
  return spawnSync('net', ['session'], { windowsHide: true }).status === 0
}

// Register (or repair, e.g. after the install path changed) the logon task that
// starts the app elevated — CPU temperature needs admin. Runs on every elevated
// start; Register-ScheduledTask -Force makes it idempotent. Done here instead of
// in the NSIS installer to avoid schtasks quoting pitfalls.
function ensureAutostartTask() {
  if (isDev || !isElevated()) return
  const ps = [
    "Register-ScheduledTask -TaskName 'TrofeoVisionStudio' -Force",
    // --hidden: logon autostart goes straight to the tray (resident driver);
    // only manual launches show the editor window.
    `-Action (New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '--hidden')`,
    '-Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)',
    '-Principal (New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest)',
    '-Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries',
    '-DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable)',
  ].join(' ')
  const encoded = Buffer.from(ps, 'utf16le').toString('base64')
  const r = spawnSync('powershell', ['-NoProfile', '-EncodedCommand', encoded], { windowsHide: true })
  console.log(r.status === 0
    ? '[electron] autostart task registered/repaired'
    : `[electron] autostart task registration failed: ${r.stderr}`)
}

let backendStartTime = 0
let backendRestartCount = 0

function startBackend() {
  if (process.env.SKIP_BACKEND) {
    console.log('[electron] SKIP_BACKEND set; not spawning backend')
    return
  }
  // Packaged: self-contained server.exe (PyInstaller). Dev: python server.py.
  const serverExe = path.join(BACKEND_DIR, 'server.exe')
  const useExe = !isDev && fs.existsSync(serverExe)
  const cmd = useExe ? serverExe : resolvePython()
  const args = useExe ? [] : ['server.py']
  // In the packaged app there is no console — keep a log file for debugging.
  const logPath = path.join(app.getPath('userData'), 'backend.log')
  try { // cap growth: start fresh once the log passes 5MB
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) {
      fs.truncateSync(logPath, 0)
    }
  } catch { /* ignore */ }
  const log = fs.createWriteStream(logPath, { flags: 'a' })
  console.log(`[electron] backend: ${cmd} ${args.join(' ')} (cwd ${BACKEND_DIR}, log ${logPath})`)
  backendStartTime = Date.now()
  py = spawn(cmd, args, { cwd: BACKEND_DIR, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  py.stdout.on('data', (d) => { log.write(d); if (isDev) process.stdout.write(d) })
  py.stderr.on('data', (d) => { log.write(d); if (isDev) process.stderr.write(d) })
  py.on('error', (e) => console.error('[electron] backend spawn error:', e.message))
  py.on('exit', (code) => {
    const uptimeMs = Date.now() - backendStartTime
    py = null
    console.log(`[electron] backend exited: code=${code} after ${(uptimeMs / 1000) | 0}s`)
    if (app.isQuiting || process.env.SKIP_BACKEND) return
    // Healthy run before crash → reset the backoff so the next crash restarts fast.
    if (uptimeMs > 60_000) backendRestartCount = 0
    backendRestartCount++
    // 1s → 2s → 4s → 8s → 16s → 30s (capped). Prevents log spam on hard failures.
    const delay = Math.min(30_000, 1000 * 2 ** (backendRestartCount - 1))
    console.log(`[electron] restarting backend in ${delay}ms (attempt ${backendRestartCount})`)
    setTimeout(() => { if (!app.isQuiting) startBackend() }, delay)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 640,
    backgroundColor: '#0e0e13',
    title: 'Trofeo Vision Studio',
    // Logon autostart (--hidden) starts tray-only; streaming still runs because
    // backgroundThrottling is off and the page renders while hidden.
    show: !process.argv.includes('--hidden'),
    webPreferences: { backgroundThrottling: false }, // keep streaming when hidden
  })

  // Surface renderer console + load failures on stdout AND a log file — the
  // packaged app has no console, so renderer.log is the only trace of renderer
  // errors (e.g. audio-capture failures) in the resident install.
  const rlogPath = path.join(app.getPath('userData'), 'renderer.log')
  try {
    if (fs.existsSync(rlogPath) && fs.statSync(rlogPath).size > 5 * 1024 * 1024) {
      fs.truncateSync(rlogPath, 0)
    }
  } catch { /* ignore */ }
  const rlog = fs.createWriteStream(rlogPath, { flags: 'a' })
  rlog.write(`--- launch ${new Date().toISOString()} v${app.getVersion()} ---\n`)
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    // skip Electron's noisy CSP advisory; keep everything else
    if (!String(message).includes('Content-Security-Policy')) {
      rlog.write(`${new Date().toISOString()} [${level}] ${message}\n`)
    }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] failed to load ${url}: ${code} ${desc}`)
  })

  // Eyes-free testing: point the renderer at a side-by-side backend without
  // touching the profile's localStorage (the app:// handler ignores the query).
  const q = process.env.TROFEO_BACKEND_URL
    ? `?backend=${encodeURIComponent(process.env.TROFEO_BACKEND_URL)}` : ''
  if (isDev) win.loadURL(DEV_URL + q)
  else win.loadURL('app://bundle/index.html' + q)

  // Eyes-free debugging on a remote box: DEBUG_SHOT=<path.png> clicks the first
  // widget (so selection chrome shows) and saves an editor screenshot there.
  // DEBUG_CLICK_TEXT=<label> clicks that sidebar button instead (e.g. "Graph").
  // DEBUG_EVAL=<js> runs arbitrary JS in the renderer ~8s after launch and
  // logs the result — eyes-free poking (seed localStorage, inspect state, ...).
  if (process.env.DEBUG_EVAL) {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(process.env.DEBUG_EVAL)
        console.log('[debug] eval:', JSON.stringify(r))
      } catch (e) { console.error('[debug] eval failed:', e.message) }
    }, 8000)
  }
  // Second-stage eval at ~16s — survives a location.reload() issued by DEBUG_EVAL
  // (the seed-then-inspect pattern in one app run).
  if (process.env.DEBUG_EVAL_LATE) {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(process.env.DEBUG_EVAL_LATE)
        console.log('[debug] late eval:', JSON.stringify(r))
      } catch (e) { console.error('[debug] late eval failed:', e.message) }
    }, 16000)
  }
  // DEBUG_FRAME=<path.png> saves the full-resolution LCD content layer (the
  // first Konva canvas) — exactly what gets streamed to the panel.
  if (process.env.DEBUG_FRAME) {
    setTimeout(async () => {
      try {
        const url = await win.webContents.executeJavaScript(
          `document.querySelector('.canvas-wrap canvas').toDataURL('image/png')`)
        fs.writeFileSync(process.env.DEBUG_FRAME,
          Buffer.from(url.split(',')[1], 'base64'))
        console.log(`[debug] LCD frame saved: ${process.env.DEBUG_FRAME}`)
      } catch (e) { console.error('[debug] frame dump failed:', e.message) }
    }, 12000)
  }
  if (process.env.DEBUG_SHOT) {
    setTimeout(async () => {
      try {
        await win.webContents.executeJavaScript(`(() => {
          const label = ${JSON.stringify(process.env.DEBUG_CLICK_TEXT || '')}
          if (label) {
            const btn = [...document.querySelectorAll('button')]
              .find((b) => b.textContent.trim() === label)
            if (!btn) return 'no button ' + label
            btn.click()
            return 'clicked button ' + label
          }
          const c = document.querySelector('.canvas-wrap canvas')
          if (!c) return 'no canvas'
          const r = c.getBoundingClientRect()
          const o = { bubbles: true, clientX: r.left + 125, clientY: r.top + 100, button: 0 }
          c.dispatchEvent(new MouseEvent('mousedown', o))
          c.dispatchEvent(new MouseEvent('mouseup', o))
          return 'clicked'
        })()`)
        // after a button click, let 1Hz widgets (e.g. a fresh graph) gather data
        setTimeout(async () => {
          const img = await win.capturePage()
          fs.writeFileSync(process.env.DEBUG_SHOT, img.toPNG())
          console.log(`[debug] editor screenshot saved: ${process.env.DEBUG_SHOT}`)
        }, process.env.DEBUG_CLICK_TEXT ? 15000 : 1500)
      } catch (e) { console.error('[debug] screenshot failed:', e.message) }
    }, 10000)
  }

  // Closing hides to tray (streaming continues); real quit is via tray menu.
  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      win.hide()
    }
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Trofeo Vision Studio — streaming to LCD')
  // Autostart is handled by the installer-registered scheduled task
  // (TrofeoVisionStudio, elevated at logon) — no login-item toggle here.
  const menu = Menu.buildFromTemplate([
    { label: 'Show editor', click: () => win?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => win?.show())
}

// Two instances would fight over the USB device and port 8787 — a second
// launch just surfaces the existing window. SKIP_BACKEND runs are backendless
// (debug/visual checks against an already-running backend), so they may coexist.
//
// The 'second-instance' event alone can't do the surfacing: the resident
// instance is elevated (logon task, RunLevel Highest) and Windows UIPI drops
// Chromium's cross-process notification from a non-elevated launch (desktop
// shortcut) — the second window just flashed and died with the editor never
// appearing. A signal file crosses the elevation boundary instead: both
// processes run as the same user, so they share %APPDATA%.
const SHOW_SIGNAL = path.join(app.getPath('userData'), 'show-editor.signal')
if (!process.env.SKIP_BACKEND && !app.requestSingleInstanceLock()) {
  try { fs.writeFileSync(SHOW_SIGNAL, String(Date.now())) } catch { /* best effort */ }
  // exit(0), not quit(): quit would continue into whenReady long enough to
  // flash a window, spawn a doomed backend, and blank the resident's panel.
  app.exit(0)
}
app.on('second-instance', () => { win?.show(); win?.focus() })

function watchShowSignal() {
  try { fs.rmSync(SHOW_SIGNAL, { force: true }) } catch { /* ignore stale file */ }
  try {
    fs.watch(path.dirname(SHOW_SIGNAL), (_ev, file) => {
      if (file !== path.basename(SHOW_SIGNAL) || !fs.existsSync(SHOW_SIGNAL)) return
      try { fs.rmSync(SHOW_SIGNAL, { force: true }) } catch { /* ignore */ }
      win?.show()
      win?.focus()
    })
  } catch (e) {
    console.error('[electron] show-signal watch failed:', e.message)
  }
}

app.whenReady().then(() => {
  if (!isDev) {
    protocol.handle('app', (req) => {
      let p = decodeURIComponent(new URL(req.url).pathname)
      if (p === '/' || p === '') p = '/index.html'
      return net.fetch(pathToFileURL(path.join(DIST, p)).toString())
    })
  }
  // Audio visualizer: grant getDisplayMedia with Windows loopback audio without
  // showing a picker (the renderer stops the video track immediately — only the
  // system-audio track is used).
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' })
    }).catch(() => callback({}))
  }, { useSystemPicker: false })
  ensureAutostartTask()
  startBackend()
  createWindow()
  createTray()
  watchShowSignal()
  // DEBUG_QUIT_AFTER=<ms>: exercise the real quit path (incl. LCD blanking)
  // without clicking the tray menu — eyes-free testing.
  if (process.env.DEBUG_QUIT_AFTER) {
    setTimeout(() => { app.isQuiting = true; app.quit() }, +process.env.DEBUG_QUIT_AFTER)
  }
})

// Don't quit when the window is hidden — the tray keeps the app (and streaming) alive.
app.on('window-all-closed', () => {})

// On quit, blank the panel (send one black frame) so the LCD doesn't stay
// frozen on the last dashboard. The renderer does the work: it stops the app's
// own stream socket first (otherwise a queued dashboard frame could land after
// the black one), then sends the blanking frame over a fresh socket.
let blanked = false
app.on('before-quit', async (e) => {
  if (!blanked && win && !win.isDestroyed()) {
    e.preventDefault()
    blanked = true
    try {
      const r = await win.webContents.executeJavaScript(`(async () => {
        try { window.__trofeoWs?.close() } catch {}
        const c = document.createElement('canvas')
        c.width = 1920; c.height = 480
        c.getContext('2d').fillRect(0, 0, 1920, 480)
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
        const buf = await blob.arrayBuffer()
        await new Promise((resolve) => {
          const ws = new WebSocket(window.__backendUrl || 'ws://localhost:8787')
          ws.binaryType = 'arraybuffer'
          ws.onopen = () => { ws.send(buf); setTimeout(() => { ws.close(); resolve() }, 500) }
          ws.onerror = () => resolve()
          setTimeout(resolve, 2000)
        })
        return 'blanked'
      })()`)
      console.log('[quit]', r)
    } catch { /* backend gone — nothing to blank */ }
    app.quit() // re-enters with blanked=true
    return
  }
  if (py) {
    try { py.kill() } catch { /* ignore */ }
  }
})
