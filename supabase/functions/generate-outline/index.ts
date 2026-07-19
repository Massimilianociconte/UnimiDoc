// POST /functions/v1/generate-outline
// Premium, cost-first outline refinement. The client/backend sends only
// deterministic candidates (title, page, evidence), never the whole PDF.

import { config } from '../_shared/env.ts'
import { preflight, jsonResponse, errorResponse, errors, parseJsonBody, requireMethod} from '../_shared/http.ts'
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
import { buildOutlinePrompt, type OutlineCandidateForPrompt } from '../_shared/prompts.ts'
import { createRequestLogger } from '../_shared/log.ts'


type RefinedOutlineEntry = {
  title?: string
  level?: number
  page_start?: number
  page_end?: number | null
  confidence?: number
  source_candidate_titles?: string[]
}

const clean = (value: unknown, fallback = '') => String(value ?? fallback).trim()

function normalizeTitle(value: string): string {
  return clean(value)
    .replace(/\s+\.{2,}\s*\d+$/, '')
    .replace(/[.:;,\s]+$/, '')
    .slice(0, 120)
}

function normalizeKey(value: string): string {
  return normalizeTitle(value)
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\s+/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeCandidates(raw: unknown, max: number): OutlineCandidateForPrompt[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OutlineCandidateForPrompt[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const title = normalizeTitle(clean(candidate.title))
    const page = Math.round(Number(candidate.page ?? candidate.page_start ?? 0))
    if (title.length < 3 || !Number.isFinite(page) || page < 1) continue
    const key = `${page}-${normalizeKey(title)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      title,
      page,
      level: Math.max(1, Math.min(3, Math.round(Number(candidate.level ?? 1)) || 1)),
      score: Math.max(0, Math.min(1, Number(candidate.score ?? candidate.confidence ?? 0.5))),
      source: clean(candidate.source, 'candidate').slice(0, 32),
      evidence: clean(candidate.evidence).slice(0, 160) || undefined,
    })
    if (out.length >= max) break
  }
  return out
}

function sanitizeOutline(
  raw: RefinedOutlineEntry[],
  candidates: OutlineCandidateForPrompt[],
  pageCount: number,
): RefinedOutlineEntry[] {
  const candidateKeys = new Map(candidates.map((candidate) => [normalizeKey(candidate.title), candidate]))
  const seen = new Set<string>()
  const out: RefinedOutlineEntry[] = []

  for (const item of raw) {
    const title = normalizeTitle(clean(item.title))
    const key = normalizeKey(title)
    const directCandidate = candidateKeys.get(key)
    const mentionedCandidate = (item.source_candidate_titles ?? [])
      .map((candidateTitle) => candidateKeys.get(normalizeKey(candidateTitle)))
      .find(Boolean)
    const evidence = directCandidate ?? mentionedCandidate
    if (!title || !evidence) continue

    const pageStart = Math.max(1, Math.min(pageCount, Math.round(Number(item.page_start ?? evidence.page)) || evidence.page))
    const pageEnd = item.page_end == null
      ? null
      : Math.max(pageStart, Math.min(pageCount, Math.round(Number(item.page_end)) || pageStart))
    const dedupe = `${pageStart}-${key}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)

    out.push({
      title,
      level: Math.max(1, Math.min(3, Math.round(Number(item.level ?? evidence.level ?? 1)) || 1)),
      page_start: pageStart,
      page_end: pageEnd,
      confidence: Math.max(0.35, Math.min(0.96, Number(item.confidence ?? evidence.score ?? 0.72))),
      source_candidate_titles: [evidence.title],
    })
    if (out.length >= 120) break
  }

  return out.sort((a, b) => Number(a.page_start) - Number(b.page_start) || Number(a.level) - Number(b.level))
}

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  const methodDenied = requireMethod(req, ['POST'])
  if (methodDenied) return methodDenied

  logger.info('generate_outline_start')

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    await requirePremium(admin, userId)

    // Validate the payload BEFORE spending rate-limit quota: a malformed
    // request must never consume the user's monthly budget.
    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')

    const pageCount = Math.max(1, Math.min(2000, Math.round(Number((body as Record<string, unknown>).pageCount ?? 1)) || 1))
    const language = clean((body as Record<string, unknown>).language, 'it').slice(0, 12)
    const documentId = clean((body as Record<string, unknown>).documentId).slice(0, 128) || null
    const candidates = sanitizeCandidates((body as Record<string, unknown>).candidates, config.limits.maxOutlineCandidates)
    if (candidates.length < 3) throw errors.badRequest('Servono almeno 3 candidati verificabili per rifinire l’indice.')

    await enforceRateLimit(admin, userId, 'outline', config.limits.outlineRefinementsPerMonth)

    const key = await cacheKey([
      'deepseek',
      config.deepseek.model,
      config.promptVersions.outline,
      'outline',
      documentId ?? 'no-document',
      language,
      pageCount,
      JSON.stringify(candidates),
    ])
    const cached = (await getCached(admin, key)) as { outline: RefinedOutlineEntry[]; notes?: string[] } | null
    if (cached?.outline) {
      await recordUsage(admin, {
        user_id: userId,
        document_id: documentId,
        provider: 'deepseek',
        model_used: config.deepseek.model,
        feature: 'outline',
        prompt_version: config.promptVersions.outline,
        estimated_cost_usd: 0,
      })
      return jsonResponse({ outline: cached.outline, notes: cached.notes ?? [], cached: true, premium: true }, 200, req)
    }

    const result = await deepseekChat({
      messages: buildOutlinePrompt({ candidates, pageCount, language }),
      temperature: 0.12,
      maxTokens: config.limits.outlineMaxTokens,
      jsonMode: true,
      userId,
    })
    const parsed = extractJson<{ outline?: RefinedOutlineEntry[]; notes?: string[] }>(result.content)
    const outline = sanitizeOutline(parsed?.outline ?? [], candidates, pageCount)
    const notes = Array.isArray(parsed?.notes) ? parsed.notes.map((note) => clean(note).slice(0, 180)).filter(Boolean).slice(0, 6) : []

    const cost = deepseekCost({
      cacheMissTokens: result.usage.cacheMissTokens,
      cacheHitTokens: result.usage.cacheHitTokens,
      completionTokens: result.usage.completionTokens,
    })
    await recordUsage(admin, {
      user_id: userId,
      document_id: documentId,
      provider: 'deepseek',
      model_used: result.model,
      feature: 'outline',
      prompt_version: config.promptVersions.outline,
      input_tokens: result.usage.promptTokens,
      output_tokens: result.usage.completionTokens,
      cache_hit_tokens: result.usage.cacheHitTokens,
      cache_miss_tokens: result.usage.cacheMissTokens,
      estimated_cost_usd: cost,
    })
    await putCached(admin, key, { provider: 'deepseek', model_used: result.model, prompt_version: config.promptVersions.outline, feature: 'outline', language }, {
      outline,
      notes,
    })

    return jsonResponse({ outline, notes, cached: false, premium: true }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
