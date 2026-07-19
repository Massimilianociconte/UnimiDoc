// Routing dichiarativo dell'app: percorsi, SEO per route e parsing degli URL.
// Estratto da App.tsx come primo passo del refactor incrementale (il
// comportamento e gli URL restano identici); la migrazione a react-router
// riuserà queste mappe (vedi docs/REFACTORING_PLAN.md).
import type { LegalRoute } from './legalContent'

export type Route = 'landing' | 'login' | 'signup' | 'app' | 'premium' | 'upload' | 'library' | 'dashboard' | 'settings' | 'document' | 'profile' | 'degrees' | 'degree' | LegalRoute
export type AuthMode = 'login' | 'signup'

export const routePaths: Record<Route, string> = {
  landing: '/',
  login: '/login',
  signup: '/signup',
  app: '/app',
  premium: '/premium',
  upload: '/upload',
  library: '/library',
  dashboard: '/dashboard',
  settings: '/impostazioni',
  document: '/appunti',
  profile: '/autore',
  degrees: '/corsi',
  degree: '/corsi',
  privacy: '/privacy',
  terms: '/termini',
  cookies: '/cookie',
  sales: '/condizioni-di-vendita',
  refunds: '/rimborsi',
  authors: '/condizioni-autori',
  content: '/regole-contenuti',
  ai: '/ai-e-documenti',
  copyright: '/copyright-segnalazioni',
}

export const routeSeo: Record<Route, { title: string; description: string }> = {
  landing: {
    title: 'UnimiDoc - Appunti verificati per la Statale di Milano',
    description: 'Trova appunti verificati per i corsi dell’Università degli Studi di Milano.',
  },
  login: {
    title: 'Accedi a UnimiDoc',
    description: 'Accedi alla tua libreria UnimiDoc, salva appunti e continua a studiare dai tuoi documenti.',
  },
  signup: {
    title: 'Crea account UnimiDoc',
    description: 'Crea il tuo account UnimiDoc per salvare appunti, guadagnare crediti e preparare gli esami.',
  },
  app: {
    title: 'Esplora gli appunti della Statale - UnimiDoc',
    description: 'Cerca documenti, appunti e materiali per corso di laurea, esame o docente alla Statale di Milano.',
  },
  premium: {
    title: 'Premium UnimiDoc',
    description: 'Scopri UnimiDoc Premium: anteprime complete, ricerca avanzata e download senza attese.',
  },
  upload: {
    title: 'Carica appunti - UnimiDoc',
    description: 'Carica i tuoi appunti, genera flashcard e contribuisci alla community UnimiDoc.',
  },
  library: {
    title: 'La tua libreria - UnimiDoc',
    description: 'Ritrova documenti salvati, crediti e materiali recenti nella tua libreria UnimiDoc.',
  },
  dashboard: {
    title: 'Dashboard personale - UnimiDoc',
    description: 'Gestisci profilo, crediti, documenti, flashcard, quiz e progressi nella dashboard UnimiDoc.',
  },
  settings: {
    title: 'Impostazioni account - UnimiDoc',
    description: 'Gestisci profilo, notifiche, crediti e preferenze del tuo account UnimiDoc.',
  },
  // Fallback: le schede documento reali sovrascrivono titolo e descrizione
  // con i metadati specifici del file (vedi effetto SEO in App).
  document: {
    title: 'Appunti verificati - UnimiDoc',
    description: 'Scheda documento con anteprima, valutazioni e dettagli per gli esami della Statale di Milano.',
  },
  profile: {
    title: 'Profilo autore - UnimiDoc',
    description: 'Profilo pubblico di un autore UnimiDoc: materiali, valutazioni, vendite e affidabilità alla Statale di Milano.',
  },
  degrees: {
    title: 'Corsi di laurea triennale e a ciclo unico della Statale di Milano - UnimiDoc',
    description:
      'Tutti i corsi di laurea triennale e magistrale a ciclo unico dell’Università degli Studi di Milano su UnimiDoc: trova o carica appunti per il tuo corso, da Medicina e Giurisprudenza alla biologia, all’informatica e alle professioni sanitarie.',
  },
  degree: {
    title: 'Appunti per corso di laurea - UnimiDoc',
    description: 'Appunti, dispense ed esercizi per i corsi di laurea triennale e magistrale a ciclo unico della Statale di Milano.',
  },
  privacy: {
    title: 'Informativa privacy - UnimiDoc',
    description: 'Come UnimiDoc tratta dati account, materiali, studio e transazioni.',
  },
  terms: {
    title: 'Termini di utilizzo - UnimiDoc',
    description: 'Regole del servizio, account, contenuti e strumenti di studio UnimiDoc.',
  },
  cookies: {
    title: 'Cookie e tecnologie locali - UnimiDoc',
    description: 'Tecnologie necessarie, preferenze e criteri per eventuali strumenti facoltativi.',
  },
  sales: {
    title: 'Condizioni di acquisto e crediti - UnimiDoc',
    description: 'Prezzi, ricariche, Premium e regole di utilizzo dei crediti interni.',
  },
  refunds: {
    title: 'Rimborsi e recesso - UnimiDoc',
    description: 'Diritto di recesso, eccezioni per contenuti digitali e procedura di rimborso.',
  },
  authors: {
    title: 'Condizioni per autori e venditori - UnimiDoc',
    description: 'Regole per chi carica e vende materiali: responsabilità, ricavi, payout.',
  },
  content: {
    title: 'Regole sui contenuti - UnimiDoc',
    description: 'Contenuti ammessi e vietati, moderazione e conseguenze delle violazioni.',
  },
  ai: {
    title: 'AI e trattamento dei documenti - UnimiDoc',
    description: 'Come OCR, embedding, RAG e modelli AI elaborano i materiali caricati.',
  },
  copyright: {
    title: 'Copyright e segnalazioni - UnimiDoc',
    description: 'Come segnalare contenuti che violano diritti o contengono dati non autorizzati.',
  },
}

