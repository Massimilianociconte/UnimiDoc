// POST /functions/v1/generate-flashcards
// Premium flashcard generation. Two modes:
//  1) { chunkText, ... }        — from a text chunk the client already has
//     (highlight, section, local analysis).
//  2) { fromDocument: true, documentId, maxCards?, focusQuery?, language? }
//     — RAG mode: the server selects the semantically most relevant chunks of
//     an INDEXED document (embedding centroid, or vector search when a
//     focusQuery is given), sends them to DeepSeek and persists the cards in
//     public.flashcards with chunk/page provenance.
// Access requires an active Premium plan or the flashcard-specific entitlement.

import { config } from '../_shared/env.ts'
import { preflight, jsonResponse, errorResponse, errors, AppError } from '../_shared/http.ts'
import {
  adminClient,
  requireUser,
  requireAiFlashcards,
  enforceRateLimit,
  recordUsage,
  cacheKey,
  getCached,
  putCached,
  sha256Hex,
} from '../_shared/supabase.ts'
import { deepseekChat, deepseekCost, extractJson } from '../_shared/ai.ts'
import { buildFlashcardsPrompt } from '../_shared/prompts.ts'
import { getEmbeddingProvider } from '../_shared/embeddings.ts'
import { retrieveRagMatches } from '../_shared/rag.ts'

type GeneratedCard = {
  type?: string
  question?: string
  answer?: string
  cloze_text?: string | null
  difficulty?: string
  source_quote?: string
  page_start?: number | null
  page_end?: number | null
  tags?: string[]
}

const ALLOWED_TYPES = new Set(['qa', 'cloze', 'definition', 'comparison', 'reasoning', 'application'])
const ALLOWED_DIFFICULTY = new Set(['easy', 'medium', 'hard'])

function sanitizeCards(cards: GeneratedCard[], max: number): GeneratedCard[] {
  const seen = new Set<string>()
  const out: GeneratedCard[] = []
  for (const card of cards) {
    const question = String(card.question ?? '').trim()
    const answer = String(card.answer ?? '').trim()
    if (question.length < 6 || answer.length < 2) continue
    if (question.length > 260 || answer.length > 640) continue
    const key = question.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      type: ALLOWED_TYPES.has(String(card.type)) ? card.type : 'qa',
      question,
      answer,
      cloze_text: card.cloze_text ?? null,
      difficulty: ALLOWED_DIFFICULTY.has(String(card.difficulty)) ? card.difficulty : 'medium',
      source_quote: String(card.source_quote ?? '').slice(0, 400),
      page_start: card.page_start ?? null,
      page_end: card.page_end ?? null,
      tags: Array.isArray(card.tags) ? card.tags.slice(0, 6).map(String) : [],
    })
    if (out.length >= max) break
  }
  return out
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    await requireAiFlashcards(admin, userId)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')

    // Persist cards explicitly reviewed by the document owner without another
    // model call. This path has no AI quota cost and never accepts cards for a
    // document owned by somebody else.
    if (body.saveReviewed === true) {
      return await saveReviewedFromUpload(req, admin, userId, body)
    }

    // --- Modalità RAG: chunk scelti dal server via embedding -----------------
    if (body.fromDocument === true) {
      await enforceRateLimit(admin, userId, 'flashcards', config.limits.aiHelpsPerMonth)
      return await generateFromDocument(req, admin, userId, body)
    }

    // Validate the payload BEFORE spending rate-limit quota: a malformed
    // request must never consume the user's monthly budget.
    const chunkText = String(body.chunkText ?? '').trim()
    if (chunkText.length < 40) throw errors.badRequest('chunkText troppo corto per generare flashcard.')
    if (chunkText.length > 50_000) throw errors.badRequest('chunkText troppo lungo per una singola generazione.')

    await enforceRateLimit(admin, userId, 'flashcards', config.limits.aiHelpsPerMonth)

    const language = String(body.language ?? 'it')
    const maxCards = Math.min(Number(body.maxCards ?? 12) || 12, config.limits.maxCardsPerGeneration)
    const pageStart = body.pageStart ?? null
    const pageEnd = body.pageEnd ?? null
    const visibility = String(body.visibility ?? 'private').toLowerCase()
    const cacheScope = visibility === 'public' ? 'public' : `user:${userId}`
    const documentScope = body.documentId ? String(body.documentId).slice(0, 128) : 'no-document'

    const key = await cacheKey([
      'deepseek',
      config.deepseek.model,
      config.promptVersions.flashcards,
      'flashcards',
      cacheScope,
      documentScope,
      language,
      maxCards,
      chunkText,
    ])
    const cached = (await getCached(admin, key)) as { flashcards: GeneratedCard[] } | null
    if (cached?.flashcards) {
      await recordUsage(admin, {
        user_id: userId,
        document_id: body.documentId ?? null,
        provider: 'deepseek',
        model_used: config.deepseek.model,
        feature: 'flashcards',
        prompt_version: config.promptVersions.flashcards,
        estimated_cost_usd: 0,
      })
      return jsonResponse({ flashcards: cached.flashcards, cached: true, premium: true }, 200, req)
    }

    const result = await deepseekChat({
      messages: buildFlashcardsPrompt({ chunkText, maxCards, language, pageStart, pageEnd }),
      temperature: 0.25,
      maxTokens: 2200,
      jsonMode: true,
      userId,
    })

    const parsed = extractJson<{ flashcards?: GeneratedCard[] }>(result.content)
    const flashcards = sanitizeCards(parsed?.flashcards ?? [], maxCards)

    const cost = deepseekCost({
      cacheMissTokens: result.usage.cacheMissTokens,
      cacheHitTokens: result.usage.cacheHitTokens,
      completionTokens: result.usage.completionTokens,
    })
    await recordUsage(admin, {
      user_id: userId,
      document_id: body.documentId ?? null,
      provider: 'deepseek',
      model_used: result.model,
      feature: 'flashcards',
      prompt_version: config.promptVersions.flashcards,
      input_tokens: result.usage.promptTokens,
      output_tokens: result.usage.completionTokens,
      cache_hit_tokens: result.usage.cacheHitTokens,
      cache_miss_tokens: result.usage.cacheMissTokens,
      estimated_cost_usd: cost,
    })
    await putCached(admin, key, { provider: 'deepseek', model_used: result.model, prompt_version: config.promptVersions.flashcards, feature: 'flashcards', language }, {
      flashcards,
    })

    return jsonResponse({ flashcards, cached: false, premium: true }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})

