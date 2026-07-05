import { findCourse } from './courseCatalog'
import type { DocumentItem } from './data'
import { supabase, type AppAuthUser } from './lib/supabaseClient'

export type DashboardNotification = {
  id: string
  title: string
  body: string
  time: string
  tone: 'info' | 'success' | 'warning'
}

export type CreditHistoryEntry = {
  id: string
  type: 'earned' | 'spent' | 'reserved'
  amount: number
  reason: string
  date: string
}

export type UserDocumentShelf = {
  id: string
  label: string
  description: string
  emptyText: string
  documents: DocumentItem[]
}

export type StudyDeckSummary = {
  id: string
  title: string
  subject: string
  cards: number
  quizzes: number
  due: number
  mastery: number
  source: string
}

export type SubjectProgress = {
  subject: string
  progress: number
  documents: number
  accuracy: number
  due: number
}

export type DocumentProgress = {
  id: string
  title: string
  subject: string
  progress: number
  flashcards: number
  quizAccuracy: number
  lastSession: string
}

export type StudySessionSummary = {
  id: string
  title: string
  detail: string
  duration: string
  date: string
}

export type ReviewTask = {
  id: string
  title: string
  subject: string
  dueAt: string
  priority: 'alta' | 'media' | 'bassa'
}

export type StudySuggestion = {
  id: string
  title: string
  body: string
}

export type UserDashboardData = {
  notifications: DashboardNotification[]
  creditHistory: CreditHistoryEntry[]
  shelves: UserDocumentShelf[]
  decks: StudyDeckSummary[]
  subjectProgress: SubjectProgress[]
  documentProgress: DocumentProgress[]
  sessions: StudySessionSummary[]
  reviews: ReviewTask[]
  suggestions: StudySuggestion[]
}

// Real, persisted slices of the dashboard that the backend already populates for
// every authenticated user (credits, ledger, notifications). Study analytics stay
// on the generated preview until the reader/flashcard/quiz features write rows.
export type DashboardLiveOverlay = {
  credits: number
  creditHistory: CreditHistoryEntry[]
  notifications: DashboardNotification[]
}

