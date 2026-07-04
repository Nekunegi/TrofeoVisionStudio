"""Non-invasive check: can libusb/pyusb see 0416:5408 right now?

On Windows, libusb only enumerates devices bound to WinUSB/libusbK/libusb-win32.
If this prints "not visible", the stock TRCC driver is still bound and Zadig is
required before demo.py can talk to the panel. Reads descriptors only; sends nothing.
"""

import libusb_package
import usb.core
import usb.util

backend = None
try:
    import usb.backend.libusb1
    backend = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)
except Exception as e:
    print("backend init warning:", e)

VID, PID = 0x0416, 0x5408

dev = usb.core.find(idVendor=VID, idProduct=PID, backend=backend)
if dev is None:
    print(f"{VID:04x}:{PID:04x} NOT visible to libusb.")
    print("-> Stock driver still bound. Run Zadig -> WinUSB (README step C).")
    print("\nAll devices libusb CAN currently see:")
    for d in usb.core.find(find_all=True, backend=backend):
        print(f"  {d.idVendor:04x}:{d.idProduct:04x}")
    raise SystemExit(1)

print(f"{VID:04x}:{PID:04x} VISIBLE. Descriptors:")
for cfg in dev:
    for intf in cfg:
        print(f"  interface {intf.bInterfaceNumber} "
              f"class={intf.bInterfaceClass:#04x}")
        for ep in intf:
            direction = "IN" if usb.util.endpoint_direction(ep.bEndpointAddress) else "OUT"
            print(f"    endpoint {ep.bEndpointAddress:#04x} {direction} "
                  f"type={usb.util.endpoint_type(ep.bmAttributes)} "
                  f"maxpkt={ep.wMaxPacketSize}")
