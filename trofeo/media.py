"""Now-playing (media session) watcher.

Uses Windows.Media.Control — the same API the volume-flyout media panel uses —
so it sees Spotify, browsers, foobar2000, anything that registers a system
media transport session. Album art is read from the session's thumbnail stream
and shipped as a data URL (only when the track changes).
"""

from __future__ import annotations

import base64
import time

THUMB_MAX_BYTES = 1_500_000
# Art often becomes available a moment after the track-change event — retry a
# few polls before giving up on the current track.
_THUMB_RETRIES = 5


class MediaWatcher:
    """Async poller: start() once, then poll() returns a state dict when
    something worth broadcasting changed (else None)."""

    def __init__(self):
        self.status = "init"  # init | ok | unsupported | error:<msg>
        self._mgr = None
        self._ps_playing = None
        self._DataReader = None
        # last observed state (drives change detection)
        self._had = None  # None = never polled
        self._key = None  # (title, artist, album)
        self._playing = False
        self._pos = 0.0
        self._mono = 0.0
        self._dur = 0.0
        self._thumb = None
        self._thumb_tries = 0
        self._snapshot = None  # full last state incl. thumb (for new clients)

    async def start(self) -> str:
        try:
            from winsdk.windows.media.control import (
                GlobalSystemMediaTransportControlsSessionManager as Mgr,
                GlobalSystemMediaTransportControlsSessionPlaybackStatus as PS,
            )
            from winsdk.windows.storage.streams import DataReader
        except Exception as e:
            self.status = f"unsupported ({type(e).__name__})"
            return self.status
        try:
            self._mgr = await Mgr.request_async()
            self._ps_playing = PS.PLAYING
            self._DataReader = DataReader
            self.status = "ok"
        except Exception as e:
            self.status = f"error: {e}"
        return self.status

    def snapshot(self):
        """Last full state (incl. thumb) — sent to newly connected clients."""
        return self._snapshot

    async def poll(self):
        if self._mgr is None:
            return None
        session = self._mgr.get_current_session()
        if session is None:
            if self._had is not False:
                self._had = False
                self._key = None
                self._thumb = None
                self._snapshot = {"hasMedia": False}
                return {"hasMedia": False}
            return None

        props = await session.try_get_media_properties_async()
        info = session.get_playback_info()
        tl = session.get_timeline_properties()
        title = props.title or ""
        artist = props.artist or props.album_artist or ""
        album = props.album_title or ""
        playing = info.playback_status == self._ps_playing
        pos = max(0.0, tl.position.total_seconds())
        dur = max(0.0, tl.end_time.total_seconds())
        app = ""
        try:
            app = session.source_app_user_model_id or ""
        except Exception:
            pass

        key = (title, artist, album)
        mono = time.monotonic()
        # position drifts forward on its own while playing — only an
        # unexpected jump (seek) is worth a broadcast
        expected = self._pos + (mono - self._mono if self._playing else 0.0)
        emit = (
            self._had is not True
            or key != self._key
            or playing != self._playing
            or abs(pos - expected) > 3.0
            or abs(dur - self._dur) > 1.0
        )

        thumb_changed = False
        if key != self._key:
            self._thumb = await self._read_thumb(props)
            self._thumb_tries = 1
            thumb_changed = True
        elif self._thumb is None and self._thumb_tries < _THUMB_RETRIES:
            self._thumb = await self._read_thumb(props)
            self._thumb_tries += 1
            if self._thumb is not None:
                thumb_changed = True
                emit = True

        self._had = True
        self._key = key
        self._playing = playing
        self._pos = pos
        self._mono = mono
        self._dur = dur

        state = {
            "hasMedia": True, "app": app, "title": title, "artist": artist,
            "album": album, "playing": playing,
            "pos": round(pos, 2), "dur": round(dur, 2),
        }
        self._snapshot = {**state, "thumb": self._thumb}
        if not emit:
            return None
        # the "thumb" key is present ONLY when the art changed — clients keep
        # their cached art when the key is absent
        return {**state, "thumb": self._thumb} if thumb_changed else state

    async def _read_thumb(self, props):
        ref = props.thumbnail
        if ref is None:
            return None
        stream = None
        try:
            stream = await ref.open_read_async()
            size = int(stream.size)
            if not size or size > THUMB_MAX_BYTES:
                return None
            reader = self._DataReader(stream.get_input_stream_at(0))
            await reader.load_async(size)
            try:
                data = bytearray(size)
                reader.read_bytes(data)
                raw = bytes(data)
            except Exception:
                raw = bytes(memoryview(reader.read_buffer(size)))
            ctype = "image/jpeg"
            try:
                ctype = stream.content_type or ctype
            except Exception:
                pass
            return f"data:{ctype};base64,{base64.b64encode(raw).decode()}"
        except Exception:
            return None
        finally:
            try:
                if stream is not None:
                    stream.close()
            except Exception:
                pass
