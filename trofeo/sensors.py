"""Hardware sensor readout.

Primary backend: LibreHardwareMonitor (LHM) via pythonnet — the only reliable way
to read CPU/GPU *temperatures* on Windows. Reading temperatures requires the LHM
ring0 driver, which needs the process to run **as Administrator**; without admin
LHM still loads but temperature sensors return None.

Fallback: psutil for CPU load / RAM (always available, no admin, no temps).
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Optional

import psutil

from .log import get_logger

log = get_logger("trofeo.sensors")

# LHM DLLs live in ./libs next to the repo root in dev, and next to server.exe
# when frozen by PyInstaller (bundled as extraResources/backend/libs).
if getattr(sys, "frozen", False):
    _LIBS = os.path.join(os.path.dirname(sys.executable), "libs")
else:
    _LIBS = os.path.join(os.path.dirname(__file__), "..", "libs")


@dataclass
class Metrics:
    cpu_temp: Optional[float] = None   # °C
    cpu_load: Optional[float] = None   # %
    cpu_power: Optional[float] = None  # W
    cpu_clock: Optional[float] = None  # MHz
    gpu_temp: Optional[float] = None
    gpu_load: Optional[float] = None
    gpu_power: Optional[float] = None
    ram_load: Optional[float] = None   # %
    net_up: Optional[float] = None     # MB/s (delta between reads)
    net_down: Optional[float] = None   # MB/s
    disk_load: Optional[float] = None  # % used, system drive


class _LhmBackend:
    """Wraps LibreHardwareMonitorLib via pythonnet."""

    def __init__(self):
        import clr  # pythonnet

        if _LIBS not in sys.path:
            sys.path.append(_LIBS)
        clr.AddReference("LibreHardwareMonitorLib")

        from LibreHardwareMonitor.Hardware import Computer  # noqa: E402
        from LibreHardwareMonitor.Hardware import HardwareType, SensorType  # noqa: E402

        self._HardwareType = HardwareType
        self._SensorType = SensorType

        self._computer = Computer()
        self._computer.IsCpuEnabled = True
        self._computer.IsGpuEnabled = True
        self._computer.IsMemoryEnabled = True
        self._computer.IsMotherboardEnabled = True
        self._computer.Open()

    def read(self) -> Metrics:
        HT, ST = self._HardwareType, self._SensorType
        m = Metrics()

        for hw in self._computer.Hardware:
            hw.Update()
            for sh in hw.SubHardware:
                sh.Update()

            htype = hw.HardwareType
            is_cpu = htype == HT.Cpu
            is_gpu = htype in (HT.GpuNvidia, HT.GpuAmd, getattr(HT, "GpuIntel", HT.GpuNvidia))
            is_mem = htype == HT.Memory

            for s in hw.Sensors:
                name = str(s.Name)
                val = s.Value
                if val is None:
                    continue
                val = float(val)
                st = s.SensorType

                if is_cpu:
                    if st == ST.Temperature and m.cpu_temp is None and (
                        "Package" in name or "Tctl" in name or "Tdie" in name or "CPU" in name):
                        m.cpu_temp = val
                    elif st == ST.Load and name == "CPU Total":
                        m.cpu_load = val
                    elif st == ST.Power and ("Package" in name or "CPU" in name) and m.cpu_power is None:
                        m.cpu_power = val
                    elif st == ST.Clock and m.cpu_clock is None and "Core" in name:
                        m.cpu_clock = val
                elif is_gpu:
                    if st == ST.Temperature and ("Core" in name or "Hot" in name) and m.gpu_temp is None:
                        m.gpu_temp = val
                    elif st == ST.Load and "Core" in name and m.gpu_load is None:
                        m.gpu_load = val
                    elif st == ST.Power and m.gpu_power is None:
                        m.gpu_power = val
                elif is_mem:
                    if st == ST.Load and "Memory" in name and m.ram_load is None:
                        m.ram_load = val
        return m

    def close(self):
        try:
            self._computer.Close()
        except Exception:
            pass


class Sensors:
    """Unified reader: LHM if available, psutil to fill any gaps."""

    def __init__(self):
        self._lhm: Optional[_LhmBackend] = None
        self.lhm_error: Optional[str] = None
        self._net_prev: Optional[tuple] = None  # (monotonic_ts, bytes_sent, bytes_recv)
        try:
            self._lhm = _LhmBackend()
        except Exception as e:  # pythonnet/DLL/other failure
            self.lhm_error = f"{type(e).__name__}: {e}"

    def _net_rates(self) -> tuple:
        """(up MB/s, down MB/s) from the byte-counter delta between reads."""
        import time
        io = psutil.net_io_counters()
        now = time.monotonic()
        prev = self._net_prev
        self._net_prev = (now, io.bytes_sent, io.bytes_recv)
        if prev is None or now <= prev[0]:
            return None, None
        dt = now - prev[0]
        return ((io.bytes_sent - prev[1]) / dt / 1e6,
                (io.bytes_recv - prev[2]) / dt / 1e6)

    def read(self) -> Metrics:
        m = self._lhm.read() if self._lhm else Metrics()
        # psutil fills load/ram if LHM did not provide them
        if m.cpu_load is None:
            m.cpu_load = psutil.cpu_percent(interval=None)
        if m.ram_load is None:
            m.ram_load = psutil.virtual_memory().percent
        if m.cpu_clock is None:
            f = psutil.cpu_freq()
            if f:
                m.cpu_clock = f.current
        m.net_up, m.net_down = self._net_rates()
        try:
            m.disk_load = psutil.disk_usage(os.environ.get("SystemDrive", "C:") + "\\").percent
        except Exception as e:
            log.debug("[sensors] disk_usage failed: %s", e)
        return m

    def close(self):
        if self._lhm:
            self._lhm.close()
