# Changelog

All notable changes to Trofeo Vision Studio are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.12.0] — 2026-07-06

### Fixed
- **Choppy playback at 30/60 fps and occasional frame drops on Auto**
  (user report). Two root causes, both fixed:
  - The LCD capture ran on its own timer, independent of the animation.
    Sampling a 20 fps GIF with a free-running 30/60 fps clock duplicates
    and skips source frames on a drifting beat (3:2-pulldown-style
    judder), and even the matched 20/20 case slid in and out of phase.
    Capture is now **driven by the canvas redraw itself** (Konva layer
    `draw` event, throttled at the Max fps ceiling): every animation
    frame is sent exactly once, when it is drawn. Measured on a 20 fps
    GIF: Auto = 20.0 fps with 50.0 ms ± 2.7 ms spacing and zero
    outliers; a 60 fps ceiling no longer force-resamples to 60 — the
    stream follows the source.
  - The backend pushed every incoming frame to the USB panel in arrival
    order. When the requested rate exceeded what the USB link sustains,
    frames queued up (seconds of latency) and then dropped in bursts.
    Frames now go through a **latest-frame-wins mailbox**: the socket is
    drained eagerly, stale frames are skipped, and the panel always
    shows the newest frame at whatever rate the hardware achieves
    (verified: 60 fps in → 25 fps capacity out = clean 24.6 fps, last
    frame always current).
- Stream rate no longer flip-flops between the animation rate and the
  Max fps ceiling ~once a second while sensor values ease (another
  judder source at 30/60).

### Added
- The backend measures the real USB frame rate / transfer time and
  reports it to the editor every 2 s (`lcdfps` message); the header's
  "out" figure now shows what the panel actually displays, not just
  what the editor sends. `backend.log` gains `usb avg/max ms` and
  stale-skip counts (every 100th frame) for diagnosing panel capacity.

## [1.11.8] — 2026-07-06

