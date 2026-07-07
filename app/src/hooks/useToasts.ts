import { useCallback, useEffect, useState } from 'react'
import type { LcdToast } from '../DashboardStage'
import type { ToastData } from '../useBackend'

const TOAST_MS = 8000

/** LCD toast overlay state: mirrors incoming Windows notifications (when
 * enabled) and prunes/animates on a 50ms tick — the tick always produces a
 * fresh array so it doubles as the animation clock for the slide/fade
 * (re-render → new eased positions → streamed frame). */
export function useToasts(notification: ToastData | null, notifyEnabled: boolean) {
  const [toasts, setToasts] = useState<LcdToast[]>([])
  const pushToast = useCallback((t: Omit<LcdToast, 'born' | 'until' | 'total'>) => {
    setToasts((ts) => [...ts.slice(-4),
      { ...t, born: Date.now(), until: Date.now() + TOAST_MS, total: TOAST_MS }])
  }, [])

  useEffect(() => {
    if (notification && notifyEnabled) pushToast(notification)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification])

  useEffect(() => {
    if (!toasts.length) return
    const t = setInterval(() =>
      setToasts((ts) => ts.filter((x) => x.until > Date.now()).slice()), 50)
    return () => clearInterval(t)
  }, [toasts.length])

  return { toasts, pushToast }
}
