"""Smoke test: handshake with the LCD and push a solid-color frame.

Prereqs:
  pip install -r requirements.txt
  Device 0416:5408 bound to WinUSB (via Zadig) on Windows.

Usage:
  python demo.py            # send a solid red frame
  python demo.py image.png  # send an image file
"""

import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# libusb-package ships the libusb-1.0 DLL and registers it as the pyusb backend.
try:
    import libusb_package
    import usb.backend.libusb1
    _backend = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)
except Exception:  # pragma: no cover - fall back to system libusb
    _backend = None

from PIL import Image

from trofeo import TrofeoDevice, LyProtocol
from trofeo import render


def main() -> int:
    with TrofeoDevice.open() as dev:
        proto = LyProtocol(dev)

        print("handshake...")
        proto.handshake()
        print("  ok")

        if len(sys.argv) > 1:
            img = Image.open(sys.argv[1])
        else:
            img = render.test_pattern()

        frame = render.to_jpeg(img)
        print(f"sending frame: {len(frame)} bytes "
              f"({render.WIDTH}x{render.HEIGHT} JPEG)")
        proto.send_frame(frame)
        print("  sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
