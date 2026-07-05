// Electron shell: launches the Python backend, hosts the editor renderer, and
// keeps streaming to the LCD while minimized to the tray (headless resident mode).
const {
  app, BrowserWindow, Tray, Menu, nativeImage, protocol, net, session, desktopCapturer,
  Notification, ipcMain, shell,
} = require('electron')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { autoUpdater } = require('electron-updater')

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
    width: 1100,
    height: 900,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: '#0e0e13',
    title: 'Trofeo Vision Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    // Logon autostart (--hidden) starts tray-only; streaming still runs because
    // backgroundThrottling is off and the page renders while hidden.
    show: !process.argv.includes('--hidden'),
    webPreferences: {
      backgroundThrottling: false, // keep streaming when hidden
      // Locked-down defaults — the renderer runs untrusted-ish (localStorage
      // may hold user-supplied SVG / data URLs). No Node APIs, sandboxed
      // renderer process, contextIsolation for any future IPC helpers.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Block the renderer from opening arbitrary external windows / navigating
  // away from the app bundle. Legitimate outbound HTTPS links (README,
  // troubleshooting docs) are routed to the OS default browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      shell.openExternal(url).catch((e) => console.warn('[electron] openExternal failed:', e.message))
    } else {
      console.warn('[electron] denied window.open to', url)
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(DEV_URL) && !url.startsWith('app://')) {
      e.preventDefault()
      console.warn('[electron] blocked navigation to', url)
    }
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

  // Eyes-free debugging hooks. Gated to dev mode by default so a packaged
  // resident won't respond to DEBUG_EVAL etc. — set TROFEO_DEV=1 to opt back
  // in when running smoke tests against a packaged win-unpacked build.
  const debugHooksEnabled = isDev || process.env.TROFEO_DEV === '1'

  // DEBUG_SHOT=<path.png> clicks the first widget (so selection chrome
  // shows) and saves an editor screenshot there.
  // DEBUG_CLICK_TEXT=<label> clicks that sidebar button instead (e.g. "Graph").
  // DEBUG_EVAL=<js> runs arbitrary JS in the renderer ~8s after launch and
  // logs the result — eyes-free poking (seed localStorage, inspect state, ...).
  if (debugHooksEnabled && process.env.DEBUG_EVAL) {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(process.env.DEBUG_EVAL)
        console.log('[debug] eval:', JSON.stringify(r))
      } catch (e) { console.error('[debug] eval failed:', e.message) }
    }, 8000)
  }
  // Second-stage eval at ~16s — survives a location.reload() issued by DEBUG_EVAL
  // (the seed-then-inspect pattern in one app run).
  if (debugHooksEnabled && process.env.DEBUG_EVAL_LATE) {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(process.env.DEBUG_EVAL_LATE)
        console.log('[debug] late eval:', JSON.stringify(r))
      } catch (e) { console.error('[debug] late eval failed:', e.message) }
    }, 16000)
  }
  // DEBUG_FRAME=<path.png> saves the full-resolution LCD content layer (the
  // first Konva canvas) — exactly what gets streamed to the panel.
  if (debugHooksEnabled && process.env.DEBUG_FRAME) {
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
  if (debugHooksEnabled && process.env.DEBUG_SHOT) {
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

// Updater state — surfaced in the tray menu so a hidden resident can still
// see when a new version is available.
let updateReadyVersion = null
let updateChecking = false
// Full updater state broadcast to the renderer bell. `state` is one of:
// idle | checking | available | downloading | ready | error.
// current is filled once we know the running version (post whenReady).
let updaterState = { state: 'idle', current: null, version: null, percent: 0, error: null }

function pushUpdaterState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', updaterState)
  }
}

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch }
  pushUpdaterState()
}

function rebuildTrayMenu() {
  if (!tray) return
  const items = [
    { label: 'Show editor', click: () => win?.show() },
    { type: 'separator' },
  ]
  if (updateReadyVersion) {
    items.push({
      label: `Install update ${updateReadyVersion} and restart`,
      click: () => { app.isQuiting = true; autoUpdater.quitAndInstall() },
    })
  } else {
    items.push({
      label: updateChecking ? 'Checking for updates…' : 'Check for updates',
      enabled: !updateChecking,
      click: () => { updateChecking = true; rebuildTrayMenu(); autoUpdater.checkForUpdates().catch(() => {}) },
    })
  }
  items.push({ type: 'separator' })
  items.push({ label: 'Quit', click: () => { app.isQuiting = true; app.quit() } })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Trofeo Vision Studio — streaming to LCD')
  // Autostart is handled by the installer-registered scheduled task
  // (TrofeoVisionStudio, elevated at logon) — no login-item toggle here.
  rebuildTrayMenu()
  tray.on('double-click', () => win?.show())
}