// ----------------------------------------------------------------------------
// RAG mode — the server selects the document's most relevant chunks via
// embeddings and generates cards from those topics.
// ----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RAG_MAX_BATCHES = 3
const RAG_BATCH_CHAR_BUDGET = 10_000
const RAG_MAX_PER_SECTION = 3

type TopicChunk = {
  chunk_id: string
  chunk_index: number
  page_start: number
  page_end: number
  section_path: string[]
  content: string
  similarity: number
}

// generate-flashcards types → public.flashcards.card_type check constraint.
const CARD_TYPE_DB: Record<string, string> = {
  qa: 'qa',
  cloze: 'cloze',
  definition: 'definition',
  comparison: 'comparison',
  reasoning: 'cause_effect',
  application: 'exam_question',
}

/** Greedy topic selection: similarity order, capped per top-level section so a
 * single chapter can't monopolize the deck, capped by total char budget. */
function pickDiverseChunks(chunks: TopicChunk[], charBudget: number): TopicChunk[] {
  const perSection = new Map<string, number>()
  const picked: TopicChunk[] = []
  let used = 0
  for (const chunk of chunks) {
    const section = chunk.section_path?.[0] ?? 'root'
    if ((perSection.get(section) ?? 0) >= RAG_MAX_PER_SECTION) continue
    if (used + chunk.content.length > charBudget) continue
    perSection.set(section, (perSection.get(section) ?? 0) + 1)
    picked.push(chunk)
    used += chunk.content.length
  }
  // Restore reading order inside the selection: the LLM gets coherent text.
  return picked.sort((a, b) => a.chunk_index - b.chunk_index)
}

function batchChunks(chunks: TopicChunk[]): TopicChunk[][] {
  const batches: TopicChunk[][] = []
  let current: TopicChunk[] = []
  let used = 0
  for (const chunk of chunks) {
    if (current.length > 0 && used + chunk.content.length > RAG_BATCH_CHAR_BUDGET) {
      batches.push(current)
      current = []
      used = 0
      if (batches.length >= RAG_MAX_BATCHES) break
    }
    current.push(chunk)
    used += chunk.content.length
  }
  if (current.length > 0 && batches.length < RAG_MAX_BATCHES) batches.push(current)
  return batches
}

