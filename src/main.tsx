import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initErrorMonitoring } from './lib/monitoring'

// Cattura errori globali e promise rifiutate prima del primo render.
initErrorMonitoring()

// Service worker (solo produzione): cache prudente dei soli asset statici,
// fallback offline per le navigazioni. Nessun dato riservato in cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // La PWA è progressiva: senza SW l'app funziona comunque.
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
