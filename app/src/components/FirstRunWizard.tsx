import { useState } from 'react'
import { Check, X, AlertTriangle, ExternalLink } from 'lucide-react'
import type { Backend } from '../useBackend'
import { useT } from '../i18n'

const STORAGE_KEY = 'trofeo-onboarded'
const TROUBLE_DOC = 'https://github.com/Nekunegi/TrofeoVisionStudio/blob/main/docs/TROUBLESHOOTING.md'

type Status = 'ok' | 'pending' | 'error'

interface CheckItem {
  label: string
  status: Status
  detail: string
  helpAnchor?: string // deep link into TROUBLESHOOTING.md
}

type Tr = ReturnType<typeof useT>

function computeChecks(backend: Backend, t: Tr): CheckItem[] {
  const backendUp = backend.link === 'open'
  const lcdConnected = backend.device === 'connected'
  const cpuTempOk = backend.sensors.cpuTemp != null
  const notifyOk = backend.notifyStatus === 'allowed'

  return [
    {
      label: t('wizard.chkBackend'),
      status: backendUp ? 'ok' : backend.link === 'connecting' ? 'pending' : 'error',
      detail: backendUp ? t('wizard.chkBackendOk') : t('wizard.chkBackendErr'),
    },
    {
      label: t('wizard.chkLcd'),
      status: !backendUp ? 'pending' : lcdConnected ? 'ok' : 'error',
      detail: lcdConnected ? t('wizard.chkLcdOk') : t('wizard.chkLcdErr'),
      helpAnchor: '#0416-5408-が認識されない--フレームが送れない',
    },
    {
      label: t('wizard.chkCpu'),
      status: !backendUp ? 'pending' : cpuTempOk ? 'ok' : 'error',
      detail: cpuTempOk
        ? `${backend.sensors.cpuTemp}${t('wizard.chkCpuOkSuffix')}`
        : t('wizard.chkCpuErr'),
      helpAnchor: '#cpu温度が----のまま',
    },
    {
      label: t('wizard.chkNotify'),
      status: notifyOk
        ? 'ok'
        : backend.notifyStatus === 'unknown'
          ? 'pending'
          : 'error',
      detail: notifyOk ? t('wizard.chkNotifyOk') : t('wizard.chkNotifyErr'),
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
  const t = useT()
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1'
  )
  if (dismissed) return null
  const checks = computeChecks(backend, t)
  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }
  return (
    <div className="wizard-backdrop" onClick={dismiss}>
      <div className="wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-head">
          <h2>{t('wizard.title')}</h2>
          <p className="muted">{t('wizard.intro')}</p>
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
                    {t('wizard.troubleshoot')} <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="wizard-tips muted">
          {t('wizard.tipsPre')}{' '}
          <a href="https://github.com/Nekunegi/TrofeoVisionStudio/blob/main/README.md"
            target="_blank" rel="noreferrer">README</a>
          {t('wizard.tipsPost')}
        </div>
        <div className="wizard-foot">
          <button className="wide" onClick={dismiss}>{t('wizard.begin')}</button>
        </div>
      </div>
    </div>
  )
}