/** Chunk provenance for a generated card: the batch chunk whose page range
 * contains the card's page_start, else the first chunk of the batch. */
function chunkForCard(card: GeneratedCard, batch: TopicChunk[]): TopicChunk | undefined {
  const quote = normalizeComparable(card.source_quote ?? '')
  if (quote.length >= 20) {
    const quoted = batch.find((chunk) => normalizeComparable(chunk.content).includes(quote))
    if (quoted) return quoted
  }
  if (card.page_start != null) {
    const hit = batch.find((c) => c.page_start <= card.page_start! && card.page_start! <= c.page_end)
    if (hit) return hit
  }
  return batch[0]
}

function normalizeComparable(value: string): string {
  return value.toLocaleLowerCase('it').replace(/\s+/g, ' ').trim()
}

function groundedQuote(card: GeneratedCard, chunk: TopicChunk | undefined): string | null {
  const quote = String(card.source_quote ?? '').trim().slice(0, 400)
  if (!quote || !chunk) return null
  return normalizeComparable(chunk.content).includes(normalizeComparable(quote)) ? quote : null
}

function sourcePages(card: GeneratedCard, chunk: TopicChunk | undefined): { start: number | null; end: number | null } {
  const requestedStart = Number(card.page_start)
  const requestedEnd = Number(card.page_end)
  if (!chunk) {
    const start = Number.isInteger(requestedStart) && requestedStart > 0 ? requestedStart : null
    const end = start != null && Number.isInteger(requestedEnd) && requestedEnd >= start ? requestedEnd : start
    return { start, end }
  }
  const start = Number.isInteger(requestedStart) && requestedStart >= chunk.page_start && requestedStart <= chunk.page_end
    ? requestedStart
    : chunk.page_start
  const end = Number.isInteger(requestedEnd) && requestedEnd >= start && requestedEnd <= chunk.page_end
    ? requestedEnd
    : Math.max(start, chunk.page_end)
  return { start, end }
}

// deno-lint-ignore no-explicit-any
async function persistDocumentCards(params: {
  admin: any
  userId: string
  documentId: string
  subject: string | null
  cards: GeneratedCard[]
  chunks: TopicChunk[]
  cacheKeyValue: string
  modelUsed: string
  cardChunks?: Map<GeneratedCard, TopicChunk>
  generationMethod?: 'premium_ai' | 'manual'
  status?: 'draft' | 'approved'
}): Promise<string[]> {
  const {
    admin,
    userId,
    documentId,
    subject,
    cards,
    chunks,
    cacheKeyValue,
    modelUsed,
    cardChunks,
    generationMethod = 'premium_ai',
    status = 'draft',
  } = params
  if (cards.length === 0) return []

  const rows = await Promise.all(cards.map(async (card, index) => {
    const chunk = cardChunks?.get(card) ?? chunkForCard(card, chunks)
    const pages = sourcePages(card, chunk)
    const sectionPath = chunk?.section_path ?? []
    const front = card.type === 'cloze' && card.cloze_text && card.cloze_text.trim().length >= 3
      ? card.cloze_text.trim()
      : String(card.question ?? '').trim()
    const back = String(card.answer ?? '').trim()
    const generationItemKey = await sha256Hex([
      cacheKeyValue,
      index,
      normalizeComparable(front),
      normalizeComparable(back),
    ].join('|'))

    return {
      document_id: documentId,
      chunk_id: chunk?.chunk_id ?? null,
      owner_id: userId,
      card_type: CARD_TYPE_DB[String(card.type)] ?? 'qa',
      front: front.slice(0, 1200),
      back: back.slice(0, 2400),
      cloze_text: card.cloze_text ? String(card.cloze_text).slice(0, 2400) : null,
      tags: card.tags ?? [],
      difficulty: card.difficulty ?? 'medium',
      source_page_start: pages.start,
      source_page_end: pages.end,
      source_quote: groundedQuote(card, chunk),
      source_outline_path: sectionPath,
      subject,
      chapter_title: sectionPath[0] ?? null,
      section_title: sectionPath[1] ?? null,
      topic: sectionPath.at(-1) ?? null,
      topic_confidence: chunk ? Math.max(0, Math.min(1, Number(chunk.similarity) || 0)) : null,
      generation_method: generationMethod,
      status,
      model_name: modelUsed,
      prompt_version: config.promptVersions.flashcards,
      cache_key: cacheKeyValue,
      generation_item_key: generationItemKey,
    }
  }))

  const { error: insertError } = await admin
    .from('flashcards')
    .upsert(rows, { onConflict: 'owner_id,generation_item_key', ignoreDuplicates: true })
  if (insertError) throw errors.upstream(`Salvataggio flashcard non riuscito: ${insertError.message}`)

  const keys = rows.map((row) => row.generation_item_key)
  const { data: saved, error: readError } = await admin
    .from('flashcards')
    .select('id, generation_item_key')
    .eq('owner_id', userId)
    .in('generation_item_key', keys)
  if (readError) throw errors.upstream(`Verifica flashcard salvate non riuscita: ${readError.message}`)
  if ((saved ?? []).length !== rows.length) {
    throw errors.upstream('Il deck non è stato salvato completamente. Riprova senza rigenerare il documento.')
  }
  return (saved ?? []).map((row: { id: string }) => row.id)
}

