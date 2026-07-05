// POST /functions/v1/generate-flashcards
// Premium flashcard generation from a text chunk (e.g. a highlight or a section).
// Free users never reach this function.

import { config } from '../_shared/env.ts'
import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import {
  adminClient,
  requireUser,
  requirePremium,
  enforceRateLimit,
  recordUsage,
  cacheKey,
  getCached,
  putCached,
} from '../_shared/supabase.ts'
import { deepseekChat, deepseekCost, extractJson } from '../_shared/ai.ts'
import { buildFlashcardsPrompt } from '../_shared/prompts.ts'

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
    await requirePremium(admin, userId)
    await enforceRateLimit(admin, userId, 'flashcards', config.limits.aiHelpsPerMonth)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const chunkText = String(body.chunkText ?? '').trim()
    if (chunkText.length < 40) throw errors.badRequest('chunkText troppo corto per generare flashcard.')
    if (chunkText.length > 50_000) throw errors.badRequest('chunkText troppo lungo per una singola generazione.')

    const language = String(body.language ?? 'it')
    const maxCards = Math.min(Number(body.maxCards ?? 12) || 12, config.limits.maxCardsPerGeneration)
    const pageStart = body.pageStart ?? null
    const pageEnd = body.pageEnd ?? null

    const key = await cacheKey([
      'deepseek',
      config.deepseek.model,
      config.promptVersions.flashcards,
      'flashcards',
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
