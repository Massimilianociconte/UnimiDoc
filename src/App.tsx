import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bookmark,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clipboard,
  Crown,
  FileArchive,
  FileDown,
  FileText,
  Download,
  Eye,
  Filter,
  GraduationCap,
  Highlighter,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  PanelRight,
  PencilLine,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Clock,
  MessagesSquare,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Zap,
  Upload,
  User,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import creditToken from './assets/generated/credit-token.webp'
import creditsAccumulate from './assets/generated/credits-accumulate.webp'
import creditsCommunity from './assets/generated/credits-community.webp'
import creditsEarn from './assets/generated/credits-earn.webp'
import creditsUnlock from './assets/generated/credits-unlock.webp'
import demoDocumentImage from './assets/generated/demo-document.png'
import demoPage01 from './assets/generated/demo-page-01.webp'
import demoPage02 from './assets/generated/demo-page-02.webp'
import demoPage03 from './assets/generated/demo-page-03.webp'
import demoPage04 from './assets/generated/demo-page-04.webp'
import heroDocuments from './assets/generated/hero-documents.png'
import libraryNotes from './assets/generated/library-notes.png'
import loginStudy from './assets/generated/login-study.png'
import logoMark from './assets/generated/logo-mark.png'
import premiumStack from './assets/generated/premium-stack.png'
import uploadBackpack from './assets/generated/upload-backpack.png'
import {
  allL13Professors,
  featuredCourses,
  findCourse,
  formatCourseMeta,
  getCourseLines,
  getCourseProfessors,
  landingCourses,
  searchableCourses,
  type CourseInfo,
  type CourseLine,
} from './courseCatalog'
import { documentTypes, initialDocuments, professors, subjects, type DocumentItem } from './data'
import { DEFAULT_FREE_FLASHCARD_LIMIT, DEFAULT_PREMIUM_FLASHCARD_LIMIT } from './lib/flashcardConfig'
import {
  getSupabaseAccessToken,
  getSupabaseSessionUser,
  getUserCreditBalance,
  isSupabaseConfigured,
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutSupabase,
  signUpWithEmail,
  subscribeSupabaseAuth,
  type AppAuthUser,
} from './lib/supabaseClient'
import type {
  CompressionResult,
  DocSentence,
  DocumentHeading,
  DocumentInsights,
  Flashcard,
  PdfAnalysis,
} from './lib/pdfProcessing'
import { calculateNextReview, evaluateTextAnswer, type AnswerStatus, type SrsRating, type SrsState } from './lib/studyEngine'
import { getPremiumState, refreshPremiumState, setPremiumState } from './lib/entitlements'
import {
  autoDetectOcclusion,
  generatePremiumFlashcards as generateBackendPremiumFlashcards,
  requestAiHelp,
  setAccessTokenProvider,
  type AiHelpMode,
  type PremiumGeneratedFlashcard,
} from './lib/aiClient'
import { buildUserDashboardData, loadDashboardLiveOverlay, type DashboardLiveOverlay } from './userDashboardData'
import { creditsToEur, creditTier, documentCreditPrice, revenueSplit, tierLabel, TOPUP_PACKS, WELCOME_CREDITS } from './lib/creditPricing'
import { moderatePublicText } from './lib/contentModeration'
import {
  addEarnedCredits,
  balanceOf,
  ensureWallet,
  formatTimestamp,
  formatTransactionRef,
  loadWalletState,
  purchaseWithWallet,
  type PurchasedItem,
  type WalletState,
} from './lib/creditsWallet'
import {
  breadcrumbJsonLd,
  documentCourseMeta,
  documentJsonLd,
  documentMatchesQuery,
  documentPath,
  documentSeoDescription,
  documentSeoTitle,
  findDocumentByPath,
  setJsonLd,
  setMetaTag,
  slugify,
  uploaderRankJsonLd,
} from './lib/seo'
import {
  loadNotificationPrefs,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  saveNotificationPrefs,
  type NotificationChannel,
  type NotificationPrefs,
} from './lib/notificationPrefs'

type Route = 'landing' | 'login' | 'signup' | 'app' | 'premium' | 'upload' | 'library' | 'dashboard' | 'settings' | 'document' | 'profile'
type AuthMode = 'login' | 'signup'
type AuthProvider = 'email' | 'google'

type AuthFormValues = {
  email: string
  password: string
  fullName: string
  remember: boolean
  provider: AuthProvider
}

// Premium AI Edge Functions authenticate with the live Supabase JWT.
setAccessTokenProvider(getSupabaseAccessToken)

const appDocuments = initialDocuments.filter((document) => document.status === 'approved')

const featuredCourseCards = featuredCourses
  .map((courseName) => findCourse(courseName))
  .filter((course): course is CourseInfo => Boolean(course))

const courseStats = landingCourses.map((course, index) => ({
  ...course,
  count: `${1840 - index * 47} appunti`,
}))

const featuredFilterSubjects = featuredCourseCards.map((course) => course.name)
const orderedFilterSubjects = [
  ...featuredFilterSubjects,
  ...subjects.filter((subject) => !featuredFilterSubjects.includes(subject)),
]

const rotatingSearchCourses = searchableCourses.map((course) => course.shortName)

const searchSuggestions = Array.from(
  new Set([
    ...searchableCourses.flatMap((course) => [course.name, course.shortName, ...(course.aliases ?? [])]),
    ...allL13Professors,
  ]),
)

const creditFlowSteps = [
  {
    title: 'Guadagni',
    text: 'Carichi appunti tuoi o rielaborati bene: se superano la revisione, entrano nel catalogo.',
    image: creditsEarn,
  },
  {
    title: 'Accumuli',
    text: 'Ogni download utile ti porta crediti. Piu il materiale aiuta davvero, piu valore torna a te.',
    image: creditsAccumulate,
  },
  {
    title: 'Scarichi',
    text: 'Usi i crediti per sbloccare documenti mirati, con anteprima protetta prima della scelta.',
    image: creditsUnlock,
  },
  {
    title: 'Cresci',
    text: 'La community premia contributi affidabili e rende piu semplice preparare ogni esame.',
    image: creditsCommunity,
  },
]

const premiumBenefits = [
  'Anteprime complete prima di scaricare',
  'Filtri avanzati per docente, anno e tipo d’esame',
  'Download senza attese quando hai poco tempo',
  'Una libreria ordinata dei materiali migliori',
]

const routePaths: Record<Route, string> = {
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
}

const routeSeo: Record<Route, { title: string; description: string }> = {
  landing: {
    title: 'UnimiDoc - Appunti verificati per Scienze Biologiche UniMi',
    description: 'Trova appunti verificati per Scienze Biologiche L-13 alla Statale di Milano.',
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
    title: 'Esplora appunti L-13 - UnimiDoc',
    description: 'Cerca documenti, appunti, anteprime e materiali per gli esami di Scienze Biologiche L-13.',
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
    description: 'Scheda documento con anteprima, valutazioni e dettagli per gli esami di Scienze Biologiche L-13.',
  },
  profile: {
    title: 'Profilo autore - UnimiDoc',
    description: 'Profilo pubblico di un autore UnimiDoc: materiali, valutazioni, vendite e affidabilità per Scienze Biologiche L-13.',
  },
}

const demoDocument = {
  title: 'Citologia e istologia - Demo interattiva',
  subject: 'Citologia e istologia',
  professor: 'Documento dimostrativo',
  pages: 24,
  credits: 0,
}

const demoPageImages = [
  {
    src: demoPage01,
    alt: 'Pagina demo di appunti su membrana cellulare e organelli',
  },
  {
    src: demoPage02,
    alt: 'Pagina demo di appunti su ciclo cellulare e mitosi',
  },
  {
    src: demoPage03,
    alt: 'Pagina demo di appunti su istologia ed epiteli',
  },
  {
    src: demoPage04,
    alt: 'Pagina demo protetta su trascrizione del DNA',
  },
]

function routeFromPathname(pathname: string): Route {
  if (pathname === '/login') return 'login'
  if (pathname === '/signup') return 'signup'
  if (pathname === '/app' || pathname === '/esplora') return 'app'
  if (pathname === '/premium' || pathname === '/pricing') return 'premium'
  if (pathname === '/upload' || pathname === '/carica') return 'upload'
  if (pathname === '/dashboard' || pathname === '/area-riservata') return 'dashboard'
  if (pathname === '/library' || pathname === '/libreria') return 'library'
  if (pathname === '/impostazioni' || pathname === '/settings') return 'settings'
  if (pathname.startsWith('/appunti/')) return 'document'
  if (pathname.startsWith('/autore/')) return 'profile'
  return 'landing'
}

function authModeFromRoute(route: Route): AuthMode {
  return route === 'signup' ? 'signup' : 'login'
}

function subjectFromSearch() {
  if (typeof window === 'undefined') return 'Tutti'
  const value = new URLSearchParams(window.location.search).get('materia')
  return value ? (findCourse(value)?.name ?? 'Tutti') : 'Tutti'
}

function queryFromSearch() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('q')?.trim() ?? ''
}

const DEMO_AUTH_STORAGE_KEY = 'unimidoc:auth-demo-user:v1'

function loadStoredDemoUser(): AppAuthUser | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(DEMO_AUTH_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AppAuthUser) : null
  } catch {
    return null
  }
}

function storeDemoUser(user: AppAuthUser | null, remember = true) {
  if (typeof window === 'undefined') return

  if (!user || !remember) {
    window.localStorage.removeItem(DEMO_AUTH_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(user))
}

function makeDemoAuthUser(values: AuthFormValues): AppAuthUser {
  const email = values.email.trim().toLowerCase() || 'giulia.demo@unimidoc.local'
  const fallbackName = email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Giulia'
  const name = values.fullName.trim() || fallbackName.replace(/\b\w/g, (letter) => letter.toUpperCase())

  return {
    id: `demo-${hashString(email).toString(36)}`,
    email,
    name,
    isDemo: true,
  }
}

function nextRouteAfterAuth() {
  if (typeof window === 'undefined') return 'dashboard' as Route
  const nextPath = new URLSearchParams(window.location.search).get('next')
  if (!nextPath) return 'dashboard' as Route

  const nextRoute = routeFromPathname(nextPath)
  return nextRoute === 'login' || nextRoute === 'signup' || nextRoute === 'landing' ? 'dashboard' : nextRoute
}

function useRotatingCourseName() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setIndex((currentIndex) => (currentIndex + 1) % rotatingSearchCourses.length)
    }, 2400)

    return () => window.clearInterval(interval)
  }, [])

  return rotatingSearchCourses[index] ?? 'Genetica'
}

function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined

    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
    }
  }, [active])
}

function LogoMark() {
  return (
    <span className="brand-icon" aria-hidden="true">
      <img src={logoMark} alt="" />
    </span>
  )
}

function SubjectIcon({ name, compact = false }: { name: string; compact?: boolean }) {
  const course = findCourse(name)

  if (!course?.icon) {
    return (
      <span className={`subject-icon fallback ${compact ? 'compact' : ''}`} aria-hidden="true">
        <Sparkles size={compact ? 14 : 18} />
      </span>
    )
  }

  return (
    <span className={`subject-icon ${compact ? 'compact' : ''}`} aria-hidden="true">
      <img src={course.icon} alt="" />
    </span>
  )
}

function CreditIcon({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return <img className={`credit-token ${size}`} src={creditToken} alt="" aria-hidden="true" draggable={false} />
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <button className={`brand-button ${compact ? 'compact' : ''}`} onClick={() => window.dispatchEvent(new CustomEvent('go-home'))} type="button">
      <LogoMark />
      <span>UnimiDoc</span>
    </button>
  )
}

function HeaderSearch({ onSearch }: { onSearch: (query: string) => void }) {
  const [value, setValue] = useState('')
  const rotatingCourse = useRotatingCourseName()

  return (
    <form
      className="header-search-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim()) onSearch(value.trim())
      }}
    >
      <label className={`header-search dynamic-search ${value ? 'has-value' : ''}`}>
        <Search size={18} />
        <input
          aria-label="Cerca esami, appunti o professori"
          list="global-search-suggestions"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <datalist id="global-search-suggestions">
          {searchSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <span className="search-placeholder header-placeholder" aria-hidden="true">
          Cerca appunti per <strong key={rotatingCourse}>{rotatingCourse}</strong>
        </span>
      </label>
    </form>
  )
}

