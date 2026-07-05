import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Self-hosted fonts (no CDN — offline + privacy-safe): Space Grotesk for UI
// chrome, Space Mono for the numeric readouts (ids, dB, meters).
import '@fontsource-variable/space-grotesk/index.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('mbus: #root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker for offline use — production builds only.
// Best-effort: a failure must never break the app. In dev the SW must not run
// (cache-first pins stale modules, and localhost origins are shared across
// projects); also unregister any previously installed worker so a dev profile
// heals itself on the next load.
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) void reg.unregister()
      })
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
    })
  }
}
