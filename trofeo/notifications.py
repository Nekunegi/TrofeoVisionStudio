"""Windows toast notification listener.

Uses the WinRT UserNotificationListener (the same API phone-companion apps
use), so notifications are captured even when fullscreen games or focus assist
suppress the on-screen toasts. Requires the user-level permission in
Settings > Privacy & security > Notifications ("notification access").
"""

from __future__ import annotations


class NotificationWatcher:
    """Async poller: start() once, then poll() returns only NEW toasts."""

    def __init__(self):
        self.status = "init"  # init | allowed | denied | unsupported | error:<msg>
        self._listener = None
        self._kinds = None
        self._binding_key = None
        self._seen: set[int] = set()
        self._primed = False  # first poll seeds _seen without emitting old toasts

    async def start(self) -> str:
        try:
            from winsdk.windows.ui.notifications.management import (
                UserNotificationListener, UserNotificationListenerAccessStatus)
            from winsdk.windows.ui.notifications import (
                NotificationKinds, KnownNotificationBindings)
        except Exception as e:
            self.status = f"unsupported ({type(e).__name__})"
            return self.status
        try:
            listener = UserNotificationListener.current
            access = await listener.request_access_async()
            if access != UserNotificationListenerAccessStatus.ALLOWED:
                self.status = "denied"
                return self.status
            self._listener = listener
            self._kinds = NotificationKinds.TOAST
            self._binding_key = KnownNotificationBindings.toast_generic
            self.status = "allowed"
        except Exception as e:
            self.status = f"error: {e}"
        return self.status

    async def poll(self) -> list[dict]:
        """New toasts since the previous call (oldest first)."""
        if self._listener is None:
            return []
        notifs = await self._listener.get_notifications_async(self._kinds)
        out: list[dict] = []
        current_ids = set()
        for n in notifs:
            current_ids.add(n.id)
            if n.id in self._seen:
                continue
            self._seen.add(n.id)
            if not self._primed:
                continue  # pre-existing toast from before we started
            app = ""
            try:
                app = n.app_info.display_info.display_name
            except Exception:
                pass
            texts: list[str] = []
            try:
                binding = n.notification.visual.get_binding(self._binding_key)
                if binding:
                    texts = [t.text for t in binding.get_text_elements() if t.text]
            except Exception:
                pass
            out.append({
                "id": int(n.id),
                "app": app,
                "title": texts[0] if texts else "",
                "body": " ".join(texts[1:3]) if len(texts) > 1 else "",
            })
        self._primed = True
        # forget ids of dismissed toasts so the set can't grow forever
        self._seen &= current_ids | {d["id"] for d in out}
        return out
