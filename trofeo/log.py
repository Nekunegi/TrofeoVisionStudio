"""Timestamped logging to stdout.

The Electron shell captures backend stdout into backend.log; timestamps make
that log usable for rate/latency forensics (previously we had to infer time
from unrelated periodic events). Level defaults to INFO; TROFEO_LOGLEVEL=debug
turns on the chatty per-poll diagnostics.
"""

from __future__ import annotations

import logging
import os
import sys


def get_logger(name: str) -> logging.Logger:
    root = logging.getLogger()
    if not root.handlers:
        # The console may be cp932 (Japanese Windows); never let logging crash
        # on non-ASCII characters in exception messages.
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(errors="replace")
            except Exception:
                pass
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(message)s", datefmt="%m-%d %H:%M:%S")
        )
        root.addHandler(handler)
        level = os.environ.get("TROFEO_LOGLEVEL", "info").upper()
        root.setLevel(getattr(logging, level, logging.INFO))
    return logging.getLogger(name)