function Header({
  route,
  isLoggedIn,
  credits,
  user,
  onRoute,
  onAuth,
  onSearch,
  onSignOut,
}: {
  route: Route
  isLoggedIn: boolean
  credits: number
  user: AppAuthUser | null
  onRoute: (route: Route, options?: { hash?: string }) => void
  onAuth: (mode: AuthMode) => void
  onSearch: (query: string) => void
  onSignOut: () => void
}) {
  const appArea =
    route === 'app' || route === 'premium' || route === 'upload' || route === 'library' || route === 'dashboard' || route === 'settings'
  const firstName = user?.name.split(' ')[0] || 'Giulia'
  const initials = user?.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'G'

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const goFromMenu = (nextRoute: Route, hash?: string) => {
    setMenuOpen(false)
    onRoute(nextRoute, hash ? { hash } : undefined)
  }

  return (
    <header className={`site-header ${appArea ? 'app-header' : ''}`}>
      <div className="header-inner">
        <button className="brand-button" onClick={() => onRoute('landing')} type="button">
          <LogoMark />
          <span>UnimiDoc</span>
        </button>

        {appArea ? (
          <HeaderSearch onSearch={onSearch} />
        ) : null}

        <nav className="main-nav" aria-label="Navigazione">
          <button className={route === 'app' ? 'active' : ''} onClick={() => onRoute('app')} type="button">
            Esplora
          </button>
          <button className={route === 'premium' ? 'active premium-link' : 'premium-link'} onClick={() => onRoute('premium')} type="button">
            <Crown size={15} />
            Premium
          </button>
          <button className={route === 'upload' ? 'active' : ''} onClick={() => onRoute('upload')} type="button">
            Carica appunti
          </button>
        </nav>

        <div className="header-actions">
          {appArea && isLoggedIn ? (
            <button className="credits-chip" onClick={() => onRoute('dashboard', { hash: 'crediti' })} type="button">
              <CreditIcon size="sm" />
              {credits}<span className="credits-chip-label"> crediti</span>
            </button>
          ) : null}
          {isLoggedIn ? (
            <>
              {appArea ? (
                <button className="icon-button" aria-label="Notifiche" onClick={() => onRoute('dashboard', { hash: 'notifiche' })} type="button">
                  <Bell size={18} />
                </button>
              ) : null}
              <div className={`user-menu ${menuOpen ? 'open' : ''}`} ref={menuRef}>
                <button
                  className="user-button"
                  onClick={() => setMenuOpen((open) => !open)}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <span>{initials}</span>
                  <small>Ciao, {firstName}</small>
                  <ChevronDown size={15} className="user-button-chevron" />
                </button>
                {menuOpen ? (
                  <div className="user-dropdown" role="menu">
                    <div className="user-dropdown-head">
                      <span className="user-dropdown-avatar">{initials}</span>
                      <div className="user-dropdown-id">
                        <strong>{user?.name ?? 'Studente'}</strong>
                        <small>{user?.email}</small>
                      </div>
                    </div>
                    <button className="user-dropdown-credits" onClick={() => goFromMenu('dashboard', 'crediti')} type="button">
                      <span><Wallet size={15} /> Crediti disponibili</span>
                      <strong>{credits}</strong>
                    </button>
                    <nav className="user-dropdown-items" aria-label="Menu account">
                      <button role="menuitem" onClick={() => goFromMenu('dashboard', 'profilo')} type="button">
                        <User size={16} /> Profilo
                      </button>
                      <button role="menuitem" onClick={() => goFromMenu('dashboard')} type="button">
                        <GraduationCap size={16} /> La mia dashboard
                      </button>
                      <button role="menuitem" onClick={() => goFromMenu('dashboard', 'crediti')} type="button">
                        <Wallet size={16} /> Crediti e acquisti
                      </button>
                      <button role="menuitem" onClick={() => goFromMenu('library')} type="button">
                        <FileText size={16} /> Libreria personale
                      </button>
                      <button role="menuitem" onClick={() => goFromMenu('settings', 'notifiche')} type="button">
                        <Bell size={16} /> Notifiche
                      </button>
                      <button role="menuitem" onClick={() => goFromMenu('settings')} type="button">
                        <Settings size={16} /> Impostazioni
                      </button>
                    </nav>
                    <button
                      className="user-dropdown-logout"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        onSignOut()
                      }}
                      type="button"
                    >
                      <LogOut size={16} /> Esci
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <button className="plain-action" onClick={() => onAuth('login')} type="button">
                Accedi
              </button>
              <button className="primary-action" onClick={() => onAuth('signup')} type="button">
                Inizia gratis
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

function SearchBox({
  compact = false,
  value,
  onChange,
  onSearch,
}: {
  compact?: boolean
  value?: string
  onChange?: (value: string) => void
  onSearch?: (value: string) => void
}) {
  const [internalValue, setInternalValue] = useState('')
  const rotatingCourse = useRotatingCourseName()
  const currentValue = value ?? internalValue
  const updateValue = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue)
    }
    onChange?.(nextValue)
  }

  return (
    <form
      className={`exam-search dynamic-search ${compact ? 'compact' : ''} ${currentValue ? 'has-value' : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        onSearch?.(currentValue)
      }}
    >
      <Search size={22} />
      <input
        aria-label="Che esame stai preparando"
        list="exam-search-suggestions"
        value={currentValue}
        onChange={(event) => updateValue(event.target.value)}
      />
      <datalist id="exam-search-suggestions">
        {searchSuggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <span className="search-placeholder" aria-hidden="true">
        <span className="desktop-prefix">Che esame stai preparando, </span>
        <span className="mobile-prefix">Prepari </span>
        <strong key={rotatingCourse}>{rotatingCourse}?</strong>
      </span>
      <button type="submit">Cerca</button>
    </form>
  )
}

function DemoPageViewer({ compact = false }: { compact?: boolean }) {
  const pages = compact ? demoPageImages.slice(0, 2) : demoPageImages
  const freePageLimit = compact ? 1 : 3

  return (
    <div className={`demo-page-viewer ${compact ? 'compact' : ''}`}>
      {pages.map((page, index) => {
        const locked = index >= freePageLimit
        const pageNumber = index + 1

        return (
          <figure className={`demo-pdf-page ${locked ? 'locked' : ''}`} key={page.src}>
            <img
              src={page.src}
              alt={locked ? '' : page.alt}
              draggable={false}
              loading={pageNumber === 1 ? 'eager' : 'lazy'}
            />
            <figcaption>Pagina {pageNumber}</figcaption>
            {locked ? (
              <div className="demo-page-lock">
                <div>
                  <Lock size={22} />
                  <strong>Il documento continua</strong>
                  <span>Sblocca le pagine successive per leggere il resto.</span>
                </div>
              </div>
            ) : null}
          </figure>
        )
      })}
      {!compact ? (
        <div className="demo-continuation-note">
          <Lock size={18} />
          <span>Le pagine successive sono simulate come contenuto protetto.</span>
        </div>
      ) : null}
    </div>
  )
}

function DemoDocumentCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="demo-document-card" onClick={onOpen} type="button">
      <img src={demoDocumentImage} alt="Documento demo di biologia con appunti e diagrammi" />
      <div className="demo-card-body">
        <span className="type-pill"><Eye size={14} /> Demo anteprima</span>
        <h3>{demoDocument.title}</h3>
        <p>Un documento fittizio per provare ricerca, anteprima gratuita e contenuto bloccato.</p>
        <DemoPageViewer compact />
      </div>
      <div className="demo-card-lock">
        <Lock size={17} />
        Parte protetta
      </div>
    </button>
  )
}

function DemoDocumentModal({ onClose, onPremium }: { onClose: () => void; onPremium: () => void }) {
  useBodyScrollLock()

  return (
    <div
      className="preview-modal demo-modal"
      onContextMenu={(event) => event.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label="Documento demo UnimiDoc"
    >
      <button className="preview-backdrop" onClick={onClose} type="button" aria-label="Chiudi demo" />
      <section className="preview-panel demo-preview-panel">
        <div className="preview-heading">
          <div>
            <span className="preview-kicker"><Eye size={15} /> Demo consultazione</span>
            <h2>{demoDocument.title}</h2>
            <p>{demoDocument.subject} · {demoDocument.pages} pagine · documento fittizio</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>
        <div className="demo-modal-layout">
          <div className="demo-document-scroll">
            <DemoPageViewer />
          </div>
          <aside className="demo-modal-aside">
            <img src={demoDocumentImage} alt="" />
            <h3>Prova come funziona l’anteprima</h3>
            <p>Leggi la parte gratuita, poi il contenuto si sfuma e resta protetto fino allo sblocco.</p>
            <button className="premium-button" onClick={onPremium} type="button">
              <Crown size={17} />
              Scopri Premium
            </button>
          </aside>
        </div>
      </section>
    </div>
  )
}

function LandingPage({
  onRoute,
  onAuth,
  onExploreSubject,
  onOpenDemo,
}: {
  onRoute: (route: Route) => void
  onAuth: (mode: AuthMode) => void
  onExploreSubject: (value: string) => void
  onOpenDemo: () => void
}) {
  const [heroQuery, setHeroQuery] = useState('')
  const [selectedCourse, setSelectedCourse] = useState('')

  return (
    <main className="landing">
      <section className="landing-hero section-wrap">
        <div className="hero-copy">
          <h1>Trova gli appunti giusti prima dell’esame</h1>
          <p>
            Appunti verificati da studenti come te. Cerca per esame, docente o corso e risparmia ore tra PDF
            disordinati.
          </p>
          <SearchBox
            value={heroQuery}
            onChange={(nextValue) => {
              setHeroQuery(nextValue)
              setSelectedCourse('')
            }}
            onSearch={(value) => onExploreSubject(selectedCourse || value)}
          />
          <div className="quick-chips" aria-label="Ricerche rapide">
            {featuredCourseCards.map((course) => (
              <button
                aria-pressed={selectedCourse === course.name}
                className={selectedCourse === course.name ? 'selected' : ''}
                key={course.name}
                onClick={() => {
                  setSelectedCourse(course.name)
                  setHeroQuery(course.shortName)
                }}
                type="button"
              >
                <SubjectIcon compact name={course.name} />
                {course.shortName}
              </button>
            ))}
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={18} /> Verificati dagli studenti</span>
            <span><User size={18} /> Oltre 12.000 studenti</span>
            <span><Lock size={18} /> Sicuro e indipendente</span>
          </div>
        </div>
        <div className="hero-visual">
          <img src={heroDocuments} alt="Anteprime di appunti di biologia verificati" />
        </div>
      </section>

      <section className="login-strip section-wrap" aria-label="Accesso rapido">
        <div>
          <h2>Accedi ai tuoi appunti ovunque sei</h2>
          <p>Salva, organizza e riprendi da dove hai lasciato. Anche cinque minuti prima di lezione.</p>
        </div>
        <div>
          <button className="secondary-action" onClick={() => onAuth('login')} type="button">
            Accedi
          </button>
          <button className="primary-action" onClick={() => onAuth('signup')} type="button">
            Inizia gratis
            <ArrowRight size={17} />
          </button>
        </div>
      </section>

      <section className="onboarding-section section-wrap" aria-labelledby="onboarding-title">
        <div className="section-title onboarding-title">
          <div>
            <h2 id="onboarding-title">Come funziona, in pratica</h2>
            <p>Cerca l’esame, apri un’anteprima reale e sblocca solo ciò che ti serve davvero.</p>
          </div>
          <button onClick={onOpenDemo} type="button">Prova la demo</button>
        </div>
        <div className="onboarding-layout">
          <div className="onboarding-steps">
            {[
              ['Cerca', 'Parti da materia, docente o argomento senza perdere tempo tra cartelle e file sparsi.'],
              ['Sfoglia', 'Guarda una parte del documento prima di spendere crediti o attivare Premium.'],
              ['Studia', 'Salva il materiale giusto e ritrovalo nella tua libreria quando ti serve.'],
            ].map(([title, text], index) => (
              <article key={title}>
                <span>{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>
          <DemoDocumentCard onOpen={onOpenDemo} />
        </div>
      </section>

      <section className="section-wrap">
        <div className="section-title">
          <h2>Materie L-13 alla Statale</h2>
          <button onClick={() => onRoute('app')} type="button">Apri la piattaforma</button>
        </div>
        <div className="exam-grid">
          {courseStats.map((course) => (
            <button className="exam-card" key={course.name} onClick={() => onExploreSubject(course.name)} type="button">
              <SubjectIcon name={course.name} />
              <strong>{course.shortName}</strong>
              <small>{course.year} · {course.count}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="difference-band section-wrap">
        <h2>Perché qui è diverso</h2>
        <div className="difference-grid">
          <article>
            <ShieldCheck size={34} />
            <h3>Niente più caos</h3>
            <p>Basta PDF sparsi e versioni vecchie. Qui trovi solo materiali ordinati e aggiornati.</p>
          </article>
          <article>
            <Star size={34} />
            <h3>Verificati dagli studenti</h3>
            <p>Ogni appunto è valutato e commentato da chi lo ha già usato davvero.</p>
          </article>
          <article>
            <Search size={34} />
            <h3>Trovi subito ciò che serve</h3>
            <p>Cerca per esame, docente o argomento e vai dritto al punto.</p>
          </article>
        </div>
      </section>

      <section className="credits-flow section-wrap">
        <h2>Come funzionano i crediti</h2>
        <p className="credits-flow-lead">
          I crediti non sono una moneta finta appiccicata sopra al sito: sono il modo con cui chi contribuisce bene
          ottiene accesso piu rapido ai materiali che gli servono.
        </p>
        <div className="flow-grid">
          {creditFlowSteps.map((step, index) => (
            <article key={step.title}>
              <img src={step.image} alt="" loading="lazy" />
              <span>{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="premium-section section-wrap">
        <div>
          <h2>Premium: studia senza limiti</h2>
          <p>
            Quando l’esame si avvicina, non vuoi perdere tempo a capire quale file vale la pena aprire.
            Premium ti porta prima ai materiali migliori.
          </p>
          <button className="premium-button" onClick={() => onRoute('premium')} type="button">
            <Crown size={18} />
            Scopri Premium
          </button>
          <small>Disdici quando vuoi. Nessun vincolo.</small>
        </div>
        <div className="premium-card">
          <img src={premiumStack} alt="Illustrazione premium UnimiDoc" />
          <ul>
            {premiumBenefits.map((benefit) => (
              <li key={benefit}><Check size={17} /> {benefit}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="contributor-cta section-wrap">
        <img src={uploadBackpack} alt="Carica appunti e guadagna crediti" />
        <div>
          <h2>I tuoi appunti possono aiutare migliaia di studenti</h2>
          <p>Carica materiali tuoi, guadagna crediti e lascia il segno nella community.</p>
          <button className="primary-action" onClick={() => onRoute('upload')} type="button">
            <Upload size={18} />
            Carica i tuoi appunti
          </button>
        </div>
      </section>

      <section className="final-cta section-wrap">
        <div>
          <h2>Pronto a studiare meglio?</h2>
          <p>Unisciti a studenti che hanno già semplificato il loro studio.</p>
        </div>
        <div>
          <button className="secondary-action" onClick={() => onAuth('login')} type="button">Accedi</button>
          <button className="primary-action" onClick={() => onAuth('signup')} type="button">Inizia gratis</button>
        </div>
      </section>

      <footer className="site-footer section-wrap">
        <Brand compact />
        <nav>
          <button onClick={() => onRoute('app')} type="button">Esplora</button>
          <button onClick={() => onRoute('premium')} type="button">Premium</button>
          <button onClick={() => onRoute('upload')} type="button">Carica appunti</button>
          <button onClick={() => onAuth('login')} type="button">Accedi</button>
        </nav>
        <p>UnimiDoc è un progetto indipendente e non è affiliato con l’Università degli Studi di Milano.</p>
      </footer>
    </main>
  )
}

function DocumentCard({
  document,
  onDownload,
  onPreview,
  onOpenPage,
}: {
  document: DocumentItem
  onDownload: (document: DocumentItem) => void
  onPreview?: (document: DocumentItem) => void
  onOpenPage?: (document: DocumentItem) => void
}) {
  const course = findCourse(document.subject)
  const shortTitle = document.title.replace(' - Appunti completi', '').replace(' generale - Domande frequenti', '')

  return (
    <article className="note-card">
      <div>
        <span className="type-pill"><SubjectIcon compact name={document.subject} />{document.type}</span>
        <Bookmark size={19} />
      </div>
      <h3>
        {onOpenPage ? (
          // Anchor reale: i crawler scoprono gli URL delle schede documento da qui.
          <a href={documentPath(document)} onClick={(event) => { event.preventDefault(); onOpenPage(document) }}>
            {shortTitle}
          </a>
        ) : (
          shortTitle
        )}
      </h3>
      <p>{document.professor} · {document.academicYear}</p>
      <div className={`mini-preview ${document.previewKind}`}>
        <i />
        <i />
        <i />
      </div>
      <div className="note-tags">
        <span><SubjectIcon compact name={document.subject} />{course?.shortName ?? document.subject}</span>
        <span>{document.pages} pagine</span>
      </div>
      <div className="note-meta">
        <span><Star size={15} /> {document.quality.toFixed(1)} ({document.downloads})</span>
        <strong><CreditIcon size="xs" /> {documentCreditPrice(document)} crediti</strong>
      </div>
      <div className="note-actions">
        <button className="secondary-action" onClick={() => onPreview?.(document)} type="button"><Eye size={16} /> Anteprima</button>
        <button className="download-button" onClick={() => onDownload(document)} type="button">
          <Download size={16} />
          Scarica
        </button>
      </div>
    </article>
  )
}

// Classifica autori: parametri pubblici (download, qualità media, affidabilità)
// così chi carica materiale migliore guadagna visibilità e vendite.
type UploaderRankEntry = {
  name: string
  documents: number
  downloads: number
  quality: number
  trust: number
  rating: number
  reviews: number
  reports: number
  score: number
}

// Ranking multi-fattore: premia qualità, vendite, valutazioni, affidabilità e
// costanza — non il semplice numero di documenti. I documenti oltre i primi
// pesano meno (rendimento decrescente) così spammare upload non scala il punteggio.
function buildUploaderRanking(documents: DocumentItem[]): UploaderRankEntry[] {
  const byUploader = new Map<string, DocumentItem[]>()
  for (const document of documents) {
    const list = byUploader.get(document.uploader) ?? []
    list.push(document)
    byUploader.set(document.uploader, list)
  }

  return Array.from(byUploader.entries())
    .map(([name, docs]) => {
      const downloads = docs.reduce((total, doc) => total + doc.downloads, 0)
      const quality = docs.reduce((total, doc) => total + doc.quality, 0) / docs.length
      const trust = docs.reduce((total, doc) => total + doc.uploaderTrust, 0) / docs.length
      const reports = docs.reduce((total, doc) => total + doc.reportCount, 0)
      // Valutazione media 1–5 derivata dalla qualità (0–10); recensioni stimate
      // come frazione dei download (proxy finché non c'è un sistema reale).
      const rating = Math.round((quality / 2) * 10) / 10
      const reviews = Math.round(downloads * 0.18)
      const consistency = Math.min(docs.length, 6) // rendimento decrescente
      const reliability = trust - reports * 4 // le segnalazioni erodono l'affidabilità
      const score = Math.round(
        Math.sqrt(downloads) * 6 + // vendite (sub-lineare)
          quality * 8 + // qualità media
          rating * 10 + // valutazioni
          reliability + // affidabilità
          consistency * 5, // costanza
      )
      return { name, documents: docs.length, downloads, quality, trust, rating, reviews, reports, score: Math.max(0, score) }
    })
    .sort((a, b) => b.score - a.score)
}

function authorSlug(name: string): string {
  return slugify(name)
}

function findUploaderBySlug(pathname: string, documents: DocumentItem[]): string | null {
  const match = pathname.match(/^\/autore\/([^/]+)\/?$/)
  if (!match) return null
  const wanted = match[1]
  const names = Array.from(new Set(documents.map((document) => document.uploader)))
  return names.find((name) => slugify(name) === wanted) ?? null
}

function UploaderLeaderboard({ documents, onOpenProfile }: { documents: DocumentItem[]; onOpenProfile: (name: string) => void }) {
  const ranking = useMemo(() => buildUploaderRanking(documents).slice(0, 5), [documents])
  if (!ranking.length) return null

  return (
    <section className="leaderboard-section" aria-label="Classifica autori">
      <div className="leaderboard-head">
        <span className="leaderboard-icon"><Trophy size={18} /></span>
        <div>
          <h2>Classifica autori</h2>
          <p>Qualità, vendite, valutazioni e affidabilità nel tempo: chi pubblica meglio sale e vende di più.</p>
        </div>
      </div>
      <ol className="leaderboard-list">
        {ranking.map((entry, index) => (
          <li key={entry.name}>
            <span className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</span>
            <div>
              <button className="leaderboard-name" onClick={() => onOpenProfile(entry.name)} type="button">{entry.name}</button>
              <small><Star size={11} /> {entry.rating.toFixed(1)} · {entry.downloads} download · {entry.documents} materiali</small>
            </div>
            <em>{entry.score} pt</em>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PublicProfilePage({
  uploaderName,
  documents,
  onRoute,
  onOpenDocument,
}: {
  uploaderName: string | null
  documents: DocumentItem[]
  onRoute: (route: Route) => void
  onOpenDocument: (document: DocumentItem) => void
}) {
  if (!uploaderName) {
    return (
      <main className="profile-page section-wrap">
        <section className="document-missing">
          <h1>Autore non trovato</h1>
          <p>Questo profilo non esiste o non ha materiali pubblici.</p>
          <button className="primary-action" onClick={() => onRoute('app')} type="button"><Search size={17} /> Esplora appunti</button>
        </section>
      </main>
    )
  }

  const authored = documents.filter((document) => document.uploader === uploaderName)
  const entry = buildUploaderRanking(documents).find((item) => item.name === uploaderName)
  const rank = buildUploaderRanking(documents).findIndex((item) => item.name === uploaderName) + 1
  const initials = uploaderName.split(' ').slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'UD'
  const bio = `Autore della community UnimiDoc per Scienze Biologiche L-13 alla Statale di Milano. Condivide ${authored.length} material${authored.length === 1 ? 'e' : 'i'} verificati su ${new Set(authored.map((d) => d.subject)).size} materie.`

  return (
    <main className="profile-page section-wrap">
      <section className="profile-hero">
        <span className="profile-avatar">{initials}</span>
        <div className="profile-hero-main">
          <h1>{uploaderName}</h1>
          <p className="profile-bio">{bio}</p>
          <div className="profile-badges">
            {rank > 0 && rank <= 5 ? <span className="profile-badge top"><Trophy size={14} /> #{rank} in classifica</span> : null}
            <span className="profile-badge"><Star size={14} /> {entry?.rating.toFixed(1) ?? '—'}/5 media</span>
            <span className="profile-badge"><ShieldCheck size={14} /> Affidabilità {Math.round(entry?.trust ?? 0)}%</span>
          </div>
        </div>
      </section>

      <section className="profile-metrics">
        <article><strong>{authored.length}</strong><span>Materiali</span></article>
        <article><strong>{entry?.downloads ?? 0}</strong><span>Vendite/Download</span></article>
        <article><strong>{entry?.reviews ?? 0}</strong><span>Recensioni</span></article>
        <article><strong>{entry?.quality.toFixed(1) ?? '—'}</strong><span>Qualità media</span></article>
      </section>

      <section className="profile-materials">
        <h2>Materiali pubblicati</h2>
        <div className="document-related-grid">
          {authored.map((document) => (
            <a
              className="document-related-card"
              href={documentPath(document)}
              key={document.id}
              onClick={(event) => { event.preventDefault(); onOpenDocument(document) }}
            >
              <span><SubjectIcon compact name={document.subject} /></span>
              <div>
                <strong>{document.title}</strong>
                <small>{document.subject} · {document.pages} pagine · {document.quality.toFixed(1)}/10</small>
              </div>
              <ChevronRight size={15} />
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}

function DocumentPage({
  document: doc,
  documents,
  onDownload,
  onPreview,
  onRoute,
  onOpenDocument,
  onOpenProfile,
}: {
  document: DocumentItem | null
  documents: DocumentItem[]
  onDownload: (document: DocumentItem) => void
  onPreview: (document: DocumentItem) => void
  onRoute: (route: Route) => void
  onOpenDocument: (document: DocumentItem) => void
  onOpenProfile: (name: string) => void
}) {
  if (!doc) {
    return (
      <main className="document-page section-wrap">
        <section className="document-missing">
          <h1>Documento non trovato</h1>
          <p>La scheda che cerchi non esiste più o l’indirizzo non è corretto. Esplora il catalogo aggiornato.</p>
          <button className="primary-action" onClick={() => onRoute('app')} type="button">
            <Search size={17} /> Esplora appunti
          </button>
        </section>
      </main>
    )
  }

  const course = findCourse(doc.subject)
  const related = documents.filter((item) => item.subject === doc.subject && item.id !== doc.id).slice(0, 3)
  const price = documentCreditPrice(doc)
  const insights = doc.insights
  const courseMeta = documentCourseMeta(doc)
  const contentFeatures = insights
    ? ([
        [insights.contentFlags.hasImages, 'Immagini'],
        [insights.contentFlags.hasDiagrams, 'Schemi e diagrammi'],
        [insights.contentFlags.hasTables, 'Tabelle'],
        [insights.contentFlags.hasFormulas, 'Formule'],
        [insights.contentFlags.hasExercises, 'Esercizi svolti'],
        [insights.contentFlags.hasExamQuestions, 'Domande d’esame'],
      ] as Array<[boolean, string]>)
        .filter(([present]) => present)
        .map(([, label]) => label)
    : []

  return (
    <main className="document-page section-wrap">
      <nav className="document-breadcrumbs" aria-label="Percorso">
        <a href="/" onClick={(event) => { event.preventDefault(); onRoute('landing') }}>UnimiDoc</a>
        <ChevronRight size={13} />
        <a href="/app" onClick={(event) => { event.preventDefault(); onRoute('app') }}>Appunti</a>
        <ChevronRight size={13} />
        <span>{course?.shortName ?? doc.subject}</span>
      </nav>

      <section className="document-hero">
        <div className="document-hero-main">
          <span className="type-pill"><SubjectIcon compact name={doc.subject} />{doc.type}</span>
          <h1>{doc.title}</h1>
          <p className="document-subtitle">
            {doc.subject} · {doc.professor} · a.a. {doc.academicYear} · Scienze Biologiche L-13, Università degli
            Studi di Milano
          </p>
          <div className="document-badges">
            {doc.verified ? <span className="document-badge verified"><ShieldCheck size={14} /> Verificato</span> : null}
            <span className="document-badge"><Star size={14} /> {doc.quality.toFixed(1)}/10</span>
            <span className="document-badge"><Download size={14} /> {doc.downloads} download</span>
            <span className="document-badge"><FileText size={14} /> {doc.pages} pagine</span>
          </div>
          <p className="document-description">{doc.description}</p>
          <div className="document-actions">
            <button className="secondary-action" onClick={() => onPreview(doc)} type="button">
              <Eye size={17} /> Anteprima gratuita
            </button>
            <button className="download-button" onClick={() => onDownload(doc)} type="button">
              <Download size={17} /> Sblocca con {price} crediti
            </button>
          </div>
          <p className="document-price-hint">
            {price} crediti ≈ €{creditsToEur(price).toFixed(2)} · l’autore riceve €{revenueSplit(price).sellerEur.toFixed(2)}
          </p>
        </div>
        <aside className="document-uploader-card">
          <span className="document-uploader-avatar">{doc.uploader.slice(0, 2).toUpperCase()}</span>
          <button className="document-uploader-name" onClick={() => onOpenProfile(doc.uploader)} type="button">{doc.uploader}</button>
          <small>Affidabilità {doc.uploaderTrust}%</small>
          <p>Autore verificato della community UnimiDoc per Scienze Biologiche.</p>
          <button className="document-uploader-link" onClick={() => onOpenProfile(doc.uploader)} type="button">
            Vedi profilo e materiali <ChevronRight size={13} />
          </button>
        </aside>
      </section>

      <section className="document-details">
        <h2>Dettagli del documento</h2>
        <dl>
          <div><dt>Materia</dt><dd>{doc.subject}</dd></div>
          <div><dt>Docente</dt><dd>{doc.professor}</dd></div>
          <div><dt>Anno accademico</dt><dd>{doc.academicYear}</dd></div>
          {courseMeta ? <div><dt>Corso L-13</dt><dd>{courseMeta}</dd></div> : null}
          <div><dt>Tipo</dt><dd>{doc.type}</dd></div>
          <div><dt>Esame</dt><dd>{doc.examType}</dd></div>
          <div><dt>Pagine</dt><dd>{doc.pages}</dd></div>
          <div><dt>Dimensione</dt><dd>{doc.sizeMb.toFixed(1)} MB</dd></div>
          <div><dt>Lingua</dt><dd>{doc.language}</dd></div>
          {insights ? <div><dt>Livello</dt><dd className="document-depth">{insights.depthLevel}</dd></div> : null}
        </dl>
        {contentFeatures.length ? (
          <div className="document-feature-chips" aria-label="Contenuti presenti">
            {contentFeatures.map((feature) => (
              <span key={feature}><Check size={13} /> {feature}</span>
            ))}
          </div>
        ) : null}
      </section>

      {insights?.abstract || insights?.topics.length ? (
        <section className="document-insights">
          <h2>Di cosa parla questo documento</h2>
          {insights.abstract ? <p className="document-abstract">{insights.abstract}</p> : null}
          {insights.topics.length ? (
            <div className="document-topic-chips" aria-label="Argomenti principali">
              {insights.topics.map((topic) => (
                <span key={topic}>{topic}</span>
              ))}
            </div>
          ) : null}
          {insights.keywords.length ? (
            <p className="document-keywords">
              <strong>Parole chiave:</strong> {insights.keywords.join(' · ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="document-seo-copy">
        <h2>Appunti di {doc.subject} alla Statale di Milano</h2>
        <p>
          Questo materiale copre il corso di {doc.subject} tenuto da {doc.professor} per la laurea triennale in
          Scienze Biologiche (L-13) all’Università degli Studi di Milano. È stato caricato da uno studente del corso,
          verificato dalla community e valutato {doc.quality.toFixed(1)}/10 da chi lo ha usato per preparare l’esame.
        </p>
      </section>

      {related.length ? (
        <section className="document-related">
          <h2>Altri appunti di {course?.shortName ?? doc.subject}</h2>
          <div className="document-related-grid">
            {related.map((item) => (
              <a
                className="document-related-card"
                href={documentPath(item)}
                key={item.id}
                onClick={(event) => { event.preventDefault(); onOpenDocument(item) }}
              >
                <span><FileText size={17} /></span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.professor} · {item.pages} pagine · {item.quality.toFixed(1)}/10</small>
                </div>
                <ChevronRight size={15} />
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

function AppHome({
  documents,
  credits,
  isLoggedIn,
  onRoute,
  onAuth,
  onDownload,
  onPreview,
  onOpenDocument,
  onOpenProfile,
  initialSubject,
  initialQuery,
}: {
  documents: DocumentItem[]
  credits: number
  isLoggedIn: boolean
  onRoute: (route: Route) => void
  onAuth: (mode: AuthMode) => void
  onDownload: (document: DocumentItem) => void
  onPreview: (document: DocumentItem) => void
  onOpenDocument: (document: DocumentItem) => void
  onOpenProfile: (name: string) => void
  initialSubject: string
  initialQuery: string
}) {
  const [activeSubject, setActiveSubject] = useState(initialSubject || 'Tutti')
  const [activeProfessor, setActiveProfessor] = useState('Tutti')
  const [activeQuery, setActiveQuery] = useState(initialQuery)
  const [filtersOpen, setFiltersOpen] = useState(false)
  useEffect(() => {
    if (initialSubject) {
      setActiveSubject(initialSubject)
    }
  }, [initialSubject])
  useEffect(() => {
    setActiveQuery(initialQuery)
  }, [initialQuery])

  // Professori raggruppati per materia (compatto): quando una materia è
  // selezionata mostra solo i suoi docenti, altrimenti raggruppa per le materie
  // con documenti disponibili.
  const professorGroups = useMemo(() => {
    const subjectsToShow =
      activeSubject !== 'Tutti'
        ? [activeSubject]
        : Array.from(new Set(documents.map((document) => document.subject)))
    return subjectsToShow
      .map((subjectName) => {
        const course = findCourse(subjectName)
        const fromCatalog = course ? getCourseProfessors(course, 'Tutti') : []
        const fromDocs = documents.filter((d) => d.subject === subjectName).map((d) => d.professor)
        const professorsList = Array.from(new Set([...fromDocs, ...fromCatalog])).filter(Boolean)
        return { subject: subjectName, shortName: course?.shortName ?? subjectName, professors: professorsList }
      })
      .filter((group) => group.professors.length > 0)
  }, [activeSubject, documents])

  const visibleDocuments = useMemo(
    () =>
      documents.filter(
        (document) =>
          (activeSubject === 'Tutti' || document.subject === activeSubject) &&
          (activeProfessor === 'Tutti' || document.professor === activeProfessor) &&
          (!activeQuery || documentMatchesQuery(document, activeQuery)),
      ),
    [activeSubject, activeProfessor, activeQuery, documents],
  )

  const advancedActive = activeProfessor !== 'Tutti'
  const anyFilterActive = activeSubject !== 'Tutti' || activeProfessor !== 'Tutti' || Boolean(activeQuery)
  const resetFilters = () => {
    setActiveSubject('Tutti')
    setActiveProfessor('Tutti')
    setActiveQuery('')
  }

  return (
    <main className="app-page">
      {!isLoggedIn ? (
        <section className="app-login-nudge section-wrap">
          <div>
            <h2>Accedi per salvare appunti, anteprime e progressi</h2>
            <p>Ci vuole meno di un minuto. Poi ritrovi tutto nella tua libreria.</p>
          </div>
          <button className="primary-action" onClick={() => onAuth('login')} type="button">
            <LogIn size={18} />
            Accedi
          </button>
        </section>
      ) : null}

      <section className="course-hero section-wrap">
        <div>
          <h1>Scienze Biologiche L-13</h1>
          <p>Meno caccia al PDF, più tempo per ripassare.</p>
          <SearchBox compact />
          <div className="filter-bar">
            <div className="filter-bar-top">
              <div className="filter-row">
                <span className="filter-label">Filtra la lista</span>
                {['Tutti', ...orderedFilterSubjects].map((subject) => (
                  <button
                    className={activeSubject === subject ? 'selected' : ''}
                    key={subject}
                    onClick={() => setActiveSubject(subject)}
                    type="button"
                  >
                    <SubjectIcon compact name={subject} />
                    <span>{subject === 'Tutti' ? 'Tutti' : (findCourse(subject)?.shortName ?? subject)}</span>
                  </button>
                ))}
              </div>
              <button
                className={`filter-toggle ${filtersOpen ? 'open' : ''} ${advancedActive ? 'has-active' : ''}`}
                onClick={() => setFiltersOpen((open) => !open)}
                type="button"
                aria-expanded={filtersOpen}
                aria-controls="advanced-filters"
              >
                <Filter size={16} />
                <span>Filtri</span>
                {advancedActive ? <span className="filter-count">1</span> : null}
                <ChevronDown className="filter-chevron" size={15} />
              </button>
            </div>

            <div className={`filter-panel ${filtersOpen ? 'open' : ''}`} id="advanced-filters">
              <div className="filter-panel-clip">
                <div className="filter-panel-inner">
                  <div className="filter-group">
                    <span className="filter-group-title"><User size={15} /> Professore</span>
                    <div className="filter-chips">
                      <button
                        className={activeProfessor === 'Tutti' ? 'selected' : ''}
                        onClick={() => setActiveProfessor('Tutti')}
                        type="button"
                      >
                        Tutti i docenti
                      </button>
                    </div>
                    <div className="filter-prof-groups">
                      {professorGroups.map((group) => (
                        <div className="filter-prof-group" key={group.subject}>
                          <span className="filter-prof-group-title">
                            <SubjectIcon compact name={group.subject} /> {group.shortName}
                          </span>
                          <div className="filter-chips">
                            {group.professors.map((professor) => (
                              <button
                                className={activeProfessor === professor ? 'selected' : ''}
                                key={`${group.subject}-${professor}`}
                                onClick={() => setActiveProfessor(professor)}
                                type="button"
                              >
                                {professor}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="filter-panel-foot">
                    <span className="filter-result-count">
                      {visibleDocuments.length} {visibleDocuments.length === 1 ? 'documento' : 'documenti'}
                    </span>
                    <button className="filter-reset" onClick={resetFilters} type="button" disabled={!anyFilterActive}>
                      <X size={14} /> Azzera filtri
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <aside className="premium-panel">
          <Crown size={28} />
          <h2>Premium sblocca tempo, non solo file.</h2>
          <ul>
            <li><Check size={17} /> Anteprime complete</li>
            <li><Check size={17} /> Ricerca avanzata</li>
            <li><Check size={17} /> Download senza attese</li>
          </ul>
          <button onClick={() => onRoute('premium')} type="button">Scopri Premium</button>
        </aside>
      </section>

      <section className="trust-strip section-wrap">
        <span><ShieldCheck size={24} /> Contenuti verificati</span>
        <span><Star size={24} /> 4.7/5 qualità media</span>
        <span><User size={24} /> Oltre 18.000 studenti</span>
      </section>

      <section className="browse-layout section-wrap">
        <div className="notes-area">
          <div className="section-title">
            <h2>{activeQuery ? `Risultati per “${activeQuery}”` : 'Documenti popolari'}</h2>
            <button type="button">Vedi tutti</button>
          </div>
          {activeQuery ? (
            <div className="active-query-pill">
              <Search size={14} />
              <span>{visibleDocuments.length} {visibleDocuments.length === 1 ? 'documento trovato' : 'documenti trovati'}</span>
              <button aria-label="Rimuovi ricerca" onClick={() => setActiveQuery('')} type="button"><X size={14} /></button>
            </div>
          ) : null}
          {visibleDocuments.length ? (
            <div className="notes-grid">
              {visibleDocuments.slice(0, 6).map((document) => (
                <DocumentCard document={document} key={document.id} onDownload={onDownload} onOpenPage={onOpenDocument} onPreview={onPreview} />
              ))}
            </div>
          ) : (
            <div className="empty-documents">
              <SubjectIcon name={activeSubject} />
              <h3>Questa materia è pronta, mancano solo gli appunti giusti.</h3>
              <p>Puoi caricare materiale tuo o tornare su “Tutti” per esplorare i documenti già verificati.</p>
              <button className="primary-action" onClick={() => onRoute('upload')} type="button">
                <Upload size={18} />
                Carica appunti
              </button>
            </div>
          )}
        </div>
        <aside className="study-sidebar">
          <UploaderLeaderboard documents={documents} onOpenProfile={onOpenProfile} />
          <section className="upload-panel">
            <img src={uploadBackpack} alt="Carica appunti" />
            <h2>Condividi, aiuta, guadagna.</h2>
            <p>Carica i tuoi appunti e ricevi crediti ogni volta che vengono scaricati.</p>
            <button className="primary-action" onClick={() => onRoute('upload')} type="button">
              <Upload size={18} />
              Carica appunti
            </button>
          </section>
          <section className="library-panel">
            <h2>I tuoi documenti salvati</h2>
            <img src={libraryNotes} alt="Documenti salvati" />
            <button onClick={() => onRoute('dashboard')} type="button">
              Vai alla tua libreria
              <ArrowRight size={16} />
            </button>
          </section>
          <section className="credits-panel">
            <div>
              <span>I tuoi crediti</span>
              <strong><CreditIcon size="lg" /> {credits}</strong>
            </div>
            <button onClick={() => onRoute('upload')} type="button">
              Ottieni più crediti
              <ArrowRight size={16} />
            </button>
          </section>
        </aside>
      </section>
    </main>
  )
}

function ProtectedPreview({ document }: { document: DocumentItem }) {
  const sessionId = useMemo(() => `UD-${hashString(`${document.id}-${document.title}`).toString(36).slice(0, 6).toUpperCase()}`, [document.id, document.title])
  const watermarkTiles = useMemo(() => Array.from({ length: 12 }, (_, index) => index), [])

  return (
    <div className="protected-preview-frame" onContextMenu={(event) => event.preventDefault()}>
      <div className="real-document-scroll">
        <DemoPageViewer compact />
      </div>
      <div className="preview-watermark-grid" aria-hidden="true">
        {watermarkTiles.map((tile) => (
          <span key={tile}>Anteprima protetta · {sessionId}</span>
        ))}
      </div>
      <div className="preview-shield">
        <Shield size={18} />
        Anteprima parziale · originale non esposto
      </div>
      <div className="preview-security-note">
        <Lock size={14} />
        Sessione {sessionId}: in produzione vengono servite solo pagine renderizzate e watermarkate.
      </div>
    </div>
  )
}

function PreviewModal({
  document,
  onClose,
  onPremium,
}: {
  document: DocumentItem
  onClose: () => void
  onPremium: () => void
}) {
  useBodyScrollLock()

  const course = findCourse(document.subject)

  return (
    <div
      className="preview-modal"
      onContextMenu={(event) => event.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label={`Anteprima protetta di ${document.title}`}
    >
      <button className="preview-backdrop" onClick={onClose} type="button" aria-label="Chiudi anteprima" />
      <section className="preview-panel">
        <div className="preview-heading">
          <div>
            <span className="preview-kicker"><Lock size={15} /> Anteprima protetta</span>
            <h2>{document.title.replace(' - Appunti completi', '').replace(' generale - Domande frequenti', '')}</h2>
            <p>{course?.shortName ?? document.subject} · {document.pages} pagine · {documentCreditPrice(document)} crediti · {tierLabel(creditTier(documentCreditPrice(document)))}</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>
        <ProtectedPreview document={document} />
        <div className="preview-actions">
          <span><ShieldCheck size={17} /> Watermark dinamico e oscuramento anti-copia</span>
          <button className="premium-button" onClick={onPremium} type="button">
            <Crown size={17} />
            Sblocca anteprima completa
          </button>
        </div>
      </section>
    </div>
  )
}

function LoginPage({
  mode,
  onMode,
  onSubmit,
  onRoute,
}: {
  mode: AuthMode
  onMode: (mode: AuthMode) => void
  onSubmit: (values: AuthFormValues) => Promise<void>
  onRoute: (route: Route) => void
}) {
  const [email, setEmail] = useState(isSupabaseConfigured ? '' : 'giulia.demo@unimidoc.local')
  const [password, setPassword] = useState(isSupabaseConfigured ? '' : 'unimidoc-demo')
  const [fullName, setFullName] = useState(isSupabaseConfigured ? '' : 'Giulia Bianchi')
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState<AuthProvider | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleForgotPassword = async () => {
    setError('')
    setNotice('')
    if (!isSupabaseConfigured) {
      setNotice('Il reset password non è attivo in modalità demo.')
      return
    }
    if (!email.trim()) {
      setError('Inserisci la tua email qui sopra per ricevere il link di reset.')
      return
    }
    try {
      await requestPasswordReset(email.trim())
      setNotice('Ti abbiamo inviato un link per reimpostare la password. Controlla l’email.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Non riesco a inviare il reset ora. Riprova.')
    }
  }

  const submit = async (provider: AuthProvider, event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setError('')
    setNotice('')

    if (provider === 'email') {
      if (!email.trim() || !password.trim()) {
        setError('Inserisci email e password per continuare.')
        return
      }
      if (mode === 'signup' && !fullName.trim()) {
        setError('Aggiungi il tuo nome: serve per personalizzare la dashboard.')
        return
      }
    }

    setSubmitting(provider)
    try {
      await onSubmit({
        email,
        password,
        fullName,
        remember,
        provider,
      })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Accesso non riuscito. Riprova tra poco.')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <h1>Bentornato, gli appunti ti stavano aspettando.</h1>
        <p>Riprendi da dove avevi lasciato, ritrova i materiali salvati e prepara i tuoi esami con più sicurezza.</p>
        <div className="auth-benefits">
          <span><Bookmark size={20} /> La tua libreria sempre con te</span>
          <span><ShieldCheck size={20} /> Materiali verificati dalla community</span>
          <span><Sparkles size={20} /> Studia meglio, in meno tempo</span>
        </div>
        <img src={loginStudy} alt="Appunti salvati e sicuri" />
      </section>
      <section className="auth-panel">
        <button className="auth-close" onClick={() => onRoute('landing')} aria-label="Torna alla landing" type="button">
          <X size={18} />
        </button>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => onMode('login')} type="button">
            Accedi
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => onMode('signup')} type="button">
            Crea account
          </button>
        </div>

        <form className="auth-form" onSubmit={(event) => void submit('email', event)}>
          {mode === 'signup' ? (
            <label>
              Nome
              <input
                autoComplete="name"
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Il tuo nome"
                type="text"
                value={fullName}
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@email.com"
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Inserisci la tua password"
              type="password"
              value={password}
            />
          </label>
          <div className="auth-options">
            <label>
              <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
              Resta connesso
            </label>
            <button type="button" onClick={() => void handleForgotPassword()}>Hai dimenticato la password?</button>
          </div>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
          <button className="auth-submit" disabled={submitting !== null} type="submit">
            {submitting === 'email' ? <Loader2 className="spin" size={17} /> : null}
            {mode === 'login' ? 'Entra nella dashboard' : 'Crea account'}
          </button>
        </form>

        <div className="divider">oppure</div>
        <button className="google-button" disabled={submitting !== null} onClick={() => void submit('google')} type="button">
          {submitting === 'google' ? <Loader2 className="spin" size={18} /> : <Mail size={18} />}
          Continua con Google
        </button>
        <p className="auth-runtime-note">
          {isSupabaseConfigured
            ? 'Accesso sicuro: la tua sessione resta attiva e protetta su tutti i dispositivi.'
            : 'Modalità demo: stai esplorando l’interfaccia senza un account reale.'}
        </p>
        {!isSupabaseConfigured ? (
          <button className="google-button auth-dashboard-demo" disabled={submitting !== null} onClick={() => void submit('email')} type="button">
            <Mail size={18} />
            Entra con account demo
          </button>
        ) : null}
        <button className="auth-premium" onClick={() => onRoute('premium')} type="button">
          <Crown size={22} />
          <span>
            <strong>Con Premium trovi prima i materiali migliori</strong>
            Filtri avanzati, anteprime complete e zero pubblicità.
          </span>
          <ArrowRight size={18} />
        </button>
        <p className="auth-note">
          UnimiDoc è una piattaforma indipendente e non è affiliata all’Università degli Studi di Milano.
          Rispettiamo la tua privacy.
        </p>
      </section>
    </main>
  )
}

const PREMIUM_PAINS = [
  { icon: MessagesSquare, title: 'Appunti persi nei gruppi WhatsApp', body: 'PDF sparsi in mille chat, nessuno sa quale sia la versione buona.' },
  { icon: AlertTriangle, title: 'Non sai di chi fidarti', body: 'Materiali senza fonte, incompleti o vecchi: rischi di studiare sul documento sbagliato.' },
  { icon: Clock, title: 'Tempo perso a cercare', body: 'Ore a chiedere in giro invece di ripassare. L’esame però non aspetta.' },
]

const PREMIUM_FEATURES = [
  { icon: Search, title: 'Ricerca che capisce l’esame', body: 'Trovi per materia, docente e argomento. Anche gli assistenti AI trovano i tuoi appunti.' },
  { icon: Eye, title: 'Anteprime complete', body: 'Vedi tutto il documento prima di spendere: niente acquisti al buio.' },
  { icon: BrainCircuit, title: 'Flashcard e quiz automatici', body: 'Dal PDF a un mazzo di ripasso in un minuto, con ripetizione dilazionata.' },
  { icon: ScanLine, title: 'Image occlusion', body: 'Nascondi etichette su schemi e figure per allenare la memoria visiva.' },
  { icon: ShieldCheck, title: 'Materiali verificati', body: 'Qualità, provenienza e affidabilità controllate dalla community.' },
  { icon: Zap, title: 'Download senza attese', body: 'Zero code, zero pubblicità: vai dritto a studiare.' },
]

function PremiumPage({ onRoute }: { onRoute: (route: Route) => void }) {
  return (
    <main className="premium-page section-wrap">
      <section className="premium-hero">
        <div>
          <span className="premium-kicker"><Crown size={15} /> UnimiDoc Premium</span>
          <h1>Smetti di rincorrere gli appunti. Inizia a studiare.</h1>
          <p>
            Tutto il materiale di Scienze Biologiche L-13 in un posto solo: verificato, cercabile e già pronto per il
            ripasso. Meno caos, meno tempo perso, più voti.
          </p>
          <div className="premium-hero-actions">
            <button className="premium-button" type="button"><Crown size={18} /> Provalo gratis 7 giorni</button>
            <button className="secondary-action" onClick={() => onRoute('app')} type="button"><Search size={17} /> Esplora appunti</button>
          </div>
          <small className="premium-hero-note">Nessun rinnovo automatico nascosto · disdici quando vuoi</small>
        </div>
        <img src={premiumStack} alt="Premium UnimiDoc" />
      </section>

      <section className="premium-pains">
        <h2>Ti suona familiare?</h2>
        <div className="premium-pain-grid">
          {PREMIUM_PAINS.map((pain) => (
            <article key={pain.title}>
              <span className="premium-pain-icon"><pain.icon size={20} /></span>
              <h3>{pain.title}</h3>
              <p>{pain.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="premium-features">
        <div className="premium-section-head">
          <h2>Cosa sblocchi con Premium</h2>
          <p>Strumenti di studio ordinati, verificabili e intelligenti. Fatti per chi deve dare l’esame, non per perderci tempo.</p>
        </div>
        <div className="premium-feature-grid">
          {PREMIUM_FEATURES.map((feature) => (
            <article key={feature.title}>
              <span className="premium-feature-icon"><feature.icon size={20} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="premium-credits">
        <div className="premium-section-head">
          <h2>Abbonamento o crediti? Come preferisci.</h2>
          <p>L’abbonamento Premium sblocca gli strumenti di studio. I crediti servono a sbloccare i singoli materiali: compri solo quello che ti serve.</p>
        </div>
        <div className="premium-plan-grid">
          <article className="premium-plan highlight">
            <span className="premium-plan-tag"><Crown size={14} /> Premium</span>
            <strong className="premium-plan-price">€4,99<span>/mese</span></strong>
            <ul>
              <li><Check size={15} /> Anteprime complete</li>
              <li><Check size={15} /> Flashcard, quiz e image occlusion</li>
              <li><Check size={15} /> Ricerca avanzata + download senza attese</li>
              <li><Check size={15} /> 7 giorni gratis</li>
            </ul>
            <button className="premium-button" type="button"><Crown size={17} /> Inizia gratis</button>
          </article>
          <article className="premium-plan">
            <span className="premium-plan-tag"><Wallet size={14} /> Crediti</span>
            <strong className="premium-plan-price">da €5</strong>
            <p className="premium-plan-note">Più ricarichi, più bonus. 1 credito = €0,10.</p>
            <ul className="premium-pack-list">
              {TOPUP_PACKS.map((pack) => (
                <li key={pack.id}>
                  <span>€{pack.priceEur}</span>
                  <strong>{pack.credits} crediti</strong>
                  {pack.bonusPct > 0 ? <em>+{pack.bonusPct}%</em> : <em>base</em>}
                </li>
              ))}
            </ul>
            <button className="secondary-action" onClick={() => onRoute('app')} type="button"><Wallet size={17} /> Sfoglia i materiali</button>
          </article>
        </div>
      </section>

      <section className="premium-trust">
        <span><TrendingUp size={22} /> Autori premiati per qualità e vendite</span>
        <span><Star size={22} /> 4.7/5 qualità media dei materiali</span>
        <span><ShieldCheck size={22} /> Contenuti verificati dalla community</span>
      </section>

      <section className="final-cta">
        <div>
          <h2>Il prossimo appello si prepara meglio così.</h2>
          <p>Entra, cerca il tuo esame e prova gli strumenti sul materiale che stai già studiando.</p>
        </div>
        <button className="primary-action" onClick={() => onRoute('app')} type="button">Esplora appunti</button>
      </section>
    </main>
  )
}

// Italian academic year rolls over with the autumn term (~September). At UniMi
// the Scienze Biologiche courses start in late September, so from September the
// "current" academic year is YYYY/(YYYY+1); before then it is (YYYY-1)/YYYY.
// Recomputed at runtime so the latest year is always available for uploads.
function buildAcademicYears(count = 6): string[] {
  const now = new Date()
  const month = now.getMonth() + 1
  const startYear = month >= 9 ? now.getFullYear() : now.getFullYear() - 1
  return Array.from({ length: count }, (_, index) => {
    const year = startYear - index
    return `${year}/${String((year + 1) % 100).padStart(2, '0')}`
  })
}

const academicYears = buildAcademicYears()
const EXAM_TYPES = ['Scritto', 'Orale', 'Scritto + orale', 'Scritto + progetto', 'Test a risposta multipla', 'In itinere']
const DEGREE_COURSE = 'Scienze Biologiche (L-13)'
const UNIVERSITY_NAME = 'Università degli Studi di Milano'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const FREE_FLASHCARD_LIMIT = readPositiveInt(import.meta.env.VITE_FREE_FLASHCARD_LIMIT, DEFAULT_FREE_FLASHCARD_LIMIT)
const PREMIUM_FLASHCARD_LIMIT = readPositiveInt(import.meta.env.VITE_PREMIUM_FLASHCARD_LIMIT, DEFAULT_PREMIUM_FLASHCARD_LIMIT)

function flashcardLimitFor(premium: boolean): number {
  return premium ? PREMIUM_FLASHCARD_LIMIT : FREE_FLASHCARD_LIMIT
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type PipelineStepKey = 'read' | 'convert' | 'compress' | 'ocr' | 'flashcards' | 'finalize'
type PipelineStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'
type PipelineStep = { key: PipelineStepKey; label: string; detail: string; status: PipelineStatus }
type UploadPhase = 'idle' | 'processing' | 'ready' | 'published'

const flashcardSourceLabels: Record<Flashcard['source'], string> = {
  definizione: 'Definizione',
  concetto: 'Concetto',
  cloze: 'Cloze',
  processo: 'Processo',
  confronto: 'Confronto',
  causa: 'Causa-effetto',
  classificazione: 'Classificazione',
}

type PremiumFlashcardChunk = {
  text: string
  pageStart: number
  pageEnd: number
  section: string | null
  score: number
}

const AI_CHUNK_TARGET_CHARS = 5200
const AI_CHUNK_MAX_CHARS = 7600
const AI_CARDS_PER_CHUNK = 8
const AI_MAX_CHUNKS_PER_DOCUMENT = 6
const AI_LOW_VALUE_SECTION =
  /\b(indice|bibliografia|references|sitografia|copyright|ringraziamenti|licenza|appendice|crediti|programma del corso)\b/i
const AI_TECHNICAL_SIGNAL =
  /\b(DNA|RNA|ATP|enzim|gene|cellul|prote|membran|metabol|cromosom|sequenz|recettor|tessut|organo|mitosi|meiosi|batter|virus|fisiolog|anatom|farmac|immun|ecolog|evoluz|biochim|molecol|formula|gradiente|omeostas|trascrizion|traduzion)\b/i

function normalizeAiText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function scoreTextForAiFlashcards(text: string): number {
  const clean = normalizeAiText(text)
  let score = Math.min(2.4, clean.length / 1200)
  if (AI_TECHNICAL_SIGNAL.test(clean)) score += 2.2
  if (/\b(è|sono|si definisce|viene definito|rappresenta|indica|costituisce|consiste)\b/i.test(clean)) score += 1.4
  if (/\b(causa|provoca|determina|induce|favorisce|inibisce|porta a|dipende da|regola)\b/i.test(clean)) score += 1.4
  if (/\b(fase|fasi|prima|poi|successivamente|infine|processo|meccanismo|ciclo|pathway|via)\b/i.test(clean)) score += 1.2
  if (/\b(differenza|rispetto a|mentre|invece|al contrario|confronto|diverso da)\b/i.test(clean)) score += 1.1
  if (/\b(si distinguono in|si classificano in|comprendono|include|sono costituiti da|sono composti da)\b/i.test(clean)) score += 1
  if (AI_LOW_VALUE_SECTION.test(clean)) score -= 3
  return Math.max(0, score)
}

function isUsefulAiSentence(sentence: DocSentence): boolean {
  const text = normalizeAiText(sentence.text)
  if (text.length < 45 || text.length > 780) return false
  if (AI_LOW_VALUE_SECTION.test(sentence.section ?? '') || AI_LOW_VALUE_SECTION.test(text)) return false
  if (/^(figura|tabella|slide|pagina)\s+\d+/i.test(text)) return false
  return scoreTextForAiFlashcards(text) >= 1.1
}

function buildPremiumFlashcardChunks(analysis: PdfAnalysis, maxCards: number): PremiumFlashcardChunk[] {
  const selected = analysis.sentences.filter(isUsefulAiSentence)
  const chunks: PremiumFlashcardChunk[] = []
  let current: DocSentence[] = []
  let currentSection: string | null = null
  let currentChars = 0

  const flush = () => {
    if (!current.length) return
    const text = current.map((sentence) => `[p. ${sentence.page}] ${sentence.text}`).join('\n')
    chunks.push({
      text,
      pageStart: Math.min(...current.map((sentence) => sentence.page)),
      pageEnd: Math.max(...current.map((sentence) => sentence.page)),
      section: currentSection,
      score: scoreTextForAiFlashcards(text),
    })
    current = []
    currentSection = null
    currentChars = 0
  }

  for (const sentence of selected) {
    const section = sentence.section ?? null
    const lineLength = sentence.text.length + 12
    const sectionChanged = current.length > 0 && section && currentSection && section !== currentSection
    const tooLarge = currentChars + lineLength > AI_CHUNK_MAX_CHARS
    const healthyBreak = currentChars >= AI_CHUNK_TARGET_CHARS && (sectionChanged || sentence.page !== current[current.length - 1]?.page)
    if (tooLarge || healthyBreak) flush()
    current.push(sentence)
    currentSection = currentSection ?? section
    currentChars += lineLength
  }
  flush()

  const maxChunks = Math.min(AI_MAX_CHUNKS_PER_DOCUMENT, Math.max(1, Math.ceil(maxCards / AI_CARDS_PER_CHUNK)))
  return chunks
    .filter((chunk) => chunk.text.length >= 180 && chunk.score >= 1.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
}

function sourceForPremiumCard(card: PremiumGeneratedFlashcard): Flashcard['source'] {
  if (card.type === 'definition') return 'definizione'
  if (card.type === 'cloze') return 'cloze'
  if (card.type === 'comparison') return 'confronto'
  const text = `${card.question ?? ''} ${card.answer ?? ''}`.toLowerCase()
  if (/\b(causa|effetto|perché|determina|provoca|inibisce|favorisce)\b/i.test(text)) return 'causa'
  if (/\b(fase|processo|meccanismo|sequenza|ciclo|prima|successivamente)\b/i.test(text)) return 'processo'
  if (/\b(classifica|categorie|tipi|gruppi|comprende)\b/i.test(text)) return 'classificazione'
  return 'concetto'
}

function findPremiumSourceRef(
  analysis: PdfAnalysis,
  chunk: PremiumFlashcardChunk,
  card: PremiumGeneratedFlashcard,
): Flashcard['ref'] {
  const quote = normalizeAiText(card.source_quote ?? '')
  const page = Math.max(1, Number(card.page_start ?? chunk.pageStart) || chunk.pageStart)
  const match = quote
    ? analysis.sentences.find((sentence) => {
        const source = normalizeAiText(sentence.text)
        return source.includes(quote.slice(0, 90)) || quote.includes(source.slice(0, 90))
      })
    : undefined
  return {
    page: match?.page ?? page,
    sentenceIndex: match?.index ?? -1,
    text: quote || chunk.text.slice(0, 260),
    section: match?.section ?? chunk.section,
  }
}

function dedupePremiumFlashcards(cards: Flashcard[]): Flashcard[] {
  const seen = new Set<string>()
  return cards.filter((card) => {
    const key = `${normalizeAiText(card.front).toLowerCase()}\n${normalizeAiText(card.back).toLowerCase()}`.slice(0, 360)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mapPremiumGeneratedCard(
  analysis: PdfAnalysis,
  chunk: PremiumFlashcardChunk,
  card: PremiumGeneratedFlashcard,
  index: number,
): Flashcard | null {
  const front = normalizeAiText(card.type === 'cloze' && card.cloze_text ? card.cloze_text : card.question ?? '')
  const back = normalizeAiText(card.answer ?? '')
  if (front.length < 6 || back.length < 2) return null
  return {
    id: `ai-premium-${Date.now()}-${chunk.pageStart}-${index}`,
    front: front.slice(0, 420),
    back: back.slice(0, 900),
    source: sourceForPremiumCard(card),
    score: card.difficulty === 'hard' ? 0.94 : card.difficulty === 'easy' ? 0.86 : 0.9,
    ref: findPremiumSourceRef(analysis, chunk, card),
  }
}

async function generatePremiumDeckFromBackend(
  analysis: PdfAnalysis,
  onProgress?: (done: number, total: number) => void,
): Promise<Flashcard[]> {
  const maxCards = flashcardLimitFor(true)
  const chunks = buildPremiumFlashcardChunks(analysis, maxCards)
  if (!chunks.length) return []

  const cards: Flashcard[] = []
  for (let index = 0; index < chunks.length && cards.length < maxCards; index += 1) {
    const chunk = chunks[index]
    onProgress?.(index, chunks.length)
    const remaining = maxCards - cards.length
    const response = await generateBackendPremiumFlashcards({
      chunkText: chunk.text,
      language: analysis.language,
      maxCards: Math.min(AI_CARDS_PER_CHUNK, remaining),
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    })
    if (!response.ok) {
      throw new Error(response.message)
    }
    const mapped = response.data.flashcards
      .map((card, cardIndex) => mapPremiumGeneratedCard(analysis, chunk, card, index * AI_CARDS_PER_CHUNK + cardIndex))
      .filter((card): card is Flashcard => Boolean(card))
    cards.push(...mapped)
    onProgress?.(index + 1, chunks.length)
  }

  return dedupePremiumFlashcards(cards).slice(0, maxCards)
}

function PipelineIcon({ status }: { status: PipelineStatus }) {
  if (status === 'running') return <Loader2 className="spin" size={16} />
  if (status === 'done') return <Check size={16} />
  if (status === 'error') return <AlertTriangle size={16} />
  return <span className="pipeline-dot" />
}

type StudyAnswerMode = 'flashcard' | 'typing' | 'choice' | 'truefalse'

const answerStatusLabels: Record<AnswerStatus, string> = {
  unanswered: 'In attesa',
  correct: 'Corretto',
  incorrect: 'Da rivedere',
  partial: 'Quasi',
  unknown: 'Non lo so',
  skipped: 'Saltata',
}

const srsRatingLabels: Record<SrsRating, string> = {
  impossible: 'Impossible',
  hard: 'Hard',
  ok: 'OK',
  easy: 'Easy',
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

const SRS_STORAGE_PREFIX = 'unimidoc:srs:'

function loadSrsMap(key: string): Record<string, SrsState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SRS_STORAGE_PREFIX + key)
    return raw ? (JSON.parse(raw) as Record<string, SrsState>) : {}
  } catch {
    return {}
  }
}

function saveSrsMap(key: string, map: Record<string, SrsState>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SRS_STORAGE_PREFIX + key, JSON.stringify(map))
  } catch {
    /* storage unavailable or full — non-fatal for study flow */
  }
}

type HighlightColor = 'yellow' | 'mint' | 'blue'
type FreeReaderView = 'all' | 'highlights' | 'review' | 'bookmarks'

type FreeHighlight = {
  note: string
  color: HighlightColor
  review: boolean
}

type FreeReaderState = {
  version: 2
  highlights: Record<number, FreeHighlight>
  readPages: number[]
  bookmarkedPages: number[]
  updatedAt: string
}

const FREE_READER_STORAGE_PREFIX = 'unimidoc:free-reader:v2:'
const EMPTY_FREE_READER_STATE: FreeReaderState = {
  version: 2,
  highlights: {},
  readPages: [],
  bookmarkedPages: [],
  updatedAt: '',
}

function normalizeSearchValue(value: string): string {
  return value
    .toLocaleLowerCase('it-IT')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}

function makeFreeReaderState(patch: Partial<FreeReaderState> = {}): FreeReaderState {
  return {
    ...EMPTY_FREE_READER_STATE,
    ...patch,
    highlights: patch.highlights ?? {},
    readPages: [...new Set(patch.readPages ?? [])].sort((a, b) => a - b),
    bookmarkedPages: [...new Set(patch.bookmarkedPages ?? [])].sort((a, b) => a - b),
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  }
}

function loadFreeReaderState(key: string): FreeReaderState {
  if (typeof window === 'undefined') return makeFreeReaderState()
  try {
    const raw = window.localStorage.getItem(FREE_READER_STORAGE_PREFIX + key)
    if (!raw) return makeFreeReaderState()
    const parsed = JSON.parse(raw) as Partial<FreeReaderState> | Record<string, string>

    if ('version' in parsed && parsed.version === 2) {
      return makeFreeReaderState(parsed as Partial<FreeReaderState>)
    }

    const migratedHighlights = Object.entries(parsed).reduce<Record<number, FreeHighlight>>((acc, [index, note]) => {
      const numericIndex = Number(index)
      if (Number.isFinite(numericIndex) && typeof note === 'string') {
        acc[numericIndex] = { note, color: 'yellow', review: false }
      }
      return acc
    }, {})

    return makeFreeReaderState({ highlights: migratedHighlights })
  } catch {
    return makeFreeReaderState()
  }
}

function saveFreeReaderState(key: string, state: FreeReaderState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FREE_READER_STORAGE_PREFIX + key, JSON.stringify(state))
  } catch {
    /* Storage is progressive enhancement: the reader still works without it. */
  }
}

function formatSavedAt(value: string): string {
  if (!value) return 'Non ancora salvato'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Salvataggio locale'
  return `Salvato ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
}

function toggleNumber(list: number[], value: number): number[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value].sort((a, b) => a - b)
}

function slugifyFileName(value: string): string {
  return normalizeSearchValue(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'unimidoc-note'
}

function downloadTextFile(filename: string, content: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
}

function SearchHighlightedText({ text, query }: { text: string; query: string }) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return <>{text} </>

  const lowerText = text.toLocaleLowerCase('it-IT')
  const lowerQuery = trimmedQuery.toLocaleLowerCase('it-IT')
  const parts: React.ReactNode[] = []
  let cursor = 0
  let matchIndex = lowerText.indexOf(lowerQuery)

  while (matchIndex >= 0) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex))
    parts.push(
      <mark className="reader-search-mark" key={`${matchIndex}-${lowerQuery}`}>
        {text.slice(matchIndex, matchIndex + trimmedQuery.length)}
      </mark>,
    )
    cursor = matchIndex + trimmedQuery.length
    matchIndex = lowerText.indexOf(lowerQuery, cursor)
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts} </>
}

