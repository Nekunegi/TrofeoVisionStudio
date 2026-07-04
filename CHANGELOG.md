# Changelog

All notable changes to Trofeo Vision Studio are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Nekunegi/TrofeoVisionStudio/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/Nekunegi/TrofeoVisionStudio/releases/tag/v1.7.1