### Changed
- **Quieter header** (user request): removed the brand logo icon and the
  undo/redo buttons added in 1.11.6. Undo/redo remain on Ctrl+Z / Ctrl+Y
  (listed in the Selection panel's shortcut hints).
- **Editor fits one screen without scrolling, both panel orientations**
  (user request). Landscape: the preview height is now computed from the
  live window height minus the actual inspector masonry height (was a
  fixed 420px cap), so preview + cards always share the window.
  Tightened main paddings/gaps, palette buttons, masonry column width
  (260→230, fits 3 columns even in the default 1100px window) and the
  side panel (302→288). Verified 0px overflow at 1100×900 in both
  landscape and portrait.
- Slider labels no longer wrap mid-word in narrow columns.

## [1.11.7] — 2026-07-06

### Fixed
- **1.11.6's fixed-column sidebar looked broken**: four fixed-height
  column stacks left large empty gaps below short columns and wrapped
  awkwardly at some window widths (user report: "UIの崩れや無駄なスペース").
  New split: the two height-volatile sections (Selection, Layers) are
  pinned in a dedicated right side panel with its own scroll, and the
  settings sections (Add widget / Background / LCD / Notifications /
  Presets) went back to the original dense CSS-columns masonry — their
  heights are static, so the old column-jumping can't recur.

## [1.11.6] — 2026-07-06

### Changed
- **Inspector sections no longer jump between columns**: the sidebar was
  CSS-columns masonry, which auto-balances — selecting a widget grew the
  Selection card and reshuffled every section into a different column.
  Now four fixed column stacks (Add widget / Selection+Layers /
  Background+LCD / Notifications+Presets), responsive via grid
  `auto-fit`. Every card keeps its place while editing.
- **Selection panel upgrades**: numeric X/Y position inputs; six
  alignment buttons (left/center/right, top/middle/bottom against the
  panel edges); Copy/Front/Back as a tidy equal-width row (labels no
  longer wrapped mid-word); all property labels localized (色 / 不透明度 /
  メトリック … follow the JA/EN toggle).
- **Undo/redo buttons in the header** (with hover tooltips showing
  Ctrl+Z / Ctrl+Y), enabled/disabled to match the history state.
- **Keyboard shortcut hints** in the empty Selection panel render as
  styled key chips instead of a text blob.
- **Brand icon in the header** next to the app name.
- Keyboard-focus rings on buttons/inputs for accessibility; disabled
  buttons now look disabled.

### Fixed
- **LCD ran at ~1fps after logon until the editor window was opened**
  (regression introduced in 1.8.0). The tray-resident hidden window
  encodes frames with `canvas.toBlob`, which Chromium schedules as an
  idle task — hidden renderers reach idle tasks only ~once per second,
  and the stream loop serialized on the callback. The loop now switches
  to synchronous `toDataURL` encoding while the compositor is stalled
  (window hidden) and keeps the faster `toBlob` path when visible.
  Measured hidden output: 1fps → ~18fps (20fps target).
- **Video backgrounds froze while the window was hidden**:
  `requestVideoFrameCallback` only fires when a frame is presented, and
  a hidden window presents nothing. A shim-paced rAF watchdog now keeps
  painting video frames whenever the compositor is stalled.

## [1.11.5] — 2026-07-05

### Changed
- **App now has a proper brand icon**: the installer, exe, taskbar entry,
  window titlebar, tray, and browser favicon all share the cyan-blue
  LCD-with-waveform mark instead of falling back to Electron's default.
  Source in `app/build/icon.svg`; `.ico` embeds 16/24/32/48/64/128/256.

## [1.11.4] — 2026-07-05

### Changed
- **Panel-rotate layout transition is animated**: switching between
  landscape and portrait used to snap — the preview and inspector jumped
  to their new positions in one frame. Now they spring smoothly to their
  new spots via `motion/react` `LayoutGroup`. New dependency: `motion`.
- **Portrait preview no longer capped at 420px tall**: the height cap was
  a landscape-oriented number that left the LCD strip at 105×420 in
  portrait. Portrait uses `body clientHeight − 60`, giving the strip
  most of the window height. Landscape stays as before (widgets don't
  crowd the inspector below them).

## [1.11.3] — 2026-07-05

### Changed
- **Portrait mode layout uses the empty horizontal space**: when panel
  is 90°/270°, the LCD preview is a tall narrow strip that leaves the
  main area mostly empty. `main` now switches to a two-column row, with
  the preview docked on the left and the inspector cards spreading
  across the reclaimed space on the right. Landscape stays as the
  familiar stacked layout.

## [1.11.2] — 2026-07-05

Panel-rotate consistency pass — every place where state assumed landscape
(1920×480) has been taught about portrait (480×1920).

### Fixed
- **Widgets stranded off-canvas after aspect flip**: rotating landscape ↔
  portrait swapped logicalW/H but left every widget's stored x/y untouched.
  With the default layout (gpu-g x=1520, clock x=775, graph x=560), 4 of 6
  widgets would land outside a 480-wide portrait canvas and become
  unreachable from the stage. Widgets now rotate through a center-mapped
  remap on aspect flip and clamp on any other rotation.
- **Widget palette spawned off-canvas in portrait**: factories hardcoded
  landscape coords (gauge x=800, visualizer x=510+900). `addWidget` now
  clamps against the current logical bounds so palette / drag-drop / any
  future insertion site all land visible.
- **BgEditor crop rect stuck to the previous aspect after panel rotate**:
  stored crop insets were reused regardless of whether the current panel
  aspect matched. Now the editor re-fits when the aspect drifts, and the
  panel-rotate handler resets the crop on aspect flip too.
- **ToastCard unreadable in portrait**: hardcoded `TOAST_W=540` overflowed
  a 480-wide panel (rest position ox = 480 − 540 − 20 = −80, accent bar
  and every glyph off-canvas). Width now clamps to `min(540, panelW − 40)`.
- **GlassPanel bg sampling ignored every bg transform**: the "frosted
  glass" widgets sampled the raw source with a 1:1 stretch, so the
  blurred region behind them didn't match the visible bg — visible seam
  at the edge of every glass card on every real background. DashboardStage
  now mirrors the transformed bg into an offscreen panelW×panelH canvas
  each frame; GlassPanel samples it 1:1 for seam-free glass.
- **baseFit ignored bgRotate**: cover-fit was axis-aligned, so a 90°/270°
  bg rotation exposed bgColor bands at the top/bottom. baseFit now uses
  the rotated axis-aligned bounding box.
- **60fps mode capped at ~40fps**: streaming loop's `Math.max(15, …)`
  scheduler floor forced a 15ms wait even when the target period was
  16.7ms. Drop the floor so 60fps mode actually runs at 60fps.
- **measuredFps was a cumulative session average**: took tens of seconds
  to converge after a rate change and baked in every stall since app
  start. Now it's a rolling 1-second window; disconnect resets it.
- **canvas-wrap paint-flash after panel rotate**: the fit hook was a
  `useEffect`, so React committed one paint at (new logicalW/H × old
  scale) before the correction ran. Switched to `useLayoutEffect`, and
  now observes the parent width rather than the wrap (which is itself
  scaled from that width). Also cures the cold-load flash for portrait
  users whose landscape-seeded `useState(0.5)` produced a tall canvas.
- **Landscape .canvas-wrap stretched with an asymmetric black strip**:
  wrap was 100% wide but the LCD was height-capped, leaving a right-side
  gutter. Now the wrap tracks `logicalW * scale` with `margin: 0 auto`,
  so the LCD is centered in both orientations.
- **Presets import leaked current-session IDB media**: an imported layout
  with `bgImage: 'idb:bg#…'` but no `__bgMedia` payload would silently
  reuse whatever image was in the session's IDB. Now those layouts clear
  the entire bg block.
- **Presets import accepted corrupt panelRotate**: values outside
  {0,90,180,270} passed the shape check and reached the emit switch,
  which handled none of them and would silently blank the LCD. The
  shape check rejects them, and the emit switch has an identity-draw
  default as belt-and-suspenders.

## [1.11.1] — 2026-07-05

### Fixed
- **Update bell icon invisible in the header**: `.bell` inherited a
  generic `button` padding (`7px 12px`) on top of its 30px fixed width,
  leaving a 6px content box; the 16px SVG then flex-shrunk to zero.
  Reset padding and margin on the bell button and its child SVG.
- **Widget palette icons off-center**: a global `button svg
  { margin-right: 6px }` — sized for the horizontal icon-then-text
  pattern — pushed the icon 3px left inside the column-flex `.wbtn`
  buttons where icon sits ABOVE label. Cancel the margin locally.

### Changed
- **Panel rotation is now labelled 0° for the correct (default)
  mounting** instead of 180°. Internally a fixed 180° flip is applied
  when emitting to the LCD to account for the physically upside-down
  panel. Existing layouts are auto-migrated (pre-v2 → v2 scheme) so
  the on-screen output is preserved.
- **Panel rotation control moved out of the Background section into
  LCD Adjust**, next to contrast / saturation / brightness. It's a
  device-mounting concern, not a background-media concern — grouping
  it with the LCD hardware settings removes the "two rotations, one
  section" confusion between panel and image rotation.

## [1.11.0] — 2026-07-05

### Added
- **In-app background editor** (Instagram-style): opens automatically after
  picking a file. Full-size source view with an aspect-locked crop rect,
  four corner handles for zoom, rule-of-thirds guides, and rotation +
  flip controls. Confirmed via Apply or dismissed with Cancel/Escape.
- **Video background support**: .mp4/.webm/.mov can be set as the LCD
  background alongside images and GIFs. Stored as Blob in IndexedDB
  (avoiding the 33% base64 overhead), played through an off-screen
  `<video>` element, and blitted to a double-buffered canvas so React
  actually re-renders each frame.
- **Panel rotation 0°/90°/180°/270°** (portrait mounting): the editor
  stage swaps to a 480×1920 logical space and the outgoing frame is
  rotated into the fixed 1920×480 hardware buffer.
- **i18n JA / EN toggle** with per-user localStorage persistence. Covers
  header, inspector sections, buttons, first-run wizard, update bell,
  widget palette (search, empty state, category labels), layer panel,
  and presets.
- **In-app update bell** in the header: reflects the auto-updater
  lifecycle live (checking / downloading with progress / ready to
  install / error). One click on "Install and restart" replaces the
  tray-menu-only path.
- **First-run wizard**: pre-flight status check for backend / LCD / CPU
  temperature / Windows notifications, with deep-links into
  `docs/TROUBLESHOOTING.md` for anything red.
- **Background transforms** (via the editor modal): rotation, flip X/Y,
  aspect-locked crop.

### Changed
- **Inspector moved below the LCD preview** as a responsive multi-column
  layout; the right-hand sidebar is gone. Window default now 1100×900
  (was 1280×640) to match a taller stack.
- **Sensor readout strip removed** — the LCD preview shows the values
  directly through its widgets.
- **Version pill in the header** shows the running `package.json`
  version.
- **CSS variable aliases** (`--muted`, `--fg`, `--panel`) added so
  newer components stop referencing undefined custom properties.
- Removed the earlier drag-on-preview overlay and 4-slider crop
  diagram from the sidebar — both superseded by the editor modal.

### Fixed
- **Background swap regression**: choosing a new image when one was
  already set left the previous pixels on the LCD. The `useAnimatedImage`
  effect keyed on the `bgImage` sentinel string; two consecutive image
  selections were both `idb:bg` so React saw no dep change and skipped
  the effect. Sentinels now carry a `#<epoch>` suffix so every write
  forces a real re-run — fix propagates to preset load and JSON import.
- **Video path never re-rendered**: the runVideo loop reused a single
  canvas ref, so `setFrame(canvas)` bailed on `Object.is` equality and
  Konva painted a static frame. Now double-buffered like the GIF path.
- **`vfcHandle` collision**: cleanup mixed `cancelVideoFrameCallback`
  and `cancelAnimationFrame` on the same variable across
  requestVideoFrameCallback and rAF fallback paths. Split into
  `vfcHandle` and `vidRafHandle`.
- **Streaming loop teardown thrash**: the interval was rebuilt every
  time `streamFps` flipped (20+ times/sec while sensors eased). Now a
  self-scheduling `setTimeout` chain reads `streamFps`/`panelRotate`
  through refs and only tears down on `streaming` toggle. Also polls at
  1Hz while the backend socket is down (was burning CPU on JPEG encodes
  no one would receive).
- **Backend disconnect left stale sensor state**: `ws.onclose` didn't
  reset sensors / notifyStatus / spectrumStatus, so the first-run
  wizard's "backend connection" light stayed green after the socket
  died. Now resets the full backend-derived state slice.
- **Malformed WebSocket JSON crashed the message handler**: unguarded
  `JSON.parse` in `ws.onmessage` now wrapped in try/catch, with a shape
  check before dispatch.
- **Debug hooks exposed in production**: `window.__injectSensors` and
  `window.__injectMedia` (used for eyes-free screenshots) are now
  dev-only. `window.__backendUrl` is gated to loopback WebSockets and
  the shutdown blanking path in `main.cjs` re-validates before use.
- **Global keyboard shortcuts leaked through open modals**: Delete /
  Ctrl+Z / arrows hit the underlying layout while the bg editor or
  wizard was open. Handler now bails when a modal backdrop is mounted.
- **BgEditorModal keyboard control**: added Escape (cancel) and Enter
  (apply) bindings.
- **Presets lost video backgrounds** on save / load / export /
  import — image path only. `PresetEntry` gained a `videoMedia?: Blob`
  field, and export round-trips the video as a base64 data URL.
- **Presets import accepted any JSON** and swallowed all errors. Now
  shape-validates the parsed object and surfaces a message when
  something looks wrong.
- **Preset save silently overwrote existing presets**. Prompts for
  confirmation before clobbering.
- **Portrait panelRotate coordinate leaks**: drag snap targets, guide
  lines, GlassPanel bg sampling, and the toast overlay right-edge were
  computed against landscape `PANEL_W`/`PANEL_H`. Now use logical
  dimensions.
- **CSP hardening**: added `object-src 'none'`, `frame-src 'none'`,
  `form-action 'none'`, `worker-src 'self'` (defense in depth for
  future untrusted embeds).
- **Layout save flooded localStorage during drags**: now debounced
  300ms and surfaces a toast if the write throws (quota, etc.).
- **`useSmoothedSensors` rAF loop no longer runs when idle**: previous
  version scheduled a frame every ~16 ms whether or not any sensor was
  actually gliding. Now sleeps when settled and wakes on target change.
- **External links in Electron did nothing**: `setWindowOpenHandler`
  denied all URLs. Legitimate https: links (README, troubleshooting
  docs) now route through `shell.openExternal`.
- **UpdateBell popover missed Escape and touchstart**: now closes on
  Escape and on outside touch as well as outside mousedown.
- **`server.py` handler could leak `CLIENTS` on early send failure**:
  the initial notify/media sends happened before `try:` — a socket
  that died mid-handshake would keep its entry. Now inside the outer
  try, and the sensor_task cancel `awaits` briefly so the executor
  read can't outlive the socket.

## [1.10.0] — 2026-07-05

### Added
- **In-app update bell**: a bell button lives in the header next to the
  Stream toggle. It reflects the auto-updater state in real time —
  spinner while checking / downloading (with % progress), a badge when a
  version is ready to install, and a red error state if the check
  failed. Clicking the bell opens a popover with the current version,
  the new version, and an "インストールして再起動" call-to-action that
  triggers `quitAndInstall` directly from the app UI. Previously the
  only way to install a downloaded update was via the tray menu.

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

[1.11.0]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.11.0
[1.10.0]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.10.0
[1.9.1]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.9.1
[1.9.0]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.9.0
[1.8.0]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.8.0