// Auto-update: check GitHub Releases on startup and every 6h; downloaded
// updates apply at quit-and-install (never mid-session; would kill streaming).
// NOTE: the source repo is currently private — electron-updater needs a GH
// token to reach private release assets, so checks will fail silently until
// the repo (or its releases) go public. The code path stays wired.
function setupAutoUpdate() {
  updaterState.current = app.getVersion()
  if (isDev) { pushUpdaterState(); return }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false // let the user press "Install and restart"
  autoUpdater.on('checking-for-update', () => {
    updateChecking = true
    rebuildTrayMenu()
    // Preserve 'ready' if a downloaded update is already waiting.
    if (updaterState.state !== 'ready') setUpdaterState({ state: 'checking', error: null })
  })
  autoUpdater.on('update-not-available', () => {
    updateChecking = false
    rebuildTrayMenu()
    if (updaterState.state !== 'ready') setUpdaterState({ state: 'idle' })
  })
  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`)
    setUpdaterState({ state: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (p) => {
    setUpdaterState({ state: 'downloading', percent: Math.round(p.percent || 0) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update ready: ${info.version}`)
    updateReadyVersion = info.version
    updateChecking = false
    rebuildTrayMenu()
    setUpdaterState({ state: 'ready', version: info.version, percent: 100 })
    if (Notification.isSupported()) {
      new Notification({
        title: 'Trofeo Vision Studio',
        body: `新しいバージョン ${info.version} をインストールできます`,
      }).show()
    }
  })
  autoUpdater.on('error', (e) => {
    updateChecking = false
    rebuildTrayMenu()
    console.error('[updater] error:', e.message)
    setUpdaterState({ state: 'error', error: e.message })
  })
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

// Renderer bell button IPC.
ipcMain.handle('updater:get', () => updaterState)
ipcMain.handle('updater:check', () => {
  if (isDev) return { ok: false, reason: 'dev' }
  autoUpdater.checkForUpdates().catch(() => {})
  return { ok: true }
})
ipcMain.handle('updater:install', () => {
  if (updaterState.state !== 'ready') return { ok: false, reason: 'not-ready' }
  app.isQuiting = true
  // Slight defer so the IPC reply reaches the renderer before we tear down.
  setTimeout(() => autoUpdater.quitAndInstall(), 200)
  return { ok: true }
})

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

// Strict CSP for the renderer. Dev mode gets 'unsafe-inline' / 'unsafe-eval'
// for Vite HMR; production locks scripts to 'self' + app://. Open-Meteo is
// whitelisted for the weather widget; ws://127.0.0.1:* covers the backend
// WebSocket (never LAN — the backend also binds loopback-only).
function installCsp() {
  const dev = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: app: ws: wss: http://localhost:*"
  const prod = [
    "default-src 'self' app:",
    "script-src 'self' app:",
    "style-src 'self' app: 'unsafe-inline'", // Konva / react-konva inject inline styles
    "img-src 'self' app: data: blob:",
    "media-src 'self' app: blob:",
    "font-src 'self' app: data:",
    // Backend binds 127.0.0.1 explicitly, but useBackend defaults to
    // ws://localhost:8787 (browser resolves that to loopback). Allow both
    // host forms so a first-run install without a manual localStorage
    // override still connects.
    // data: is required for fetch() of the IndexedDB-persisted background
    // media (a data: URL) inside useAnimatedImage — WebCodecs decodes it
    // frame-by-frame. img-src doesn't cover that; fetch is a connect-src.
    "connect-src 'self' app: data: ws://127.0.0.1:* ws://localhost:* https://api.open-meteo.com https://geocoding-api.open-meteo.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    // Defense in depth: no <object>/<embed>, no cross-origin iframes, no form
    // submits leaving the app, no service workers loaded from anywhere else.
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "worker-src 'self'",
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? dev : prod],
      },
    })
  })
}

app.whenReady().then(() => {
  installCsp()
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
  setupAutoUpdate()
  // DEBUG_QUIT_AFTER=<ms>: exercise the real quit path (incl. LCD blanking)
  // without clicking the tray menu — eyes-free testing.
  if ((isDev || process.env.TROFEO_DEV === '1') && process.env.DEBUG_QUIT_AFTER) {
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
          // The shutdown URL is validated here — a compromised renderer can
          // rewrite window.__backendUrl to point elsewhere, so we only accept
          // loopback WebSockets.
          const raw = window.__backendUrl || 'ws://localhost:8787'
          const url = /^wss?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/i.test(raw)
            ? raw : 'ws://localhost:8787'
          const ws = new WebSocket(url)
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
