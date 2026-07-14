import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../theme'
import { useT } from '../i18n'

export function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const t = useT()
  const dark = theme === 'dark'
  const label = dark ? t('header.themeLight') : t('header.themeDark')
  return (
    <button
      type="button"
      className="iconbtn"
      title={label}
      aria-label={label}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