// deno-lint-ignore no-explicit-any
async function saveReviewedFromUpload(
  req: Request,
  admin: any,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const documentId = String(body.documentId ?? '')
  if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')
  if (!Array.isArray(body.cards) || body.cards.length === 0) throw errors.badRequest('Nessuna flashcard revisionata da salvare.')
  if (body.cards.length > 80) throw errors.badRequest('Troppe flashcard in un singolo salvataggio (max 80).')

  const { data: doc, error: docError } = await admin
    .from('documents')
    .select('id, owner_id, course_name, visibility')
    .eq('id', documentId)
    .maybeSingle()
  if (docError || !doc) throw new AppError(404, 'not_found', 'Documento non trovato.')
  if (doc.owner_id !== userId) throw new AppError(403, 'owner_required', 'Puoi salvare solo le flashcard dei tuoi documenti.')
  if (!['private', 'submitted'].includes(doc.visibility)) {
    throw errors.badRequest('Le flashcard di upload si salvano prima della pubblicazione del documento.')
  }

  const cards = sanitizeCards(body.cards as GeneratedCard[], 80)
  if (cards.length === 0) throw errors.badRequest('Le flashcard revisionate non contengono domande e risposte valide.')
  const { data: chunkRows, error: chunkError } = await admin
    .from('pdf_chunks')
    .select('id, chunk_index, page_start, page_end, section_path, content')
    .eq('document_id', documentId)
    .neq('processing_state', 'failed')
    .order('chunk_index', { ascending: true })
  if (chunkError) throw errors.badRequest(`Provenienza chunk non disponibile: ${chunkError.message}`)
  const chunks = (chunkRows ?? []).map((chunk: {
    id: string
    chunk_index: number
    page_start: number
    page_end: number
    section_path: string[] | null
    content: string
  }) => ({
    chunk_id: chunk.id,
    chunk_index: chunk.chunk_index,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    section_path: chunk.section_path ?? [],
    content: chunk.content,
    similarity: 1,
  })) as TopicChunk[]

  const reviewedKey = await cacheKey([
    'human-reviewed-upload',
    documentId,
    JSON.stringify(cards.map((card) => [card.question, card.answer, card.page_start, card.page_end])),
  ])

  const { error: reservationError } = await admin.rpc('reserve_reviewed_flashcard_write', {
    p_owner: userId,
    p_document: documentId,
    p_request_key: reviewedKey,
    p_card_count: cards.length,
  })
  if (reservationError) {
    if (reservationError.message.includes('hourly_quota')) {
      throw errors.rateLimited('Troppe flashcard revisionate nell’ultima ora. Riprova più tardi.')
    }
    if (reservationError.message.includes('document_quota')) {
      throw errors.badRequest('Il documento può contenere al massimo 300 flashcard revisionate.')
    }
    throw errors.badRequest(`Impossibile riservare il salvataggio del deck: ${reservationError.message}`)
  }
  const savedIds = await persistDocumentCards({
    admin,
    userId,
    documentId,
    subject: doc.course_name ?? null,
    cards,
    chunks,
    cacheKeyValue: reviewedKey,
    modelUsed: 'human-reviewed',
    generationMethod: 'manual',
    status: 'approved',
  })
  const { error: commitError } = await admin.rpc('commit_reviewed_flashcard_write', {
    p_owner: userId,
    p_document: documentId,
    p_request_key: reviewedKey,
  })
  if (commitError) {
    throw errors.upstream('Flashcard salvate, ma conferma quota non completata. Riprova lo stesso deck senza modificarlo.')
  }
  const { error: statusError } = await admin
    .from('documents')
    .update({ flashcard_status: 'ready' })
    .eq('id', documentId)
    .eq('owner_id', userId)
  if (statusError) throw errors.badRequest(`Stato flashcard non aggiornato: ${statusError.message}`)

  return jsonResponse({ savedIds, savedCount: savedIds.length, premium: true, source: 'human_reviewed' }, 200, req)
}

