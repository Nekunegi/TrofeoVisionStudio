"""System-audio (WASAPI loopback) spectrum capture for the visualizer.

The renderer's own desktop capture is blocked in the ELEVATED resident app
(Chromium NotReadableError), so the backend captures instead: pyaudiowpatch
opens the default output device in loopback mode and numpy folds the FFT into
the same 96 log-spaced bands the frontend renders. WASAPI loopback has no
elevation restrictions.
"""

from __future__ import annotations

import math
import threading
import time

BANDS = 96
F_LO = 40.0
F_HI = 16000.0
FFT_N = 2048
SMOOTH = 0.7  # matches WebAudio smoothingTimeConstant
MIN_DB = -100.0
MAX_DB = -30.0
# ~60fps at 48kHz; the read cadence paces the whole loop (the server throttles
# what it actually sends to each client's requested rate)
READ_FRAMES = 800


class SpectrumCapture:
    """Background capture thread. start()/stop() are cheap and idempotent;
    the latest folded bands live in .bands (seq bumps on every update)."""

    def __init__(self):
        self.status = "idle"  # idle | ok | error: <msg>
        self.bands: list[float] = [0.0] * BANDS
        self.audible = False
        self.seq = 0
        # called (from the capture thread!) after every bands update — the
        # server uses it to pace sends off the WASAPI clock instead of asyncio
        # timers (Windows timer granularity is ~15.6ms, too coarse for 60fps)
        self.on_update = None
        self._run = False
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._run

    def start(self) -> None:
        if self._run:
            return
        self._run = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._run = False
        self._thread = None

    def _loop(self) -> None:
        try:
            import numpy as np
            import pyaudiowpatch as pyaudio
        except Exception as e:
            self.status = f"error: audio deps missing ({e})"
            self._run = False
            return

        while self._run:
            try:
                p = pyaudio.PyAudio()
                try:
                    self._capture(p, np, pyaudio)
                finally:
                    p.terminate()
            except Exception as e:
                self.status = f"error: {e}"
                self.bands = [0.0] * BANDS
                self.audible = False
                self.seq += 1
                # keep retrying while wanted — the endpoint may come back
                for _ in range(50):
                    if not self._run:
                        break
                    time.sleep(0.1)
        self.status = "idle"

    def _capture(self, p, np, pyaudio) -> None:
        # default output device -> its loopback twin
        wasapi = p.get_host_api_info_by_type(pyaudio.paWASAPI)
        dev = p.get_device_info_by_index(wasapi["defaultOutputDevice"])
        if not dev.get("isLoopbackDevice"):
            for lb in p.get_loopback_device_info_generator():
                if dev["name"] in lb["name"]:
                    dev = lb
                    break
        rate = int(dev["defaultSampleRate"])
        ch = max(1, int(dev["maxInputChannels"]))
        stream = p.open(format=pyaudio.paInt16, channels=ch, rate=rate,
                        frames_per_buffer=READ_FRAMES, input=True,
                        input_device_index=dev["index"])
        try:
            # log-spaced band edges in rfft bin indices
            bin_hz = rate / FFT_N
            edges = []
            for i in range(BANDS + 1):
                f = F_LO * math.pow(F_HI / F_LO, i / BANDS)
                edges.append(min(FFT_N // 2, max(1, round(f / bin_hz))))
            window = np.hanning(FFT_N).astype(np.float32)
            buf = np.zeros(FFT_N, dtype=np.float32)
            smooth = np.zeros(FFT_N // 2 + 1, dtype=np.float32)
            self.status = "ok"
            print(f"[audio] loopback capture on '{dev['name']}' "
                  f"({rate}Hz x{ch})", flush=True)
            silent_since = None
            while self._run:
                raw = stream.read(READ_FRAMES, exception_on_overflow=False)
                x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                if ch > 1:
                    x = x.reshape(-1, ch).mean(axis=1)
                n = len(x)
                if n >= FFT_N:
                    buf = x[-FFT_N:].copy()
                else:
                    buf = np.roll(buf, -n)
                    buf[-n:] = x
                mag = np.abs(np.fft.rfft(buf * window)) / (FFT_N / 2)
                smooth = SMOOTH * smooth + (1.0 - SMOOTH) * mag
                db = 20.0 * np.log10(np.maximum(smooth, 1e-10))
                norm = np.clip((db - MIN_DB) / (MAX_DB - MIN_DB), 0.0, 1.0)
                out = []
                audible = False
                for i in range(BANDS):
                    a = edges[i]
                    b = max(a + 1, edges[i + 1])
                    m = float(norm[a:b].max())
                    # same shaping as the renderer: floor cut, treble tilt, gamma
                    v = max(0.0, m - 0.04) / 0.96
                    v = min(1.0, v * (0.75 + 0.65 * (i / BANDS)))
                    v = v ** 1.25
                    if v > 0.04:
                        audible = True
                    out.append(round(v, 3))
                self.bands = out
                self.audible = audible
                self.seq += 1
                cb = self.on_update
                if cb is not None:
                    try:
                        cb()
                    except Exception:
                        pass
                # long silence may mean the default device changed under us —
                # reopen (bands are zero anyway, so the gap is invisible)
                if audible:
                    silent_since = None
                elif silent_since is None:
                    silent_since = time.monotonic()
                elif time.monotonic() - silent_since > 30.0:
                    silent_since = None
                    return
        finally:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
