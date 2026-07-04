import { useLang } from '../i18n'

export function LangToggle() {
  const [lang, setLang] = useLang()
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        type="button"
        className={lang === 'ja' ? 'on' : ''}
        onClick={() => setLang('ja')}
        aria-pressed={lang === 'ja'}
      >JA</button>
      <button
        type="button"
        className={lang === 'en' ? 'on' : ''}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
      >EN</button>
    </div>
  )
}
