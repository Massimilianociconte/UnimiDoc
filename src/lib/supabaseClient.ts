import { createClient, type Session, type User } from '@supabase/supabase-js'
import type { DocumentItem, DocumentStatus } from '../data'
import type { DocumentInsights } from './pdfProcessing'

export type AppAuthUser = {
  id: string
  email: string
  name: string
  avatarUrl?: string
  isDemo: boolean
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

function profileNameFromUser(user: User) {
  const metadata = user.user_metadata ?? {}
  const name =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : user.email?.split('@')[0]

  return name || 'Studente UnimiDoc'
}

function avatarFromUser(user: User) {
  const metadata = user.user_metadata ?? {}
  return typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined
}

export function authUserFromSession(session: Session | null): AppAuthUser | null {
  if (!session?.user?.email) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: profileNameFromUser(session.user),
    avatarUrl: avatarFromUser(session.user),
    isDemo: false,
  }
}

export async function getSupabaseSessionUser() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return authUserFromSession(data.session)
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function getUserCreditBalance(): Promise<number | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user?.id
  if (!uid) return null
  const { data: account } = await supabase
    .from('user_credit_accounts')
    .select('balance')
    .eq('owner_id', uid)
    .maybeSingle()
  return (account as { balance: number } | null)?.balance ?? null
}

export type SellerProfilePreferences = {
  publicDisplayName: string
  enabled: boolean
}

export async function loadSellerProfilePreferences(userId: string): Promise<SellerProfilePreferences> {
  if (!supabase) return { publicDisplayName: '', enabled: false }
  const { data, error } = await supabase
    .from('profiles')
    .select('public_display_name, seller_profile_enabled')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    publicDisplayName: String(data?.public_display_name ?? ''),
    enabled: data?.seller_profile_enabled === true,
  }
}

export async function saveSellerProfilePreferences(
  userId: string,
  preferences: SellerProfilePreferences,
): Promise<SellerProfilePreferences> {
  if (!supabase) throw new Error('Profilo pubblico non configurato.')
  const publicDisplayName = preferences.publicDisplayName.trim()
  if (preferences.enabled && (publicDisplayName.length < 2 || publicDisplayName.length > 80)) {
    throw new Error('Il nome pubblico deve contenere da 2 a 80 caratteri.')
  }
  const { data, error } = await supabase
    .from('profiles')
    .update({
      public_display_name: publicDisplayName || null,
      seller_profile_enabled: preferences.enabled,
    })
    .eq('id', userId)
    .select('public_display_name, seller_profile_enabled')
    .single()
  if (error) throw error
  return {
    publicDisplayName: String(data.public_display_name ?? ''),
    enabled: data.seller_profile_enabled === true,
  }
}

export type DocumentPurchase = {
  id: string
  document_id: string
  buyer_id: string
  credits_spent: number
  created_at: string
}

type CatalogRow = {
  id: string
  owner_id?: string
  seller_id?: string | null
  title: string
  course_name: string
  professor: string | null
  academic_year: string | null
  page_count: number | null
  language: string | null
  preview_policy: string
  description: string | null
  exam_type: string | null
  semester: string | null
  degree_course: string | null
  degree_slug?: string | null
  university: string | null
  tags: string[] | null
  compatible_exams: string[] | null
  insights: DocumentInsights | null
  price_credits: number | null
  flashcard_quality_percent?: number | null
  flashcard_reviewer_count?: number | null
  created_at: string
  updated_at: string
  visibility?: 'private' | 'submitted' | 'published' | 'rejected'
  original_size_bytes?: number | null
}

const CATALOG_COLUMNS = 'id, seller_id, title, course_name, professor, academic_year, page_count, language, preview_policy, description, exam_type, semester, degree_course, university, tags, compatible_exams, insights, price_credits, flashcard_quality_percent, flashcard_reviewer_count, created_at, updated_at, degree_slug'

function documentStatus(visibility: CatalogRow['visibility']): DocumentStatus {
  if (visibility === 'rejected') return 'rejected'
  if (visibility === 'private' || visibility === 'submitted') return 'pendingreview'
  return 'approved'
}