function relativeTimeLabel(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'Adesso'
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h fa`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Ieri'
  if (days < 7) return `${days} giorni fa`
  const weeks = Math.round(days / 7)
  return weeks <= 1 ? '1 settimana fa' : `${weeks} settimane fa`
}

type CreditTxRow = { id: string; direction: string; amount: number; reason: string; created_at: string }
type NotificationRow = { id: string; title: string; body: string; notification_type: string; created_at: string }

/**
 * Loads the user's real credits, ledger and notifications from Supabase.
 * Returns null for demo users, when Supabase is not configured, or on error —
 * callers should then keep the generated preview data.
 */
export async function loadDashboardLiveOverlay(user: AppAuthUser): Promise<DashboardLiveOverlay | null> {
  if (!supabase || user.isDemo) return null

  try {
    const [account, tx, notifs] = await Promise.all([
      supabase.from('user_credit_accounts').select('balance').eq('owner_id', user.id).maybeSingle(),
      supabase
        .from('credit_transactions')
        .select('id, direction, amount, reason, created_at')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('user_notifications')
        .select('id, title, body, notification_type, created_at')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    if (account.error && tx.error && notifs.error) return null

    const credits = (account.data as { balance: number } | null)?.balance ?? 0

    const creditHistory: CreditHistoryEntry[] = ((tx.data as CreditTxRow[] | null) ?? []).map((row) => ({
      id: row.id,
      type: row.direction === 'spent' ? 'spent' : row.direction === 'reserved' ? 'reserved' : 'earned',
      amount: row.amount,
      reason: row.reason,
      date: relativeTimeLabel(row.created_at),
    }))

    const notifications: DashboardNotification[] = ((notifs.data as NotificationRow[] | null) ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      time: relativeTimeLabel(row.created_at),
      tone:
        row.notification_type === 'warning'
          ? 'warning'
          : row.notification_type === 'success' || row.notification_type === 'purchase' || row.notification_type === 'credits'
            ? 'success'
            : 'info',
    }))

    return { credits, creditHistory, notifications }
  } catch {
    return null
  }
}

function compactTitle(document: DocumentItem) {
  return document.title.replace(' - Appunti completi', '').replace(' generale - Domande frequenti', '')
}

function uniqueBySubject(documents: DocumentItem[]) {
  const seen = new Set<string>()
  return documents.filter((document) => {
    if (seen.has(document.subject)) return false
    seen.add(document.subject)
    return true
  })
}

function uniqueById(documents: DocumentItem[]) {
  const seen = new Set<string>()
  return documents.filter((document) => {
    if (seen.has(document.id)) return false
    seen.add(document.id)
    return true
  })
}

function clampPercent(value: number) {
  return Math.max(18, Math.min(96, value))
}

export function buildUserDashboardData({
  user,
  credits,
  documents,
  uploads,
}: {
  user: AppAuthUser
  credits: number
  documents: DocumentItem[]
  uploads: DocumentItem[]
}): UserDashboardData {
  const purchased = documents.filter((document) => document.premium).slice(0, 3)
  const saved = documents.slice(1, 6)
  const studyLater = documents.filter((document) => document.pages > 60).slice(0, 4)
  const wishlist = documents.filter((document) => document.credits >= 8 && !document.premium).slice(0, 4)
  const focusSubjects = uniqueBySubject([...saved, ...purchased, ...uploads]).slice(0, 5)

  return {
    notifications: [
      {
        id: 'notif-review',
        title: uploads.length ? 'Revisione in corso' : 'Profilo pronto',
        body: uploads.length
          ? `${uploads[0].title} è in coda: ti avvisiamo appena supera i controlli.`
          : `${user.name.split(' ')[0]}, la tua area riservata è pronta: inizia a costruire la tua libreria.`,
        time: uploads.length ? 'Adesso' : 'Oggi',
        tone: uploads.length ? 'warning' : 'success',
      },
      {
        id: 'notif-review-plan',
        title: 'Ripasso consigliato',
        body: 'Genetica e Microbiologia hanno card in scadenza: meglio chiuderle prima di aggiungere nuovo materiale.',
        time: 'Tra 2 ore',
        tone: 'info',
      },
      {
        id: 'notif-credits',
        title: 'Crediti sotto controllo',
        body: `${credits} crediti disponibili. Ogni movimento resta tracciato nel tuo storico crediti.`,
        time: 'Aggiornato ora',
        tone: 'success',
      },
    ],
    creditHistory: [
      ...uploads.slice(0, 3).map((document, index) => ({
        id: `earned-${document.id}`,
        type: 'earned' as const,
        amount: 25,
        reason: `Caricamento ${compactTitle(document)}`,
        date: index === 0 ? 'Oggi' : `${index + 1} giorni fa`,
      })),
      ...purchased.slice(0, 3).map((document, index) => ({
        id: `spent-${document.id}`,
        type: 'spent' as const,
        amount: document.credits,
        reason: `Sblocco ${compactTitle(document)}`,
        date: index === 0 ? 'Ieri' : `${index + 3} giorni fa`,
      })),
      {
        id: 'reserved-ai',
        type: 'reserved',
        amount: 4,
        reason: 'Quota riservata per anteprime e revisione appunti',
        date: 'Questa settimana',
      },
    ],
    shelves: [
      {
        id: 'uploads',
        label: 'Documenti caricati',
        description: 'Materiali inviati in revisione o già pubblicati.',
        emptyText: 'Nessun caricamento ancora. Il primo appunto utile può già farti guadagnare crediti.',
        documents: uploads,
      },
      {
        id: 'purchased',
        label: 'Documenti acquistati',
        description: 'File sbloccati con crediti o accesso Premium.',
        emptyText: 'Qui appariranno gli appunti sbloccati.',
        documents: purchased,
      },
      {
        id: 'saved',
        label: 'Dispensa personale',
        description: 'Documenti salvati e già organizzati per lo studio.',
        emptyText: 'Salva un documento per costruire la tua dispensa.',
        documents: saved,
      },
      {
        id: 'later',
        label: 'Da comprare o studiare più avanti',
        description: 'Materiali segnati come utili, ma non urgenti.',
        emptyText: 'Nessun documento in lista d’attesa.',
        documents: uniqueById([...wishlist, ...studyLater]).slice(0, 6),
      },
    ],
    decks: saved.slice(0, 5).map((document, index) => ({
      id: `deck-${document.id}`,
      title: compactTitle(document),
      subject: document.subject,
      cards: 18 + index * 7,
      quizzes: 4 + index,
      due: index === 0 ? 9 : 3 + index,
      mastery: clampPercent(74 - index * 9 + Math.round(document.quality)),
      source: `p. ${Math.max(1, Math.round(document.pages * 0.18))}-${Math.max(3, Math.round(document.pages * 0.62))}`,
    })),
    subjectProgress: focusSubjects.map((document, index) => ({
      subject: findCourse(document.subject)?.shortName ?? document.subject,
      progress: clampPercent(82 - index * 11),
      documents: documents.filter((item) => item.subject === document.subject).length,
      accuracy: clampPercent(88 - index * 7),
      due: 4 + index * 3,
    })),
    documentProgress: saved.slice(0, 6).map((document, index) => ({
      id: `progress-${document.id}`,
      title: compactTitle(document),
      subject: findCourse(document.subject)?.shortName ?? document.subject,
      progress: clampPercent(76 - index * 8),
      flashcards: 22 + index * 6,
      quizAccuracy: clampPercent(90 - index * 6),
      lastSession: index === 0 ? 'Oggi' : `${index + 1} giorni fa`,
    })),
    sessions: [
      {
        id: 'session-1',
        title: 'Ripasso flashcard Genetica',
        detail: '34 card, 81% corrette, 9 rinviate',
        duration: '24 min',
        date: 'Oggi',
      },
      {
        id: 'session-2',
        title: 'Lettura guidata Microbiologia',
        detail: 'Indice automatico + note su 12 pagine',
        duration: '31 min',
        date: 'Ieri',
      },
      {
        id: 'session-3',
        title: 'Quiz Chimica biologica',
        detail: '18 domande, 14 corrette',
        duration: '16 min',
        date: '3 giorni fa',
      },
    ],
    reviews: [
      {
        id: 'review-1',
        title: 'Replicazione del DNA',
        subject: 'Genetica',
        dueAt: 'Oggi, 18:30',
        priority: 'alta',
      },
      {
        id: 'review-2',
        title: 'Metabolismo energetico',
        subject: 'Chimica biologica',
        dueAt: 'Domani',
        priority: 'media',
      },
      {
        id: 'review-3',
        title: 'Colorazioni istologiche',
        subject: 'Citologia e istologia',
        dueAt: 'Venerdì',
        priority: 'bassa',
      },
    ],
    suggestions: [
      {
        id: 'suggestion-review-first',
        title: 'Chiudi prima le card in scadenza',
        body: 'Sono poche e hanno rendimento alto: completarle rende più solido il ripasso prima di aprire nuovi PDF.',
      },
      {
        id: 'suggestion-compare',
        title: 'Confronta due documenti della stessa materia',
        body: 'Per Genetica hai materiali con taglio diverso: usa quello più completo per teoria e quello più breve per ripasso.',
      },
      {
        id: 'suggestion-upload',
        title: 'Carica appunti con docente e corso corretti',
        body: 'I documenti ben classificati vengono trovati prima e tendono a generare più crediti.',
      },
    ],
  }
}