function FlashcardStudyModal({
  cards,
  sentences,
  title,
  onClose,
}: {
  cards: Flashcard[]
  sentences: DocSentence[]
  title: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [answerMode, setAnswerMode] = useState<StudyAnswerMode>('flashcard')
  const [userAnswer, setUserAnswer] = useState('')
  const [answerStatus, setAnswerStatus] = useState<AnswerStatus>('unanswered')
  const [selectedChoice, setSelectedChoice] = useState('')
  const [responseLog, setResponseLog] = useState<Record<string, AnswerStatus>>({})
  const storageKey = `${hashString(title)}-${cards.length}`
  const [srsByCard, setSrsByCard] = useState<Record<string, SrsState>>(() => loadSrsMap(storageKey))
  const [aiHelpMessage, setAiHelpMessage] = useState('')
  const [aiHelpLoading, setAiHelpLoading] = useState(false)
  const readerRef = useRef<HTMLDivElement>(null)

  useBodyScrollLock()

  useEffect(() => {
    setSrsByCard(loadSrsMap(storageKey))
  }, [storageKey])

  const safeIndex = Math.min(index, Math.max(0, cards.length - 1))
  const current = cards[safeIndex]

  const pages = useMemo(() => {
    const grouped = new Map<number, DocSentence[]>()
    for (const sentence of sentences) {
      if (!grouped.has(sentence.page)) grouped.set(sentence.page, [])
      grouped.get(sentence.page)?.push(sentence)
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0])
  }, [sentences])

  const referencedPages = useMemo(
    () => new Set(cards.map((card) => card.ref?.page).filter((page): page is number => Boolean(page))),
    [cards],
  )
  const sourceCoverage = pages.length ? Math.round((referencedPages.size / pages.length) * 100) : 0
  const completedCount = Object.keys(responseLog).length
  const currentSrs = current ? srsByCard[current.id] : null

  const choiceOptions = useMemo(() => {
    if (!current) return []
    const distractors = cards
      .filter((card) => card.id !== current.id && card.back.length <= 120)
      .map((card) => card.back)
      .slice(0, 3)
    const options = [current.back, ...distractors]
    return options
      .map((option, optionIndex) => ({ option, sort: (safeIndex + 1) * (optionIndex + 3) % 7 }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ option }) => option)
  }, [cards, current, safeIndex])

  const tfPrompt = useMemo(() => {
    if (!current) return { statement: '', isTrue: true }
    const wantTrue = hashString(current.id) % 2 === 0
    if (!wantTrue) {
      const distractor = cards.find(
        (card) => card.id !== current.id && card.back !== current.back && card.back.length <= 160,
      )
      if (distractor) return { statement: distractor.back, isTrue: false }
    }
    return { statement: current.back, isTrue: true }
  }, [cards, current])

  useEffect(() => {
    setRevealed(false)
    setUserAnswer('')
    setAnswerStatus('unanswered')
    setSelectedChoice('')
    setAiHelpMessage('')
  }, [safeIndex, answerMode])

  useEffect(() => {
    const node = readerRef.current
    if (!node || !current?.ref) return
    const target = node.querySelector<HTMLElement>(`[data-sent="${current.ref.sentenceIndex}"]`)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [safeIndex, current])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(cards.length - 1, value + 1))
      else if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1))
      else if (event.key === 'Escape') onClose()
      else if (event.key === ' ') {
        event.preventDefault()
        setRevealed((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cards.length, onClose])

  if (!current) return null

  const scrollToSource = () => {
    const node = readerRef.current
    if (!node || !current.ref) return
    node.querySelector<HTMLElement>(`[data-sent="${current.ref.sentenceIndex}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const submitTextAnswer = () => {
    const status = evaluateTextAnswer(userAnswer, current.back)
    if (status === 'unanswered') return
    setAnswerStatus(status)
    setRevealed(true)
    setResponseLog((currentLog) => ({ ...currentLog, [current.id]: status }))
  }

  const markUnknown = () => {
    setAnswerStatus('unknown')
    setRevealed(true)
    setResponseLog((currentLog) => ({ ...currentLog, [current.id]: 'unknown' }))
  }

  const chooseOption = (option: string) => {
    const status: AnswerStatus = option === current.back ? 'correct' : 'incorrect'
    setSelectedChoice(option)
    setAnswerStatus(status)
    setRevealed(true)
    setResponseLog((currentLog) => ({ ...currentLog, [current.id]: status }))
  }

  const chooseTrueFalse = (value: boolean) => {
    const status: AnswerStatus = value === tfPrompt.isTrue ? 'correct' : 'incorrect'
    setSelectedChoice(value ? 'true' : 'false')
    setAnswerStatus(status)
    setRevealed(true)
    setResponseLog((currentLog) => ({ ...currentLog, [current.id]: status }))
  }

  const rateSrs = (rating: SrsRating) => {
    const next = calculateNextReview({
      currentState: currentSrs,
      rating,
      answerStatus: answerStatus === 'unanswered' ? (revealed ? 'correct' : 'skipped') : answerStatus,
    })
    setSrsByCard((state) => {
      const updated = { ...state, [current.id]: next }
      saveSrsMap(storageKey, updated)
      return updated
    })
  }

  const runAiHelp = async (mode: AiHelpMode, label: string) => {
    if (!getPremiumState().isPremium) {
      setAiHelpMessage(`🔒 ${label} è una funzione Premium. Attiva Premium per sbloccarla.`)
      return
    }
    setAiHelpLoading(true)
    setAiHelpMessage(`${label} in corso…`)
    const result = await requestAiHelp({
      mode,
      question: current.front,
      correctAnswer: current.back,
      answerStatus: answerStatus === 'unanswered' ? undefined : answerStatus,
      sourceText: current.ref?.text ?? null,
      flashcardId: current.id,
      language: 'it',
    })
    setAiHelpLoading(false)
    setAiHelpMessage(result.ok ? result.data.content : result.message)
  }

  const nextDueLabel = currentSrs
    ? currentSrs.intervalMinutes >= 24 * 60
      ? `${Math.round(currentSrs.intervalMinutes / (24 * 60))} giorni`
      : `${currentSrs.intervalMinutes} min`
    : null

  return (
    <div className="study-modal" role="dialog" aria-modal="true" aria-label="Studio flashcard">
      <button className="preview-backdrop" onClick={onClose} type="button" aria-label="Chiudi" />
      <div className="study-shell">
        <header className="study-head">
          <div className="study-head-title">
            <GraduationCap size={20} />
            <div>
              <strong>Studio flashcard</strong>
              <small>{title || 'Documento'}</small>
            </div>
          </div>
          <div className="study-top-tabs" aria-label="Sezioni studio">
            <button className="active" type="button"><FileText size={16} /> Fonte {sourceCoverage}%</button>
            <button type="button"><Layers size={16} /> Flashcard {cards.length}</button>
            <button type="button"><CheckCircle2 size={16} /> Quiz</button>
          </div>
          <button className="study-close" onClick={onClose} type="button" aria-label="Chiudi studio">
            <X size={18} />
          </button>
        </header>

        <div className="study-body">
          <div className="study-reader" ref={readerRef}>
            <div className="reader-toolbar">
              <div>
                <strong>Fonte verificabile</strong>
                <small>{completedCount} risposte registrate · {referencedPages.size} pagine coperte</small>
              </div>
              <button onClick={scrollToSource} disabled={!current.ref} type="button">
                <Eye size={15} /> View Source
              </button>
            </div>
            {pages.map(([page, pageSentences]) => (
              <section className="reader-page" key={page}>
                <span className="reader-page-tag">Pagina {page}</span>
                {pageSentences[0]?.section ? <strong className="reader-section">{pageSentences[0].section}</strong> : null}
                <p className="reader-text">
                  {pageSentences.map((sentence) => (
                    <span
                      className={current.ref?.sentenceIndex === sentence.index ? 'reader-sent active' : 'reader-sent'}
                      data-sent={sentence.index}
                      key={sentence.index}
                    >
                      {sentence.text}{' '}
                    </span>
                  ))}
                </p>
              </section>
            ))}
          </div>

          <div className="study-panel">
            <div className="study-counter">
              <span className={`study-tag ${current.source}`}>{flashcardSourceLabels[current.source]}</span>
              <span>{safeIndex + 1} / {cards.length}</span>
            </div>

            <div className="study-mode-tabs" aria-label="Modalità domanda">
              <button className={answerMode === 'flashcard' ? 'active' : ''} onClick={() => setAnswerMode('flashcard')} type="button">Card</button>
              <button className={answerMode === 'typing' ? 'active' : ''} onClick={() => setAnswerMode('typing')} type="button">Scrivi</button>
              <button className={answerMode === 'choice' ? 'active' : ''} onClick={() => setAnswerMode('choice')} disabled={choiceOptions.length < 3} type="button">Scelta</button>
              <button className={answerMode === 'truefalse' ? 'active' : ''} onClick={() => setAnswerMode('truefalse')} type="button">V/F</button>
            </div>

            {answerMode === 'flashcard' ? (
              <button
                className={`study-card ${revealed ? 'revealed' : ''}`}
                onClick={() => setRevealed((value) => !value)}
                type="button"
              >
                <span className="study-card-role">Domanda</span>
                <p className="study-card-front">{current.front}</p>
                <span className="study-card-divider" />
                {revealed ? (
                  <>
                    <span className="study-card-role">Risposta</span>
                    <p className="study-card-back">{current.back}</p>
                  </>
                ) : (
                  <span className="study-card-hint">Tocca o premi spazio per la risposta</span>
                )}
              </button>
            ) : null}

            {answerMode === 'typing' ? (
              <div className="study-answer-box">
                <span className="study-card-role">{current.source === 'cloze' ? 'Fill-in-the-blanks' : 'Free typing answer'}</span>
                <p className="study-card-front">{current.front}</p>
                <textarea
                  onChange={(event) => setUserAnswer(event.target.value)}
                  placeholder="Scrivi la risposta senza guardare..."
                  rows={3}
                  value={userAnswer}
                />
                <div className="study-answer-actions">
                  <button onClick={submitTextAnswer} type="button">Controlla</button>
                  <button onClick={markUnknown} type="button">Non lo so</button>
                </div>
              </div>
            ) : null}

            {answerMode === 'choice' ? (
              <div className="study-answer-box">
                <span className="study-card-role">Multiple choice</span>
                <p className="study-card-front">{current.front}</p>
                <div className="choice-list">
                  {choiceOptions.map((option) => {
                    const selected = selectedChoice === option
                    const correct = revealed && option === current.back
                    return (
                      <button
                        className={`${selected ? 'selected' : ''} ${correct ? 'correct' : ''} ${selected && answerStatus === 'incorrect' ? 'incorrect' : ''}`}
                        disabled={revealed}
                        key={option}
                        onClick={() => chooseOption(option)}
                        type="button"
                      >
                        {option}
                      </button>
                    )
                  })}
                </div>
                {!revealed ? <button className="unknown-link" onClick={markUnknown} type="button">Non lo so</button> : null}
              </div>
            ) : null}

            {answerMode === 'truefalse' ? (
              <div className="study-answer-box">
                <span className="study-card-role">Vero o falso?</span>
                <p className="study-card-front">{tfPrompt.statement}</p>
                <div className="truefalse-actions">
                  <button
                    className={`${selectedChoice === 'true' ? 'selected' : ''} ${revealed && tfPrompt.isTrue ? 'correct' : ''} ${revealed && selectedChoice === 'true' && !tfPrompt.isTrue ? 'incorrect' : ''}`}
                    disabled={revealed}
                    onClick={() => chooseTrueFalse(true)}
                    type="button"
                  >
                    Vero
                  </button>
                  <button
                    className={`${selectedChoice === 'false' ? 'selected' : ''} ${revealed && !tfPrompt.isTrue ? 'correct' : ''} ${revealed && selectedChoice === 'false' && tfPrompt.isTrue ? 'incorrect' : ''}`}
                    disabled={revealed}
                    onClick={() => chooseTrueFalse(false)}
                    type="button"
                  >
                    Falso
                  </button>
                  <button disabled={revealed} onClick={markUnknown} type="button">Non lo so</button>
                </div>
              </div>
            ) : null}

            {answerStatus !== 'unanswered' ? (
              <div className={`study-feedback ${answerStatus}`}>
                <strong>{answerStatusLabels[answerStatus]}</strong>
                <span>
                  {answerStatus === 'correct'
                    ? 'Risposta agganciata bene al concetto.'
                    : answerStatus === 'partial'
                      ? 'Ci sei vicino: confronta la risposta esatta e riprova più tardi.'
                      : answerStatus === 'unknown'
                        ? 'Ottimo segnalarlo: la carta tornerà presto nel ripasso.'
                        : 'Guarda la fonte e correggi il punto debole prima di andare avanti.'}
                </span>
                <em>
                  {answerMode === 'truefalse'
                    ? `Affermazione ${tfPrompt.isTrue ? 'vera' : 'falsa'}`
                    : `Risposta corretta: ${current.back}`}
                </em>
              </div>
            ) : null}

            {current.ref ? (
              <div className="study-source">
                <Eye size={14} /> Fonte evidenziata · pagina {current.ref.page}
                {current.ref.section ? <span> · {current.ref.section}</span> : null}
              </div>
            ) : (
              <div className="study-source muted"><Eye size={14} /> Carta aggiunta manualmente</div>
            )}

            <div className="ai-help-panel">
              <span><Sparkles size={15} /> AI Helps Premium</span>
              <div>
                {(
                  [
                    ['explain', 'Explain'],
                    ['example', 'Example'],
                    ['memo', 'Memo'],
                    ['visualize', 'Visualize'],
                  ] as [AiHelpMode, string][]
                ).map(([mode, label]) => (
                  <button disabled={aiHelpLoading} key={mode} onClick={() => runAiHelp(mode, label)} type="button">
                    {label}
                  </button>
                ))}
              </div>
              {aiHelpMessage ? <small>{aiHelpMessage}</small> : null}
            </div>

            {(revealed || answerStatus !== 'unanswered') ? (
              <div className="srs-panel">
                <span>Ripetizione spaziata{nextDueLabel ? ` · prossima tra ${nextDueLabel}` : ''}</span>
                <div>
                  {(Object.keys(srsRatingLabels) as SrsRating[]).map((rating) => (
                    <button key={rating} onClick={() => rateSrs(rating)} type="button">
                      {srsRatingLabels[rating]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="study-nav">
              <button onClick={() => setIndex(0)} disabled={safeIndex === 0} type="button" aria-label="Prima carta">
                <ChevronsLeft size={18} />
              </button>
              <button onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={safeIndex === 0} type="button" aria-label="Carta precedente">
                <ChevronLeft size={18} />
              </button>
              <div className="study-progress">
                <span style={{ width: `${((safeIndex + 1) / cards.length) * 100}%` }} />
              </div>
              <button onClick={() => setIndex((value) => Math.min(cards.length - 1, value + 1))} disabled={safeIndex === cards.length - 1} type="button" aria-label="Carta successiva">
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setIndex(cards.length - 1)} disabled={safeIndex === cards.length - 1} type="button" aria-label="Ultima carta">
                <ChevronsRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FlashcardGenerationSummary({
  analysis,
  cards,
  steps,
}: {
  analysis: PdfAnalysis
  cards: Flashcard[]
  steps: PipelineStep[]
}) {
  const usedPages = new Set(cards.map((card) => card.ref?.page).filter((page): page is number => Boolean(page)))
  const coverage = analysis.pageCount ? Math.round((usedPages.size / analysis.pageCount) * 100) : 0
  const doneSteps = steps.filter((step) => step.status === 'done').length
  const activeStep = steps.find((step) => step.status === 'running') ?? steps.find((step) => step.status === 'pending')
  const checklist = [
    { label: 'Lettura documento', done: steps.some((step) => step.key === 'read' && step.status === 'done') },
    { label: 'Concetti principali', done: cards.length > 0 || steps.some((step) => step.key === 'flashcards' && step.status === 'done') },
    { label: 'Generazione flashcard', done: cards.length > 0 },
    { label: 'Deduplica e quality gate', done: steps.some((step) => step.key === 'flashcards' && step.status === 'done') },
    { label: 'Deck pronto', done: steps.some((step) => step.key === 'finalize' && step.status === 'done') },
  ]

  return (
    <aside className="generation-summary" aria-label="Avanzamento generazione flashcard">
      <div className="generation-summary-head">
        <span><Sparkles size={18} /></span>
        <div>
          <strong>Generazione deck</strong>
          <small>{activeStep ? activeStep.detail : 'Pronto per la revisione'}</small>
        </div>
      </div>
      <ul>
        {checklist.map((item) => (
          <li className={item.done ? 'done' : ''} key={item.label}>
            <PipelineIcon status={item.done ? 'done' : 'pending'} />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="generation-stats">
        <div><strong>{cards.length}</strong><span>card</span></div>
        <div><strong>{coverage}%</strong><span>copertura</span></div>
        <div><strong>{doneSteps}/{steps.length}</strong><span>step</span></div>
      </div>
      <small>{usedPages.size} pagine sorgente usate su {analysis.pageCount}. Se vuoi più profondità, passa al livello Premium.</small>
    </aside>
  )
}

type OcclusionMask = {
  id: string
  page: number
  label: string
  x: number
  y: number
  width: number
  height: number
  answer: string
  hint: string
}

type OcclusionDragState = {
  mode: 'move' | 'resize'
  id: string
  startClientX: number
  startClientY: number
  originX: number
  originY: number
  originWidth: number
  originHeight: number
}

// Rubber-band draw of a brand-new mask (drag on empty canvas).
type OcclusionDraftState = {
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

const initialOcclusionMasks: OcclusionMask[] = [
  { id: 'mask-1', page: 1, label: '1', x: 0.56, y: 0.2, width: 0.26, height: 0.08, answer: 'Epitelio di rivestimento', hint: 'È lo strato più superficiale' },
  { id: 'mask-2', page: 1, label: '2', x: 0.16, y: 0.45, width: 0.24, height: 0.09, answer: 'Connettivo', hint: 'Sostiene il tessuto' },
  { id: 'mask-3', page: 1, label: '3', x: 0.58, y: 0.6, width: 0.28, height: 0.1, answer: 'Vaso sanguigno', hint: 'Trasporta cellule e nutrienti' },
]

function clampUnit(value: number, min = 0, max = 1) {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeOcclusionMask(mask: OcclusionMask): OcclusionMask {
  const width = clampUnit(mask.width, 0.04, 0.96)
  const height = clampUnit(mask.height, 0.035, 0.96)

  return {
    ...mask,
    width,
    height,
    x: clampUnit(mask.x, 0, 1 - width),
    y: clampUnit(mask.y, 0, 1 - height),
  }
}

function ImageOcclusionLab({ analysis, premium }: { analysis?: PdfAnalysis | null; premium: boolean }) {
  const renderedPages = analysis?.renderedPages ?? []
  const visualPages = renderedPages.length
    ? renderedPages
    : [{ page: 1, dataUrl: demoPage03, width: 900, height: 1200, textChars: 0, imageCount: 1, figureCount: 1, figureScore: 0.8, reason: 'overview' as const }]
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<OcclusionDragState | null>(null)
  const draftRef = useRef<OcclusionDraftState | null>(null)
  const [draft, setDraft] = useState<OcclusionDraftState | null>(null)
  const [selectedPage, setSelectedPage] = useState(visualPages[0]?.page ?? 1)
  const [masks, setMasks] = useState<OcclusionMask[]>(() => (renderedPages.length ? [] : initialOcclusionMasks))
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null)
  const [draggingMaskId, setDraggingMaskId] = useState<string | null>(null)
  const [suppressCanvasClick, setSuppressCanvasClick] = useState(false)
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const activePage = visualPages.find((page) => page.page === selectedPage) ?? visualPages[0]
  const activeMasks = masks.filter((mask) => mask.page === activePage.page)

  useEffect(() => {
    const first = visualPages[0]?.page ?? 1
    setSelectedPage(first)
    setMasks(renderedPages.length ? [] : initialOcclusionMasks)
    setSelectedMaskId(null)
  }, [renderedPages.length, visualPages[0]?.page])

  useEffect(() => {
    if (selectedMaskId && masks.some((mask) => mask.id === selectedMaskId && mask.page === activePage.page)) return
    setSelectedMaskId(activeMasks[0]?.id ?? null)
  }, [activeMasks, activePage.page, masks, selectedMaskId])

  const addMask = (position?: { x: number; y: number }) => {
    const nextNumber = masks.length + 1
    const id = `mask-${Date.now()}`
    const nextMask = normalizeOcclusionMask({
      id,
      page: activePage.page,
      label: `${nextNumber}`,
      x: position?.x ?? 0.18 + activeMasks.length * 0.08,
      y: position?.y ?? 0.24 + activeMasks.length * 0.07,
      width: 0.22,
      height: 0.08,
      answer: `Risposta ${nextNumber}`,
      hint: 'Aggiungi un indizio breve',
    })

    setMasks((current) => [...current, nextMask])
    setSelectedMaskId(id)
  }

  // Commit a rubber-band draft as a real mask (ignores tiny accidental drags).
  const addMaskFromRect = (rect: { x: number; y: number; width: number; height: number }) => {
    if (rect.width < 0.03 || rect.height < 0.025) return false
    const nextNumber = masks.length + 1
    const id = `mask-${Date.now()}`
    const nextMask = normalizeOcclusionMask({
      id,
      page: activePage.page,
      label: `${nextNumber}`,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      answer: `Risposta ${nextNumber}`,
      hint: 'Aggiungi un indizio breve',
    })
    setMasks((current) => [...current, nextMask])
    setSelectedMaskId(id)
    return true
  }

  const updateMask = (id: string, patch: Partial<OcclusionMask>) => {
    setMasks((current) =>
      current.map((mask) => (mask.id === id ? normalizeOcclusionMask({ ...mask, ...patch }) : mask)),
    )
  }

  const removeMask = (id: string) => {
    setMasks((current) => current.filter((mask) => mask.id !== id))
    if (selectedMaskId === id) {
      setSelectedMaskId(activeMasks.find((mask) => mask.id !== id)?.id ?? null)
    }
  }

  const updateMaskPercent = (id: string, key: 'x' | 'y' | 'width' | 'height', value: string) => {
    const numberValue = Number.parseFloat(value)
    if (Number.isNaN(numberValue)) return
    updateMask(id, { [key]: numberValue / 100 })
  }

  const beginDrag = (event: React.PointerEvent<HTMLElement>, mask: OcclusionMask, mode: 'move' | 'resize') => {
    if (preview) return
    event.preventDefault()
    event.stopPropagation()
    setSuppressCanvasClick(true)
    setSelectedMaskId(mask.id)
    setDraggingMaskId(mask.id)
    dragRef.current = {
      mode,
      id: mask.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: mask.x,
      originY: mask.y,
      originWidth: mask.width,
      originHeight: mask.height,
    }
  }

  // Start drawing a new mask by dragging on empty canvas area.
  const beginDraw = (event: React.PointerEvent<HTMLDivElement>) => {
    if (preview) return
    if ((event.target as HTMLElement).closest('.occlusion-mask')) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clampUnit((event.clientX - rect.left) / rect.width)
    const y = clampUnit((event.clientY - rect.top) / rect.height)
    draftRef.current = { startX: x, startY: y, x, y, width: 0, height: 0 }
    setDraft(draftRef.current)
    setSuppressCanvasClick(true)
  }

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const drawing = draftRef.current
    if (drawing) {
      const px = clampUnit((event.clientX - rect.left) / rect.width)
      const py = clampUnit((event.clientY - rect.top) / rect.height)
      const next: OcclusionDraftState = {
        startX: drawing.startX,
        startY: drawing.startY,
        x: Math.min(drawing.startX, px),
        y: Math.min(drawing.startY, py),
        width: Math.abs(px - drawing.startX),
        height: Math.abs(py - drawing.startY),
      }
      draftRef.current = next
      setDraft(next)
      return
    }

    const drag = dragRef.current
    if (!drag) return
    const deltaX = (event.clientX - drag.startClientX) / rect.width
    const deltaY = (event.clientY - drag.startClientY) / rect.height

    if (drag.mode === 'move') {
      updateMask(drag.id, {
        x: drag.originX + deltaX,
        y: drag.originY + deltaY,
      })
      return
    }

    updateMask(drag.id, {
      width: drag.originWidth + deltaX,
      height: drag.originHeight + deltaY,
    })
  }

  const endDrag = () => {
    if (draftRef.current) {
      const { x, y, width, height } = draftRef.current
      draftRef.current = null
      setDraft(null)
      addMaskFromRect({ x, y, width, height })
      window.setTimeout(() => setSuppressCanvasClick(false), 0)
      return
    }
    if (!dragRef.current) return
    dragRef.current = null
    setDraggingMaskId(null)
    window.setTimeout(() => setSuppressCanvasClick(false), 0)
  }

  // Keyboard precision: arrows nudge, shift+arrows resize, Delete removes.
  const handleMaskKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, mask: OcclusionMask) => {
    const step = event.altKey ? 0.005 : 0.02
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelectedMaskId(mask.id)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeMask(mask.id)
      return
    }
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    }
    const delta = arrows[event.key]
    if (!delta) return
    event.preventDefault()
    if (event.shiftKey) {
      updateMask(mask.id, { width: mask.width + delta[0], height: mask.height + delta[1] })
    } else {
      updateMask(mask.id, { x: mask.x + delta[0], y: mask.y + delta[1] })
    }
  }

  const resetPageMasks = () => {
    setMasks((current) => current.filter((mask) => mask.page !== activePage.page))
    setSelectedMaskId(null)
  }

  const addMaskFromCanvas = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressCanvasClick || (event.target as HTMLElement).closest('.occlusion-mask')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    addMask({ x: x - 0.11, y: y - 0.04 })
  }

  const runAiAssist = async () => {
    if (!premium) {
      setNotice('Auto-detect è Premium: il vision backend propone label e coordinate senza esporre chiavi nel frontend.')
      return
    }
    if (aiBusy) return

    const src = activePage.dataUrl
    const comma = src.indexOf(',')
    // Only real rendered pages carry a base64 data URL; the demo image is a bundled asset.
    if (comma < 0 || !src.startsWith('data:image/')) {
      setNotice('Questa pagina non è uno snapshot analizzabile: carica un PDF per usare il rilevamento automatico.')
      return
    }
    const imageBase64 = src.slice(comma + 1)
    const mimeType = src.slice(5, comma).split(';')[0] || 'image/png'

    setAiBusy(true)
    setNotice('Analisi vision in corso: rilevo etichette e strutture della figura…')
    try {
      const res = await autoDetectOcclusion({
        imageBase64,
        mimeType,
        pageNumber: activePage.page,
        language: analysis?.language ?? 'it',
      })
      if (!res.ok) {
        setNotice(res.message)
        return
      }
      const candidates = (res.data.occlusion_candidates ?? []) as Array<{
        label?: string
        answer?: string
        hint?: string
        bbox?: { x: number; y: number; width: number; height: number }
      }>
      const detected = candidates
        .filter((candidate) => candidate.bbox)
        .map((candidate, index) =>
          normalizeOcclusionMask({
            id: `ai-${Date.now()}-${index}`,
            page: activePage.page,
            label: `${index + 1}`,
            x: candidate.bbox!.x,
            y: candidate.bbox!.y,
            width: candidate.bbox!.width,
            height: candidate.bbox!.height,
            answer: (candidate.answer ?? candidate.label ?? `Struttura ${index + 1}`).slice(0, 160),
            hint: (candidate.hint ?? '').slice(0, 160),
          }),
        )
      if (!detected.length) {
        setNotice('Nessuna etichetta rilevata: la pagina probabilmente non è una figura con strutture nominate. Prova un’altra pagina o disegna a mano.')
        return
      }
      // Keep manual masks, replace any previous AI masks on this page.
      setMasks((current) => [
        ...current.filter((mask) => mask.page !== activePage.page || !mask.id.startsWith('ai-')),
        ...detected,
      ])
      setSelectedMaskId(detected[0].id)
      setNotice(`${detected.length} area${detected.length === 1 ? '' : 'e'} rilevate dall’AI: verifica label e risposta prima di salvare.`)
    } catch {
      setNotice('Errore durante l’analisi vision. Riprova tra poco.')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <section className="occlusion-lab" aria-label="Image occlusion">
      <div className="occlusion-head">
        <div>
          <h3><ScanLine size={18} /> Image occlusion</h3>
          <p>
            Disegna trascinando sulla pagina per creare una maschera, spostala col drag, usa l’angolo per
            ridimensionarla. Con la maschera selezionata: frecce per spostare, Shift+frecce per ridimensionare,
            Canc per eliminare. Correggi label, risposta e hint quando vuoi.
          </p>
        </div>
        <div className="occlusion-actions">
          <button onClick={() => addMask()} type="button"><Plus size={15} /> Maschera</button>
          <button onClick={() => void runAiAssist()} type="button" disabled={aiBusy}>
            <Sparkles size={15} /> {aiBusy ? 'Analisi…' : 'Auto-detect'}
          </button>
          <button onClick={() => setPreview((value) => !value)} type="button"><Eye size={15} /> Preview</button>
        </div>
      </div>

      {!renderedPages.length ? (
        <p className="occlusion-notice">
          Nessuna pagina renderizzata dal PDF disponibile in questa sessione: mostro una demo. Su PDF caricati,
          il renderer crea pagine visuali candidate per occlusion.
        </p>
      ) : null}
      {notice ? (
        <p className="occlusion-notice">{notice}</p>
      ) : null}

      {renderedPages.length ? (
        <>
          {visualPages.some((page) => (page.figureCount ?? 0) > 0 || (page.figureScore ?? 0) >= 0.25) ? (
            <p className="occlusion-figure-hint">
              <ScanLine size={14} /> Le pagine con <strong>figure reali</strong> sono evidenziate: scegli quelle per creare esercizi visivi sugli schemi.
            </p>
          ) : null}
          <div className="occlusion-page-strip" aria-label="Pagine renderizzate">
            {visualPages.map((page) => {
              const hasFigure = (page.figureCount ?? 0) > 0 || (page.figureScore ?? 0) >= 0.25
              const figureLabel = page.figureCount ? `${page.figureCount} figure` : page.vectorOpCount ? 'schema' : 'figura'
              return (
                <button
                  className={`${page.page === activePage.page ? 'active' : ''} ${hasFigure ? 'has-figure' : ''}`}
                  onClick={() => setSelectedPage(page.page)}
                  type="button"
                  key={page.page}
                >
                  <img src={page.dataUrl} alt={`Pagina ${page.page}`} />
                  <span>p. {page.page}</span>
                  <em>{hasFigure ? figureLabel : page.reason === 'ocr' ? 'OCR' : 'testo'}</em>
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      <div className="occlusion-workbench">
        <div
          className={`occlusion-canvas ${preview ? 'preview' : ''} ${draft ? 'drawing' : ''}`}
          onClick={addMaskFromCanvas}
          onPointerDown={beginDraw}
          onPointerLeave={endDrag}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={endDrag}
          ref={canvasRef}
        >
          <img src={activePage.dataUrl} alt={`Pagina ${activePage.page} per image occlusion`} draggable={false} />
          {draft ? (
            <div
              aria-hidden="true"
              className="occlusion-draft"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.width * 100}%`,
                height: `${draft.height * 100}%`,
              }}
            />
          ) : null}
          {activeMasks.map((mask, index) => {
            const selected = mask.id === selectedMaskId
            return (
              <div
                aria-label={`Maschera ${mask.label || index + 1}`}
                className={`occlusion-mask ${selected ? 'selected' : ''} ${draggingMaskId === mask.id ? 'dragging' : ''}`}
                key={mask.id}
                onClick={(event) => {
                  event.stopPropagation()
                  setSelectedMaskId(mask.id)
                }}
                onKeyDown={(event) => handleMaskKeyDown(event, mask)}
                onPointerDown={(event) => beginDrag(event, mask, 'move')}
                role="button"
                style={{
                  left: `${mask.x * 100}%`,
                  top: `${mask.y * 100}%`,
                  width: `${mask.width * 100}%`,
                  height: `${mask.height * 100}%`,
                }}
                tabIndex={0}
                title={preview ? mask.answer : 'Trascina per spostare la maschera'}
              >
                <span className="occlusion-mask-label">{preview ? index + 1 : mask.label || mask.answer}</span>
                {!preview ? (
                  <span
                    aria-hidden="true"
                    className="occlusion-resize-handle"
                    onPointerDown={(event) => beginDrag(event, mask, 'resize')}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="occlusion-editor">
          <div className="occlusion-editor-head">
            <strong>{activeMasks.length} card · pagina {activePage.page}</strong>
            <button onClick={resetPageMasks} type="button">Elimina pagina</button>
          </div>
          <div className="occlusion-source-note">
            <span>{activePage.width}×{activePage.height}px</span>
            <span>{activePage.figureCount ?? 0} figure reali</span>
            <span>{activePage.imageCount} immagini totali</span>
            <span>{activePage.textChars} caratteri testo</span>
          </div>
          <p className="occlusion-save-note">
            Coordinate salvate in percentuale: il backend può ricostruire la maschera anche se la pagina viene
            mostrata a dimensioni diverse.
          </p>
          {activeMasks.length ? activeMasks.map((mask, index) => (
            <article className={mask.id === selectedMaskId ? 'selected' : ''} key={mask.id}>
              <button className="occlusion-card-index" onClick={() => setSelectedMaskId(mask.id)} type="button">{index + 1}</button>
              <label>
                Label
                <input onChange={(event) => updateMask(mask.id, { label: event.target.value })} value={mask.label} />
              </label>
              <label>
                Risposta
                <input onChange={(event) => updateMask(mask.id, { answer: event.target.value })} value={mask.answer} />
              </label>
              <label>
                Hint
                <input onChange={(event) => updateMask(mask.id, { hint: event.target.value })} value={mask.hint} />
              </label>
              <div className="occlusion-position-grid">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={key}>
                    {key === 'width' ? 'W' : key === 'height' ? 'H' : key.toUpperCase()} %
                    <input
                      max={100}
                      min={0}
                      onChange={(event) => updateMaskPercent(mask.id, key, event.target.value)}
                      step={1}
                      type="number"
                      value={Math.round(mask[key] * 100)}
                    />
                  </label>
                ))}
              </div>
              <div className="occlusion-card-actions">
                <small>x {Math.round(mask.x * 100)}% · y {Math.round(mask.y * 100)}% · w {Math.round(mask.width * 100)}% · h {Math.round(mask.height * 100)}%</small>
                <button onClick={() => removeMask(mask.id)} type="button"><Trash2 size={14} /> Elimina</button>
              </div>
            </article>
          )) : (
            <p className="occlusion-empty">Clicca sulla pagina o usa “Maschera” per creare la prima card visuale.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function FreeStudyToolsPanel({
  analysis,
  storageKey,
  title,
  onPremium,
}: {
  analysis: PdfAnalysis
  storageKey: string
  title: string
  onPremium: () => void
}) {
  const sentences = analysis.sentences
  const outline = analysis.outline ?? []
  const review = analysis.review
  const [readerState, setReaderState] = useState<FreeReaderState>(() => loadFreeReaderState(storageKey))
  const [query, setQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const [view, setView] = useState<FreeReaderView>('all')
  const [notice, setNotice] = useState('')
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setReaderState(loadFreeReaderState(storageKey))
    setView('all')
    setQuery('')
    setActiveMatchIndex(0)
  }, [storageKey])

  useEffect(() => {
    saveFreeReaderState(storageKey, readerState)
  }, [readerState, storageKey])

  const pages = useMemo(() => {
    const grouped = new Map<number, DocSentence[]>()
    for (const sentence of sentences) {
      if (!grouped.has(sentence.page)) grouped.set(sentence.page, [])
      grouped.get(sentence.page)?.push(sentence)
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0])
  }, [sentences])

  const sentenceByIndex = useMemo(() => new Map(sentences.map((sentence) => [sentence.index, sentence])), [sentences])
  const readPageSet = useMemo(() => new Set(readerState.readPages), [readerState.readPages])
  const bookmarkedPageSet = useMemo(() => new Set(readerState.bookmarkedPages), [readerState.bookmarkedPages])
  const highlightIds = Object.keys(readerState.highlights).map(Number).sort((a, b) => a - b)
  const noteCount = highlightIds.filter((index) => readerState.highlights[index]?.note.trim()).length
  const reviewCount = highlightIds.filter((index) => readerState.highlights[index]?.review).length
  const readProgress = pages.length ? Math.round((readPageSet.size / pages.length) * 100) : 0
  const normalizedQuery = normalizeSearchValue(query)

  const sentenceMatchesView = (sentence: DocSentence) => {
    if (view === 'highlights') return sentence.index in readerState.highlights
    if (view === 'review') return Boolean(readerState.highlights[sentence.index]?.review)
    if (view === 'bookmarks') return bookmarkedPageSet.has(sentence.page)
    return true
  }

  const visiblePages = useMemo(
    () =>
      pages
        .map(([page, pageSentences]) => [page, pageSentences.filter(sentenceMatchesView)] as [number, DocSentence[]])
        .filter(([, pageSentences]) => pageSentences.length > 0),
    [bookmarkedPageSet, pages, readerState.highlights, view],
  )

  const searchMatches = useMemo(
    () =>
      normalizedQuery
        ? sentences.filter((sentence) => sentenceMatchesView(sentence) && normalizeSearchValue(sentence.text).includes(normalizedQuery))
        : [],
    [bookmarkedPageSet, normalizedQuery, readerState.highlights, sentences, view],
  )

  const activeMatch = searchMatches[activeMatchIndex] ?? null

  useEffect(() => {
    setActiveMatchIndex(0)
  }, [normalizedQuery, view])

  useEffect(() => {
    if (activeMatchIndex >= searchMatches.length) setActiveMatchIndex(Math.max(0, searchMatches.length - 1))
  }, [activeMatchIndex, searchMatches.length])

  useEffect(() => {
    if (!activeMatch) return
    docRef.current
      ?.querySelector<HTMLElement>(`[data-free-sent="${activeMatch.index}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatch])

  const updateReaderState = (updater: (current: FreeReaderState) => FreeReaderState) => {
    setReaderState((current) => makeFreeReaderState({ ...updater(current), updatedAt: new Date().toISOString() }))
  }

  const toggleHighlight = (index: number) =>
    updateReaderState((current) => {
      const highlights = { ...current.highlights }
      if (index in highlights) {
        delete highlights[index]
      } else {
        highlights[index] = { note: '', color: 'yellow', review: false }
      }
      return { ...current, highlights }
    })

  const updateHighlight = (index: number, patch: Partial<FreeHighlight>) => {
    updateReaderState((current) => ({
      ...current,
      highlights: {
        ...current.highlights,
        [index]: { ...(current.highlights[index] ?? { note: '', color: 'yellow' as const, review: false }), ...patch },
      },
    }))
  }

  const clearReader = () => {
    updateReaderState((current) => ({ ...current, highlights: {}, readPages: [], bookmarkedPages: [] }))
    setNotice('Reader pulito. Puoi ripartire da zero.')
  }

  const toggleReadPage = (page: number) =>
    updateReaderState((current) => ({ ...current, readPages: toggleNumber(current.readPages, page) }))

  const toggleBookmarkPage = (page: number) =>
    updateReaderState((current) => ({ ...current, bookmarkedPages: toggleNumber(current.bookmarkedPages, page) }))

  const moveMatch = (direction: 1 | -1) => {
    if (!searchMatches.length) return
    setActiveMatchIndex((current) => (current + direction + searchMatches.length) % searchMatches.length)
  }

  const scrollToPage = (page: number) => {
    docRef.current
      ?.querySelector<HTMLElement>(`[data-free-page="${page}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const sectionOutline = useMemo(() => {
    const rows = new Map<string, { section: string; page: number; total: number; marked: number }>()
    for (const sentence of sentences) {
      const section = sentence.section ?? `Pagina ${sentence.page}`
      const key = `${section}-${sentence.page}`
      const current = rows.get(key) ?? { section, page: sentence.page, total: 0, marked: 0 }
      current.total += 1
      if (sentence.index in readerState.highlights) current.marked += 1
      rows.set(key, current)
    }
    return [...rows.values()].slice(0, 8)
  }, [readerState.highlights, sentences])

  const exportMarkdown = useMemo(() => {
    const lines = [
      `# Note UnimiDoc - ${title || 'Documento'}`,
      '',
      `Esportato il ${new Date().toLocaleString('it-IT')}`,
      `Progresso lettura: ${readProgress}%`,
      `Evidenziazioni: ${highlightIds.length}`,
      `Da ripassare: ${reviewCount}`,
      '',
      '## Evidenziazioni e note',
      '',
    ]

    if (!highlightIds.length) {
      lines.push('Nessuna evidenziazione salvata.')
      return lines.join('\n')
    }

    for (const index of highlightIds) {
      const sentence = sentenceByIndex.get(index)
      const highlight = readerState.highlights[index]
      if (!sentence || !highlight) continue
      lines.push(`### Pagina ${sentence.page}${sentence.section ? ` - ${sentence.section}` : ''}`)
      lines.push(`> ${sentence.text}`)
      if (highlight.note.trim()) lines.push('', `Nota: ${highlight.note.trim()}`)
      if (highlight.review) lines.push('', 'Stato: da ripassare')
      lines.push('')
    }

    return lines.join('\n')
  }, [highlightIds, readerState.highlights, readProgress, reviewCount, sentenceByIndex, title])

  const copyNotes = async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown)
      setNotice('Note copiate negli appunti.')
    } catch {
      setNotice('Copia non disponibile nel browser: puoi scaricare il file Markdown.')
    }
  }

  const exportNotes = () => {
    downloadTextFile(`${slugifyFileName(title)}-note-unimidoc.md`, exportMarkdown)
    setNotice('File Markdown pronto con note, pagine e riferimenti.')
  }

  return (
    <section className="free-study-tools free-reader" aria-label="Strumenti gratuiti sul documento">
      <div className="free-tools-head">
        <span><Highlighter size={20} /></span>
        <div>
          <h3>Reader studio · gratis</h3>
          <p>
            Cerca nel documento, evidenzia i passaggi importanti, salva note locali, crea una coda manuale
            di ripasso ed esporta tutto. Le flashcard automatiche restano Premium per avere deck davvero curati.
          </p>
        </div>
      </div>

      <div className="free-reader-stats" aria-label="Stato del reader gratuito">
        <article>
          <strong>{readProgress}%</strong>
          <span>letto</span>
        </article>
        <article>
          <strong>{highlightIds.length}</strong>
          <span>evidenziate</span>
        </article>
        <article>
          <strong>{noteCount}</strong>
          <span>note</span>
        </article>
        <article>
          <strong>{reviewCount}</strong>
          <span>da ripassare</span>
        </article>
      </div>

      <div className="free-reader-toolbar">
        <label className="free-search-field">
          <Search size={16} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca nel testo, es. mitosi, membrana, enzima..."
            value={query}
          />
        </label>
        <div className="free-search-actions" aria-label="Navigazione risultati">
          <button disabled={!searchMatches.length} onClick={() => moveMatch(-1)} type="button" aria-label="Risultato precedente">
            <ChevronLeft size={16} />
          </button>
          <span>{normalizedQuery ? `${searchMatches.length ? activeMatchIndex + 1 : 0}/${searchMatches.length}` : 'Cerca'}</span>
          <button disabled={!searchMatches.length} onClick={() => moveMatch(1)} type="button" aria-label="Risultato successivo">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="free-reader-view-tabs" aria-label="Filtro reader">
        {(
          [
            ['all', 'Tutto', <BookOpen size={15} />],
            ['highlights', 'Evidenziati', <Highlighter size={15} />],
            ['review', 'Ripasso', <ListChecks size={15} />],
            ['bookmarks', 'Segnalibri', <Bookmark size={15} />],
          ] as [FreeReaderView, string, React.ReactNode][]
        ).map(([key, label, icon]) => (
          <button className={view === key ? 'active' : ''} onClick={() => setView(key)} type="button" key={key}>
            {icon}
            {label}
          </button>
        ))}
      </div>

      <div className="free-reader-body">
        <div className="free-reader-doc" ref={docRef}>
          {visiblePages.length ? (
            visiblePages.map(([page, pageSentences]) => {
              const isRead = readPageSet.has(page)
              const isBookmarked = bookmarkedPageSet.has(page)
              return (
                <section className={`reader-page ${isRead ? 'read' : ''}`} data-free-page={page} key={page}>
                  <div className="reader-page-top">
                    <span className="reader-page-tag">Pagina {page}</span>
                    <div>
                      <button className={isRead ? 'active' : ''} onClick={() => toggleReadPage(page)} type="button">
                        <Check size={14} /> Letta
                      </button>
                      <button className={isBookmarked ? 'active' : ''} onClick={() => toggleBookmarkPage(page)} type="button">
                        <Bookmark size={14} /> Salva
                      </button>
                    </div>
                  </div>
                  {pageSentences[0]?.section ? <strong className="reader-section">{pageSentences[0].section}</strong> : null}
                  <p className="reader-text">
                    {pageSentences.map((sentence) => {
                      const highlight = readerState.highlights[sentence.index]
                      const isActiveMatch = activeMatch?.index === sentence.index
                      return (
                        <span
                          className={`reader-sent selectable ${highlight ? `highlighted color-${highlight.color}` : ''} ${isActiveMatch ? 'search-active' : ''}`}
                          data-free-sent={sentence.index}
                          key={sentence.index}
                          onClick={() => toggleHighlight(sentence.index)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              toggleHighlight(sentence.index)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <SearchHighlightedText text={sentence.text} query={query} />
                        </span>
                      )
                    })}
                  </p>
                </section>
              )
            })
          ) : (
            <div className="free-reader-empty-state">
              <PanelRight size={22} />
              <strong>Niente da mostrare qui.</strong>
              <span>Cambia filtro o aggiungi una nuova evidenziazione dal testo completo.</span>
            </div>
          )}
        </div>

        <aside className="free-reader-notes">
          <div className="free-notes-head">
            <div>
              <strong>{highlightIds.length} evidenziazioni</strong>
              <small>{formatSavedAt(readerState.updatedAt)}</small>
            </div>
            <div>
              <button onClick={copyNotes} disabled={!highlightIds.length} type="button"><Clipboard size={13} /> Copia</button>
              <button onClick={exportNotes} type="button"><FileDown size={13} /> Export</button>
            </div>
          </div>

          <div className="free-outline-card">
            <div>
              <Target size={15} />
              <strong>Mappa rapida</strong>
            </div>
            <ul>
              {sectionOutline.map((item) => (
                <li key={`${item.page}-${item.section}`}>
                  <button onClick={() => scrollToPage(item.page)} type="button">
                    <span>Pag. {item.page}</span>
                    <strong>{item.section}</strong>
                    <em>{item.marked}/{item.total}</em>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="free-document-index">
            <div className="free-document-index-head">
              <div>
                <FileText size={15} />
                <strong>Indice automatico</strong>
              </div>
              <span>{outline.length || sectionOutline.length} sezioni</span>
            </div>
            {(outline.length ? outline : sectionOutline.map((item, index) => ({
              id: `outline-fallback-${item.page}-${index}`,
              title: item.section,
              page: item.page,
              level: 1,
              score: 0.35,
              source: 'page',
            } as DocumentHeading))).length ? (
              <ol>
                {(outline.length ? outline : sectionOutline.map((item, index) => ({
                  id: `outline-fallback-${item.page}-${index}`,
                  title: item.section,
                  page: item.page,
                  level: 1,
                  score: 0.35,
                  source: 'page',
                } as DocumentHeading))).map((heading) => (
                  <li className={`level-${heading.level} source-${heading.source}`} key={heading.id}>
                    <button onClick={() => scrollToPage(heading.page)} type="button">
                      <span>p. {heading.page}</span>
                      <strong>{heading.title}</strong>
                      <em>{Math.round(heading.score * 100)}%</em>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Indice non disponibile: il documento potrebbe richiedere OCR o titoli più leggibili.</p>
            )}
          </div>

          {review ? (
            <div className="free-review-card">
              <div className="free-review-head">
                <div>
                  <ShieldCheck size={15} />
                  <strong>Review automatica</strong>
                </div>
                <span>{review.score}/100</span>
              </div>
              <div className="free-review-metrics">
                <span>Testo: {review.textQuality}</span>
                <span>Struttura: {review.structureQuality}</span>
                <span>OCR: {analysis.ocrPages.length}</span>
                <span>Figure: {review.occlusionPages.length}</span>
              </div>
              {review.issues.length ? (
                <ul>
                  {review.issues.slice(0, 4).map((issue) => (
                    <li className={issue.severity} key={issue.id}>
                      <strong>{issue.title}</strong>
                      <span>
                        {issue.detail}
                        {issue.pages.length ? ` Pagine: ${issue.pages.slice(0, 8).join(', ')}${issue.pages.length > 8 ? '…' : ''}.` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Nessun problema evidente: testo, struttura e pagine visuali sono utilizzabili.</p>
              )}
            </div>
          ) : null}

          {highlightIds.length ? (
            <ul className="free-notes-list">
              {highlightIds.map((index) => {
                const sentence = sentenceByIndex.get(index)
                const highlight = readerState.highlights[index]
                if (!sentence || !highlight) return null

                return (
                  <li className={`free-note-item color-${highlight.color}`} key={index}>
                    <div className="free-note-meta">
                      <span>Pagina {sentence.page}</span>
                      {sentence.section ? <em>{sentence.section}</em> : null}
                    </div>
                    <p className="free-note-quote">“{sentence.text.slice(0, 180)}”</p>
                    <div className="free-note-colors" aria-label="Colore evidenziazione">
                      {(['yellow', 'mint', 'blue'] as HighlightColor[]).map((color) => (
                        <button
                          aria-label={`Colore ${color}`}
                          className={`${highlight.color === color ? 'active' : ''} ${color}`}
                          key={color}
                          onClick={() => updateHighlight(index, { color })}
                          type="button"
                        />
                      ))}
                    </div>
                    <label>
                      <PencilLine size={14} />
                      <textarea
                        onChange={(event) => updateHighlight(index, { note: event.target.value })}
                        placeholder="Nota privata, collegamento mentale, dubbio da chiarire..."
                        rows={2}
                        value={highlight.note}
                      />
                    </label>
                    <div className="free-note-actions">
                      <button
                        className={highlight.review ? 'active' : ''}
                        onClick={() => updateHighlight(index, { review: !highlight.review })}
                        type="button"
                      >
                        <ListChecks size={14} />
                        {highlight.review ? 'Nel ripasso' : 'Da ripassare'}
                      </button>
                      <button onClick={() => toggleHighlight(index)} type="button" aria-label="Rimuovi evidenziazione">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="free-notes-empty">Nessuna evidenziazione: tocca una frase nel documento per iniziare.</p>
          )}
        </aside>
      </div>

      <div className="free-reader-footer">
        <div>
          <strong>Gratis: studio manuale potente. Premium: studio automatico completo.</strong>
          <span>Quando vuoi passare da note e ripasso manuale a deck, quiz e spiegazioni già pronti, sblocca Premium.</span>
          {notice ? <em>{notice}</em> : null}
        </div>
        <div>
          <button className="secondary-action" onClick={clearReader} type="button">
            <Trash2 size={15} />
            Pulisci reader
          </button>
          <button className="premium-button" onClick={onPremium} type="button">
            <Crown size={17} />
            Genera deck Premium
          </button>
        </div>
      </div>
    </section>
  )
}

type UploadReaderDraft = {
  version: 1
  title: string
  analysis: PdfAnalysis
  savedAt: string
}

const UPLOAD_READER_DRAFT_KEY = 'unimidoc:upload-reader-draft:v1'
const MAX_DRAFT_SENTENCES = 1200
const MAX_DRAFT_TEXT_CHARS = 260_000

function readerStorageKeyForAnalysis(analysis: PdfAnalysis): string {
  const sentenceSample = analysis.sentences
    .slice(0, 120)
    .map((sentence) => `${sentence.page}:${sentence.text}`)
    .join('|')
  const fallback = analysis.text.slice(0, 6000)
  return `upload-${hashString(`${analysis.pageCount}:${sentenceSample || fallback}`).toString(36)}`
}

function makeDraftAnalysis(analysis: PdfAnalysis): PdfAnalysis {
  const sentences: DocSentence[] = []
  let chars = 0

  for (const sentence of analysis.sentences) {
    chars += sentence.text.length
    if (sentences.length >= MAX_DRAFT_SENTENCES || chars > MAX_DRAFT_TEXT_CHARS) break
    sentences.push(sentence)
  }

  return {
    ...analysis,
    text: '',
    sentences,
    renderedPages: (analysis.renderedPages ?? []).slice(0, 4),
    outline: (analysis.outline ?? []).slice(0, 220),
    review: analysis.review,
  }
}

function loadUploadReaderDraft(): UploadReaderDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(UPLOAD_READER_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UploadReaderDraft
    if (parsed.version !== 1 || !parsed.analysis?.sentences?.length) return null
    return parsed
  } catch {
    return null
  }
}

function saveUploadReaderDraft(title: string, analysis: PdfAnalysis): void {
  if (typeof window === 'undefined') return
  try {
    const draft: UploadReaderDraft = {
      version: 1,
      title,
      analysis: makeDraftAnalysis(analysis),
      savedAt: new Date().toISOString(),
    }
    window.localStorage.setItem(UPLOAD_READER_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* A long document can exceed localStorage. The active reader still works. */
  }
}

function clearUploadReaderDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(UPLOAD_READER_DRAFT_KEY)
  } catch {
    /* Best effort only. */
  }
}

function restoredReaderSteps(analysis: PdfAnalysis): PipelineStep[] {
  return [
    {
      key: 'read',
      label: 'Lettura documento',
      detail: `Bozza locale ripristinata · ${analysis.pageCount} pagine`,
      status: 'done',
    },
    { key: 'convert', label: 'Conversione Word → PDF', detail: 'Non disponibile nella bozza locale', status: 'skipped' },
    { key: 'compress', label: 'Compressione lossless', detail: 'Ricarica il file per comprimere e inviare', status: 'skipped' },
    { key: 'ocr', label: 'OCR selettivo', detail: 'Dati già estratti dalla sessione precedente', status: 'done' },
    { key: 'flashcards', label: 'Flashcard automatiche', detail: 'Solo Premium', status: 'skipped' },
    { key: 'finalize', label: 'Pronto per lo studio', detail: 'Reader gratuito ripreso localmente', status: 'done' },
  ]
}

function UploadPage({
  onRoute,
  onPublish,
}: {
  onRoute: (route: Route) => void
  onPublish: (document: DocumentItem) => number
}) {
  const [restoredDraft, setRestoredDraft] = useState<UploadReaderDraft | null>(() => loadUploadReaderDraft())
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<UploadPhase>(() => (restoredDraft ? 'ready' : 'idle'))
  const [error, setError] = useState('')

  const [premium, setPremium] = useState(() => getPremiumState().isPremium)

  // Con Supabase attivo il piano non è un toggle demo: si sincronizza con
  // l'entitlement reale a ogni apertura della pagina di upload.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    void refreshPremiumState().then((isPremium) => {
      if (active) setPremium(isPremium)
    })
    return () => {
      active = false
    }
  }, [])
  const [doCompress, setDoCompress] = useState(true)
  const [doOcr, setDoOcr] = useState(true)
  const [doFlashcards, setDoFlashcards] = useState(true)

  const [steps, setSteps] = useState<PipelineStep[]>(() => (restoredDraft ? restoredReaderSteps(restoredDraft.analysis) : []))
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(() => restoredDraft?.analysis ?? null)
  const [insights, setInsights] = useState<DocumentInsights | null>(null)
  const [compression, setCompression] = useState<CompressionResult | null>(null)
  const [cards, setCards] = useState<Flashcard[]>([])
  const [reviewCardIndex, setReviewCardIndex] = useState(0)
  const [approvedCardIds, setApprovedCardIds] = useState<Set<string>>(() => new Set())
  const [rebuilding, setRebuilding] = useState(false)
  const [studyOpen, setStudyOpen] = useState(false)
  // Workspace a schede: prima i dati del documento, poi gli strumenti avanzati,
  // così il form non è affollato da OCR/flashcard/occlusion tutti insieme.
  const [workspaceTab, setWorkspaceTab] = useState<'dati' | 'strumenti'>('dati')

  const [title, setTitle] = useState(() => restoredDraft?.title ?? '')
  const [subject, setSubject] = useState(subjects[0] ?? '')
  const [professor, setProfessor] = useState('')
  const [courseLine, setCourseLine] = useState<CourseLine | 'Tutti'>('Tutti')
  const [year, setYear] = useState(academicYears[0])
  const [docType, setDocType] = useState(documentTypes[0])
  const [description, setDescription] = useState('')
  const [examType, setExamType] = useState(EXAM_TYPES[0])
  const [semester, setSemester] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [rights, setRights] = useState(false)
  const [earned, setEarned] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const isPdfFile = (candidate: File) =>
    candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf')
  const isWordFile = (candidate: File) => {
    const name = candidate.name.toLowerCase()
    return (
      candidate.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      candidate.type === 'application/msword' ||
      name.endsWith('.docx') ||
      name.endsWith('.doc')
    )
  }

  const selectedCourse = useMemo(() => findCourse(subject), [subject])
  const courseLines = useMemo(() => getCourseLines(selectedCourse), [selectedCourse])
  const suggestedProfessors = useMemo(
    () => getCourseProfessors(selectedCourse, courseLine),
    [courseLine, selectedCourse],
  )
  const professorSuggestions = useMemo(
    () => Array.from(new Set([...suggestedProfessors, ...professors])),
    [suggestedProfessors],
  )
  const isWordUpload = Boolean(file && isWordFile(file) && !isPdfFile(file))

  useEffect(() => {
    setCourseLine(courseLines.length === 1 ? courseLines[0] : 'Tutti')
  }, [courseLines])

  // Semestre ricavato automaticamente dal catalogo quando il corso è noto.
  useEffect(() => {
    if (selectedCourse?.semester && selectedCourse.semester !== 'Non definito') {
      setSemester(selectedCourse.semester)
    }
  }, [selectedCourse])

  // Tag suggeriti automaticamente dalle keyword estratte (editabili).
  useEffect(() => {
    if (insights?.keywords.length && !tagsInput.trim()) {
      setTagsInput(insights.keywords.slice(0, 6).join(', '))
    }
  }, [insights])

  useEffect(() => {
    setReviewCardIndex((current) => Math.min(current, Math.max(0, cards.length - 1)))
  }, [cards.length])

  useEffect(() => {
    if (phase === 'ready' && analysis) {
      saveUploadReaderDraft(title.trim() || file?.name || restoredDraft?.title || 'Documento caricato', analysis)
    }
  }, [analysis, file?.name, phase, restoredDraft?.title, title])

  const patchStep = (key: PipelineStepKey, patch: Partial<PipelineStep>) =>
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, ...patch } : step)))

  const resetAll = () => {
    clearUploadReaderDraft()
    setRestoredDraft(null)
    setFile(null)
    setPhase('idle')
    setError('')
    setSteps([])
    setAnalysis(null)
    setInsights(null)
    setCompression(null)
    setCards([])
    setReviewCardIndex(0)
    setApprovedCardIds(new Set())
    setRights(false)
    setEarned(0)
    setTitle('')
    setDescription('')
    setTagsInput('')
    setSemester('')
    setExamType(EXAM_TYPES[0])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const skipFreeFlashcards = () => {
    setCards([])
    patchStep('flashcards', {
      status: 'skipped',
      detail: 'Solo Premium · usa evidenziazioni, note e occlusion manuale gratis',
    })
  }

  const runPipeline = async (picked: File) => {
    clearUploadReaderDraft()
    setRestoredDraft(null)
    setPhase('processing')
    setError('')
    setAnalysis(null)
    setInsights(null)
    setCompression(null)
    setCards([])
    setReviewCardIndex(0)
    setApprovedCardIds(new Set())

    const pdf = isPdfFile(picked)
    const word = isWordFile(picked) && !pdf
    const willBePdf = pdf || word // a Word file becomes a real PDF after conversion
    setSteps([
      { key: 'read', label: 'Lettura documento', detail: 'Apertura e validazione', status: 'running' },
      {
        key: 'convert',
        label: 'Conversione Word → PDF',
        detail: word ? 'In coda' : 'Non necessaria',
        status: word ? 'pending' : 'skipped',
      },
      { key: 'compress', label: 'Compressione lossless', detail: doCompress ? 'In coda' : 'Disattivata', status: doCompress && willBePdf ? 'pending' : 'skipped' },
      { key: 'ocr', label: 'OCR selettivo', detail: doOcr ? 'In coda' : 'Disattivato', status: doOcr && willBePdf ? 'pending' : 'skipped' },
      {
        key: 'flashcards',
        label: 'Flashcard automatiche',
        detail: doFlashcards ? (premium ? 'In coda Premium' : 'Solo Premium') : 'Disattivate',
        status: doFlashcards && willBePdf && premium ? 'pending' : 'skipped',
      },
      { key: 'finalize', label: 'Pronto per la revisione', detail: 'In attesa', status: 'pending' },
    ])

    try {
      let buffer = await picked.arrayBuffer()

      if (word) {
        const lower = picked.name.toLowerCase()
        if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
          patchStep('read', { status: 'error', detail: 'Formato .doc legacy' })
          patchStep('convert', { status: 'error', detail: 'Salva come .docx o PDF e riprova' })
          setError('Il formato .doc legacy non è supportato: salva come .docx o PDF.')
          setPhase('idle')
          return
        }
        patchStep('read', { status: 'done', detail: `${formatBytes(picked.size)} · Word` })
        patchStep('convert', { status: 'running', detail: 'Conversione .docx → PDF nel browser…' })
        const { convertDocxToPdf } = await import('./lib/wordToPdf')
        const converted = await convertDocxToPdf(buffer)
        buffer = converted.pdf
        const extras = [
          converted.images ? `${converted.images} immagini` : null,
          converted.tables ? `${converted.tables} tabelle` : null,
        ].filter(Boolean).join(' · ')
        patchStep('convert', {
          status: 'done',
          detail: `PDF generato · ${converted.blocks} blocchi${extras ? ` · ${extras}` : ''} · ${formatBytes(buffer.byteLength)}`,
        })
      }

      const { analyzePdf, compressPdfLossless, buildDocumentInsights } = await import('./lib/pdfProcessing')

      let info = await analyzePdf(buffer)
      setAnalysis(info)
      // Metadatazione SEO/GEO automatica: keywords, argomenti, abstract, flag
      // contenuto e livello estratti dal testo reale (nessun costo AI).
      setInsights(buildDocumentInsights(info))
      const inferredTitle = title || picked.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
      saveUploadReaderDraft(inferredTitle || 'Documento caricato', info)
      patchStep('read', {
        status: 'done',
        detail: word ? `Convertito · ${info.pageCount} pagine` : `${info.pageCount} pagine · ${formatBytes(picked.size)}`,
      })

      if (doCompress) {
        patchStep('compress', { status: 'running', detail: 'Riscrittura con object stream…' })
        const result = await compressPdfLossless(buffer)
        setCompression(result)
        patchStep('compress', {
          status: 'done',
          detail: result.alreadyOptimized
            ? 'Già ottimizzato · nessuna perdita'
            : `−${result.savedPct}% · ${formatBytes(result.savedBytes)} risparmiati`,
        })
      }

      if (doOcr) {
        const count = info.ocrPages.length
        if (count === 0) {
          patchStep('ocr', { status: 'done', detail: 'Testo nativo su tutte le pagine · nessun OCR' })
        } else {
          // OCR reale in-browser (tesseract.js, ita+eng) sulle pagine senza
          // testo nativo: il testo recuperato rientra in analisi, metadati,
          // flashcard e ricerca. Lazy-load per non pesare sui PDF già testuali.
          patchStep('ocr', { status: 'running', detail: `OCR su ${count} pagin${count === 1 ? 'a' : 'e'} scansionat${count === 1 ? 'a' : 'e'}…` })
          try {
            const { runOcr, mergeOcrIntoAnalysis } = await import('./lib/ocr')
            const ocr = await runOcr(buffer, info, {
              onProgress: ({ page, total }) =>
                patchStep('ocr', { status: 'running', detail: `OCR pagina ${page} (${total} in coda)…` }),
            })
            if (ocr.pages.length) {
              info = mergeOcrIntoAnalysis(info, ocr)
              setAnalysis(info)
              setInsights(buildDocumentInsights(info))
              patchStep('ocr', {
                status: 'done',
                detail: `OCR completato · ${ocr.pages.length} pagine · ${ocr.totalChars} caratteri recuperati · confidenza ${ocr.meanConfidence}%`,
              })
            } else {
              patchStep('ocr', { status: 'done', detail: `${count} pagine analizzate · nessun testo recuperabile` })
            }
          } catch {
            patchStep('ocr', { status: 'done', detail: `${count} pagine in coda OCR · elaborazione non riuscita in questa sessione` })
          }
        }
      }

      if (doFlashcards) {
        if (!premium) {
          skipFreeFlashcards()
        } else {
          patchStep('flashcards', {
            status: 'running',
            detail: 'Generazione AI Premium sui chunk migliori…',
          })
          try {
            const generated = await generatePremiumDeckFromBackend(info, (done, total) => {
              patchStep('flashcards', {
                status: 'running',
                detail: `Generazione AI Premium · batch ${Math.min(done + 1, total)}/${total}`,
              })
            })
            setCards(generated)
            setReviewCardIndex(0)
            setApprovedCardIds(new Set())
            patchStep('flashcards', {
              status: generated.length ? 'done' : 'skipped',
              detail: generated.length
                ? `${generated.length} flashcard AI Premium pronte per revisione`
                : 'Testo insufficiente per flashcard AI di qualità',
            })
          } catch (error) {
            setCards([])
            patchStep('flashcards', {
              status: 'error',
              detail: error instanceof Error ? error.message : 'Generazione AI non riuscita',
            })
          }
        }
      }

      if (!title) setTitle(inferredTitle)
      patchStep('finalize', { status: 'done', detail: 'Rivedi dati e strumenti, poi invia' })
      setPhase('ready')
    } catch (caught) {
      patchStep('read', { status: 'error', detail: 'File non leggibile o protetto' })
      setError(caught instanceof Error ? `Elaborazione non riuscita: ${caught.message}` : 'Elaborazione non riuscita.')
      setPhase('idle')
    }
  }

  const acceptFile = (candidate: File | undefined | null) => {
    if (!candidate) return
    const name = candidate.name.toLowerCase()
    const okType =
      isPdfFile(candidate) ||
      isWordFile(candidate) ||
      name.endsWith('.pdf')
    if (!okType) {
      setError('Formato non supportato: carica un PDF, DOC o DOCX.')
      return
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setError(`File troppo grande (${formatBytes(candidate.size)}). Il limite è 25 MB.`)
      return
    }
    setFile(candidate)
    void runPipeline(candidate)
  }

  const regenerate = () => {
    if (!analysis) return
    if (!premium) {
      skipFreeFlashcards()
      return
    }
    setRebuilding(true)
    patchStep('flashcards', { status: 'running', detail: 'Rigenerazione AI Premium…' })
    generatePremiumDeckFromBackend(analysis, (done, total) => {
      patchStep('flashcards', {
        status: 'running',
        detail: `Rigenerazione AI Premium · batch ${Math.min(done + 1, total)}/${total}`,
      })
    })
      .then((generated) => {
        setCards(generated)
        setReviewCardIndex(0)
        setApprovedCardIds(new Set())
        patchStep('flashcards', {
          status: generated.length ? 'done' : 'skipped',
          detail: generated.length ? `${generated.length} flashcard AI Premium rigenerate` : 'Testo insufficiente',
        })
      })
      .catch((error) => {
        setCards([])
        patchStep('flashcards', {
          status: 'error',
          detail: error instanceof Error ? error.message : 'Rigenerazione AI non riuscita',
        })
      })
      .finally(() => {
        setRebuilding(false)
      })
  }

  const changeMode = (nextPremium: boolean) => {
    setPremium(nextPremium)
    setPremiumState(nextPremium)
    if (analysis && doFlashcards) {
      if (!nextPremium) {
        skipFreeFlashcards()
      } else {
        setRebuilding(true)
        patchStep('flashcards', { status: 'running', detail: 'Generazione AI Premium…' })
        generatePremiumDeckFromBackend(analysis, (done, total) => {
          patchStep('flashcards', {
            status: 'running',
            detail: `Generazione AI Premium · batch ${Math.min(done + 1, total)}/${total}`,
          })
        })
          .then((generated) => {
            setCards(generated)
            setReviewCardIndex(0)
            setApprovedCardIds(new Set())
            patchStep('flashcards', {
              status: generated.length ? 'done' : 'skipped',
              detail: generated.length ? `${generated.length} flashcard AI Premium pronte` : 'Testo insufficiente',
            })
          })
          .catch((error) => {
            setCards([])
            patchStep('flashcards', {
              status: 'error',
              detail: error instanceof Error ? error.message : 'Generazione AI non riuscita',
            })
          })
          .finally(() => {
            setRebuilding(false)
          })
      }
    }
  }

  const changeFlashcardOption = (enabled: boolean) => {
    setDoFlashcards(enabled)
    if (!enabled) {
      setCards([])
      patchStep('flashcards', { status: 'skipped', detail: 'Disattivate' })
      return
    }
    if (!analysis) return
    if (!premium) {
      skipFreeFlashcards()
      return
    }
    regenerate()
  }

  const updateCard = (id: string, patch: Partial<Flashcard>) =>
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)))
  const removeCard = (id: string) => {
    setCards((current) => current.filter((card) => card.id !== id))
    setApprovedCardIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    setReviewCardIndex((current) => Math.max(0, current - 1))
  }
  const addCard = () => {
    setReviewCardIndex(cards.length)
    setCards((current) => [
      ...current,
      { id: `fc-manual-${current.length + 1}-${current.length}`, front: '', back: '', source: 'concetto', score: 0, ref: null },
    ])
  }

  const includedCards = cards.filter((card) => card.front.trim() && card.back.trim())
  const safeReviewCardIndex = Math.min(reviewCardIndex, Math.max(0, cards.length - 1))
  const currentReviewCard = cards[safeReviewCardIndex]
  const approvedCount = includedCards.filter((card) => approvedCardIds.has(card.id)).length
  const toggleApproveCard = (id: string) => {
    setApprovedCardIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const canPublish = phase === 'ready' && Boolean(file) && Boolean(title.trim()) && Boolean(subject) && Boolean(professor.trim()) && rights

  const publish = () => {
    if (!file) return
    if (!title.trim()) return setError('Aggiungi un titolo al documento.')
    if (!professor.trim()) return setError('Indica il docente.')
    if (!rights) return setError('Devi dichiarare la titolarità del materiale.')

    // Blocca contatti/riferimenti esterni in titolo e descrizione pubblici.
    const moderation = moderatePublicText(`${title}\n${description}`)
    if (!moderation.ok) return setError(moderation.message)
    setError('')

    const sizeBytes = compression ? compression.compressedBytes : file.size
    const pages = analysis?.pageCount ?? 0
    const cost = Math.max(4, Math.min(14, Math.round(pages / 12) + (premium ? 4 : 2)))

    const document: DocumentItem = {
      id: `up-${Date.now()}`,
      title: title.trim(),
      subject,
      professor: professor.trim(),
      academicYear: year,
      type: docType,
      examType,
      pages,
      sizeMb: Math.max(0.1, Math.round((sizeBytes / (1024 * 1024)) * 10) / 10),
      quality: 0,
      credits: cost,
      downloads: 0,
      description: description.trim()
        || (includedCards.length
          ? `Caricato dalla community · ${includedCards.length} flashcard pronte al ripasso.`
          : 'Caricato dalla community · in attesa di revisione.'),
      status: 'pendingreview',
      verified: false,
      premium,
      uploader: 'Tu',
      uploaderTrust: 82,
      fileHash: `up${Date.now().toString(16)}`,
      malwareScan: 'in corso',
      copyrightRisk: 'basso',
      reportCount: 0,
      uploadedAt: new Date().toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      language: insights?.language === 'en' ? 'Inglese' : 'Italiano',
      previewKind: insights?.contentFlags.hasExercises
        ? 'exercise'
        : insights?.contentFlags.hasDiagrams
          ? 'diagram'
          : 'notes',
      insights: insights ?? undefined,
      degreeCourse: DEGREE_COURSE,
      university: UNIVERSITY_NAME,
      semester: semester || undefined,
      tags: tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10),
    }

    const awarded = onPublish(document)
    setEarned(awarded)
    setPhase('published')
    window.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
  }

  const compressionBadge = compression
    ? compression.alreadyOptimized
      ? 'Già ottimizzato'
      : `−${compression.savedPct}% lossless`
    : 'Sempre attiva'
  const flashcardBadge = includedCards.length
    ? `${includedCards.length} Premium`
    : doFlashcards
      ? premium
        ? 'Premium'
        : 'Solo Premium'
      : 'Disattivate'
  const ocrBadge = analysis
    ? analysis.ocrPages.length
      ? `${analysis.ocrPages.length} pagine in coda`
      : 'Nessun OCR necessario'
    : 'Cost-first'
  const flashcardModeName = 'Premium'
  const flashcardModeNote = premium
    ? 'Usa i chunk puliti e selezionati: generazione avanzata lato backend, con cache e controllo qualità.'
    : 'Le flashcard automatiche sono riservate a Premium per mantenere deck più pertinenti e meno casuali.'
  const selectedCourseMeta = formatCourseMeta(selectedCourse)
  const freeReaderTitle = title.trim() || file?.name || 'Documento caricato'
  const freeReaderStorageKey = analysis ? readerStorageKeyForAnalysis(analysis) : 'upload-empty'

  return (
    <main className="upload-page section-wrap">
      <section className="upload-hero">
        <div>
          <h1>Carica appunti fatti bene. Aiuteranno qualcuno davvero.</h1>
          <p>
            Il PDF viene compresso senza perdite, analizzato per l’OCR e preparato per strumenti di studio:
            tutto prima dell’invio. Resta in revisione prima di essere pubblicato.
          </p>
        </div>
        <img src={uploadBackpack} alt="Upload appunti" />
      </section>

      <section className="upload-automation-grid" aria-label="Automazioni sul PDF">
        <article className={compression ? 'is-live' : ''}>
          <span><FileArchive size={22} /></span>
          <div>
            <h2>Compressione lossless</h2>
            <p>PDF più leggeri senza perdere testo, immagini, annotazioni o layer OCR.</p>
          </div>
          <strong>{compressionBadge}</strong>
        </article>
        <article className={includedCards.length ? 'is-live' : ''}>
          <span><BrainCircuit size={22} /></span>
          <div>
            <h2>Flashcard automatiche</h2>
            <p>Deck automatici solo Premium, costruiti sui chunk migliori e sempre revisionabili.</p>
          </div>
          <strong>{flashcardBadge}</strong>
        </article>
        <article className={analysis ? 'is-live' : ''}>
          <span><ScanLine size={22} /></span>
          <div>
            <h2>OCR selettivo</h2>
            <p>Le pagine scannerizzate vengono individuate solo quando il testo nativo non basta.</p>
          </div>
          <strong>{ocrBadge}</strong>
        </article>
      </section>

      {phase === 'published' ? (
        <section className="upload-success">
          <span className="upload-success-icon"><CheckCircle2 size={30} /></span>
          <h2>Inviato in revisione</h2>
          <p>“{title}” è nella coda di moderazione. Ti avvisiamo appena viene pubblicato.</p>
          <div className="upload-success-stats">
            <div><strong><CreditIcon size="lg" /> +{earned}</strong><span>crediti guadagnati</span></div>
            <div>
              <strong>{compression ? (compression.alreadyOptimized ? '0%' : `−${compression.savedPct}%`) : '—'}</strong>
              <span>peso PDF (lossless)</span>
            </div>
            <div><strong>{includedCards.length}</strong><span>flashcard incluse</span></div>
            <div><strong>{analysis ? analysis.ocrPages.length : 0}</strong><span>pagine in coda OCR</span></div>
          </div>
          <div className="upload-success-actions">
            <button className="primary-action" onClick={() => onRoute('dashboard')} type="button">
              Vai alla libreria <ArrowRight size={16} />
            </button>
            <button className="secondary-action" onClick={resetAll} type="button">
              Carica un altro
            </button>
          </div>
        </section>
      ) : (
        <section className="upload-form-card upload-workspace">
          <div className="processing-options">
            <label><input checked={doCompress} onChange={(event) => setDoCompress(event.target.checked)} type="checkbox" /> Compressione lossless</label>
            <label><input checked={doOcr} onChange={(event) => setDoOcr(event.target.checked)} type="checkbox" /> OCR selettivo</label>
            <label><input checked={doFlashcards} onChange={(event) => changeFlashcardOption(event.target.checked)} type="checkbox" /> Flashcard automatiche Premium</label>
            {isSupabaseConfigured ? (
              // Il piano arriva dall'entitlement reale (user_entitlements): qui
              // si mostra soltanto, l'upgrade passa dalla pagina Premium.
              premium ? (
                <span className="mode-active plan-badge"><Crown size={16} /> Premium attivo</span>
              ) : (
                <button className="plan-upgrade" onClick={() => onRoute('premium')} type="button">
                  <Crown size={16} /> Passa a Premium
                </button>
              )
            ) : (
              <>
                <button className={premium ? '' : 'mode-active'} onClick={() => changeMode(false)} type="button"><Layers size={16} /> Free tools</button>
                <button className={premium ? 'mode-active' : ''} onClick={() => changeMode(true)} type="button"><Crown size={16} /> Premium</button>
              </>
            )}
          </div>

          {!file ? (
            <label
              className={`upload-drop ${dragging ? 'dragging' : ''}`}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                acceptFile(event.dataTransfer.files?.[0])
              }}
            >
              <input
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                hidden
                onChange={(event) => acceptFile(event.target.files?.[0])}
                ref={fileInputRef}
                type="file"
              />
              <Upload size={28} />
              Trascina qui il PDF o Word
              <small>PDF consigliato · DOC/DOCX convertiti in PDF prima della revisione · Max 25 MB</small>
            </label>
          ) : (
            <div className="upload-file">
              <span className="upload-file-icon"><FileText size={22} /></span>
              <div className="upload-file-meta">
                <strong>{file.name}</strong>
                <small>
                  {formatBytes(compression ? compression.compressedBytes : file.size)}
                  {analysis ? ` · ${analysis.pageCount} pagine` : ''}
                  {phase === 'processing' ? ' · elaborazione…' : ''}
                </small>
              </div>
              <button className="upload-file-remove" onClick={resetAll} type="button" aria-label="Rimuovi file">
                <X size={18} />
              </button>
            </div>
          )}

          {error ? (
            <p className="upload-error"><AlertTriangle size={16} /> {error}</p>
          ) : null}

          {isWordUpload ? (
            <div className="word-conversion-warning" role="note">
              <AlertTriangle size={18} />
              <div>
                <strong>Word accettato, ma il PDF resta il formato migliore.</strong>
                <p>
                  Il file verra convertito lato backend con LibreOffice headless prima della revisione. Impaginazione,
                  font, tabelle o immagini molto complesse possono cambiare leggermente: controlla sempre il PDF finale
                  generato prima della pubblicazione. UnimiDoc non garantisce la fedelta perfetta del layout Word e non
                  risponde di eventuali artefatti dovuti alla conversione.
                </p>
              </div>
            </div>
          ) : null}

          {analysis && phase === 'ready' && !file ? (
            <div className="local-reader-resume" role="note">
              <BookOpen size={18} />
              <div>
                <strong>Bozza reader ripristinata su questo dispositivo.</strong>
                <p>
                  Puoi continuare ricerca, evidenziazioni, note ed export senza ricaricare il PDF. Per inviare in
                  revisione o comprimere il file, carica di nuovo il documento originale.
                </p>
              </div>
              <button onClick={resetAll} type="button">Chiudi bozza</button>
            </div>
          ) : null}

          {steps.length ? (
            <ol className="pipeline">
              {steps.map((step) => (
                <li className={`pipeline-step ${step.status}`} key={step.key}>
                  <span className="pipeline-icon"><PipelineIcon status={step.status} /></span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {analysis && phase === 'ready' ? (
            <div className="upload-workspace-tabs" role="tablist" aria-label="Sezioni del caricamento">
              <button
                role="tab"
                aria-selected={workspaceTab === 'dati'}
                className={workspaceTab === 'dati' ? 'active' : ''}
                onClick={() => setWorkspaceTab('dati')}
                type="button"
              >
                <FileText size={16} /> Dati del documento
              </button>
              <button
                role="tab"
                aria-selected={workspaceTab === 'strumenti'}
                className={workspaceTab === 'strumenti' ? 'active' : ''}
                onClick={() => setWorkspaceTab('strumenti')}
                type="button"
              >
                <Sparkles size={16} /> Strumenti di studio
              </button>
            </div>
          ) : null}

          {analysis && phase === 'ready' && workspaceTab === 'strumenti' && !premium ? (
            <div className="free-study-tools-grid">
              <FreeStudyToolsPanel
                analysis={analysis}
                onPremium={() => changeMode(true)}
                storageKey={freeReaderStorageKey}
                title={freeReaderTitle}
              />
              <ImageOcclusionLab analysis={analysis} premium={premium} />
            </div>
          ) : null}

          {doFlashcards && analysis && phase === 'ready' && workspaceTab === 'strumenti' && premium ? (
            <div className="learning-review-grid">
              <div className="flashcards-review">
                <div className="flashcards-head">
                  <div>
                    <h3><BrainCircuit size={18} /> Flashcard da approvare</h3>
                    <small>{includedCards.length} pronte · {flashcardModeName} · modifica o rimuovi prima dell’invio</small>
                  </div>
                  <div className="flashcards-actions">
                    <button disabled={rebuilding} onClick={regenerate} type="button">
                      <RefreshCw className={rebuilding ? 'spin' : ''} size={15} /> Rigenera
                    </button>
                    <button onClick={addCard} type="button"><Plus size={15} /> Aggiungi</button>
                  </div>
                </div>
                <p className={`flashcard-mode-note ${premium ? 'premium' : 'base'}`}>
                  {premium ? <Sparkles size={15} /> : <ShieldCheck size={15} />}
                  <span>{flashcardModeNote}</span>
                </p>
                {cards.length && currentReviewCard ? (
                  <div className="flashcard-carousel">
                    <div className="flashcard-carousel-top">
                      <button
                        disabled={safeReviewCardIndex === 0}
                        onClick={() => setReviewCardIndex((value) => Math.max(0, value - 1))}
                        type="button"
                        aria-label="Flashcard precedente"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <div>
                        <strong>Card {safeReviewCardIndex + 1} di {cards.length}</strong>
                        <span>{approvedCount} approvate · {includedCards.length} complete</span>
                      </div>
                      <button
                        disabled={safeReviewCardIndex === cards.length - 1}
                        onClick={() => setReviewCardIndex((value) => Math.min(cards.length - 1, value + 1))}
                        type="button"
                        aria-label="Flashcard successiva"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>

                    <article className={`flashcard-editor-card ${approvedCardIds.has(currentReviewCard.id) ? 'approved' : ''}`}>
                      <div className="flashcard-editor-head">
                        <span className={`flashcard-tag ${currentReviewCard.source}`}>{flashcardSourceLabels[currentReviewCard.source]}</span>
                        <span>Score {Math.round(currentReviewCard.score * 100)}</span>
                      </div>
                      <label>
                        Domanda
                        <input
                          onChange={(event) => updateCard(currentReviewCard.id, { front: event.target.value })}
                          placeholder="Domanda o termine"
                          value={currentReviewCard.front}
                        />
                      </label>
                      <label>
                        Risposta
                        <textarea
                          onChange={(event) => updateCard(currentReviewCard.id, { back: event.target.value })}
                          placeholder="Risposta o definizione"
                          rows={4}
                          value={currentReviewCard.back}
                        />
                      </label>
                      <label>
                        Tag
                        <select
                          onChange={(event) => updateCard(currentReviewCard.id, { source: event.target.value as Flashcard['source'] })}
                          value={currentReviewCard.source}
                        >
                          {Object.entries(flashcardSourceLabels).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="flashcard-editor-source">
                        {currentReviewCard.ref ? (
                          <span><Eye size={14} /> p. {currentReviewCard.ref.page}{currentReviewCard.ref.section ? ` · ${currentReviewCard.ref.section}` : ''}</span>
                        ) : (
                          <span><PencilLine size={14} /> Card manuale</span>
                        )}
                      </div>
                      <div className="flashcard-editor-actions">
                        <button
                          className={approvedCardIds.has(currentReviewCard.id) ? 'approved' : ''}
                          onClick={() => toggleApproveCard(currentReviewCard.id)}
                          type="button"
                        >
                          <CheckCircle2 size={15} />
                          {approvedCardIds.has(currentReviewCard.id) ? 'Approvata' : 'Approva'}
                        </button>
                        <button onClick={() => removeCard(currentReviewCard.id)} type="button">
                          <Trash2 size={15} /> Elimina
                        </button>
                      </div>
                    </article>

                    <div className="flashcard-rail" aria-label="Navigazione flashcard">
                      {cards.map((card, index) => (
                        <button
                          className={`${index === safeReviewCardIndex ? 'active' : ''} ${approvedCardIds.has(card.id) ? 'approved' : ''} ${card.front.trim() && card.back.trim() ? 'complete' : 'incomplete'}`}
                          key={card.id}
                          onClick={() => setReviewCardIndex(index)}
                          title={card.front || `Card ${index + 1}`}
                          type="button"
                        >
                          <span>{index + 1}</span>
                          <em>{flashcardSourceLabels[card.source]}</em>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="flashcards-empty">
                    Nessuna flashcard automatica: testo insufficiente o disattivate. Puoi aggiungerne a mano.
                  </p>
                )}
                {includedCards.length ? (
                  <button className="study-launch" onClick={() => setStudyOpen(true)} type="button">
                    <GraduationCap size={18} /> Studia deck, quiz e fonte
                  </button>
                ) : null}
              </div>
              <FlashcardGenerationSummary analysis={analysis} cards={includedCards} steps={steps} />
              <ImageOcclusionLab analysis={analysis} premium={premium} />
            </div>
          ) : null}

          {phase !== 'ready' || workspaceTab === 'dati' ? (
          <div className="upload-data-section">
          <div className="upload-data-panel">
            <div className="upload-data-head">
              <div>
                <h2>Dati del documento</h2>
                <p>Scegli corso e docente dal catalogo L13 2025/26 oppure inserisci manualmente se il docente e cambiato.</p>
              </div>
              <span>Base UniMi L-13</span>
            </div>

            <div className="form-grid refined">
              <label className="field-wide">
                Titolo
                <input onChange={(event) => setTitle(event.target.value)} placeholder="Es. Riassunto di Genetica molecolare" value={title} />
              </label>
              <label className="field-wide">
                Materia
                <select onChange={(event) => setSubject(event.target.value)} value={subject}>
                  {subjects.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                Anno accademico
                <select onChange={(event) => setYear(event.target.value)} value={year}>
                  {academicYears.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo materiale
                <select onChange={(event) => setDocType(event.target.value)} value={docType}>
                  {documentTypes.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                Tipo di esame
                <select onChange={(event) => setExamType(event.target.value)} value={examType}>
                  {EXAM_TYPES.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label>
                Semestre
                <select onChange={(event) => setSemester(event.target.value)} value={semester}>
                  <option value="">Non specificato</option>
                  <option>1 semestre</option>
                  <option>2 semestre</option>
                  <option>Annuale</option>
                </select>
              </label>
              <label className="field-readonly">
                Corso di laurea
                <input value={DEGREE_COURSE} readOnly tabIndex={-1} />
              </label>
              <label className="field-readonly">
                Università
                <input value={UNIVERSITY_NAME} readOnly tabIndex={-1} />
              </label>
              <label className="field-wide">
                Descrizione pubblica
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Cosa contiene il materiale, argomenti trattati, come è organizzato. Niente contatti o link: le comunicazioni restano su UnimiDoc."
                  rows={3}
                  value={description}
                />
              </label>
              <label className="field-wide">
                Tag e parole chiave <em className="field-optional">(opzionale · compilati in automatico)</em>
                <input
                  onChange={(event) => setTagsInput(event.target.value)}
                  placeholder="Es. mitosi, ciclo cellulare, DNA"
                  value={tagsInput}
                />
              </label>
            </div>

            {selectedCourse ? (
              <div className="course-match-card">
                <SubjectIcon name={selectedCourse.name} />
                <div>
                  <strong>{selectedCourse.shortName}</strong>
                  <small>{selectedCourseMeta}</small>
                  {selectedCourse.cohortNote ? <em>{selectedCourse.cohortNote}</em> : null}
                </div>
              </div>
            ) : null}

            <div className="teacher-picker">
              <div className="teacher-picker-row">
                <label>
                  Linea / edizione
                  <select
                    disabled={courseLines.length === 0}
                    onChange={(event) => setCourseLine(event.target.value as CourseLine | 'Tutti')}
                    value={courseLine}
                  >
                    <option value="Tutti">Tutte</option>
                    {courseLines.map((line) => (
                      <option key={line} value={line}>{line}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Docente
                  <input
                    list="upload-professor-suggestions"
                    onChange={(event) => setProfessor(event.target.value)}
                    placeholder="Scrivi o scegli un docente"
                    value={professor}
                  />
                </label>
              </div>
              <datalist id="upload-professor-suggestions">
                {professorSuggestions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              {suggestedProfessors.length ? (
                <div className="professor-suggestion-chips" aria-label="Docenti suggeriti per il corso">
                  {suggestedProfessors.map((option) => (
                    <button
                      className={professor === option ? 'selected' : ''}
                      key={option}
                      onClick={() => setProfessor(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="manual-professor-note">
                  Nessun docente unico per questa attivita: indica il tutor o il riferimento che compare nel materiale.
                </p>
              )}
            </div>
          </div>

          <label className="rights-check">
            <input checked={rights} onChange={(event) => setRights(event.target.checked)} type="checkbox" /> Dichiaro che il
            materiale è mio o rielaborato in modo originale.
          </label>

          <button className="primary-action upload-submit" disabled={!canPublish} onClick={publish} type="button">
            {phase === 'processing' ? (
              <>
                <Loader2 className="spin" size={18} /> Elaborazione in corso…
              </>
            ) : (
              <>
                <ShieldCheck size={18} /> Invia in revisione
              </>
            )}
          </button>
          {phase === 'ready' && !canPublish ? (
            <small className="upload-hint">
              {file
                ? 'Completa titolo, docente e dichiarazione per inviare.'
                : 'Questa è una bozza locale: ricarica il file originale per inviare in revisione.'}
            </small>
          ) : null}
          </div>
          ) : (
            <p className="upload-tools-hint">
              <Sparkles size={15} /> Quando hai finito con gli strumenti, torna a <button onClick={() => setWorkspaceTab('dati')} type="button">Dati del documento</button> per completare e inviare in revisione.
            </p>
          )}
        </section>
      )}

      {studyOpen && analysis ? (
        <FlashcardStudyModal
          cards={includedCards}
          sentences={analysis.sentences}
          title={title || file?.name || 'Documento'}
          onClose={() => setStudyOpen(false)}
        />
      ) : null}
    </main>
  )
}

function UserDashboardPage({
  user,
  documents,
  credits,
  wallet,
  onPreview,
  onOpenDocument,
  onRoute,
  onSignOut,
  uploads,
}: {
  user: AppAuthUser
  documents: DocumentItem[]
  credits: number
  wallet: WalletState | null
  onPreview: (document: DocumentItem) => void
  onOpenDocument: (document: DocumentItem) => void
  onRoute: (route: Route, options?: { hash?: string }) => void
  onSignOut: () => void
  uploads: DocumentItem[]
}) {
  const baseData = useMemo(() => buildUserDashboardData({ user, credits, documents, uploads }), [credits, documents, uploads, user])
  const [overlay, setOverlay] = useState<DashboardLiveOverlay | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<'notifications' | 'credits' | null>(null)

  // Deep-link to a dashboard section via #hash (from navbar / user menu).
  useEffect(() => {
    const scrollToSection = (id: string | undefined) => {
      if (!id) return
      window.requestAnimationFrame(() => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
    scrollToSection(window.location.hash.replace('#', '') || undefined)
    const onSection = (event: Event) => scrollToSection((event as CustomEvent<string>).detail)
    window.addEventListener('ud-section', onSection)
    return () => window.removeEventListener('ud-section', onSection)
  }, [])

  useEffect(() => {
    if (user.isDemo || !isSupabaseConfigured) {
      setOverlay(null)
      return
    }

    let active = true
    setLiveLoading(true)
    loadDashboardLiveOverlay(user)
      .then((result) => {
        if (active) setOverlay(result)
      })
      .catch(() => {
        if (active) setOverlay(null)
      })
      .finally(() => {
        if (active) setLiveLoading(false)
      })

    return () => {
      active = false
    }
  }, [user])

  // Real persisted slices replace the preview only when the backend actually
  // returned rows; otherwise the generated content keeps the dashboard alive.
  const data = overlay
    ? {
        ...baseData,
        creditHistory: overlay.creditHistory.length ? overlay.creditHistory : baseData.creditHistory,
        notifications: overlay.notifications.length ? overlay.notifications : baseData.notifications,
      }
    : baseData
  const displayCredits = overlay?.credits ?? credits
  const dataIsLive = Boolean(overlay)
  const firstName = user.name.split(' ')[0] || 'Studente'
  const totalFlashcards = data.decks.reduce((total, deck) => total + deck.cards, 0)
  const dueReviews = data.reviews.length
  const averageProgress = data.subjectProgress.length
    ? Math.round(data.subjectProgress.reduce((total, item) => total + item.progress, 0) / data.subjectProgress.length)
    : 0

  const activeShelf = data.shelves.find((shelf) => shelf.id === activeShelfId)
    ?? data.shelves.find((shelf) => shelf.documents.length > 0)
    ?? data.shelves[0]

  return (
    <main className="dashboard-page section-wrap">
      <section className="dashboard-hero">
        <div>
          <span className="dashboard-kicker"><ShieldCheck size={16} /> Area riservata</span>
          <h1>Ciao {firstName}, qui tieni insieme tutto lo studio.</h1>
          <p>
            Documenti, crediti, flashcard, quiz e ripassi programmati in una dashboard pensata per studenti L-13,
            sempre sincronizzata e al sicuro.
          </p>
          <div className="dashboard-hero-actions">
            <button className="primary-action" onClick={() => onRoute('upload')} type="button">
              <Upload size={18} />
              Carica appunti
            </button>
            <button className="secondary-action" onClick={() => onRoute('app')} type="button">
              <Search size={18} />
              Cerca documenti
            </button>
            <button className="plain-action dashboard-logout" onClick={onSignOut} type="button">
              <LogOut size={17} />
              Esci
            </button>
          </div>
        </div>
        <img src={libraryNotes} alt="Libreria appunti" />
      </section>

      <section className="dashboard-profile-grid" id="profilo" style={{ scrollMarginTop: '90px' }}>
        <article className="dashboard-profile-card">
          <span className="dashboard-profile-avatar">
            {user.name.split(' ').slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'UD'}
          </span>
          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <small className="dashboard-sync">
              <span className={`dashboard-sync-dot ${dataIsLive ? 'live' : liveLoading ? 'loading' : ''}`} />
              {user.isDemo
                ? 'Modalità demo'
                : liveLoading
                  ? 'Sincronizzazione…'
                  : dataIsLive
                    ? 'Dati aggiornati'
                    : 'Account attivo'}
              {' '}· Scienze Biologiche L-13
            </small>
          </div>
        </article>

        <button className="dashboard-stat stat-credits" onClick={() => onRoute('settings')} type="button">
          <span className="dashboard-stat-icon"><Wallet size={20} /></span>
          <span className="dashboard-stat-body">
            <strong>{displayCredits}</strong>
            <span className="dashboard-stat-label">Crediti disponibili</span>
            <span className="dashboard-stat-sub">Gestisci e ricarica <ChevronRight size={13} /></span>
          </span>
        </button>

        <button className="dashboard-stat stat-flashcards" onClick={() => onRoute('app')} type="button">
          <span className="dashboard-stat-icon"><BrainCircuit size={20} /></span>
          <span className="dashboard-stat-body">
            <strong>{totalFlashcards}</strong>
            <span className="dashboard-stat-label">Flashcard collegate</span>
            <span className="dashboard-stat-sub">{data.decks.length} deck attivi</span>
          </span>
        </button>

        <article className="dashboard-stat stat-progress">
          <span className="dashboard-stat-icon"><Target size={20} /></span>
          <span className="dashboard-stat-body">
            <strong>{averageProgress}%</strong>
            <span className="dashboard-stat-label">Progresso medio</span>
            <span className="dashboard-stat-sub">{data.subjectProgress.length} materie seguite</span>
          </span>
        </article>

        <article className="dashboard-stat stat-reviews">
          <span className="dashboard-stat-icon"><RefreshCw size={20} /></span>
          <span className="dashboard-stat-body">
            <strong>{dueReviews}</strong>
            <span className="dashboard-stat-label">Ripassi programmati</span>
            <span className="dashboard-stat-sub">Da chiudere a breve</span>
          </span>
        </article>
      </section>

      {wallet ? (
        <section className="dashboard-section dashboard-credits" id="crediti" style={{ scrollMarginTop: '90px' }}>
          <div className="dashboard-section-head">
            <div>
              <h2>Crediti e acquisti</h2>
              <p>Il tuo saldo è persistente e diviso per tipo. I crediti gratuiti valgono solo su materiali fino a {WELCOME_CREDITS} crediti.</p>
            </div>
            <button onClick={() => onRoute('premium')} type="button"><Wallet size={15} /> Ricarica</button>
          </div>

          <div className="credits-split-grid">
            <article className="credits-split free">
              <span className="credits-split-icon"><Sparkles size={18} /></span>
              <strong>{wallet.wallet.free}</strong>
              <span className="credits-split-label">Gratuiti</span>
              <small>Bonus di benvenuto · solo materiali ≤ {WELCOME_CREDITS} crediti</small>
            </article>
            <article className="credits-split purchased">
              <span className="credits-split-icon"><CreditIcon size="sm" /></span>
              <strong>{wallet.wallet.purchased}</strong>
              <span className="credits-split-label">Acquistati</span>
              <small>Ricaricati con denaro reale · spendibili ovunque</small>
            </article>
            <article className="credits-split earned">
              <span className="credits-split-icon"><Trophy size={18} /></span>
              <strong>{wallet.wallet.earned}</strong>
              <span className="credits-split-label">Guadagnati</span>
              <small>Da vendite e ricompense · {wallet.wallet.earnedConvertible} convertibili</small>
            </article>
            <article className="credits-split total">
              <span className="credits-split-icon"><Wallet size={18} /></span>
              <strong>{balanceOf(wallet.wallet)}</strong>
              <span className="credits-split-label">Saldo totale</span>
              <small>≈ €{creditsToEur(balanceOf(wallet.wallet)).toFixed(2)} di valore di spesa</small>
            </article>
          </div>

          <div className="dashboard-credits-columns">
            <div className="dashboard-credits-purchased">
              <h3>Documenti acquistati ({wallet.purchases.length})</h3>
              {wallet.purchases.length ? (
                <div className="dashboard-doc-list">
                  {wallet.purchases.slice(0, 6).map((purchase) => {
                    const doc = documents.find((item) => item.id === purchase.documentId)
                    return (
                      <button
                        className="dashboard-doc-row"
                        key={purchase.transactionId}
                        onClick={() => (doc ? onOpenDocument(doc) : undefined)}
                        type="button"
                      >
                        <span><SubjectIcon compact name={purchase.subject} /></span>
                        <div>
                          <strong>{purchase.title.replace(' - Appunti completi', '')}</strong>
                          <small>{purchase.subject} · {purchase.professor} · {formatTimestamp(purchase.purchasedAt)}</small>
                        </div>
                        <em>{purchase.creditsSpent} cr</em>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="dashboard-empty">Nessun acquisto ancora. Sblocca un materiale e comparirà qui, per sempre.</p>
              )}
            </div>

            <div className="dashboard-credits-ledger">
              <h3>Storico operazioni</h3>
              <div className="dashboard-ledger-list">
                {wallet.ledger.slice(0, 8).map((entry) => (
                  <article className={`ledger-${entry.direction}`} key={entry.id}>
                    <span className="ledger-amount">{entry.direction === 'spent' ? '−' : '+'}{entry.amount}</span>
                    <div>
                      <strong>{entry.reason}</strong>
                      <small>
                        {formatTimestamp(entry.ts)} · saldo {entry.balanceBefore}→{entry.balanceAfter}
                        {entry.breakdown && entry.breakdown.free > 0 ? ` · ${entry.breakdown.free} gratuiti` : ''}
                      </small>
                    </div>
                    <em className="ledger-ref">{formatTransactionRef(entry.id)}</em>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="dashboard-layout">
        <div className="dashboard-main">
          <section className="dashboard-section">
            <div className="dashboard-section-head">
              <div>
                <h2>Libreria personale</h2>
                <p>Caricati, acquistati, salvati e segnati per dopo: tutto il tuo materiale in un unico posto.</p>
              </div>
              <button onClick={() => onRoute('upload')} type="button"><Plus size={15} /> Nuovo upload</button>
            </div>
            <div className="dashboard-shelf-tabs" role="tablist" aria-label="Sezioni della libreria">
              {data.shelves.map((shelf) => (
                <button
                  key={shelf.id}
                  className={shelf.id === activeShelf?.id ? 'active' : ''}
                  role="tab"
                  aria-selected={shelf.id === activeShelf?.id}
                  onClick={() => setActiveShelfId(shelf.id)}
                  type="button"
                >
                  {shelf.label}
                  <span>{shelf.documents.length}</span>
                </button>
              ))}
            </div>
            {activeShelf ? (
              <div className="dashboard-shelf-panel" role="tabpanel">
                <p className="dashboard-shelf-caption">{activeShelf.description}</p>
                {activeShelf.documents.length ? (
                  <div className="dashboard-doc-list">
                    {activeShelf.documents.map((document) => (
                      <button className="dashboard-doc-row" key={`${activeShelf.id}-${document.id}`} onClick={() => onPreview(document)} type="button">
                        <span><SubjectIcon compact name={document.subject} /></span>
                        <div>
                          <strong>{document.title.replace(' - Appunti completi', '').replace(' generale - Domande frequenti', '')}</strong>
                          <small>{findCourse(document.subject)?.shortName ?? document.subject} · {document.professor}</small>
                        </div>
                        <em>{document.pages}p</em>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="dashboard-empty">{activeShelf.emptyText}</p>
                )}
              </div>
            ) : null}
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-head">
              <div>
                <h2>Flashcard e quiz</h2>
                <p>Deck generati o approvati, con card in scadenza e fonte del documento.</p>
              </div>
              <button onClick={() => onRoute('upload')} type="button"><BrainCircuit size={15} /> Genera da PDF</button>
            </div>
            <div className="dashboard-deck-grid">
              {data.decks.map((deck) => (
                <article key={deck.id}>
                  <div>
                    <span><BrainCircuit size={18} /></span>
                    <strong>{deck.mastery}%</strong>
                  </div>
                  <h3>{deck.title}</h3>
                  <p>{deck.subject} · fonte {deck.source}</p>
                  <footer>
                    <span>{deck.cards} card</span>
                    <span>{deck.quizzes} quiz</span>
                    <span>{deck.due} da ripassare</span>
                  </footer>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-head">
              <div>
                <h2>Progressi per documento</h2>
                <p>Utile per capire quali dispense stanno rendendo e quali vanno ripassate.</p>
              </div>
            </div>
            <div className="dashboard-progress-table">
              {data.documentProgress.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.subject} · ultima sessione {item.lastSession}</small>
                  </div>
                  <div className="dashboard-progress-bar"><span style={{ width: `${item.progress}%` }} /></div>
                  <span>{item.progress}%</span>
                  <em>{item.flashcards} card · {item.quizAccuracy}% quiz</em>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-head">
              <div>
                <h2>Confronto performance</h2>
                <p>Confronta documenti della stessa materia prima di decidere dove investire tempo o crediti.</p>
              </div>
            </div>
            <div className="dashboard-compare-grid">
              {data.documentProgress.slice(0, 4).map((item) => (
                <article key={`compare-${item.id}`}>
                  <span>{item.subject}</span>
                  <strong>{item.quizAccuracy}%</strong>
                  <p>{item.title}</p>
                  <div className="dashboard-progress-bar"><span style={{ width: `${item.quizAccuracy}%` }} /></div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="dashboard-side">
          <section className="dashboard-section compact" id="notifiche" style={{ scrollMarginTop: '90px' }}>
            <h2>
              Notifiche
              {dataIsLive ? <span className="dashboard-live-badge">Live</span> : null}
            </h2>
            <div className="dashboard-notification-list">
              {data.notifications.slice(0, 3).map((notification) => (
                <article className={notification.tone} key={notification.id}>
                  <span><Bell size={16} /></span>
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <small>{notification.time}</small>
                  </div>
                </article>
              ))}
            </div>
            {data.notifications.length > 3 ? (
              <button className="dashboard-side-more" onClick={() => setSidePanel('notifications')} type="button">
                Vedi tutte ({data.notifications.length}) <ChevronRight size={14} />
              </button>
            ) : null}
          </section>

          <section className="dashboard-section compact">
            <h2>
              Storico crediti
              {dataIsLive ? <span className="dashboard-live-badge">Live</span> : null}
            </h2>
            <div className="dashboard-credit-ledger">
              {data.creditHistory.slice(0, 3).map((entry) => (
                <article className={entry.type} key={entry.id}>
                  <span>{entry.type === 'spent' ? '-' : '+'}{entry.amount}</span>
                  <div>
                    <strong>{entry.reason}</strong>
                    <small>{entry.date}</small>
                  </div>
                </article>
              ))}
            </div>
            {data.creditHistory.length > 3 ? (
              <button className="dashboard-side-more" onClick={() => setSidePanel('credits')} type="button">
                Vedi tutto ({data.creditHistory.length}) <ChevronRight size={14} />
              </button>
            ) : null}
          </section>

          <section className="dashboard-section compact">
            <h2>Progressi per materia</h2>
            <div className="dashboard-subject-list">
              {data.subjectProgress.map((item) => (
                <article key={item.subject}>
                  <div>
                    <strong>{item.subject}</strong>
                    <small>{item.documents} documenti · {item.due} ripassi</small>
                  </div>
                  <span>{item.accuracy}%</span>
                  <div className="dashboard-progress-bar"><span style={{ width: `${item.progress}%` }} /></div>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-section compact">
            <h2>Sessioni recenti</h2>
            <div className="dashboard-timeline">
              {data.sessions.map((session) => (
                <article key={session.id}>
                  <span><BookOpen size={15} /></span>
                  <div>
                    <strong>{session.title}</strong>
                    <p>{session.detail}</p>
                    <small>{session.duration} · {session.date}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-section compact">
            <h2>Ripassi programmati</h2>
            <div className="dashboard-review-list">
              {data.reviews.map((review) => (
                <article className={review.priority} key={review.id}>
                  <span>{review.priority}</span>
                  <div>
                    <strong>{review.title}</strong>
                    <small>{review.subject} · {review.dueAt}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-section compact">
            <h2>Suggerimenti</h2>
            <div className="dashboard-suggestion-list">
              {data.suggestions.map((suggestion) => (
                <article key={suggestion.id}>
                  <Sparkles size={16} />
                  <div>
                    <strong>{suggestion.title}</strong>
                    <p>{suggestion.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {sidePanel ? (
        <div className="dashboard-modal" role="dialog" aria-modal="true" aria-label={sidePanel === 'notifications' ? 'Tutte le notifiche' : 'Storico crediti completo'}>
          <button className="preview-backdrop" onClick={() => setSidePanel(null)} aria-label="Chiudi" type="button" />
          <div className="dashboard-modal-panel">
            <header>
              <h2>{sidePanel === 'notifications' ? 'Tutte le notifiche' : 'Storico crediti completo'}</h2>
              <button className="dashboard-modal-close" onClick={() => setSidePanel(null)} aria-label="Chiudi" type="button"><X size={18} /></button>
            </header>
            {sidePanel === 'notifications' ? (
              <div className="dashboard-notification-list">
                {data.notifications.map((notification) => (
                  <article className={notification.tone} key={`modal-${notification.id}`}>
                    <span><Bell size={16} /></span>
                    <div>
                      <strong>{notification.title}</strong>
                      <p>{notification.body}</p>
                      <small>{notification.time}</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="dashboard-credit-ledger">
                {data.creditHistory.map((entry) => (
                  <article className={entry.type} key={`modal-${entry.id}`}>
                    <span>{entry.type === 'spent' ? '-' : '+'}{entry.amount}</span>
                    <div>
                      <strong>{entry.reason}</strong>
                      <small>{entry.date}</small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  )
}

function SettingsPage({
  user,
  credits,
  onRoute,
  onSignOut,
}: {
  user: AppAuthUser
  credits: number
  onRoute: (route: Route) => void
  onSignOut: () => void
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    let active = true
    void loadNotificationPrefs(user).then((loaded) => {
      if (active) setPrefs(loaded)
    })
    return () => {
      active = false
    }
  }, [user])

  const toggleChannel = (categoryId: string, channel: NotificationChannel) => {
    setPrefs((current) => {
      if (!current) return current
      const next: NotificationPrefs = {
        ...current,
        [categoryId]: { ...current[categoryId], [channel]: !current[categoryId][channel] },
      }
      setSaveState('saving')
      void saveNotificationPrefs(user, next).then(() => {
        setSaveState('saved')
        window.setTimeout(() => setSaveState('idle'), 1600)
      })
      return next
    })
  }

  const initials =
    user.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'UD'

  return (
    <main className="settings-page section-wrap">
      <section className="settings-hero">
        <div>
          <span className="dashboard-kicker"><Settings size={16} /> Impostazioni</span>
          <h1>Gestisci account, crediti e notifiche</h1>
          <p>Decidi con precisione quali avvisi ricevere e su quali canali riceverli.</p>
        </div>
        <button className="secondary-action" onClick={() => onRoute('dashboard')} type="button">
          <ChevronLeft size={18} /> Torna alla dashboard
        </button>
      </section>

      <div className="settings-grid">
        <aside className="settings-account">
          <article className="settings-account-card">
            <span className="settings-avatar">{initials}</span>
            <div className="settings-account-id">
              <h2>{user.name}</h2>
              <p title={user.email}>{user.email}</p>
              <small>Scienze Biologiche L-13</small>
            </div>
          </article>
          <article className="settings-credit-card">
            <span className="settings-credit-label"><Wallet size={16} /> Crediti disponibili</span>
            <strong>{credits}</strong>
            <p>I {WELCOME_CREDITS} crediti di benvenuto bastano per sbloccare una dispensa base o standard.</p>
            <button className="secondary-action" onClick={() => onRoute('premium')} type="button">
              <Crown size={16} /> Ricarica con Premium
            </button>
          </article>
          <button className="settings-logout" onClick={onSignOut} type="button">
            <LogOut size={16} /> Esci dall’account
          </button>
        </aside>

        <section className="settings-notifications">
          <div className="settings-section-head">
            <div>
              <h2><Bell size={18} /> Preferenze notifiche</h2>
              <p>Attiva o disattiva ogni tipo di avviso separatamente, per singolo canale.</p>
            </div>
            <span className={`settings-save-state ${saveState}`}>
              {saveState === 'saving' ? (
                <><Loader2 className="spin" size={14} /> Salvo…</>
              ) : saveState === 'saved' ? (
                <><Check size={14} /> Salvato</>
              ) : (
                'Salvataggio automatico'
              )}
            </span>
          </div>

          {!prefs ? (
            <div className="settings-loading"><Loader2 className="spin" size={20} /> Carico le preferenze…</div>
          ) : (
            <>
              <div className="settings-channel-legend">
                <span className="settings-legend-label">Canali disponibili</span>
                <div className="settings-legend-channels">
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <span key={channel.id} className="settings-legend-channel">
                      {channel.id === 'inApp' ? <Bell size={13} /> : channel.id === 'email' ? <Mail size={13} /> : <Smartphone size={13} />}
                      {channel.label}
                      {channel.hint ? <em>{channel.hint}</em> : null}
                    </span>
                  ))}
                </div>
              </div>

              {NOTIFICATION_GROUPS.map((group) => (
                <div className="settings-notif-group" key={group}>
                  <h3>{group}</h3>
                  {NOTIFICATION_CATEGORIES.filter((category) => category.group === group).map((category) => (
                    <div className="settings-notif-row" key={category.id}>
                      <div className="settings-notif-label">
                        <strong>{category.label}</strong>
                        <small>{category.description}</small>
                      </div>
                      <div className="settings-notif-toggles">
                        {NOTIFICATION_CHANNELS.map((channel) => {
                          const disabled = channel.id === 'push'
                          const active = prefs[category.id][channel.id]
                          return (
                            <button
                              key={channel.id}
                              className={`settings-toggle ${active ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
                              onClick={() => {
                                if (!disabled) toggleChannel(category.id, channel.id)
                              }}
                              type="button"
                              role="switch"
                              aria-checked={active}
                              aria-label={`${category.label} — ${channel.label}`}
                              disabled={disabled}
                              title={disabled ? 'Notifiche push in arrivo' : channel.label}
                            >
                              <span className="settings-toggle-track"><span className="settings-toggle-thumb" /></span>
                              <em>{channel.label}</em>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function Toast({ message }: { message: string }) {
  return <div className="toast"><Check size={17} /> {message}</div>
}

function PurchaseConfirmModal({
  item,
  onClose,
  onView,
  onOpenPage,
}: {
  item: PurchasedItem
  onClose: () => void
  onView: () => void
  onOpenPage: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cleanTitle = item.title.replace(' - Appunti completi', '').replace(' generale - Domande frequenti', '')

  return (
    <div className="purchase-modal" role="dialog" aria-modal="true" aria-label="Acquisto completato">
      <button className="preview-backdrop" onClick={onClose} aria-label="Chiudi" type="button" />
      <div className="purchase-panel">
        <div className="purchase-panel-head">
          <span className="purchase-check"><Check size={26} /></span>
          <div>
            <h2>Materiale sbloccato</h2>
            <p>È già nella tua <strong>Libreria personale → Documenti acquistati</strong>, disponibile per sempre.</p>
          </div>
          <button className="purchase-close" onClick={onClose} aria-label="Chiudi" type="button"><X size={18} /></button>
        </div>

        <div className="purchase-doc">
          <span className="purchase-doc-icon"><SubjectIcon compact name={item.subject} /></span>
          <div>
            <strong>{cleanTitle}</strong>
            <small>{item.subject} · {item.professor} · {item.type}</small>
          </div>
        </div>

        <dl className="purchase-receipt">
          <div><dt>Crediti spesi</dt><dd>{item.creditsSpent} <span>(≈ €{item.eurValue.toFixed(2)})</span></dd></div>
          <div><dt>Saldo prima</dt><dd>{item.balanceBefore}</dd></div>
          <div><dt>Saldo dopo</dt><dd>{item.balanceAfter}</dd></div>
          <div><dt>Università</dt><dd>{item.university}</dd></div>
          <div><dt>Corso</dt><dd>{item.course}</dd></div>
          <div><dt>Anno accademico</dt><dd>{item.academicYear}</dd></div>
          <div><dt>Autore</dt><dd>{item.uploader}</dd></div>
          <div><dt>Data e ora</dt><dd>{formatTimestamp(item.purchasedAt)}</dd></div>
          <div><dt>Rif. transazione</dt><dd className="purchase-ref">{formatTransactionRef(item.transactionId)}</dd></div>
        </dl>

        <div className="purchase-actions">
          <button className="primary-action" onClick={onView} type="button"><Eye size={17} /> Visualizza subito</button>
          <button className="secondary-action" onClick={onOpenPage} type="button"><FileText size={17} /> Apri la pagina del documento</button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const initialRoute = routeFromPathname(window.location.pathname)
  const [route, setRoute] = useState<Route>(initialRoute)
  const [routeDocument, setRouteDocument] = useState<DocumentItem | null>(() =>
    initialRoute === 'document' ? findDocumentByPath(window.location.pathname, appDocuments) : null,
  )
  const [routeProfile, setRouteProfile] = useState<string | null>(() =>
    initialRoute === 'profile' ? findUploaderBySlug(window.location.pathname, appDocuments) : null,
  )
  const [authMode, setAuthMode] = useState<AuthMode>(authModeFromRoute(initialRoute))
  const [authUser, setAuthUser] = useState<AppAuthUser | null>(() => loadStoredDemoUser())
  const [credits, setCredits] = useState(120)
  const [walletState, setWalletState] = useState<WalletState | null>(null)
  const [purchaseModal, setPurchaseModal] = useState<{ item: PurchasedItem; document: DocumentItem } | null>(null)
  const [uploads, setUploads] = useState<DocumentItem[]>([])
  const [initialSubject, setInitialSubject] = useState(subjectFromSearch)
  const [initialQuery, setInitialQuery] = useState(queryFromSearch)
  const [previewDocument, setPreviewDocument] = useState<DocumentItem | null>(null)
  const [demoOpen, setDemoOpen] = useState(false)
  const [toast, setToast] = useState('')
  // Until the initial Supabase session check resolves we must not run the private
  // route guard, otherwise a refresh on /dashboard bounces a valid session to login.
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const isLoggedIn = Boolean(authUser)

  const navigateRoute = (nextRoute: Route, options?: { replace?: boolean; search?: string; hash?: string }) => {
    const hash = options?.hash ? `#${options.hash}` : ''
    const nextPath = `${routePaths[nextRoute]}${options?.search ?? ''}${hash}`
    setRoute(nextRoute)
    if (nextRoute !== 'document') setRouteDocument(null)

    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextPath) {
      const method = options?.replace ? 'replaceState' : 'pushState'
      window.history[method]({ route: nextRoute }, '', nextPath)
    }
    // Same-route hash change (already on /dashboard): notify listeners to scroll.
    if (hash) window.dispatchEvent(new CustomEvent('ud-section', { detail: options?.hash }))
  }

  const openProfile = (name: string) => {
    const nextPath = `${routePaths.profile}/${authorSlug(name)}`
    setRoute('profile')
    setRouteProfile(name)
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ route: 'profile' }, '', nextPath)
    }
    window.scrollTo({ left: 0, top: 0 })
  }

  const openDocumentPage = (document: DocumentItem) => {
    const nextPath = documentPath(document)
    setRoute('document')
    setRouteDocument(document)
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ route: 'document' }, '', nextPath)
    }
  }

  useEffect(() => {
    const listener = () => navigateRoute('landing')
    window.addEventListener('go-home', listener)
    return () => window.removeEventListener('go-home', listener)
  })

  useEffect(() => {
    const onPopState = () => {
      const nextRoute = routeFromPathname(window.location.pathname)
      setRoute(nextRoute)
      setRouteDocument(nextRoute === 'document' ? findDocumentByPath(window.location.pathname, appDocuments) : null)
      setRouteProfile(nextRoute === 'profile' ? findUploaderBySlug(window.location.pathname, appDocuments) : null)
      setAuthMode(authModeFromRoute(nextRoute))
      if (nextRoute === 'app') {
        setInitialSubject(subjectFromSearch())
        setInitialQuery(queryFromSearch())
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [route])

  useEffect(() => {
    const seo = routeSeo[route]
    const isDocPage = route === 'document' && routeDocument
    const isProfilePage = route === 'profile' && routeProfile
    const title = isDocPage
      ? documentSeoTitle(routeDocument)
      : isProfilePage
        ? `${routeProfile} · Appunti Scienze Biologiche UniMi | UnimiDoc`
        : seo.title
    const descriptionText = isDocPage
      ? documentSeoDescription(routeDocument)
      : isProfilePage
        ? `Materiali, valutazioni e vendite di ${routeProfile} per Scienze Biologiche L-13 alla Statale di Milano.`
        : seo.description
    const canonicalPath = isDocPage
      ? documentPath(routeDocument)
      : isProfilePage
        ? `${routePaths.profile}/${authorSlug(routeProfile)}`
        : routePaths[route === 'signup' ? 'login' : route]
    const canonicalUrl = `${window.location.origin}${canonicalPath}`

    document.title = title

    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.append(description)
    }
    description.content = descriptionText

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.append(canonical)
    }
    canonical.href = canonicalUrl

    // Open Graph / Twitter: le anteprime nei social e nelle chat AI leggono
    // questi tag, quindi vanno tenuti allineati alla pagina attiva.
    setMetaTag('property', 'og:title', title)
    setMetaTag('property', 'og:description', descriptionText)
    setMetaTag('property', 'og:url', canonicalUrl)
    setMetaTag('property', 'og:type', isDocPage ? 'article' : 'website')
    setMetaTag('property', 'og:site_name', 'UnimiDoc')
    setMetaTag('property', 'og:locale', 'it_IT')
    setMetaTag('name', 'twitter:card', 'summary')
    setMetaTag('name', 'twitter:title', title)
    setMetaTag('name', 'twitter:description', descriptionText)

    if (isDocPage) {
      setJsonLd('document', documentJsonLd(routeDocument, canonicalUrl))
      setJsonLd('breadcrumb', breadcrumbJsonLd(routeDocument, window.location.origin))
    } else {
      setJsonLd('document', null)
      setJsonLd('breadcrumb', null)
    }

    if (route === 'app') {
      setJsonLd('ranking', uploaderRankJsonLd(buildUploaderRanking(appDocuments).slice(0, 5), window.location.origin))
    } else {
      setJsonLd('ranking', null)
    }
  }, [route, routeDocument])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined

    let active = true
    void getSupabaseSessionUser()
      .then((user) => {
        if (active) setAuthUser(user)
      })
      .catch(() => {
        if (active) setAuthUser(null)
      })
      .finally(() => {
        if (active) setAuthReady(true)
      })

    const unsubscribe = subscribeSupabaseAuth((user) => {
      setAuthUser(user)
      if (user) storeDemoUser(null)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Keep the app-wide credit counter in sync with the persisted balance so the
  // header and dashboard agree for authenticated (non-demo) users.
  const authUserId = authUser?.id
  const authUserIsDemo = authUser?.isDemo ?? false
  // The wallet drives the demo experience (persistent, split, ledger). Live
  // users keep the DB balance path below.
  const walletMode = Boolean(authUserId) && (!isSupabaseConfigured || authUserIsDemo)

  useEffect(() => {
    if (!authUserId || !walletMode) {
      setWalletState(null)
      return
    }
    const state = ensureWallet(authUserId, { grantWelcome: true })
    setWalletState(state)
    setCredits(balanceOf(state.wallet))
  }, [authUserId, walletMode])

  useEffect(() => {
    if (!authUserId || authUserIsDemo || !isSupabaseConfigured) return undefined

    let active = true
    void getUserCreditBalance().then((balance) => {
      if (active && typeof balance === 'number') setCredits(balance)
    })
    // Allinea anche l'hint premium locale all'entitlement reale, così i gate
    // client (studio flashcard, occlusion) non dipendono da un flag manuale.
    void refreshPremiumState()

    return () => {
      active = false
    }
  }, [authUserId, authUserIsDemo])

  const goAuth = (mode: AuthMode) => {
    setAuthMode(mode)
    navigateRoute(mode === 'signup' ? 'signup' : 'login')
  }

  const exploreSubject = (value: string) => {
    const course = findCourse(value)
    setInitialSubject(course?.name ?? 'Tutti')
    navigateRoute('app', { search: course ? `?materia=${encodeURIComponent(course.shortName)}` : '' })
  }

  // Ricerca globale dall'header: se la query è esattamente un corso del
  // catalogo va al filtro materia, altrimenti ricerca testuale full-metadata.
  const searchDocuments = (query: string) => {
    const course = findCourse(query)
    if (course) {
      exploreSubject(course.name)
      return
    }
    setInitialSubject('Tutti')
    setInitialQuery(query)
    navigateRoute('app', { search: `?q=${encodeURIComponent(query)}` })
  }

  const completeLogin = async (values: AuthFormValues) => {
    if (values.provider === 'google' && isSupabaseConfigured) {
      await signInWithGoogle(routePaths[nextRouteAfterAuth()])
      return
    }

    if (isSupabaseConfigured) {
      if (authMode === 'signup') {
        const result = await signUpWithEmail(values.email.trim(), values.password, values.fullName.trim())
        if (result.status === 'confirm') {
          setAuthMode('login')
          navigateRoute('login', { replace: true })
          notify('Ti abbiamo inviato un’email di conferma: aprila, poi accedi qui.')
          return
        }
        setAuthUser(result.user)
        storeDemoUser(null)
      } else {
        const supabaseUser = await signInWithEmail(values.email.trim(), values.password)
        if (!supabaseUser) {
          throw new Error('Accesso non riuscito: controlla email e password.')
        }
        setAuthUser(supabaseUser)
        storeDemoUser(null)
      }
    } else {
      const demoUser = makeDemoAuthUser(values)
      setAuthUser(demoUser)
      storeDemoUser(demoUser, values.remember)
    }

    navigateRoute(nextRouteAfterAuth())
    notify(authMode === 'login' ? 'Bentornata: dashboard sincronizzata.' : 'Account creato: la tua area riservata è pronta.')
  }

  const handleSignOut = async () => {
    try {
      await signOutSupabase()
    } finally {
      setAuthUser(null)
      storeDemoUser(null)
      navigateRoute('landing')
      notify('Sessione chiusa. I dati demo restano sul dispositivo solo se salvi nuovi contenuti.')
    }
  }

  const handleDownload = (document: DocumentItem) => {
    if (!isLoggedIn) {
      goAuth('login')
      notify('Accedi per scaricare e salvare questo appunto.')
      return
    }
    const price = documentCreditPrice(document)

    // Wallet mode (demo): persistent purchase with split, ledger, library entry
    // and a confirmation modal.
    if (walletMode && authUserId) {
      const alreadyOwned = loadWalletState(authUserId).purchases.some((purchase) => purchase.documentId === document.id)
      if (alreadyOwned) {
        setPreviewDocument(null)
        openDocumentPage(document)
        notify('Hai già questo materiale: lo trovi nella tua libreria.')
        return
      }
      const result = purchaseWithWallet(authUserId, document, price)
      if (!result.ok) {
        if (result.reason === 'free_only_low_cost') {
          navigateRoute('premium')
          notify(`I crediti gratuiti sbloccano solo materiali fino a ${WELCOME_CREDITS} crediti. Ricarica per questo documento.`)
        } else {
          navigateRoute('premium')
          notify(`Servono ${price} crediti per questa dispensa: ricarica o passa a Premium.`)
        }
        return
      }
      setWalletState(result.state)
      setCredits(balanceOf(result.state.wallet))
      setPreviewDocument(null)
      setPurchaseModal({ item: result.item, document })
      return
    }

    // Live path (DB balance). The authoritative deduction happens server-side
    // via the purchase_document RPC; here we optimistically reflect it.
    if (credits < price) {
      navigateRoute('premium')
      notify(`Servono ${price} crediti per questa dispensa: Premium ti aiuta quando sei a corto.`)
      return
    }
    setCredits((value) => value - price)
    notify(`Dispensa sbloccata: ${price} crediti usati bene.`)
  }

  const openPremiumFromPreview = () => {
    setPreviewDocument(null)
    setDemoOpen(false)
    navigateRoute('premium')
  }

  const publishUpload = (document: DocumentItem) => {
    const reward = 25
    setUploads((current) => [document, ...current])
    if (walletMode && authUserId) {
      const state = addEarnedCredits(authUserId, reward, 'Caricamento approvato')
      setWalletState(state)
      setCredits(balanceOf(state.wallet))
    } else {
      setCredits((value) => value + reward)
    }
    notify(`Caricamento inviato in revisione: +${reward} crediti.`)
    return reward
  }

  const switchAuthMode = (mode: AuthMode) => {
    setAuthMode(mode)
    navigateRoute(mode === 'signup' ? 'signup' : 'login', { replace: true })
  }

  useEffect(() => {
    if (!authReady) return
    const privateRoute = route === 'dashboard' || route === 'library' || route === 'settings'
    if (!privateRoute || isLoggedIn) return

    setAuthMode('login')
    navigateRoute('login', { replace: true, search: `?next=${routePaths[route]}` })
    notify('Accedi per aprire la tua area riservata.')
  }, [isLoggedIn, route, authReady])

  return (
    <>
      {route !== 'login' && route !== 'signup' ? (
        <Header route={route} isLoggedIn={isLoggedIn} credits={credits} user={authUser} onRoute={navigateRoute} onAuth={goAuth} onSearch={searchDocuments} onSignOut={() => void handleSignOut()} />
      ) : null}
      {route === 'landing' ? (
        <LandingPage onRoute={navigateRoute} onAuth={goAuth} onExploreSubject={exploreSubject} onOpenDemo={() => setDemoOpen(true)} />
      ) : null}
      {route === 'login' || route === 'signup' ? (
        <LoginPage mode={authMode} onMode={switchAuthMode} onSubmit={completeLogin} onRoute={navigateRoute} />
      ) : null}
      {route === 'app' ? (
        <AppHome
          credits={credits}
          documents={appDocuments}
          initialSubject={initialSubject}
          isLoggedIn={isLoggedIn}
          onAuth={goAuth}
          onDownload={handleDownload}
          onOpenDocument={openDocumentPage}
          onOpenProfile={openProfile}
          onPreview={setPreviewDocument}
          onRoute={navigateRoute}
          initialQuery={initialQuery}
        />
      ) : null}
      {route === 'document' ? (
        <DocumentPage
          document={routeDocument}
          documents={appDocuments}
          onDownload={handleDownload}
          onOpenDocument={openDocumentPage}
          onOpenProfile={openProfile}
          onPreview={setPreviewDocument}
          onRoute={navigateRoute}
        />
      ) : null}
      {route === 'profile' ? (
        <PublicProfilePage
          uploaderName={routeProfile}
          documents={appDocuments}
          onRoute={navigateRoute}
          onOpenDocument={openDocumentPage}
        />
      ) : null}
      {route === 'premium' ? <PremiumPage onRoute={navigateRoute} /> : null}
      {route === 'upload' ? <UploadPage onRoute={navigateRoute} onPublish={publishUpload} /> : null}
      {route === 'library' || route === 'dashboard' ? (
        authUser ? (
          <UserDashboardPage
            credits={credits}
            wallet={walletState}
            documents={appDocuments}
            onPreview={setPreviewDocument}
            onOpenDocument={openDocumentPage}
            onRoute={navigateRoute}
            onSignOut={() => void handleSignOut()}
            uploads={uploads}
            user={authUser}
          />
        ) : !authReady ? (
          <main className="dashboard-loading section-wrap">
            <Loader2 className="spin" size={22} />
            <p>Carico la tua area riservata…</p>
          </main>
        ) : null
      ) : null}
      {route === 'settings' ? (
        authUser ? (
          <SettingsPage credits={credits} user={authUser} onRoute={navigateRoute} onSignOut={() => void handleSignOut()} />
        ) : !authReady ? (
          <main className="dashboard-loading section-wrap">
            <Loader2 className="spin" size={22} />
            <p>Carico le impostazioni…</p>
          </main>
        ) : null
      ) : null}
      {previewDocument ? (
        <PreviewModal document={previewDocument} onClose={() => setPreviewDocument(null)} onPremium={openPremiumFromPreview} />
      ) : null}
      {demoOpen ? <DemoDocumentModal onClose={() => setDemoOpen(false)} onPremium={openPremiumFromPreview} /> : null}
      {purchaseModal ? (
        <PurchaseConfirmModal
          item={purchaseModal.item}
          onClose={() => setPurchaseModal(null)}
          onView={() => {
            const doc = purchaseModal.document
            setPurchaseModal(null)
            setPreviewDocument(doc)
          }}
          onOpenPage={() => {
            const doc = purchaseModal.document
            setPurchaseModal(null)
            openDocumentPage(doc)
          }}
        />
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </>
  )
}

export default App