function mapCatalogDocument(row: CatalogRow, uploader: string, ownerView = false, sellerPublic = true): DocumentItem {
  const flags = row.insights?.contentFlags
  const previewKind: DocumentItem['previewKind'] = flags?.hasExercises
    ? 'exercise'
    : flags?.hasDiagrams
      ? 'diagram'
      : 'notes'
  const createdAt = new Date(row.created_at)
  return {
    id: row.id,
    title: row.title,
    subject: row.course_name,
    professor: row.professor ?? 'Docente non indicato',
    academicYear: row.academic_year ?? 'Non specificato',
    type: 'Appunti delle lezioni',
    examType: row.exam_type ?? 'Non specificato',
    pages: row.page_count ?? 0,
    sizeMb: row.original_size_bytes ? Math.round((row.original_size_bytes / 1024 / 1024) * 10) / 10 : 0,
    quality: row.flashcard_quality_percent ? Math.round(row.flashcard_quality_percent) / 10 : 0,
    flashcardQualityPercent: row.flashcard_quality_percent ?? undefined,
    flashcardQualityVotes: row.flashcard_reviewer_count ?? undefined,
    credits: row.price_credits ?? 0,
    downloads: 0,
    description: row.description ?? 'Materiale universitario in catalogo.',
    status: ownerView ? documentStatus(row.visibility) : 'approved',
    verified: ownerView ? row.visibility === 'published' : true,
    premium: row.preview_policy === 'premium_full',
    uploader,
    sellerId: row.seller_id ?? undefined,
    sellerPublic,
    uploaderTrust: 0,
    fileHash: `catalog-${row.id}`,
    malwareScan: ownerView && row.visibility !== 'published' ? 'in corso' : 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString('it-IT'),
    language: row.language === 'en' ? 'Inglese' : 'Italiano',
    previewKind,
    insights: row.insights ?? undefined,
    degreeCourse: row.degree_course ?? undefined,
    degreeSlug: row.degree_slug ?? undefined,
    university: row.university ?? undefined,
    semester: row.semester ?? undefined,
    tags: row.tags ?? [],
    compatibleExams: row.compatible_exams ?? [],
  }
}

type RankingRow = {
  document_id: string
  overall_score: number
  recent_score: number
  didactic_score: number
  review_avg: number | null
  review_count: number
}

export async function loadPublicDocumentCatalog(): Promise<DocumentItem[]> {
  if (!supabase) return []
  const [catalog, sellers, rankings] = await Promise.all([
    supabase.from('public_document_catalog').select(CATALOG_COLUMNS).order('created_at', { ascending: false }),
    supabase.from('public_seller_profiles').select('id, public_display_name'),
    // Punteggi multi-segnale calcolati dal DB (recensioni bayesiane, qualità
    // flashcard, completezza, soddisfazione, freschezza): autoritativi per
    // l'ordinamento e le classifiche lato client.
    supabase
      .from('public_document_rankings')
      .select('document_id, overall_score, recent_score, didactic_score, review_avg, review_count'),
  ])
  if (catalog.error) throw catalog.error
  const sellerNames = new Map(
    ((sellers.data ?? []) as Array<{ id: string; public_display_name: string }>).map((seller) => [seller.id, seller.public_display_name]),
  )
  const rankingById = new Map(
    ((rankings.data ?? []) as RankingRow[]).map((row) => [row.document_id, row]),
  )
  return ((catalog.data ?? []) as unknown as CatalogRow[]).map((row) => {
    const publicName = row.seller_id ? sellerNames.get(row.seller_id) : undefined
    const item = mapCatalogDocument(row, publicName ?? 'Profilo venditore privato', false, Boolean(publicName))
    const ranking = rankingById.get(row.id)
    if (ranking) {
      item.serverRanking = {
        overall: Number(ranking.overall_score),
        recent: Number(ranking.recent_score),
        didactic: Number(ranking.didactic_score),
        reviewAvg: ranking.review_avg == null ? null : Number(ranking.review_avg),
        reviewCount: ranking.review_count,
      }
    }
    return item
  })
}

export type CatalogSearchFilters = {
  query?: string
  course?: string
  professor?: string
  university?: string
  degreeSlug?: string
  academicYear?: string
  seller?: string
  examType?: string
  sort?: 'relevance' | 'recent' | 'price_asc' | 'price_desc'
  limit?: number
  offset?: number
}

export type CatalogSearchResult = { items: DocumentItem[]; totalCount: number }

/**
 * Ricerca server-side del catalogo (Postgres full-text, config italiana) con
 * filtri strutturati e paginazione stabile. Sostituisce progressivamente il
 * filtro client di AppHome quando il catalogo cresce; la ricerca semantica
 * resta su pgvector (RAG).
 */
