"""Handshake-only test: prove two-way bulk comms without changing the display."""

import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import libusb_package
import usb.backend.libusb1

# register the bundled libusb backend for pyusb
_backend = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)

from trofeo.device import TrofeoDevice
from trofeo.protocol import LyProtocol

with TrofeoDevice.open() as dev:
    proto = LyProtocol(dev)
    print("handshake...")
    proto.handshake()
    print("  OK - device replied with valid 03 FF .. 01 signature")
    print("Two-way comms confirmed. No frame sent; display unchanged.")
