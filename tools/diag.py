"""Eyes-free verification: dump everything the device tells us over USB.

We cannot see the panel (remote session), so instead we read back the handshake
reply and the post-frame ACK and scan them for the device's native resolution
and any status codes.
"""

import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import libusb_package
import usb.backend.libusb1
import usb.util

_backend = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)

from trofeo.device import TrofeoDevice
from trofeo.protocol import LyProtocol
from trofeo import render


def scan_for_res(buf: bytes):
    """Look for common panel dimensions encoded as LE/BE uint16."""
    import struct
    candidates = {1920: "1920", 1080: "1080", 1280: "1280", 480: "480",
                  800: "800", 320: "320", 240: "240", 960: "960", 540: "540"}
    hits = []
    for off in range(len(buf) - 1):
        for endian in ("<H", ">H"):
            val = struct.unpack_from(endian, buf, off)[0]
            if val in candidates:
                hits.append(f"    off {off:3d} {endian}: {val}")
    return hits


def hexdump(buf: bytes, width=32):
    lines = []
    for i in range(0, len(buf), width):
        chunk = buf[i:i + width]
        lines.append(f"  {i:04x}  " + chunk.hex(" "))
    return "\n".join(lines)


with TrofeoDevice.open() as dev:
    raw = dev._dev

    print("=== DEVICE DESCRIPTOR ===")
    print(f"  VID:PID = {raw.idVendor:04x}:{raw.idProduct:04x}  bcdDevice={raw.bcdDevice:#06x}")
    for name, idx in (("Manufacturer", raw.iManufacturer),
                      ("Product", raw.iProduct),
                      ("Serial", raw.iSerialNumber)):
        try:
            print(f"  {name}: {usb.util.get_string(raw, idx)}")
        except Exception as e:
            print(f"  {name}: <unreadable: {e}>")

    proto = LyProtocol(dev)

    # --- handshake, capture full reply ---
    header = bytearray(16)
    header[0], header[1], header[8] = 0x02, 0xFF, 0x01
    dev.write(bytes(header) + b"\x00" * (2048 - 16))
    reply = dev.read(512)
    print("\n=== HANDSHAKE REPLY (first 96 bytes) ===")
    print(hexdump(reply[:96]))
    print("  resolution-like values found:")
    hits = scan_for_res(reply)
    print("\n".join(hits) if hits else "    (none)")

    # --- send frame, capture ack ---
    frame = render.to_jpeg(render.test_pattern())
    chunks = proto._build_chunks(frame)
    buf = b"".join(chunks)
    off = 0
    from trofeo.protocol import BURST_SIZE
    while off < len(buf):
        end = min(off + BURST_SIZE, len(buf))
        dev.write(buf[off:end])
        off = end
    ack = dev.read(512)
    print(f"\n=== FRAME ACK ({len(ack)} bytes, frame was {len(frame)} B / {len(chunks)} chunks) ===")
    print(hexdump(ack[:64]))
