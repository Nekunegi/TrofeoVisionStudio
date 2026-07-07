"""server.DeviceManager: USB failure recovery + panel size self-report.

A panel crashed mid-transfer wedges the device; DeviceManager.send_frame must
reset + reopen + retry exactly once. These tests freeze that behavior with a
fake device/protocol pair (no hardware, no libusb calls).
"""

import pytest
import usb.core

import server


class FakeDev:
    def __init__(self):
        self.reset_calls = 0
        self.closed = False

    def drain_in(self) -> int:
        return 0

    def reset(self) -> None:
        self.reset_calls += 1

    def close(self) -> None:
        self.closed = True


class FakeDeviceCls:
    """Stands in for trofeo.device.TrofeoDevice inside server."""
    instances: list[FakeDev] = []

    @classmethod
    def open(cls) -> FakeDev:
        d = FakeDev()
        cls.instances.append(d)
        return d


class FakeProto:
    """Stands in for LyProtocol. fail_next (class attr) makes the next N
    send_frame calls raise USBError."""
    fail_next = 0
    report_width: int | None = 1920
    instances: list["FakeProto"] = []

    def __init__(self, dev):
        self.dev = dev
        self.panel_width = FakeProto.report_width
        self.device_id = 0x1234
        self.sent: list[bytes] = []
        FakeProto.instances.append(self)

    def handshake(self) -> None:
        pass

    def send_frame(self, jpeg: bytes) -> None:
        if FakeProto.fail_next > 0:
            FakeProto.fail_next -= 1
            raise usb.core.USBError("fake transfer error")
        self.sent.append(jpeg)


@pytest.fixture
def dm(monkeypatch):
    FakeDeviceCls.instances = []
    FakeProto.instances = []
    FakeProto.fail_next = 0
    FakeProto.report_width = 1920
    monkeypatch.setattr(server, "TrofeoDevice", FakeDeviceCls)
    monkeypatch.setattr(server, "LyProtocol", FakeProto)
    return server.DeviceManager()


def test_send_frame_happy_path(dm):
    dm.send_frame(b"jpeg-bytes")
    assert FakeProto.instances[0].sent == [b"jpeg-bytes"]
    assert dm.connected


def test_send_failure_resets_reconnects_and_retries(dm):
    dm.ensure()
    FakeProto.fail_next = 1
    dm.send_frame(b"frame-2")
    # The wedged device got a USB port reset, a fresh device+proto was opened,
    # and the SAME frame was delivered on the second attempt.
    assert FakeDeviceCls.instances[0].reset_calls == 1
    assert len(FakeDeviceCls.instances) == 2
    assert FakeProto.instances[-1].sent == [b"frame-2"]
    assert dm.connected


def test_reset_failure_does_not_block_reconnect(dm):
    dm.ensure()
    FakeDeviceCls.instances[0].reset = _raise  # type: ignore[method-assign]
    FakeProto.fail_next = 1
    dm.send_frame(b"frame-3")
    assert FakeProto.instances[-1].sent == [b"frame-3"]


def test_second_consecutive_failure_propagates(dm):
    dm.ensure()
    FakeProto.fail_next = 2  # retry after reset also fails
    with pytest.raises(usb.core.USBError):
        dm.send_frame(b"frame-4")


def test_panel_size_from_handshake_self_report(dm):
    dm.ensure()
    assert dm.panel_width == 1920
    assert dm.panel_height == 480


def test_panel_size_defaults_when_not_reported(dm):
    FakeProto.report_width = None
    dm.ensure()
    assert dm.panel_width == 1920
    assert dm.panel_height == 480


def test_panel_size_686_model(dm):
    FakeProto.report_width = 1280
    dm.ensure()
    assert dm.panel_width == 1280
    assert dm.panel_height == 480


def _raise():
    raise RuntimeError("reset blew up")
