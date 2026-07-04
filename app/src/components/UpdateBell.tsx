import { useEffect, useState } from 'react'
import { Bell, BellRing, Loader2, AlertCircle, Check } from 'lucide-react'

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
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.bell-wrap')) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
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

  const title = state === 'ready' ? `v${version} をインストールできます`
    : state === 'downloading' ? `v${version} をダウンロード中 (${percent}%)`
    : state === 'checking' ? 'アップデート確認中…'
    : state === 'error' ? `更新エラー: ${error ?? ''}`
    : '最新版です'

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
            現在のバージョン: <b>v{current ?? '?'}</b>
          </div>
          {state === 'ready' && (
            <>
              <div className="bell-msg ok">
                <Check size={14} /> 新しいバージョン <b>v{version}</b> が利用可能
              </div>
              <button type="button" className="bell-cta" onClick={install}>
                インストールして再起動
              </button>
              <div className="bell-note">
                LCD への配信は再起動中に一時停止します
              </div>
            </>
          )}
          {state === 'downloading' && (
            <>
              <div className="bell-msg">
                <Loader2 size={14} className="spin" /> v{version} をダウンロード中
              </div>
              <div className="bell-bar"><span style={{ width: `${percent}%` }} /></div>
              <div className="bell-note">{percent}% 完了</div>
            </>
          )}
          {state === 'checking' && (
            <div className="bell-msg">
              <Loader2 size={14} className="spin" /> 確認中…
            </div>
          )}
          {state === 'idle' && (
            <>
              <div className="bell-msg">最新版を使用中です</div>
              <button type="button" className="bell-check" onClick={check}>
                今すぐ確認
              </button>
            </>
          )}
          {state === 'error' && (
            <>
              <div className="bell-msg err">
                <AlertCircle size={14} /> 更新チェックに失敗
              </div>
              <div className="bell-err-detail">{error}</div>
              <button type="button" className="bell-check" onClick={check}>
                再試行
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
