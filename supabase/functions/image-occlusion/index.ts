// POST /functions/v1/image-occlusion
// Premium vision analysis: analyze a rendered PDF page / figure and propose
// occlusion masks (normalized bboxes) with label/answer/hint/difficulty.
// The model's coordinates are validated server-side; the client always
// previews and confirms before saving.

import { config } from '../_shared/env.ts'
import { preflight, jsonResponse, errorResponse, errors, parseJsonBody } from '../_shared/http.ts'
import {
  adminClient,
  requireUser,
  requirePremium,
  enforceRateLimit,
  recordUsage,
  cacheKey,
  getCached,
  putCached,
  sha256Hex,
} from '../_shared/supabase.ts'
import { geminiVision, geminiCost, extractJson } from '../_shared/ai.ts'
import { createRequestLogger } from '../_shared/log.ts'
import { buildImageOcclusionPrompt } from '../_shared/prompts.ts'

type Candidate = {
  label?: string
  question?: string
  answer?: string
  hint?: string
  difficulty?: string
  bbox?: { x?: number; y?: number; width?: number; height?: number }
  confidence?: number
  reason?: string
}

const ALLOWED_DIFFICULTY = new Set(['easy', 'medium', 'hard'])
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

function validBbox(b?: Candidate['bbox']): boolean {
  if (!b) return false
  const { x, y, width, height } = b
  for (const v of [x, y, width, height]) {
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) return false
  }
  const area = (width as number) * (height as number)
  // reject degenerate or oversized masks
  return area >= 0.0004 && area <= 0.28 && (x as number) + (width as number) <= 1.001 && (y as number) + (height as number) <= 1.001
}

function sanitize(candidates: Candidate[], max: number): Candidate[] {
  const out: Candidate[] = []
  for (const c of candidates) {
    if (!validBbox(c.bbox)) continue
    const answer = String(c.answer ?? c.label ?? '').trim()
    if (!answer) continue
    if (typeof c.confidence === 'number' && c.confidence < 0.35) continue
    out.push({
      label: String(c.label ?? answer).slice(0, 120),
      question: String(c.question ?? '').slice(0, 200) || undefined,
      answer: answer.slice(0, 160),
      hint: c.hint ? String(c.hint).slice(0, 160) : undefined,
      difficulty: ALLOWED_DIFFICULTY.has(String(c.difficulty)) ? c.difficulty : 'medium',
      bbox: {
        x: round(c.bbox!.x!),
        y: round(c.bbox!.y!),
        width: round(c.bbox!.width!),
        height: round(c.bbox!.height!),
      },
      confidence: typeof c.confidence === 'number' ? round(c.confidence) : 0.6,
      reason: c.reason ? String(c.reason).slice(0, 160) : undefined,
    })
    if (out.length >= max) break
  }
  return out
}

const round = (n: number) => Math.round(n * 1000) / 1000

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre

  logger.info('image_occlusion_start')

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    await requirePremium(admin, userId)

    // Validate the payload BEFORE spending rate-limit quota: a malformed
    // request must never consume the user's monthly budget.
    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const imageBase64 = String(body.imageBase64 ?? '')
    if (imageBase64.length < 100) throw errors.badRequest('imageBase64 mancante o non valida.')
    if (imageBase64.length > config.limits.maxImageBase64Chars) throw errors.badRequest('Immagine troppo grande per una singola analisi.')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw errors.badRequest('imageBase64 non è base64 valido (invia solo il payload, senza prefisso data:).')
    const mimeType = String(body.mimeType ?? 'image/png').toLowerCase()
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) throw errors.badRequest('mimeType non supportato: usa image/png, image/jpeg o image/webp.')
    const language = String(body.language ?? 'it')
    const pageNumber = body.pageNumber ?? null

    await enforceRateLimit(admin, userId, 'image_occlusion', config.limits.geminiPerMonth)

    const imageHash = await sha256Hex(imageBase64)
    const key = await cacheKey(['gemini', config.gemini.model, config.promptVersions.imageOcclusion, 'image_occlusion', language, imageHash])
    const cached = (await getCached(admin, key)) as { occlusion_candidates: Candidate[] } | null
    if (cached?.occlusion_candidates) {
      await recordUsage(admin, {
        user_id: userId,
        document_id: body.documentId ?? null,
        provider: 'gemini',
        model_used: config.gemini.model,
        feature: 'image_occlusion',
        prompt_version: config.promptVersions.imageOcclusion,
        image_count: 1,
        estimated_cost_usd: 0,
      })
      return jsonResponse({ occlusion_candidates: cached.occlusion_candidates, cached: true, premium: true }, 200, req)
    }

    const result = await geminiVision({
      prompt: buildImageOcclusionPrompt({ language, pageNumber }),
      imageBase64,
      mimeType,
    })
    const parsed = extractJson<{ occlusion_candidates?: Candidate[] }>(result.text)
    const candidates = sanitize(parsed?.occlusion_candidates ?? [], config.limits.maxOcclusionMasks)

    const cost = geminiCost({ inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens })
    await recordUsage(admin, {
      user_id: userId,
      document_id: body.documentId ?? null,
      provider: 'gemini',
      model_used: config.gemini.model,
      feature: 'image_occlusion',
      prompt_version: config.promptVersions.imageOcclusion,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      image_count: 1,
      estimated_cost_usd: cost,
    })
    await putCached(admin, key, { provider: 'gemini', model_used: config.gemini.model, prompt_version: config.promptVersions.imageOcclusion, feature: 'image_occlusion', language }, {
      occlusion_candidates: candidates,
    })

    return jsonResponse({ occlusion_candidates: candidates, cached: false, premium: true }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
