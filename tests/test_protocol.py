"""Golden-fixture tests for the LY chunk protocol.

The chunk header layout is protocol-critical — a silent byte-order change
would wedge the panel or render garbage. Freeze the pattern here so a
regression is caught in CI before it hits USB.
"""
import struct

import pytest

from trofeo.protocol import (
    LyProtocol,
    CHUNK_SIZE,
    CHUNK_HEADER,
    CHUNK_PAYLOAD,
    BURST_SIZE,
)


class FakeDevice:
    """Records every write; replies to reads with a valid ACK.

    ACK shape per trofeo/protocol.py handshake validation: byte 0 = 0x03,
    byte 1 = 0xFF, byte 8 = 0x01. The other 509 bytes don't matter.
    """
    def __init__(self):
        self.writes: list[bytes] = []

    def write(self, data, timeout: int = 2000) -> int:
        self.writes.append(bytes(data))
        return len(data)

    def read(self, size: int = 512, timeout: int = 2000) -> bytes:
        ack = bytearray(size)
        ack[0] = 0x03
        ack[1] = 0xFF
        ack[8] = 0x01
        return bytes(ack)


def test_chunk_payload_and_header_sizes_frozen():
    """Guard the constants callers rely on."""
    assert CHUNK_SIZE == 512
    assert CHUNK_HEADER == 16
    assert CHUNK_PAYLOAD == 496
    assert BURST_SIZE == 4096


def test_chunk_count_padded_to_multiple_of_four():
    proto = LyProtocol(FakeDevice())
    # 5 real chunks of payload → padded up to 8 (next multiple of 4).
    frame = b"\xAB" * (5 * CHUNK_PAYLOAD)
    chunks = proto._build_chunks(frame)
    assert len(chunks) == 8
    assert all(len(c) == CHUNK_SIZE for c in chunks)


def test_chunk_header_layout_byte_by_byte():
    proto = LyProtocol(FakeDevice())
    # 2 real chunks: first fills 496B, second holds 4B (500 total).
    # Padded up to 4 total chunks (multiple of 4).
    frame = b"\xAB" * 500
    chunks = proto._build_chunks(frame)
    assert len(chunks) == 4

    expected_payload = [CHUNK_PAYLOAD, 4, 0, 0]
    for i, chunk in enumerate(chunks):
        assert chunk[0] == 0x01, f"chunk {i}: marker byte"
        assert chunk[1] == 0xFF, f"chunk {i}: 0xFF byte"
        assert struct.unpack('<I', chunk[2:6])[0] == 500, f"chunk {i}: total size"
        assert struct.unpack('<H', chunk[6:8])[0] == expected_payload[i], f"chunk {i}: payload_len"
        assert chunk[8] == 0x01, f"chunk {i}: flag byte"
        assert struct.unpack('<H', chunk[9:11])[0] == 4, f"chunk {i}: n_total"
        assert struct.unpack('<H', chunk[11:13])[0] == i, f"chunk {i}: index"
        # bytes 13..15 are zero padding
        assert chunk[13:16] == b'\x00\x00\x00', f"chunk {i}: header padding"


def test_chunk_payload_bytes_match_frame():
    proto = LyProtocol(FakeDevice())
    # A distinguishable frame: bytes counting up mod 256, 1000B long → 3 real chunks.
    frame = bytes(i & 0xFF for i in range(1000))
    chunks = proto._build_chunks(frame)
    # Real chunks: 496 + 496 + 8. Padded to 4.
    reconstructed = b""
    for i in range(3):
        chunk = chunks[i]
        payload_len = struct.unpack('<H', chunk[6:8])[0]
        reconstructed += chunk[CHUNK_HEADER:CHUNK_HEADER + payload_len]
    assert reconstructed == frame
    # 4th chunk is pure padding.
    assert struct.unpack('<H', chunks[3][6:8])[0] == 0


def test_send_frame_burst_sizes():
    """The protocol writes in 4096B bursts, with the tail as a 2048B write
    (only possible because chunk count is padded to a multiple of 4)."""
    dev = FakeDevice()
    proto = LyProtocol(dev)
    # 9 real chunks → padded to 12 → 12 * 512 = 6144B total.
    # Expected wire: two writes of 4096, 2048.
    frame = b"\xAB" * (9 * CHUNK_PAYLOAD)
    proto.send_frame(frame)
    assert [len(w) for w in dev.writes] == [4096, 2048]


def test_send_frame_single_burst_when_exactly_8_chunks():
    dev = FakeDevice()
    proto = LyProtocol(dev)
    # 8 real chunks = exactly one 4096B burst, no tail.
    frame = b"\xAB" * (8 * CHUNK_PAYLOAD)
    proto.send_frame(frame)
    assert [len(w) for w in dev.writes] == [4096]


def test_handshake_packet_shape():
    dev = FakeDevice()
    proto = LyProtocol(dev)
    proto.handshake()
    assert len(dev.writes) == 1
    packet = dev.writes[0]
    assert len(packet) == 2048
    # Header per trofeo/protocol.py:44-48
    assert packet[0] == 0x02
    assert packet[1] == 0xFF
    assert packet[8] == 0x01
    # Everything else in the 16-byte header is zero.
    assert packet[2:8] == b'\x00' * 6
    assert packet[9:16] == b'\x00' * 7
    # 2032 bytes of payload zeros.
    assert packet[16:] == b'\x00' * 2032


def test_handshake_rejects_bad_ack():
    """A device that answers with the wrong magic must raise."""
    dev = FakeDevice()

    def bad_read(size=512, timeout=2000):
        return b'\x00' * size

    dev.read = bad_read  # type: ignore
    proto = LyProtocol(dev)
    with pytest.raises(RuntimeError, match="handshake"):
        proto.handshake()
