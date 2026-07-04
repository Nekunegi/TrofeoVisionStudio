import { useEffect, useState } from 'react'
import { Bell, BellRing, Loader2, AlertCircle, Check } from 'lucide-react'
import { useT } from '../i18n'

export type UpdaterState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdaterStatus {
  state: UpdaterState
  current: string | null
  version: string | null
  percent: number
  error: string | null
}

interface UpdaterBridge {
  get: () => Promise<UpdaterStatus>
  check: () => Promise<{ ok: boolean; reason?: string }>
  install: () => Promise<{ ok: boolean; reason?: string }>
  onStatus: (cb: (s: UpdaterStatus) => void) => () => void
}

declare global {
  interface Window { updater?: UpdaterBridge }
}

const EMPTY: UpdaterStatus = {
  state: 'idle', current: null, version: null, percent: 0, error: null,
}

export function UpdateBell() {
  const t = useT()
  const [status, setStatus] = useState<UpdaterStatus>(EMPTY)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const u = window.updater
    if (!u) return
    let cancelled = false
    u.get().then((s) => { if (!cancelled) setStatus(s) }).catch(() => { })
    const off = u.onStatus((s) => setStatus(s))
    return () => { cancelled = true; off() }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (!t?.closest?.('.bell-wrap')) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!window.updater) return null

  const { state, current, version, percent, error } = status
  const hasUpdate = state === 'ready' || state === 'downloading' || state === 'available'

  const icon = state === 'ready' ? <BellRing size={16} />
    : state === 'downloading' || state === 'checking' ? <Loader2 size={16} className="spin" />
    : state === 'error' ? <AlertCircle size={16} />
    : <Bell size={16} />

  const badgeText = state === 'ready' ? '!'
    : state === 'downloading' ? `${percent}%`
    : null

  const title = state === 'ready' ? `v${version} ${t('bell.tipReady')}`
    : state === 'downloading' ? `v${version} ${t('bell.tipDownloading')} (${percent}%)`
    : state === 'checking' ? t('bell.tipChecking')
    : state === 'error' ? `${t('bell.tipError')} ${error ?? ''}`
    : t('bell.tipIdle')

  const install = async () => {
    if (state !== 'ready') return
    setOpen(false)
    await window.updater!.install()
  }

  const check = async () => {
    if (state === 'checking' || state === 'downloading') return
    await window.updater!.check()
  }

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className={`bell ${hasUpdate ? 'has-update' : ''} ${state}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={title}
      >
        {icon}
        {badgeText && <span className="bell-badge">{badgeText}</span>}
      </button>
      {open && (
        <div className="bell-popover" role="dialog">
          <div className="bell-current">
            {t('bell.current')}: <b>v{current ?? '?'}</b>
          </div>
          {state === 'ready' && (
            <>
              <div className="bell-msg ok">
                <Check size={14} /> {t('bell.readyPrefix')} <b>v{version}</b> {t('bell.ready')}
              </div>
              <button type="button" className="bell-cta" onClick={install}>
                {t('bell.install')}
              </button>
              <div className="bell-note">{t('bell.installNote')}</div>
            </>
          )}
          {state === 'downloading' && (
            <>
              <div className="bell-msg">
                <Loader2 size={14} className="spin" /> v{version} {t('bell.downloading')}
              </div>
              <div className="bell-bar"><span style={{ width: `${percent}%` }} /></div>
              <div className="bell-note">{percent}{t('bell.percentDone')}</div>
            </>
          )}
          {state === 'checking' && (
            <div className="bell-msg">
              <Loader2 size={14} className="spin" /> {t('bell.checking')}
            </div>
          )}
          {state === 'idle' && (
            <>
              <div className="bell-msg">{t('bell.upToDate')}</div>
              <button type="button" className="bell-check" onClick={check}>
                {t('bell.checkNow')}
              </button>
            </>
          )}
          {state === 'error' && (
            <>
              <div className="bell-msg err">
                <AlertCircle size={14} /> {t('bell.errorTitle')}
              </div>
              <div className="bell-err-detail">{error}</div>
              <button type="button" className="bell-check" onClick={check}>
                {t('bell.retry')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
