# Changelog

All notable changes to Trofeo Vision Studio are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.9.1] — 2026-07-05

### Fixed
- Background GIF/WebP animation was stuck on the first frame after the
  v1.9.0 CSP tightening. `useAnimatedImage` fetches the IndexedDB-stored
  media (a `data:` URL) so WebCodecs can decode it frame-by-frame, but
  the new `connect-src` directive did not list `data:` — the fetch was
  blocked and the loader fell back to a plain `<img>` (which Konva only
  reads once). Added `data:` to `connect-src`.

## [1.9.0] — 2026-07-05

### Added
- **First-run wizard**: modal shown once on the very first launch. Live
  status pills for backend WS link, LCD detection, CPU-temperature
  availability, and the Windows notification permission — failing pills
  deep-link to the anchor in `docs/TROUBLESHOOTING.md` that explains the fix.
- **docs/TROUBLESHOOTING.md** covering SmartScreen, Zadig, non-admin CPU
  temperature, HVCI + PawnIO, autostart repair, LCD freeze triage, audio
  visualizer recovery, and log file locations.
- **docs/PROTOCOL.md**: dedicated byte-level LY-bulk reference (handshake
  packet layout, 16-byte chunk header fields, burst structure, worked
  examples, error-recovery flow).
- **README.en.md** — English port of the Japanese README, with a
  language switcher in both files.
- **CI + release automation** — `.github/workflows/ci.yml` runs lint +
  build + pytest + vitest on push / PR; `.github/workflows/release.yml`
  builds a full installer (including LHM DLLs auto-fetched from GitHub)
  and publishes a GitHub Release when a `v*` tag is pushed.
- **Baseline test coverage** — pytest golden-fixture suite freezes the
  LY chunk header layout (8 tests). Vitest covers layoutStore migration
  and every branch of `substituteTemplate` (15 tests).
- **CI + latest-release badges** in both READMEs.

### Changed
- Electron renderer hardened: `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webSecurity: true`, empty preload, plus a
  strict `Content-Security-Policy` header (script-src `'self' app:`,
  connect-src limited to loopback WebSocket + Open-Meteo).
- `window.open` denied and `will-navigate` blocked outside the app bundle.
- WebSocket handler rejects cross-origin browser connections with a 1008
  policy-violation code (allowlists `app://` and localhost).
- Debug hooks (`DEBUG_EVAL`, `DEBUG_SHOT`, `DEBUG_FRAME`, `DEBUG_QUIT_AFTER`)
  gated to `isDev` or an explicit `TROFEO_DEV=1` — they no longer respond
  to environment variables in a stock packaged build.
- Packaging: `redist/PawnIO_setup.exe` is now optional (the installer's
  NSIS macro skips PawnIO if the redist isn't present), so CI-built
  releases can omit it without a build failure.

### Fixed
- README screenshots re-shot with real sensor values (CPU 52°C etc.) via
  a new `window.__injectSensors` debug hook — the earlier non-admin
  smoke-test screenshots showed `--°C` for CPU temperature.

## [1.8.0] — 2026-07-05

### Added
- **LCD Adjust panel**: Contrast / Saturation / Brightness sliders applied via
  canvas `ctx.filter` to the outgoing frame. Direct compensation for the
  panel's dim look (peak brightness is hardware-capped — midtones and colour
  punch are where the win comes from).
- **Templated Text widget**: `{cpu.temp}`, `{gpu.load:1}`, `{time}`, `{date}`
  and other placeholders expand live inside a single Text widget. Placeholder
  chips in the inspector append to the selected text.
- **Warn / Crit threshold zones** on Bar and Graph widgets. Bar fills switch to
  the configured warn/crit colours once the value crosses; Graph shows tinted
  bands across the plot area.
- **Layers sidebar section**: reorder z-order, hide/show, lock/unlock, and
  delete any widget without needing to click through the stage.
- **Categorized + searchable widget palette** with English & Japanese
  aliases. Enter with a single match inserts it (keyboard-first).
- **Auto-update via electron-updater**: check GitHub Releases on startup and
  every 6 hours. Downloaded updates apply at "Install and restart" from the
  tray, never mid-session.

### Changed
- Frame capture path now skips the base64 round-trip: `canvas.toBlob` →
  `arrayBuffer` instead of `toDataURL` → `atob`. Fewer copies per frame.
- Explicit loopback bind for the WebSocket backend (`127.0.0.1`, was
  `localhost`). Opt in to LAN exposure with `TROFEO_HOST=0.0.0.0`.
- Text JSON commands to the backend are size-capped (4 KB) and shape-checked
  before dispatch.

### Fixed
- Backend crashes are now recovered automatically: Electron respawns
  `server.exe` with exponential backoff (1s → 30s, resets after 60s uptime).
- `send_frame` now attempts a USB port reset before reconnect on `USBError`
  — a plain reopen leaves a mid-transfer-crashed panel wedged.
- `sensor_loop` survives transient LHM / WMI failures instead of dying and
  freezing all sensor updates for the connection.

## [1.7.1] — 2026-07-04

### Fixed
- **Hidden-window rAF throttle**: Chromium was throttling `requestAnimationFrame`
  to ~1 fps for the tray-hidden resident window, freezing LCD animation until
  the editor was shown. `src/rafShim.ts` patches rAF before Konva binds it,
  keeping animation at ~85 fps hidden. (Measured: 1.2 fps → 85 fps hidden;
  full-pipeline eyes-free E2E hit 28.7 fps out of a 30 fps GIF background.)
- **Shortcut launch flashes and dies**: Windows UIPI silently dropped Chromium's
  second-instance notification from a non-elevated shortcut launch to the
  elevated resident. Replaced with a same-user signal file that crosses the
  elevation boundary via `%APPDATA%`.
- Toast card: left blue accent bar no longer overshoots the card's rounded
  corners (inset x=0 → x=8 to stay inside the curve).

## [1.7.0] and earlier

Full development history from v1.0.0 (initial installer, 2026-07-03) through
v1.7.0 is captured in git history and the project's internal memory notes.
Highlights: PyInstaller-bundled backend, admin-scheduled logon task,
notification mirror, SMTC now-playing, WASAPI-loopback audio visualizer,
adaptive fps, animated GIF backgrounds, drag snapping, undo/redo.

[1.9.1]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.9.1
[1.9.0]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.9.0
[1.8.0]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.8.0