export async function searchPublicCatalog(filters: CatalogSearchFilters): Promise<CatalogSearchResult> {
  if (!supabase) return { items: [], totalCount: 0 }
  const { data, error } = await supabase.rpc('search_documents', {
    p_query: filters.query ?? null,
    p_course: filters.course ?? null,
    p_professor: filters.professor ?? null,
    p_university: filters.university ?? null,
    p_degree_slug: filters.degreeSlug ?? null,
    p_academic_year: filters.academicYear ?? null,
    p_seller: filters.seller ?? null,
    p_exam_type: filters.examType ?? null,
    p_sort: filters.sort ?? 'relevance',
    p_limit: filters.limit ?? 24,
    p_offset: filters.offset ?? 0,
  })
  if (error) throw error
  const rows = (data ?? []) as Array<CatalogRow & { total_count: number }>
  const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter(Boolean))] as string[]
  const sellerNames = new Map<string, string>()
  if (sellerIds.length > 0) {
    const { data: sellers } = await supabase
      .from('public_seller_profiles')
      .select('id, public_display_name')
      .in('id', sellerIds)
    for (const seller of (sellers ?? []) as Array<{ id: string; public_display_name: string }>) {
      sellerNames.set(seller.id, seller.public_display_name)
    }
  }
  return {
    items: rows.map((row) => {
      const publicName = row.seller_id ? sellerNames.get(row.seller_id) : undefined
      return mapCatalogDocument(row, publicName ?? 'Profilo venditore privato', false, Boolean(publicName))
    }),
    totalCount: Number(rows[0]?.total_count ?? 0),
  }
}

export async function loadOwnedDocuments(userId: string): Promise<DocumentItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('documents')
    .select('id, owner_id, title, course_name, professor, academic_year, page_count, language, preview_policy, description, exam_type, semester, degree_course, degree_slug, university, tags, compatible_exams, insights, price_credits, created_at, updated_at, visibility, original_size_bytes')
    .eq('owner_id', userId)
    .neq('visibility', 'withdrawn')
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as CatalogRow[]).map((row) => mapCatalogDocument(row, 'Tu', true))
}

/** Execute the authoritative atomic purchase RPC. Never deduct credits in UI. */
export async function purchaseDocument(documentId: string): Promise<DocumentPurchase> {
  if (!supabase) throw new Error('Acquisti non configurati.')
  const { data, error } = await supabase.rpc('purchase_document', { p_document_id: documentId })
  if (error) {
    const detail = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
    if (detail.includes('insufficient_credits')) throw new Error('Crediti insufficienti per questo materiale.')
    if (detail.includes('own_document')) throw new Error('Il materiale è già tuo: aprilo dalla libreria.')
    if (detail.includes('not_purchasable')) throw new Error('Questo materiale non è ancora acquistabile.')
    if (detail.includes('document_not_found')) throw new Error('Materiale non trovato o non più disponibile.')
    throw new Error('Acquisto non completato. Il saldo non è stato modificato.')
  }
  if (!data) throw new Error('Il server non ha confermato l’acquisto.')
  return data as DocumentPurchase
}

export type DeleteDocumentResult = { mode: 'soft' | 'hard'; document_id: string; active_buyers?: number }

/**
 * Delete a document the caller owns. The server decides the mode: a document
 * with active purchases from other users is soft-deleted (withdrawn from the
 * catalogue, buyers keep access), otherwise it is hard-deleted and its Storage
 * objects are queued for garbage collection. Never delete rows from the UI.
 */
export async function deleteDocument(documentId: string): Promise<DeleteDocumentResult> {
  if (!supabase) throw new Error('Eliminazione non configurata.')
  const { data, error } = await supabase.rpc('delete_document', { p_document_id: documentId })
  if (error) {
    const detail = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
    if (detail.includes('not_document_owner')) throw new Error('Puoi eliminare solo i tuoi documenti.')
    if (detail.includes('document_not_found')) throw new Error('Documento non trovato o già eliminato.')
    if (detail.includes('auth_required')) throw new Error('Accedi per eliminare un documento.')
    throw new Error('Eliminazione non completata. Riprova.')
  }
  if (!data) throw new Error('Il server non ha confermato l’eliminazione.')
  return data as DeleteDocumentResult
}

export function subscribeSupabaseAuth(onUser: (user: AppAuthUser | null) => void) {
  if (!supabase) return () => undefined

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onUser(authUserFromSession(session))
  })

  return () => data.subscription.unsubscribe()
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return authUserFromSession(data.session)
}

export type SignUpResult =
  | { status: 'active'; user: AppAuthUser }
  | { status: 'confirm'; email: string }

export async function signUpWithEmail(email: string, password: string, fullName: string): Promise<SignUpResult> {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  })
  if (error) throw error

  // A session is only returned when email confirmation is disabled. Otherwise the
  // account exists but is unverified — the caller must ask the user to confirm.
  if (data.session) {
    const user = authUserFromSession(data.session)
    if (user) return { status: 'active', user }
  }

  return { status: 'confirm', email }
}

export async function requestPasswordReset(email: string) {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const redirectTo = `${window.location.origin}/login`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw error
}

export async function signInWithGoogle(redirectPath = '/dashboard') {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const redirectTo = `${window.location.origin}${redirectPath}`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) throw error
}

export async function signOutSupabase() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
