// Error monitoring del frontend: cattura errori globali e promise rifiutate,
// li sanifica e li registra in public.client_errors (insert-only via RLS).
// Regole: mai inviare contenuto di documenti, query di ricerca o dati
// personali; solo messaggio, stack, percorso (senza querystring), release e
// breadcrumb tecnici (route/azione), con dedupe e tetto per sessione.
import { supabase } from './supabaseClient'

type Breadcrumb = { at: string; type: 'route' | 'action'; label: string }

const MAX_BREADCRUMBS = 20
const MAX_ERRORS_PER_SESSION = 10
const DEDUPE_WINDOW_MS = 30_000

const breadcrumbs: Breadcrumb[] = []
let errorsSent = 0
let lastKey = ''
let lastSentAt = 0
let installed = false

const release = String(import.meta.env.VITE_APP_VERSION ?? 'dev').slice(0, 64)
const environment = import.meta.env.PROD ? 'production' : 'development'

/** Correlation id di sessione: lega errori frontend e chiamate Edge. */
export const sessionCorrelationId: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-0000-0000-000000000000'

function sanitize(text: string): string {
  return text
    // Email e possibili token/jwt non devono finire nei log.
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/\?[^\s'")]*/g, '') // querystring in URL dentro al messaggio
}

export function addBreadcrumb(type: Breadcrumb['type'], label: string) {
  breadcrumbs.push({ at: new Date().toISOString(), type, label: sanitize(label).slice(0, 120) })
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift()
}

async function report(eventType: 'error' | 'unhandledrejection' | 'react' | 'manual', message: string, stack?: string) {
  if (!supabase || errorsSent >= MAX_ERRORS_PER_SESSION) return
  const cleanMessage = sanitize(message).slice(0, 2000) || 'Errore sconosciuto'
  const key = `${eventType}:${cleanMessage}`
  const now = Date.now()
  if (key === lastKey && now - lastSentAt < DEDUPE_WINDOW_MS) return
  lastKey = key
  lastSentAt = now
  errorsSent += 1

  try {
    const { data } = await supabase.auth.getSession()
    await supabase.from('client_errors').insert({
      user_id: data.session?.user?.id ?? null,
      release,
      environment,
      event_type: eventType,
      message: cleanMessage,
      stack: stack ? sanitize(stack).slice(0, 8000) : null,
      url_path: typeof window !== 'undefined' ? window.location.pathname.slice(0, 300) : null,
      correlation_id: sessionCorrelationId,
      breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
    })
  } catch {
    // Il monitoraggio non deve mai rompere l'app né andare in loop.
  }
}

/** Da chiamare una volta in main.tsx, prima del render. */
export function initErrorMonitoring() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    void report('error', event.message || String(event.error ?? 'window.onerror'), event.error?.stack)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    void report('unhandledrejection', message, reason instanceof Error ? reason.stack : undefined)
  })

  // Breadcrumb di navigazione (solo pathname, mai querystring).
  window.addEventListener('popstate', () => addBreadcrumb('route', window.location.pathname))
  const originalPushState = window.history.pushState.bind(window.history)
  window.history.pushState = (...args) => {
    originalPushState(...args)
    addBreadcrumb('route', window.location.pathname)
  }
}

/** Segnalazione esplicita da catch applicativi rilevanti. */
export function reportError(error: unknown, context?: string) {
  const message = error instanceof Error ? error.message : String(error)
  void report('manual', context ? `${context}: ${message}` : message, error instanceof Error ? error.stack : undefined)
}
