"""Custom userland driver for the Thermalright Trofeo Vision 9.16 LCD (USB 0416:5408).

A clean-room reimplementation of the "LY USB" chunked-bulk protocol, replacing the
bundled TRCC software. Protocol reverse-engineered by the thermalright-trcc-linux
project (https://github.com/Lexonight1/thermalright-trcc-linux).
"""

from .device import TrofeoDevice, VID, PID
from .protocol import LyProtocol

__all__ = ["TrofeoDevice", "LyProtocol", "VID", "PID"]
