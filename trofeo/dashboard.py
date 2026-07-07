"""Render a Metrics snapshot into a 1920x480 dashboard image for the LCD.

Ultrawide 4:1 panel -> two columns (CPU | GPU), each with a big temperature,
a load bar, and a power/clock line. Missing values render as "--".
"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

from .render import WIDTH, HEIGHT
from .sensors import Metrics

_FONT = "C:/Windows/Fonts/segoeui.ttf"
_FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"


def _font(size: int, bold: bool = False):
    try:
        return ImageFont.truetype(_FONT_BOLD if bold else _FONT, size)
    except Exception:
        return ImageFont.load_default()


def _temp_color(t):
    if t is None:
        return (120, 120, 120)
    if t < 60:
        return (0, 220, 120)
    if t < 75:
        return (230, 220, 0)
    if t < 85:
        return (255, 140, 0)
    return (255, 40, 40)


def _fmt(v, suffix="", nd=0):
    if v is None:
        return "--"
    return f"{v:.{nd}f}{suffix}"


def _centered(d: ImageDraw.ImageDraw, cx, y, text, font, fill):
    left, _t, right, _b = d.textbbox((0, 0), text, font=font)
    d.text((cx - (right - left) / 2, y), text, font=font, fill=fill)


def _column(d: ImageDraw.ImageDraw, x0, width, title, temp, load, sub):
    cx = x0 + width // 2
    pad = 50

    d.text((x0 + pad, 30), title, font=_font(64, bold=True), fill=(180, 180, 190))

    # big temperature
    tcol = _temp_color(temp)
    _centered(d, cx, 90, _fmt(temp) + "°", _font(210, bold=True), tcol)

    # load bar
    bx0, bx1 = x0 + pad, x0 + width - pad
    by0, by1 = 350, 400
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=12, outline=(70, 70, 80), width=3)
    if load is not None:
        fill_w = int((bx1 - bx0 - 6) * max(0.0, min(load, 100)) / 100)
        d.rounded_rectangle([bx0 + 3, by0 + 3, bx0 + 3 + fill_w, by1 - 3],
                            radius=9, fill=_temp_color(temp))
    d.text((bx0, by0 - 46), f"LOAD {_fmt(load, '%')}", font=_font(38, bold=True),
           fill=(200, 200, 210))

    # sub line (power / clock)
    d.text((bx0, by1 + 14), sub, font=_font(34), fill=(150, 150, 160))


def render(m: Metrics) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (10, 10, 14))
    d = ImageDraw.Draw(img)

    half = WIDTH // 2
    d.line([(half, 40), (half, HEIGHT - 40)], fill=(50, 50, 60), width=3)

    cpu_sub = f"{_fmt(m.cpu_power, ' W', 1)}   {_fmt(m.cpu_clock, ' MHz')}"
    gpu_sub = f"{_fmt(m.gpu_power, ' W', 1)}"
    _column(d, 0, half, "CPU", m.cpu_temp, m.cpu_load, cpu_sub)
    _column(d, half, half, "GPU", m.gpu_temp, m.gpu_load, gpu_sub)

    return img
