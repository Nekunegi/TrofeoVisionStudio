"""Turn a PIL image into the frame bytes the LCD expects.

LY Bulk devices (0416:5408) take **JPEG-encoded** frames (per thermalright-trcc-linux
doc/REFERENCE_TECHNICAL.md), not raw pixels. The panel is 1920x480 on the 9.16"
model (1280x480 on the 6.86" model). The protocol layer chunks these JPEG bytes.

If the first frame looks offset/garbled, the likely fix is the resolution
(1920x480 <-> 1280x480) or JPEG subsampling/quality — not the transport.
"""

from __future__ import annotations

import io

from PIL import Image

# 9.16" Trofeo Vision (PID 5408). Use 1280x480 for the 6.86" panel.
WIDTH = 1920
HEIGHT = 480


def to_jpeg(img: Image.Image, width: int = WIDTH, height: int = HEIGHT,
            quality: int = 90) -> bytes:
    """Resize to the panel size and JPEG-encode. Returns the raw JPEG bytes."""
    img = img.convert("RGB").resize((width, height))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, subsampling=0)
    return buf.getvalue()


def to_rgb565(img: Image.Image, width: int = WIDTH, height: int = HEIGHT,
              little_endian: bool = True) -> bytes:
    """Raw RGB565 fallback, in case a given unit expects uncompressed frames."""
    img = img.convert("RGB").resize((width, height))
    px = img.tobytes()
    out = bytearray(width * height * 2)
    for i in range(width * height):
        r, g, b = px[i * 3], px[i * 3 + 1], px[i * 3 + 2]
        val = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
        if little_endian:
            out[i * 2], out[i * 2 + 1] = val & 0xFF, (val >> 8) & 0xFF
        else:
            out[i * 2], out[i * 2 + 1] = (val >> 8) & 0xFF, val & 0xFF
    return bytes(out)


def solid(color, width: int = WIDTH, height: int = HEIGHT) -> Image.Image:
    """A solid color test image, e.g. solid((255, 0, 0))."""
    return Image.new("RGB", (width, height), color)


def test_pattern(width: int = WIDTH, height: int = HEIGHT) -> Image.Image:
    """Diagnostic frame: reveals resolution, orientation, color order, and offset.

    - R/G/B/white bands (check color order)
    - "TL"/"BR" corner labels + border (check offset / full-panel coverage)
    - center text with the assumed resolution (check orientation)
    """
    from PIL import ImageDraw

    img = Image.new("RGB", (width, height), (0, 0, 0))
    d = ImageDraw.Draw(img)

    bands = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)]
    bw = width // len(bands)
    for i, c in enumerate(bands):
        d.rectangle([i * bw, 0, (i + 1) * bw, height // 3], fill=c)

    d.rectangle([0, 0, width - 1, height - 1], outline=(255, 255, 0), width=4)
    d.text((8, 8), "TL", fill=(255, 255, 255))
    d.text((width - 40, height - 20), "BR", fill=(255, 255, 255))
    d.text((width // 2 - 60, height // 2), f"{width}x{height}", fill=(255, 255, 0))
    return img
