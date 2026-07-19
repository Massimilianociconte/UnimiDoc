import { findCourse } from './courseCatalog'
import type { DocumentItem } from './data'
import { supabase, type AppAuthUser } from './lib/supabaseClient'
import { creditsToEur } from './lib/creditPricing'
import type { LedgerEntry, PurchasedItem, WalletState } from './lib/creditsWallet'

export type DashboardNotification = {
  id: string
  title: string
  body: string
  time: string
  tone: 'info' | 'success' | 'warning'
  readAt?: string | null
  unread?: boolean
}

export type CreditHistoryEntry = {
  id: string
  type: 'earned' | 'spent' | 'reserved' | 'purchased' | 'welcome' | 'refunded' | 'adjusted'
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

export type DashboardProcessingDocument = {
  id: string
  title: string
  subject: string
  visibility: string
  analysisStatus: string
  analysisProgress: number
  analysisStage: string | null
  analysisErrorCode: string | null
  compressionStatus: string
  ragStatus: string
  ragChunkCount: number
  flashcardStatus: string
  updatedAt: string
}

export type DashboardSellerSummary = {
  enabled: boolean
  publishedDocuments: number
  activeSales: number
  creditsEarned: number
  cashBackingMinor: number
}

// Real, persisted slices of the dashboard that the backend already populates for
// every authenticated user (credits, ledger, notifications). Missing rows are
// represented as empty states, never replaced with another student's demo data.
export type DashboardLiveOverlay = {
  credits: number
  walletState: WalletState
  creditHistory: CreditHistoryEntry[]
  notifications: DashboardNotification[]
  purchasedDocumentIds: string[]
  savedDocumentIds: string[]
  wishlistDocumentIds: string[]
  laterDocumentIds: string[]
  libraryDocuments: DocumentItem[]
  subjectProgress: SubjectProgress[]
  documentProgress: DocumentProgress[]
  sessions: StudySessionSummary[]
  reviews: ReviewTask[]
  processingDocuments: DashboardProcessingDocument[]
  seller: DashboardSellerSummary
  syncedAt: string
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

type CreditTxRow = {
  id: string
  direction: string
  amount: number
  reason: string
  created_at: string
  balance_after: number | null
  free_delta: number | null
  promotional_delta: number | null
  purchased_delta: number | null
  earned_delta: number | null
}
type NotificationRow = {
  id: string
  title: string
  body: string
  notification_type: string
  created_at: string
  read_at: string | null
}
type CreditAccountRow = {
  balance: number
  free_credits: number
  promotional_credits: number
  purchased_credits: number
  earned_credits: number
  earned_convertible: number
}
type PurchaseRow = {
  id: string
  document_id: string
  credits_spent: number
  created_at: string
  status?: string
  title: string
  course_name: string
  professor: string | null
  academic_year: string | null
  page_count: number | null
  degree_course: string | null
  degree_slug: string | null
  university: string | null
  author_id: string | null
}

type LibraryRow = Omit<PurchaseRow, 'id' | 'credits_spent' | 'created_at'> & {
  id: string
  document_id: string
  relation: string
  created_at: string
  updated_at: string
}

type DashboardSnapshot = {
  account: CreditAccountRow
  transactions: CreditTxRow[]
  notifications: NotificationRow[]
  purchases: PurchaseRow[]
  library: LibraryRow[]
  study_sessions: Array<{
    id: string
    document_id: string | null
    subject: string | null
    session_type: string
    duration_seconds: number
    cards_reviewed: number
    quiz_questions: number
    correct_answers: number
    started_at: string
    finished_at: string | null
    document_title: string | null
  }>
  document_progress: Array<{
    id: string
    document_id: string
    progress_percent: number | string
    last_page: number | null
    flashcards_total: number
    flashcards_mastered: number
    quiz_accuracy: number | string | null
    last_studied_at: string | null
    updated_at: string
    title: string
    course_name: string
  }>
  subject_progress: Array<{
    id: string
    subject: string
    progress_percent: number | string
    documents_count: number
    due_reviews: number
    average_accuracy: number | string | null
    updated_at: string
  }>
  review_tasks: Array<{
    id: string
    subject: string | null
    title: string
    due_at: string
    priority: 'low' | 'medium' | 'high'
  }>
  owned_documents: Array<{
    id: string
    title: string
    course_name: string
    visibility: string
    compression_status: string
    flashcard_status: string
    rag_status: string
    rag_chunk_count: number
    analysis_status: string
    analysis_progress: number
    analysis_stage: string | null
    analysis_error_code: string | null
    updated_at: string
  }>
  seller: {
    enabled: boolean
    published_documents: number
    active_sales: number
    credits_earned: number
    cash_backing_minor: number
  }
}

function mapDashboardDocument(row: PurchaseRow | LibraryRow): DocumentItem {
  return {
    id: row.document_id,
    title: row.title || 'Documento universitario',
    subject: row.course_name || 'Materia non indicata',
    professor: row.professor || 'Docente non indicato',
    academicYear: row.academic_year || 'Anno non indicato',
    type: 'Materiale universitario',
    examType: 'Non indicato',
    pages: row.page_count ?? 0,
    sizeMb: 0,
    quality: 0,
    credits: 0,
    downloads: 0,
    description: 'Materiale presente nella tua libreria personale.',
    status: 'approved',
    verified: true,
    premium: true,
    uploader: 'Autore UnimiDoc',
    sellerId: row.author_id ?? undefined,
    sellerPublic: true,
    uploaderTrust: 0,
    fileHash: '',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: row.created_at,
    language: 'Italiano',
    previewKind: 'notes',
    degreeCourse: row.degree_course ?? undefined,
    degreeSlug: row.degree_slug ?? undefined,
    university: row.university ?? 'Università degli Studi di Milano',
  }
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`
}

function signedTransactionDelta(row: CreditTxRow): number {
  const explicit = (row.free_delta ?? 0) + (row.promotional_delta ?? 0) + (row.purchased_delta ?? 0) + (row.earned_delta ?? 0)
  if (explicit !== 0) return explicit
  return row.direction === 'spent' || row.direction === 'reserved' ? -row.amount : row.amount
}

/** Loads the owner-scoped dashboard read model in one consistent request. */
export async function loadDashboardLiveOverlay(user: AppAuthUser): Promise<DashboardLiveOverlay | null> {
  if (!supabase || user.isDemo) return null

  const { data, error } = await supabase.rpc('get_user_dashboard_snapshot')
  if (error) throw new Error(error.message || 'dashboard_snapshot_failed')

  const snapshot = data as unknown as DashboardSnapshot | null
  if (!snapshot?.account) throw new Error('dashboard_snapshot_incomplete')

  const accountRow = snapshot.account
  const credits = accountRow.balance ?? 0
  const txRows = snapshot.transactions ?? []
  const libraryRows = snapshot.library ?? []
  const purchaseRows = snapshot.purchases ?? []

  const creditHistory: CreditHistoryEntry[] = txRows.map((row) => {
    const direction = row.direction
    const type: CreditHistoryEntry['type'] =
      direction === 'spent'
        ? 'spent'
        : direction === 'reserved'
          ? 'reserved'
          : direction === 'purchased'
            ? 'purchased'
            : direction === 'welcome'
              ? 'welcome'
              : direction === 'refunded' || direction === 'charged_back'
                ? 'refunded'
                : direction === 'adjusted' || direction === 'released'
                  ? 'adjusted'
                  : 'earned'
    return {
      id: row.id,
      type,
      amount: row.amount,
      reason: row.reason,
      date: relativeTimeLabel(row.created_at),
    }
  })

  let inferredBalance = credits
  const ledger: LedgerEntry[] = txRows.map((row) => {
    const delta = signedTransactionDelta(row)
    const balanceAfter = row.balance_after ?? inferredBalance
    const balanceBefore = balanceAfter - delta
    inferredBalance = balanceBefore
    return {
      id: row.id,
      ts: new Date(row.created_at).getTime(),
      direction:
        row.direction === 'spent'
          ? 'spent'
          : row.direction === 'purchased'
            ? 'purchased'
            : row.direction === 'welcome'
              ? 'welcome'
              : 'earned',
      amount: row.amount,
      balanceBefore,
      balanceAfter,
      reason: row.reason,
      eurValue: row.direction === 'purchased' || row.direction === 'spent' ? creditsToEur(row.amount) : 0,
    }
  })

  const notifications: DashboardNotification[] = (snapshot.notifications ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    time: relativeTimeLabel(row.created_at),
    readAt: row.read_at,
    unread: !row.read_at,
    tone:
      row.notification_type === 'warning'
        ? 'warning'
        : row.notification_type === 'success' || row.notification_type === 'purchase' || row.notification_type === 'credits'
          ? 'success'
          : 'info',
  }))

  const purchasedDocumentIds = [...new Set([
    ...purchaseRows.map((row) => row.document_id),
    ...libraryRows.filter((row) => row.relation === 'purchased').map((row) => row.document_id),
  ])]
  const savedDocumentIds = libraryRows
    .filter((row) => row.relation === 'saved')
    .map((row) => row.document_id)
  const wishlistDocumentIds = libraryRows
    .filter((row) => row.relation === 'wishlist')
    .map((row) => row.document_id)
  const laterDocumentIds = libraryRows
    .filter((row) => row.relation === 'study_later')
    .map((row) => row.document_id)
  const libraryDocuments = uniqueById([...purchaseRows.map(mapDashboardDocument), ...libraryRows.map(mapDashboardDocument)])

  const purchasedItems: PurchasedItem[] = purchaseRows.map((row) => ({
    transactionId: row.id,
    documentId: row.document_id,
    title: row.title ?? 'Documento acquistato',
    subject: row.course_name ?? 'Materia non disponibile',
    type: 'Materiale universitario',
    university: row.university ?? 'Università degli Studi di Milano',
    course: row.degree_course ?? 'Corso di laurea non indicato',
    professor: row.professor ?? 'Docente non indicato',
    academicYear: row.academic_year ?? 'Anno non indicato',
    uploader: 'Autore UnimiDoc',
    purchasedAt: new Date(row.created_at).getTime(),
    creditsSpent: row.credits_spent,
    balanceBefore: 0,
    balanceAfter: 0,
    eurValue: creditsToEur(row.credits_spent),
    pages: row.page_count ?? 0,
  }))

  const walletState: WalletState = {
    wallet: {
      free: accountRow.free_credits ?? 0,
      promotional: accountRow.promotional_credits ?? 0,
      purchased: accountRow.purchased_credits ?? 0,
      earned: accountRow.earned_credits ?? 0,
      earnedConvertible: accountRow.earned_convertible ?? 0,
    },
    ledger,
    purchases: purchasedItems,
    initialized: true,
  }

  return {
    credits,
    walletState,
    creditHistory,
    notifications,
    purchasedDocumentIds,
    savedDocumentIds,
    wishlistDocumentIds,
    laterDocumentIds,
    libraryDocuments,
    subjectProgress: (snapshot.subject_progress ?? []).map((row) => ({
      subject: row.subject,
      progress: Math.round(Number(row.progress_percent) || 0),
      documents: row.documents_count,
      accuracy: Math.round(Number(row.average_accuracy) || 0),
      due: row.due_reviews,
    })),
    documentProgress: (snapshot.document_progress ?? []).map((row) => ({
      id: row.document_id,
      title: row.title,
      subject: row.course_name,
      progress: Math.round(Number(row.progress_percent) || 0),
      flashcards: row.flashcards_total,
      quizAccuracy: Math.round(Number(row.quiz_accuracy) || 0),
      lastSession: row.last_studied_at ? relativeTimeLabel(row.last_studied_at) : 'Mai',
    })),
    sessions: (snapshot.study_sessions ?? []).map((row) => ({
      id: row.id,
      title: row.document_title || `${row.session_type === 'flashcards' ? 'Ripasso flashcard' : 'Sessione di studio'}${row.subject ? ` · ${row.subject}` : ''}`,
      detail: row.cards_reviewed
        ? `${row.cards_reviewed} card · ${row.correct_answers} corrette`
        : row.quiz_questions
          ? `${row.quiz_questions} domande · ${row.correct_answers} corrette`
          : row.subject || 'Attività registrata',
      duration: formatDuration(row.duration_seconds),
      date: relativeTimeLabel(row.finished_at ?? row.started_at),
    })),
    reviews: (snapshot.review_tasks ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject || 'Ripasso',
      dueAt: relativeTimeLabel(row.due_at),
      priority: row.priority === 'high' ? 'alta' : row.priority === 'low' ? 'bassa' : 'media',
    })),
    processingDocuments: (snapshot.owned_documents ?? [])
      .filter((row) => row.visibility !== 'withdrawn')
      .map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.course_name,
      visibility: row.visibility,
      analysisStatus: row.analysis_status,
      analysisProgress: row.analysis_progress,
      analysisStage: row.analysis_stage,
      analysisErrorCode: row.analysis_error_code,
      compressionStatus: row.compression_status,
      ragStatus: row.rag_status,
      ragChunkCount: row.rag_chunk_count,
      flashcardStatus: row.flashcard_status,
      updatedAt: row.updated_at,
    })),
    seller: {
      enabled: snapshot.seller?.enabled ?? false,
      publishedDocuments: snapshot.seller?.published_documents ?? 0,
      activeSales: snapshot.seller?.active_sales ?? 0,
      creditsEarned: snapshot.seller?.credits_earned ?? 0,
      cashBackingMinor: snapshot.seller?.cash_backing_minor ?? 0,
    },
    syncedAt: new Date().toISOString(),
  }
}

export async function markDashboardNotificationRead(notificationId: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('mark_notification_read', { p_notification: notificationId })
  if (error) throw new Error(error.message || 'notification_update_failed')
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
  if (!user.isDemo) {
    return {
      notifications: [],
      creditHistory: [],
      shelves: [
        {
          id: 'uploads',
          label: 'Documenti caricati',
          description: 'Materiali inviati in revisione o già pubblicati.',
          emptyText: 'Nessun caricamento ancora. Inizia da un PDF di cui possiedi i diritti.',
          documents: uploads,
        },
        {
          id: 'purchased',
          label: 'Documenti acquistati',
          description: 'File sbloccati con un acquisto registrato.',
          emptyText: 'Qui appariranno gli appunti acquistati dal catalogo sincronizzato.',
          documents: [],
        },
        {
          id: 'saved',
          label: 'Dispensa personale',
          description: 'Documenti salvati per lo studio.',
          emptyText: 'Salva un documento per costruire la tua dispensa.',
          documents: [],
        },
        {
          id: 'wishlist',
          label: 'Wishlist',
          description: 'Materiali salvati prima dell’acquisto.',
          emptyText: 'Aggiungi un materiale alla wishlist per ritrovarlo qui su ogni dispositivo.',
          documents: [],
        },
        {
          id: 'later',
          label: 'Da studiare più avanti',
          description: 'Materiali aggiunti alla lista di studio.',
          emptyText: 'Nessun documento nella lista di studio.',
          documents: [],
        },
      ],
      decks: [],
      subjectProgress: [],
      documentProgress: [],
      sessions: [],
      reviews: [],
      suggestions: [
        {
          id: 'suggestion-start',
          title: 'Costruisci il primo percorso di studio',
          body: credits > 0
            ? 'Sblocca o carica un documento: progressi, flashcard e ripassi compariranno qui dopo le prime attività.'
            : 'Carica un documento o aggiungi crediti: la dashboard mostrerà soltanto attività realmente registrate.',
        },
      ],
    }
  }

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
      {
        id: 'wishlist',
        label: 'Wishlist',
        description: 'Materiali che vuoi valutare o acquistare più avanti.',
        emptyText: 'La tua wishlist è vuota.',
        documents: wishlist,
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
