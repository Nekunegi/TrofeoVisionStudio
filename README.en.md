# Trofeo Vision Studio

A homebrew driver and dashboard editor for the **Thermalright Trofeo Vision LCD**
(USB `0416:5408`, 1920×480), replacing the bundled TRCC software.
Windows only, built with Electron + React + Python.

<p align="center">
  <a href="https://github.com/Nekunegi/TrofeoVisionStudio/releases/latest">
    <strong>Download the latest installer</strong>
  </a>
</p>

<p align="center">
  <img src="docs/img/editor.png" alt="Editor screen" width="900">
</p>

<p align="center">
  <em>The 1920×480 frame streamed to the LCD:</em>
</p>

<p align="center">
  <img src="docs/img/lcd-thumb.png" alt="LCD output" width="900">
</p>

---

## Highlights

- **Drag & drop dashboard editor** — position backgrounds, clocks, sensors,
  gauges, graphs, bars, media cards, weather, audio visualizer freely.
  Drag snapping, undo/redo, keyboard shortcuts, layer panel.
- **Hardware sensors** — CPU / GPU / RAM / network / disk via
  LibreHardwareMonitor. CPU temperature via a PawnIO ring0 driver.
- **Now-playing card** — pulls title, artist, timeline, album art from
  Windows Media Transport Controls (SMTC).
- **Windows notification mirror** — toast notifications shown on the LCD
  even while games run fullscreen.
- **Audio visualizer** — 96-band spectrum computed on the backend from a
  WASAPI loopback capture, streamed at up to 60 fps.
- **Animated GIF backgrounds** — stored in IndexedDB, with dim and blur.
- **LCD Adjust** — Contrast / Saturation / Brightness compensator applied
  to the outgoing frame (peak brightness is hardware-capped, but midtones
  get more punch).
- **Templated Text widget** — `{cpu.temp}°C · {gpu.load}%` and similar
  placeholders expand live inside a single Text widget.
- **Threshold zones** — warn / crit color bands on Bar and Graph widgets.
- **Adaptive fps** — static layouts stream at 1 fps; toasts, sensor
  transitions, and audio bump the rate automatically.
- **Resident architecture** — lives in the tray, autostarts elevated at
  logon via a scheduled task.
- **Auto-updates** — differential download from GitHub Releases, applied
  from the tray at "Install and restart" (never mid-session).

## Protocol credit

The USB LY-bulk protocol was reverse-engineered by
[Lexonight1/thermalright-trcc-linux](https://github.com/Lexonight1/thermalright-trcc-linux).
This repository is a **clean-room Windows / Python implementation** based on
that project's findings.

---

## Architecture

```
  app/  (Electron shell: main.cjs + React/Konva editor)
    │
    │  WebSocket  ws://127.0.0.1:8787
    ▼
  server.py + trofeo/
    ├─ device.py         USB transport (pyusb)
    ├─ protocol.py       LY chunk protocol (handshake + frame chunking)
    ├─ sensors.py        Sensor reads (LibreHardwareMonitor)
    ├─ audio.py          WASAPI loopback (spectrum)
    ├─ media.py          SMTC (now-playing)
    ├─ notifications.py  UserNotificationListener (Windows toasts)
    ├─ render.py         PIL image -> JPEG
    └─ dashboard.py      Metrics -> dashboard bitmap
    │
    │  USB bulk
    ▼
  Trofeo Vision LCD (0416:5408 / 1920×480)
```

The front-end Konva Stage doubles as the editor and the final frame source.
Frames are shipped as JPEG over WebSocket to the Python backend, which
forwards them over USB bulk.

---

## Install (recommended)

Grab the latest installer from
[Releases](https://github.com/Nekunegi/TrofeoVisionStudio/releases).

First-time users must **bind `0416:5408` to WinUSB via Zadig** — see below.

---

## Development

### External binaries (not committed)

The following are excluded from the repo for licensing reasons. Place them
manually before building:

- **`libs/`** — [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
  **v0.9.6** release DLLs (`LibreHardwareMonitorLib.dll` and dependencies).
- **`redist/PawnIO_setup.exe`** — [PawnIO](https://pawnio.eu/). Required for
  CPU temperature. Works even with Memory Integrity (HVCI) enabled.

### Dependencies

```powershell
pip install -r requirements.txt
cd app; npm install
```

### Three-terminal dev loop

```powershell
# Terminal 1 — backend (elevated PowerShell for CPU temperature)
python server.py

# Terminal 2 — Vite dev server
cd app
npm run dev

# Terminal 3 — Electron shell
cd app
npm run electron
```

`Backend online` and `LCD connected` pills green in the header, and a
non-zero `target/out fps` — that means your edits are streaming to the LCD.

### Release build

**Backend changes** — regenerate `server.exe` with PyInstaller (run from the
repo root):

```powershell
python -m PyInstaller --noconfirm --onedir --name server `
  --distpath build --workpath build\work --specpath build `
  --collect-all libusb_package --collect-all websockets `
  --collect-all pythonnet --collect-all winsdk --collect-all pyaudiowpatch `
  --hidden-import clr server.py
```

**Installer** — electron-builder NSIS (perMachine):

```powershell
cd app
npm run dist   # -> app/release/ contains the NSIS installer
```

The installer silently installs PawnIO and registers the elevated logon
task automatically.

---

## First-time setup (Zadig -> WinUSB)

pyusb can only reach the device once it is bound to **WinUSB**.

1. Launch [Zadig](https://zadig.akeo.ie/)
2. **Options -> List All Devices**
3. Select `USBDISPLAY` (`0416:5408`)
4. Pick **WinUSB** as the driver and click **Replace Driver**

> **Warning**: this makes the **stock TRCC unusable**. To revert, open Device
> Manager, uninstall the device driver, and unplug/replug — Windows will
> reinstall the stock driver automatically.

---

## `tools/`

Standalone scripts for first-time setup and protocol validation:

| Script | Purpose |
|--------|---------|
| `demo.py` | Handshake + solid color / test pattern smoke test |
| `probe.py` | Check whether libusb sees `0416:5408` (no writes) |
| `hs_test.py` | Handshake only (no display change) |
| `diag.py` | Dump handshake reply and frame ACK bytes |
| `monitor.py` | Legacy standalone resident driver (pre-Studio) |
| `admin_setup.ps1` | Stops the stock TRCC process/task for migration |

---

## LY-bulk protocol summary (0416:5408)

| Field | Value |
|-------|-------|
| Endpoints | OUT `0x09` / IN `0x81` |
| Handshake | Send 2048B (`02 FF .. 01 ..`) -> read 512B; validate `[0]=03, [1]=FF, [8]=01` |
| Chunk | 512B (16B header + 496B payload) |
| Burst | 4096B (8 chunks); tail 2048B |
| Image | **JPEG** encoded (LY family requirement) |
| Resolution | **1920 x 480** |

See **[docs/PROTOCOL.md](docs/PROTOCOL.md)** for the full byte-level layout,
burst structure, and error recovery notes.

---

## Troubleshooting

SmartScreen warnings, Zadig gotchas, CPU-temperature setup, HVCI + PawnIO,
autostart, log file locations — all covered in
**[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## Language

- English — [README.en.md](README.en.md) (this file)
- 日本語 — [README.md](README.md)
