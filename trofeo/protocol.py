"""LY USB chunked-bulk protocol for the Trofeo Vision 9.16 LCD (0416:5408).

Source of the byte layout: thermalright-trcc-linux doc/PROTOCOL_USBLCDNEW.md.

Handshake (host -> device, 2048 bytes total):
    header  16 B : 02 FF 00 00 00 00 00 00 01 00 00 00 00 00 00 00
    payload 2032 B : zeros
  device replies with 512 B; valid if resp[0]==0x03, resp[1]==0xFF, resp[8]==0x01.

Frame transfer: the pixel buffer is split into 512-byte chunks.
    chunk header 16 B:
      [0]      0x01                      chunk marker
      [1]      0xFF
      [2:6]    total frame size          LE uint32
      [6:8]    payload size in this chunk LE uint16 (496 for full chunks)
      [8]      0x01                      flag
      [9:11]   total chunk count         LE uint16, rounded up to a multiple of 4
      [11:13]  this chunk's index        LE uint16
      [13:16]  padding                   zeros
    chunk body 496 B: pixel data (zero-padded on the final chunk)
  Chunks are written in bursts of 8 (4096 B); a trailing group of 4 is written as
  one 2048 B write. After the last write, read a 512 B ack from the IN endpoint.
"""

from __future__ import annotations

import struct
from typing import List

from .device import TrofeoDevice

CHUNK_SIZE = 512
CHUNK_HEADER = 16
CHUNK_PAYLOAD = CHUNK_SIZE - CHUNK_HEADER  # 496
BURST_CHUNKS = 8
BURST_SIZE = BURST_CHUNKS * CHUNK_SIZE  # 4096


class LyProtocol:
    def __init__(self, dev: TrofeoDevice):
        self.dev = dev
        # filled in by handshake() from the device's self-report
        self.device_id: int | None = None
        self.panel_width: int | None = None

    # -- handshake ---------------------------------------------------------
    def handshake(self) -> None:
        header = bytearray(16)
        header[0] = 0x02
        header[1] = 0xFF
        header[8] = 0x01
        packet = bytes(header) + b"\x00" * (2048 - 16)

        self.dev.write(packet)
        resp = self.dev.read(512)
        if not (len(resp) >= 9 and resp[0] == 0x03 and resp[1] == 0xFF and resp[8] == 0x01):
            raise RuntimeError(
                f"Unexpected handshake reply: {resp[:16].hex(' ') if resp else '<empty>'}"
            )
        # The reply self-reports the unit: device id (u32 LE at offset 16,
        # matches the USB serial) and panel width in pixels (u16 LE at offset
        # 24; 0x0780=1920 on the 9.16", 1280 expected on the 6.86"). Height is
        # not present — every known LY panel is 480 tall.
        if len(resp) >= 20:
            self.device_id = struct.unpack_from("<I", resp, 16)[0]
        if len(resp) >= 26:
            w = struct.unpack_from("<H", resp, 24)[0]
            if 240 <= w <= 4096:
                self.panel_width = w

    # -- frame -------------------------------------------------------------
    def _build_chunks(self, frame: bytes) -> List[bytes]:
        total_size = len(frame)
        n_real = (total_size + CHUNK_PAYLOAD - 1) // CHUNK_PAYLOAD
        # chunk count is padded up to a multiple of 4 (protocol requirement)
        n_total = (n_real + 3) & ~3

        chunks: List[bytes] = []
        for i in range(n_total):
            start = i * CHUNK_PAYLOAD
            body = frame[start:start + CHUNK_PAYLOAD]
            payload_len = len(body)
            body = body.ljust(CHUNK_PAYLOAD, b"\x00")

            header = bytearray(CHUNK_HEADER)
            header[0] = 0x01
            header[1] = 0xFF
            struct.pack_into("<I", header, 2, total_size)
            struct.pack_into("<H", header, 6, payload_len)
            header[8] = 0x01
            struct.pack_into("<H", header, 9, n_total)
            struct.pack_into("<H", header, 11, i)
            chunks.append(bytes(header) + body)
        return chunks

    def send_frame(self, frame: bytes) -> None:
        """Send one full raw pixel buffer (see render.to_rgb565)."""
        chunks = self._build_chunks(frame)
        buf = b"".join(chunks)

        # Write in 4096-byte bursts; the multiple-of-4 padding guarantees the
        # trailing remainder is either empty or exactly 2048 bytes.
        offset = 0
        while offset < len(buf):
            end = min(offset + BURST_SIZE, len(buf))
            self.dev.write(buf[offset:end])
            offset = end

        # acknowledgement
        self.dev.read(512)
