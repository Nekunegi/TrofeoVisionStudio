import { useState } from 'react'
import { Check, X, AlertTriangle, ExternalLink } from 'lucide-react'
import type { Backend } from '../useBackend'

const STORAGE_KEY = 'trofeo-onboarded'
const TROUBLE_DOC = 'https://github.com/Nekunegi/TrofeoVisionStudio/blob/main/docs/TROUBLESHOOTING.md'

type Status = 'ok' | 'pending' | 'error'

interface CheckItem {
  label: string
  status: Status
  detail: string
  helpAnchor?: string // deep link into TROUBLESHOOTING.md
}

function computeChecks(backend: Backend): CheckItem[] {
  const backendUp = backend.link === 'open'
  const lcdConnected = backend.device === 'connected'
  const cpuTempOk = backend.sensors.cpuTemp != null
  const notifyOk = backend.notifyStatus === 'allowed'

  return [
    {
      label: 'バックエンド接続',
      status: backendUp ? 'ok' : backend.link === 'connecting' ? 'pending' : 'error',
      detail: backendUp
        ? 'server.exe と WebSocket でつながっています'
        : 'server.exe に接続できません。トレイから "Quit" して再起動してください',
    },
    {
      label: 'LCD 検出',
      status: !backendUp ? 'pending' : lcdConnected ? 'ok' : 'error',
      detail: lcdConnected
        ? 'Trofeo Vision LCD (0416:5408) が使用可能'
        : 'USB を差し替えるか、Zadig で WinUSB ドライバに切り替えてください',
      helpAnchor: '#0416-5408-が認識されない--フレームが送れない',
    },
    {
      label: 'CPU 温度',
      status: !backendUp ? 'pending' : cpuTempOk ? 'ok' : 'error',
      detail: cpuTempOk
        ? `${backend.sensors.cpuTemp}°C を取得中`
        : '管理者 + PawnIO が必要です。Windowsの再起動で自動起動タスクが走れば直ることが多いです',
      helpAnchor: '#cpu温度が----のまま',
    },
    {
      label: 'Windows 通知連携',
      status: notifyOk
        ? 'ok'
        : backend.notifyStatus === 'unknown'
          ? 'pending'
          : 'error',
      detail: notifyOk
        ? 'トースト通知を LCD にミラーできます'
        : '設定 → プライバシーとセキュリティ → 通知 で許可してください',
    },
  ]
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'ok') return <Check size={16} className="ok" />
  if (status === 'error') return <X size={16} className="err" />
  return <AlertTriangle size={16} className="warn" />
}

interface Props {
  backend: Backend
}

export function FirstRunWizard({ backend }: Props) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1'
  )
  if (dismissed) return null
  const checks = computeChecks(backend)
  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }
  return (
    <div className="wizard-backdrop" onClick={dismiss}>
      <div className="wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-head">
          <h2>ようこそ Trofeo Vision Studio へ</h2>
          <p className="muted">
            初回セットアップの状態を自動診断しています。すべて緑になったら
            準備完了です。
          </p>
        </div>
        <ul className="wizard-checks">
          {checks.map((c) => (
            <li key={c.label} className={c.status}>
              <StatusIcon status={c.status} />
              <div className="wizard-check-body">
                <div className="wizard-check-label">{c.label}</div>
                <div className="wizard-check-detail">{c.detail}</div>
                {c.status === 'error' && c.helpAnchor && (
                  <a href={`${TROUBLE_DOC}${c.helpAnchor}`}
                    target="_blank" rel="noreferrer"
                    className="wizard-help">
                    トラブルシューティングを開く <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="wizard-tips muted">
          左のサイドバーからウィジェットを追加できます。矢印キーで位置微調整、
          Ctrl+Z で元に戻せます。詳しい使い方は{' '}
          <a href="https://github.com/Nekunegi/TrofeoVisionStudio/blob/main/README.md"
            target="_blank" rel="noreferrer">README</a> を参照。
        </div>
        <div className="wizard-foot">
          <button className="wide" onClick={dismiss}>始める</button>
        </div>
      </div>
    </div>
  )
}