// deno-lint-ignore no-explicit-any
async function generateFromDocument(req: Request, admin: any, userId: string, body: Record<string, unknown>) {
  const documentId = String(body.documentId ?? '')
  if (!UUID_RE.test(documentId)) throw errors.badRequest('documentId non valido.')
  const language = String(body.language ?? 'it')
  const maxCards = Math.min(Number(body.maxCards ?? 20) || 20, config.limits.maxCardsPerGeneration)
  const focusQuery = String(body.focusQuery ?? '').trim().slice(0, 500)

  // Access check — same authoritative rule as retrieval.
  const { data: accessible, error: accessError } = await admin.rpc('rag_accessible_document_ids', { p_user: userId })
  if (accessError) throw errors.badRequest(`Verifica accesso non riuscita: ${accessError.message}`)
  if (!(accessible ?? []).some((row: { document_id: string }) => row.document_id === documentId)) {
    throw errors.paywall('Non hai accesso a questo documento.')
  }

  const { data: doc } = await admin
    .from('documents')
    .select('id, title, course_name, rag_status, rag_index_version')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) throw new AppError(404, 'not_found', 'Documento non trovato.')
  if (doc.rag_status !== 'indexed' && doc.rag_status !== 'partial') {
    throw errors.badRequest('Documento non ancora indicizzato: avvia prima "Analisi intelligente" sul documento.')
  }

  // Cache: same document + index version + params ⇒ same deck.
  const key = await cacheKey([
    'deepseek',
    config.deepseek.model,
    config.promptVersions.flashcards,
    'flashcards_doc',
    documentId,
    doc.rag_index_version,
    language,
    maxCards,
    focusQuery,
  ])
  // Chunk selection: vector search on the focus topic, or embedding centroid
  // ("gli argomenti più rappresentativi del documento") when no focus is given.
  const provider = getEmbeddingProvider()
  let ranked: TopicChunk[] = []
  if (focusQuery) {
    const matches = await retrieveRagMatches(req, {
      query: focusQuery,
      documentIds: [documentId],
      matchCount: 12,
      minSimilarity: 0.1,
    })
    ranked = (matches ?? []).map((m) => ({
      chunk_id: m.chunk_id,
      chunk_index: m.chunk_index,
      page_start: m.page_start,
      page_end: m.page_end,
      section_path: m.section_path ?? [],
      content: m.content,
      similarity: m.similarity,
    }))
  } else {
    const { data, error } = await admin.rpc('rag_document_topic_chunks', {
      p_document: documentId,
      p_model: provider.embeddingModelId,
      p_version: provider.embeddingVersion,
      p_limit: 48,
    })
    if (error) throw errors.badRequest(`Selezione argomenti non riuscita: ${error.message}`)
    ranked = (data ?? []) as TopicChunk[]
  }
  if (ranked.length === 0) {
    throw errors.badRequest(
      focusQuery
        ? 'Nessun passaggio del documento è abbastanza pertinente all’argomento richiesto.'
        : 'Nessun chunk indicizzato disponibile per questo documento.',
    )
  }

  const picked = pickDiverseChunks(ranked, RAG_MAX_BATCHES * RAG_BATCH_CHAR_BUDGET)
  if (picked.length === 0) throw errors.badRequest('I chunk rilevanti superano il budget di generazione.')
  const batches = batchChunks(picked)

  // Cache only avoids the LLM call. A deck is still materialized idempotently
  // for every caller so cache hits never pretend that somebody else's rows were
  // saved in this user's library.
  const cached = (await getCached(admin, key)) as { flashcards: GeneratedCard[] } | null
  if (cached?.flashcards) {
    const flashcards = sanitizeCards(cached.flashcards, maxCards)
    const savedIds = await persistDocumentCards({
      admin,
      userId,
      documentId,
      subject: doc.course_name ?? null,
      cards: flashcards,
      chunks: picked,
      cacheKeyValue: key,
      modelUsed: config.deepseek.model,
    })
    await recordUsage(admin, {
      user_id: userId,
      document_id: documentId,
      provider: 'deepseek',
      model_used: config.deepseek.model,
      feature: 'flashcards',
      prompt_version: config.promptVersions.flashcards,
      estimated_cost_usd: 0,
    })
    return jsonResponse(
      { flashcards, savedIds, cached: true, premium: true, source: 'rag', chunksUsed: picked.length },
      200,
      req,
    )
  }

  const all: GeneratedCard[] = []
  const cardChunk = new Map<GeneratedCard, TopicChunk>()
  const usage = { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 }
  let modelUsed = config.deepseek.model
  for (const batch of batches) {
    if (all.length >= maxCards) break
    const remaining = maxCards - all.length
    const batchCards = Math.min(remaining, Math.ceil(maxCards / batches.length) + 2)
    const pageStart = Math.min(...batch.map((c) => c.page_start))
    const pageEnd = Math.max(...batch.map((c) => c.page_end))
    const text = batch
      .map((c) => {
        const section = c.section_path?.length ? `[${c.section_path.join(' > ')}] ` : ''
        return `${section}(pp. ${c.page_start}-${c.page_end})\n${c.content}`
      })
      .join('\n\n')
    const result = await deepseekChat({
      messages: buildFlashcardsPrompt({ chunkText: text, maxCards: batchCards, language, pageStart, pageEnd }),
      temperature: 0.25,
      maxTokens: 2200,
      jsonMode: true,
      userId,
    })
    modelUsed = result.model
    usage.promptTokens += result.usage.promptTokens
    usage.completionTokens += result.usage.completionTokens
    usage.cacheHitTokens += result.usage.cacheHitTokens
    usage.cacheMissTokens += result.usage.cacheMissTokens
    const parsed = extractJson<{ flashcards?: GeneratedCard[] }>(result.content)
    const clean = sanitizeCards(parsed?.flashcards ?? [], batchCards)
    for (const card of clean) {
      if (all.length >= maxCards) break
      all.push(card)
      const sourceChunk = chunkForCard(card, batch)
      if (sourceChunk) cardChunk.set(card, sourceChunk)
    }
  }

  // Persist with provenance so the deck enters the real study/SRS system.
  const savedIds = await persistDocumentCards({
    admin,
    userId,
    documentId,
    subject: doc.course_name ?? null,
    cards: all,
    chunks: picked,
    cacheKeyValue: key,
    modelUsed,
    cardChunks: cardChunk,
  })

  const cost = deepseekCost(usage)
  await recordUsage(admin, {
    user_id: userId,
    document_id: documentId,
    provider: 'deepseek',
    model_used: modelUsed,
    feature: 'flashcards',
    prompt_version: config.promptVersions.flashcards,
    input_tokens: usage.promptTokens,
    output_tokens: usage.completionTokens,
    cache_hit_tokens: usage.cacheHitTokens,
    cache_miss_tokens: usage.cacheMissTokens,
    estimated_cost_usd: cost,
  })
  await putCached(
    admin,
    key,
    { provider: 'deepseek', model_used: modelUsed, prompt_version: config.promptVersions.flashcards, feature: 'flashcards', language },
    { flashcards: all },
  )

  return jsonResponse(
    {
      flashcards: all,
      savedIds,
      cached: false,
      premium: true,
      source: 'rag',
      chunksUsed: picked.length,
      focusQuery: focusQuery || null,
    },
    200,
    req,
  )
}
