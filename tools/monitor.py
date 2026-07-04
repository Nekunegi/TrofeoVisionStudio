"""Resident driver: continuously push a live hardware dashboard to the LCD.

Run as Administrator to include CPU temperature (LHM ring0 driver). Without admin
you still get GPU temp, loads, power, clock, and RAM.

Usage:
  python monitor.py                 # 1 fps dashboard, runs until Ctrl+C
  python monitor.py --interval 0.5  # faster refresh
  python monitor.py --once          # send a single frame and exit
"""

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import argparse
import ctypes
import sys
import time

# register the bundled libusb backend for pyusb
import libusb_package
import usb.backend.libusb1
import usb.core
usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)

from trofeo.device import TrofeoDevice
from trofeo.protocol import LyProtocol
from trofeo import dashboard, render
from trofeo.sensors import Sensors


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def connect() -> tuple[TrofeoDevice, LyProtocol]:
    dev = TrofeoDevice.open()
    proto = LyProtocol(dev)
    proto.handshake()
    return dev, proto


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between frames")
    ap.add_argument("--once", action="store_true", help="send one frame and exit")
    args = ap.parse_args()

    sensors = Sensors()
    if sensors.lhm_error:
        print(f"[warn] LibreHardwareMonitor unavailable: {sensors.lhm_error}")
        print("       Falling back to psutil (loads/RAM only, no temperatures).")
    elif not is_admin():
        print("[info] Not elevated: CPU temperature will read '--'. "
              "Run as Administrator for CPU temp.")

    dev, proto = connect()
    print("connected + handshaked. streaming... (Ctrl+C to stop)")

    frames = 0
    try:
        while True:
            m = sensors.read()
            img = dashboard.render(m)
            frame = render.to_jpeg(img)
            try:
                proto.send_frame(frame)
            except usb.core.USBError as e:
                print(f"[warn] USB error ({e}); reconnecting...")
                dev.close()
                time.sleep(1.0)
                dev, proto = connect()
                continue

            frames += 1
            if frames % 10 == 0:
                print(f"  {frames} frames | CPU {m.cpu_temp}C/{m.cpu_load:.0f}% "
                      f"GPU {m.gpu_temp}C/{m.gpu_load:.0f}%")

            if args.once:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopping.")
    finally:
        sensors.close()
        dev.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
