import { config } from './env.ts'
import { errors, fetchWithRetry } from './http.ts'

// --------------------------------------------------------------------------
// AI router — hard separation between text (DeepSeek) and vision (Gemini).
// --------------------------------------------------------------------------
export type AiTaskType =
  | 'text_flashcards'
  | 'text_quiz'
  | 'explain'
  | 'followup'
  | 'example'
  | 'memo'
  | 'visualize_text'
  | 'image_occlusion'
  | 'image_label_detection'
  | 'diagram_understanding'

export function resolveAiProvider(task: AiTaskType): 'deepseek' | 'gemini' {
  switch (task) {
    case 'image_occlusion':
    case 'image_label_detection':
    case 'diagram_understanding':
      return 'gemini'
    default:
      return 'deepseek'
  }
}

// --------------------------------------------------------------------------
// DeepSeek V4 Flash — all text intelligence.
// --------------------------------------------------------------------------
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type DeepseekResult = {
  content: string
  usage: { promptTokens: number; completionTokens: number; cacheHitTokens: number; cacheMissTokens: number }
  model: string
}

export async function deepseekChat({
  messages,
  temperature = 0.2,
  maxTokens = 900,
  jsonMode = false,
  userId,
}: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  userId?: string
}): Promise<DeepseekResult> {
  if (!config.deepseek.apiKey) throw errors.upstream('Servizio AI non configurato.')

  const res = await fetchWithRetry(`${config.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseek.apiKey}` },
    body: JSON.stringify({
      model: config.deepseek.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      thinking: { type: 'disabled' },
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      // anonymous technical id only — never an email or PII
      ...(userId ? { user: userId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 64) } : {}),
    }),
  })

  if (!res.ok) {
    console.error('Text AI upstream error:', { status: res.status, body: await safeText(res) })
    throw errors.upstream()
  }
  const data = await res.json()
  const usage = data.usage ?? {}
  const promptTokens = usage.prompt_tokens ?? 0
  const cacheHitTokens = usage.prompt_cache_hit_tokens ?? 0
  const cacheMissTokens = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHitTokens)

  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content) throw errors.upstream('Risposta AI vuota.')

  return {
    content,
    usage: { promptTokens, completionTokens: usage.completion_tokens ?? 0, cacheHitTokens, cacheMissTokens },
    model: data.model ?? config.deepseek.model,
  }
}

export function deepseekCost(u: { cacheMissTokens: number; cacheHitTokens: number; completionTokens: number }): number {
  const p = config.deepseek.pricing
  return (
    (u.cacheMissTokens / 1e6) * p.inputCacheMissPer1M +
    (u.cacheHitTokens / 1e6) * p.inputCacheHitPer1M +
    (u.completionTokens / 1e6) * p.outputPer1M
  )
}

// --------------------------------------------------------------------------
// Gemini 3 Flash Preview — vision only (image occlusion / diagram analysis).
// --------------------------------------------------------------------------
export type GeminiResult = { text: string; usage: { inputTokens: number; outputTokens: number } }

export async function geminiVision({
  prompt,
  imageBase64,
  mimeType = 'image/png',
}: {
  prompt: string
  imageBase64: string
  mimeType?: string
}): Promise<GeminiResult> {
  if (!config.gemini.apiKey) throw errors.upstream('Servizio vision non configurato.')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) {
    console.error('Vision AI upstream error:', { status: res.status, body: await safeText(res) })
    throw errors.upstream()
  }
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? ''
  const meta = data.usageMetadata ?? {}
  return { text, usage: { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 } }
}

export function geminiCost(u: { inputTokens: number; outputTokens: number }): number {
  return (u.inputTokens / 1e6) * config.gemini.inputPricePer1M + (u.outputTokens / 1e6) * config.gemini.outputPricePer1M
}

/** Parse a JSON payload from a model that may wrap it in prose / code fences. */
export function extractJson<T>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const start = candidate.search(/[[{]/)
  if (start < 0) return null
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
  if (end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200)
  } catch {
    return ''
  }
}
