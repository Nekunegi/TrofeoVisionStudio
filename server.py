"""WebSocket backend bridging the Electron/React editor to the LCD hardware.

Protocol (ws://localhost:8787):
  server -> client (text/JSON):
    {"type":"status",         "device":"connected"|"disconnected", "detail":"..."}
    {"type":"sensors",        "data":{cpuTemp,cpuLoad,cpuPower,cpuClock,
                                      gpuTemp,gpuLoad,gpuPower,ramLoad,
                                      netUp,netDown,diskLoad}}
    {"type":"notification",   "data":{id,app,title,body}}
    {"type":"notifyStatus",   "status":"allowed"|"denied"|"unsupported"|...}
    {"type":"media",          "data":{hasMedia,app,title,artist,album,
                                      playing,pos,dur[,thumb]}}
    {"type":"spectrum",       "data":[float x96]}   # log-spaced audio bands
    {"type":"spectrumStatus", "status":"idle"|"ok"|"error: ..."}
  client -> server:
    binary message            = a JPEG frame (1920x480) to display on the LCD
    {"cmd":"spectrum", "on":bool, "hz":int}  # subscribe/unsubscribe audio bands

Reuses the proven trofeo.* driver modules. Blocking USB / sensor calls run in a
thread executor so the asyncio loop stays responsive. Run as Administrator to
include CPU temperature.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import math
import os
import sys
import threading
import time

# The console may be cp932 (Japanese Windows); never let logging crash on
# non-ASCII characters in exception messages.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        pass


def _finite(v):
    """NaN/inf -> None so json.dumps emits valid JSON (JS JSON.parse rejects NaN)."""
    if v is None:
        return None
    return v if math.isfinite(v) else None

import libusb_package
import usb.backend.libusb1
import usb.core

usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)

import websockets

from trofeo.audio import SpectrumCapture
from trofeo.device import TrofeoDevice
from trofeo.media import MediaWatcher
from trofeo.notifications import NotificationWatcher
from trofeo.protocol import LyProtocol
from trofeo.sensors import Sensors

# Explicit loopback bind — never reachable from other machines on the LAN even
# if a firewall rule is created for our port. TROFEO_HOST=0.0.0.0 opts in to
# LAN exposure (companion apps, remote layout tweaks); default is safe.
HOST = os.environ.get("TROFEO_HOST", "127.0.0.1")
PORT = int(os.environ.get("TROFEO_PORT", "8787"))  # override for side-by-side testing
MAX_TEXT_MSG = 4096  # our JSON commands are tiny; reject anything larger
SENSOR_HZ = 1.0
NOTIFY_POLL_S = 2.0
MEDIA_POLL_S = 2.0


class DeviceManager:
    """Thread-safe access to the LCD with lazy connect + reconnect."""

    def __init__(self):
        self._dev: TrofeoDevice | None = None
        self._proto: LyProtocol | None = None
        self._lock = threading.Lock()

    @property
    def connected(self) -> bool:
        return self._proto is not None

    def _connect(self) -> None:
        self._dev = TrofeoDevice.open()
        stale = self._dev.drain_in()  # discard e.g. an unread ACK from a dead sender
        if stale:
            print(f"[device] drained {stale} stale bytes before handshake", flush=True)
        self._proto = LyProtocol(self._dev)
        self._proto.handshake()

    def ensure(self) -> None:
        with self._lock:
            if self._proto is None:
                self._connect()

    def send_frame(self, jpeg: bytes) -> None:
        with self._lock:
            if self._proto is None:
                self._connect()
            try:
                self._proto.send_frame(jpeg)
            except usb.core.USBError as e:
                # Second attempt: USB port reset before reconnect. This recovers a
                # panel stuck mid-transfer from a previous crashed sender (see
                # TrofeoDevice.reset()) — a plain close+reopen leaves the device
                # in the same wedged state.
                print(f"[device] send failed ({e}); attempting reset+reopen", flush=True)
                old = self._dev
                self._dev = self._proto = None
                if old is not None:
                    try:
                        old.reset()
                    except Exception as reset_err:
                        print(f"[device] reset failed: {reset_err}", flush=True)
                self._connect()
                self._proto.send_frame(jpeg)

    def close(self) -> None:
        with self._lock:
            if self._dev:
                self._dev.close()
            self._dev = self._proto = None


sensors = Sensors()
device = DeviceManager()
notifier = NotificationWatcher()
media = MediaWatcher()
spectrum = SpectrumCapture()
CLIENTS: set = set()
SPECTRUM_SUBS: dict = {}  # ws -> requested frame rate (10..60)


async def spectrum_loop():
    """Capture system audio while anyone is subscribed; push band frames at
    the highest subscribed rate. Pacing is event-driven off the capture
    thread's WASAPI reads (60/s) — asyncio timers on Windows are too coarse
    (~15.6ms granularity) to hit 60fps. Silent audio still gets a 1Hz
    heartbeat so clients can tell 'quiet' from 'capture died'."""
    loop = asyncio.get_running_loop()
    tick = asyncio.Event()
    spectrum.on_update = lambda: loop.call_soon_threadsafe(tick.set)
    last_sent = 0.0
    next_send = 0.0
    while True:
        if not SPECTRUM_SUBS:
            if spectrum.running:
                spectrum.stop()
            await asyncio.sleep(0.5)
            continue
        if not spectrum.running:
            spectrum.start()
        try:
            await asyncio.wait_for(tick.wait(), timeout=1.0)
        except TimeoutError:
            continue
        tick.clear()
        now = time.monotonic()
        hz = max(SPECTRUM_SUBS.values(), default=30)
        interval = 1.0 / hz
        if not spectrum.audible:
            if now - last_sent < 1.0:
                continue
        elif now < next_send - 0.003:
            # drift-free schedule: a tick that arrives early is skipped, but a
            # late one advances the schedule so the average rate stays at hz
            # despite WASAPI read jitter
            continue
        next_send = max(next_send + interval, now - interval)
        last_sent = now
        msg = json.dumps({"type": "spectrum", "data": spectrum.bands})
        for ws in list(SPECTRUM_SUBS):
            try:
                await ws.send(msg)
            except Exception:
                pass


async def media_loop():
    """Poll the system media session and broadcast now-playing changes."""
    status = await media.start()
    print(f"[media] watcher status: {status}", flush=True)
    if status != "ok":
        return
    while True:
        await asyncio.sleep(MEDIA_POLL_S)
        try:
            upd = await media.poll()
            if upd is not None:
                msg = json.dumps({"type": "media", "data": upd})
                for ws in list(CLIENTS):
                    try:
                        await ws.send(msg)
                    except Exception:
                        pass
        except Exception as e:
            print(f"[media] poll failed: {e}", flush=True)
            await asyncio.sleep(30)


async def notification_loop():
    """Poll Windows toasts and broadcast new ones to every connected client."""
    status = await notifier.start()
    print(f"[notify] listener status: {status}", flush=True)
    if status != "allowed":
        return
    while True:
        await asyncio.sleep(NOTIFY_POLL_S)
        try:
            for toast in await notifier.poll():
                msg = json.dumps({"type": "notification", "data": toast})
                for ws in list(CLIENTS):
                    try:
                        await ws.send(msg)
                    except Exception:
                        pass
        except Exception as e:
            print(f"[notify] poll failed: {e}", flush=True)
            await asyncio.sleep(30)


async def sensor_loop(ws):
    """Poll sensors and push camelCase payloads at SENSOR_HZ. A per-tick failure
    (LHM race, transient WMI hiccup) logs and keeps the loop alive — losing a
    single sample beats freezing all sensor updates for this connection."""
    loop = asyncio.get_running_loop()
    err_streak = 0
    while True:
        try:
            m = await loop.run_in_executor(None, sensors.read)
            data = dataclasses.asdict(m)
            # camelCase for JS
            payload = {
                "cpuTemp": _finite(data["cpu_temp"]), "cpuLoad": _finite(data["cpu_load"]),
                "cpuPower": _finite(data["cpu_power"]), "cpuClock": _finite(data["cpu_clock"]),
                "gpuTemp": _finite(data["gpu_temp"]), "gpuLoad": _finite(data["gpu_load"]),
                "gpuPower": _finite(data["gpu_power"]), "ramLoad": _finite(data["ram_load"]),
                "netUp": _finite(data["net_up"]), "netDown": _finite(data["net_down"]),
                "diskLoad": _finite(data["disk_load"]),
            }
            await ws.send(json.dumps({"type": "sensors", "data": payload}))
            err_streak = 0
        except websockets.ConnectionClosed:
            return  # handler's finally clause will clean us up
        except Exception as e:
            err_streak += 1
            # log the first few and then only every 30s to avoid spam on a stuck sensor
            if err_streak <= 3 or err_streak % int(30 * SENSOR_HZ) == 0:
                print(f"[sensors] read/send failed (streak {err_streak}): {e}", flush=True)
        await asyncio.sleep(1.0 / SENSOR_HZ)


_frame_count = 0


async def handler(ws):
    global _frame_count
    print("client connected", flush=True)
    loop = asyncio.get_running_loop()

    async def report(status, detail=""):
        await ws.send(json.dumps({"type": "status", "device": status, "detail": detail}))

    CLIENTS.add(ws)
    await ws.send(json.dumps({"type": "notifyStatus", "status": notifier.status}))
    snap = media.snapshot()
    if snap is not None:
        await ws.send(json.dumps({"type": "media", "data": snap}))
    try:
        await loop.run_in_executor(None, device.ensure)
        await report("connected")
    except Exception as e:
        print(f"[device] connect failed: {e}", flush=True)
        await report("disconnected", str(e))

    sensor_task = asyncio.create_task(sensor_loop(ws))
    try:
        dump_path = os.environ.get("TROFEO_DUMP")
        async for message in ws:
            if isinstance(message, bytes):
                try:
                    await loop.run_in_executor(None, device.send_frame, message)
                    _frame_count += 1
                    if dump_path and _frame_count % 100 == 0:
                        # eyes-free debugging: keep the latest delivered frame on disk
                        with open(dump_path, "wb") as f:
                            f.write(message)
                    if _frame_count % 10 == 0:
                        print(f"frames delivered to LCD: {_frame_count} "
                              f"(last {len(message)} B)", flush=True)
                except Exception as e:
                    print(f"[device] frame send failed: {e}", flush=True)
                    await report("disconnected", str(e))
            else:
                # text = JSON command from the editor
                if len(message) > MAX_TEXT_MSG:
                    continue  # malformed / hostile — our commands never approach 4KB
                try:
                    cmd = json.loads(message)
                except Exception:
                    continue
                if not isinstance(cmd, dict):
                    continue
                if cmd.get("cmd") == "spectrum":
                    if cmd.get("on"):
                        try:
                            hz = int(cmd.get("hz") or 30)
                        except (TypeError, ValueError):
                            hz = 30
                        SPECTRUM_SUBS[ws] = max(10, min(60, hz))
                        await ws.send(json.dumps(
                            {"type": "spectrumStatus", "status": spectrum.status}))
                    else:
                        SPECTRUM_SUBS.pop(ws, None)
    except websockets.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(ws)
        SPECTRUM_SUBS.pop(ws, None)
        sensor_task.cancel()
        print("client disconnected")


async def main():
    print(f"backend listening on ws://{HOST}:{PORT}")
    if sensors.lhm_error:
        print(f"[warn] LHM unavailable: {sensors.lhm_error} (loads/RAM only)")
    notify_task = asyncio.create_task(notification_loop())
    media_task = asyncio.create_task(media_loop())
    spectrum_task = asyncio.create_task(spectrum_loop())
    try:
        async with websockets.serve(handler, HOST, PORT, max_size=8 * 1024 * 1024):
            await asyncio.Future()  # run forever
    finally:
        notify_task.cancel()
        media_task.cancel()
        spectrum_task.cancel()
        spectrum.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    finally:
        sensors.close()
        device.close()
