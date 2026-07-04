// FIRST import: patches requestAnimationFrame before Konva binds it (hidden
// windows throttle rAF to ~1fps — the resident tray app must keep animating).
import './rafShim'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Editor UI font
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
// LCD widget fonts (drawn on canvas — App preloads them via document.fonts.load,
// since canvas text alone never triggers @font-face downloads)
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/600.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