export function routeFromPathname(pathname: string): Route {
  if (pathname === '/login') return 'login'
  if (pathname === '/signup') return 'signup'
  if (pathname === '/app' || pathname === '/esplora' || pathname === '/appunti') return 'app'
  if (pathname === '/premium' || pathname === '/pricing') return 'premium'
  if (pathname === '/upload' || pathname === '/carica') return 'upload'
  if (pathname === '/dashboard' || pathname === '/area-riservata') return 'dashboard'
  if (pathname === '/library' || pathname === '/libreria') return 'library'
  if (pathname === '/impostazioni' || pathname === '/settings') return 'settings'
  if (pathname === '/privacy' || pathname === '/privacy-policy') return 'privacy'
  if (pathname === '/termini' || pathname === '/terms') return 'terms'
  if (pathname === '/cookie' || pathname === '/cookie-policy') return 'cookies'
  if (pathname === '/condizioni-di-vendita') return 'sales'
  if (pathname === '/rimborsi' || pathname === '/recesso') return 'refunds'
  if (pathname === '/condizioni-autori' || pathname === '/venditori') return 'authors'
  if (pathname === '/regole-contenuti') return 'content'
  if (pathname === '/ai-e-documenti' || pathname === '/ai') return 'ai'
  if (pathname === '/copyright-segnalazioni' || pathname === '/segnalazioni') return 'copyright'
  if (pathname.startsWith('/appunti/')) return 'document'
  if (pathname.startsWith('/autore/')) return 'profile'
  if (pathname === '/corsi' || pathname === '/corsi-di-laurea') return 'degrees'
  if (pathname.startsWith('/corsi/')) return 'degree'
  return 'landing'
}

export function authModeFromRoute(route: Route): AuthMode {
  return route === 'signup' ? 'signup' : 'login'
}

export function isLegalRoute(route: Route): route is LegalRoute {
  return (
    route === 'privacy' ||
    route === 'terms' ||
    route === 'cookies' ||
    route === 'sales' ||
    route === 'refunds' ||
    route === 'authors' ||
    route === 'content' ||
    route === 'ai' ||
    route === 'copyright'
  )
}

/**
 * Safe relative path to resume after login/signup.
 * Preserves deep links (`/appunti/...`, `/corsi/...`, `/autore/...`) instead of
 * collapsing them to bare list prefixes via routePaths.
 */
export function nextPathAfterAuth(): string {
  if (typeof window === 'undefined') return routePaths.dashboard
  const raw = new URLSearchParams(window.location.search).get('next')
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    return routePaths.dashboard
  }
  const nextRoute = routeFromPathname(raw)
  if (nextRoute === 'login' || nextRoute === 'signup') return routePaths.dashboard
  return raw
}

export function nextRouteAfterAuth(): Route {
  return routeFromPathname(nextPathAfterAuth())
}
