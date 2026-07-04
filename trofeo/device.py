"""USB transport layer: open the LCD, claim its interface, expose the two endpoints.

Requires the device to be bound to a libusb-compatible driver (WinUSB via Zadig on
Windows). While the stock TRCC driver is bound, usb.core.find() will still see the
device but claiming the interface / bulk transfers will fail.
"""

from __future__ import annotations

import usb.core
import usb.util

# Use the libusb-1.0 DLL bundled by libusb-package so pyusb works on Windows
# without a system-wide libusb install. Falls back to pyusb's default lookup.
try:
    import libusb_package
    import usb.backend.libusb1

    _BACKEND = usb.backend.libusb1.get_backend(find_library=libusb_package.find_library)
except Exception:  # pragma: no cover
    _BACKEND = None

# Trofeo Vision 9.16 LCD. Confirmed present on this machine as:
#   USBDISPLAY  USB\VID_0416&PID_5408\...
VID = 0x0416
PID = 0x5408

# Endpoint addresses from the protocol doc: "EP09 OUT" / "EP01 IN".
# OUT endpoint number 9 -> address 0x09; IN endpoint number 1 -> address 0x81.
# We try to auto-detect from the interface and fall back to these constants.
EP_OUT_ADDR = 0x09
EP_IN_ADDR = 0x81


class DeviceError(RuntimeError):
    pass


class TrofeoDevice:
    """Thin wrapper over a pyusb device handle with the two bulk endpoints resolved."""

    def __init__(self, dev: usb.core.Device):
        self._dev = dev
        self.ep_out = None
        self.ep_in = None
        self._intf = None

    @classmethod
    def open(cls) -> "TrofeoDevice":
        dev = usb.core.find(idVendor=VID, idProduct=PID, backend=_BACKEND)
        if dev is None:
            raise DeviceError(
                f"Device {VID:04x}:{PID:04x} not found. Is it plugged in? "
                "On Windows, is the WinUSB driver installed via Zadig?"
            )
        self = cls(dev)
        self._configure()
        return self

    def _configure(self) -> None:
        dev = self._dev
        # On Windows/libusb there is normally no kernel driver to detach.
        try:
            dev.set_configuration()
        except usb.core.USBError as e:
            raise DeviceError(
                "Failed to set USB configuration. The stock driver is probably still "
                "bound; switch this device to WinUSB with Zadig.\n"
                f"  underlying error: {e}"
            ) from e

        cfg = dev.get_active_configuration()
        intf = cfg[(0, 0)]
        self._intf = intf

        self.ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
            == usb.util.ENDPOINT_OUT,
        )
        self.ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
            == usb.util.ENDPOINT_IN,
        )

        if self.ep_out is None or self.ep_in is None:
            raise DeviceError(
                "Could not locate bulk OUT/IN endpoints on the interface. "
                f"Expected OUT {EP_OUT_ADDR:#04x} / IN {EP_IN_ADDR:#04x}."
            )

    def write(self, data: bytes, timeout: int = 2000) -> int:
        return self.ep_out.write(data, timeout=timeout)

    def read(self, size: int = 512, timeout: int = 2000) -> bytes:
        return bytes(self.ep_in.read(size, timeout=timeout))

    def drain_in(self) -> int:
        """Read and discard any stale data queued on the IN endpoint (e.g. an
        unread frame ACK left behind by a previous sender that died before
        reading it). A stale ACK makes the next handshake reply queue behind
        garbage, so drain before handshaking. Returns bytes discarded."""
        drained = 0
        try:
            while True:
                drained += len(self.ep_in.read(512, timeout=200))
        except usb.core.USBError:
            pass  # timeout = queue empty
        return drained

    def reset(self) -> None:
        """USB port reset — recovers the panel when a previous process died
        mid-frame and left it waiting for the rest of a chunked transfer."""
        try:
            self._dev.reset()
        finally:
            usb.util.dispose_resources(self._dev)

    def close(self) -> None:
        if self._dev is not None:
            usb.util.dispose_resources(self._dev)
            self._dev = None

    def __enter__(self) -> "TrofeoDevice":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
