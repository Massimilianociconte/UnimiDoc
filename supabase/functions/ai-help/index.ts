// POST /functions/v1/ai-help
// Premium DeepSeek text helper: Explain / Follow-up / Example / Memo / Visualize.
// Enforces auth + premium + rate limit, caches by content hash, and records
// token usage + estimated cost. Never called by free users.

import { config } from '../_shared/env.ts'
import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import {
  adminClient,
  requireUser,
  requirePremium,
  enforceRateLimit,
  recordUsage,
  recordAiHelp,
  cacheKey,
  getCached,
  putCached,
} from '../_shared/supabase.ts'
import { deepseekChat, deepseekCost } from '../_shared/ai.ts'
import { buildAiHelpPrompt, type AiHelpMode } from '../_shared/prompts.ts'

const MODES: AiHelpMode[] = ['explain', 'followup', 'example', 'memo', 'visualize']

const PROMPT_VERSION: Record<AiHelpMode, string> = {
  explain: config.promptVersions.explain,
  followup: config.promptVersions.followup,
  example: config.promptVersions.example,
  memo: config.promptVersions.memo,
  visualize: config.promptVersions.visualize,
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre

  try {
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    await requirePremium(admin, userId)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')

    const mode = body.mode as AiHelpMode
    if (!MODES.includes(mode)) throw errors.badRequest('mode non valido.')
    const question = String(body.question ?? '').trim()
    const correctAnswer = String(body.correctAnswer ?? '').trim()
    if (!question || !correctAnswer) throw errors.badRequest('question e correctAnswer sono obbligatori.')
    if (mode === 'followup' && !String(body.followupQuestion ?? '').trim()) {
      throw errors.badRequest('followupQuestion obbligatoria per la modalità follow-up.')
    }

    const feature = mode
    const monthlyLimit =
      mode === 'followup'
        ? config.limits.followupsPerMonth
        : mode === 'explain'
          ? config.limits.explainsPerMonth
          : config.limits.aiHelpsPerMonth
    await enforceRateLimit(admin, userId, feature, monthlyLimit)

    const language = String(body.language ?? 'it')
    const sourceText = body.sourceText ? String(body.sourceText).slice(0, config.limits.maxSourceCharsExplain) : null
    const ctx = {
      question,
      correctAnswer,
      userAnswer: body.userAnswer ? String(body.userAnswer) : null,
      answerStatus: body.answerStatus ? String(body.answerStatus) : null,
      sourceText,
      previousExplanation: body.previousExplanation ? String(body.previousExplanation) : null,
      followupQuestion: body.followupQuestion ? String(body.followupQuestion) : null,
      language,
    }

    // The key must cover EVERY input that changes the prompt, otherwise a
    // cached answer for different context gets served (answerStatus and
    // previousExplanation feed the prompt; sourceText must not be truncated).
    const key = await cacheKey([
      'deepseek',
      config.deepseek.model,
      PROMPT_VERSION[mode],
      feature,
      language,
      question,
      correctAnswer,
      ctx.userAnswer,
      ctx.answerStatus,
      ctx.followupQuestion,
      ctx.previousExplanation,
      sourceText,
    ])

    const cached = (await getCached(admin, key)) as { content: string } | null
    if (cached?.content) {
      await recordUsage(admin, {
        user_id: userId,
        provider: 'deepseek',
        model_used: config.deepseek.model,
        feature,
        prompt_version: PROMPT_VERSION[mode],
        cache_hit_tokens: 0,
        estimated_cost_usd: 0,
      })
      return jsonResponse({ content: cached.content, cached: true, premium: true }, 200, req)
    }

    const maxTokens =
      mode === 'explain'
        ? config.limits.explainMaxTokens
        : mode === 'followup'
          ? config.limits.followupMaxTokens
          : 700
    const result = await deepseekChat({
      messages: buildAiHelpPrompt(mode, ctx),
      temperature: mode === 'memo' || mode === 'example' ? 0.35 : 0.2,
      maxTokens,
      userId,
    })

    const cost = deepseekCost({
      cacheMissTokens: result.usage.cacheMissTokens,
      cacheHitTokens: result.usage.cacheHitTokens,
      completionTokens: result.usage.completionTokens,
    })

    await recordAiHelp(admin, {
      user_id: userId,
      flashcard_id: body.flashcardId ?? null,
      mode,
      input: question,
      output: result.content,
      provider: 'deepseek',
      model_used: result.model,
      prompt_version: PROMPT_VERSION[mode],
      input_tokens: result.usage.promptTokens,
      output_tokens: result.usage.completionTokens,
      estimated_cost_usd: cost,
    })
    await recordUsage(admin, {
      user_id: userId,
      document_id: body.documentId ?? null,
      provider: 'deepseek',
      model_used: result.model,
      feature,
      prompt_version: PROMPT_VERSION[mode],
      input_tokens: result.usage.promptTokens,
      output_tokens: result.usage.completionTokens,
      cache_hit_tokens: result.usage.cacheHitTokens,
      cache_miss_tokens: result.usage.cacheMissTokens,
      estimated_cost_usd: cost,
    })
    await putCached(admin, key, { provider: 'deepseek', model_used: result.model, prompt_version: PROMPT_VERSION[mode], feature, language }, {
      content: result.content,
    })

    return jsonResponse({ content: result.content, cached: false, premium: true }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
