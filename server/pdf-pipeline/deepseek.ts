import { createHash } from 'node:crypto'

export type PremiumFlashcardType = 'qa' | 'cloze' | 'definition' | 'comparison' | 'process' | 'cause_effect' | 'exam_question'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type PremiumChunk = {
  id: string
  text: string
  pageStart?: number
  pageEnd?: number
  contentSha256?: string
  sectionPath?: string[]
}

export type PremiumFlashcard = {
  type: PremiumFlashcardType
  question: string
  answer: string
  clozeText: string | null
  difficulty: Difficulty
  sourceQuote: string
  pageStart: number | null
  pageEnd: number | null
  tags: string[]
}

export type DeepSeekUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

export type PremiumFlashcardResult = {
  flashcards: PremiumFlashcard[]
  usage: DeepSeekUsage
  model: string
  promptVersion: string
  costUsd: number
  cacheKey: string
}

export type GeneratePremiumFlashcardsInput = {
  userId: string
  documentId: string
  documentHash: string
  visibility: 'private' | 'submitted' | 'published' | 'rejected'
  generationMode: 'premium'
  language?: 'it' | 'en'
  detailLevel?: 'standard' | 'exam'
  chunk: PremiumChunk
  maxCards?: number
}

type DeepSeekChatResponse = {
  model?: string
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: DeepSeekUsage
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_PROMPT_VERSION = 'flashcards_v1'

export class DeepSeekApiError extends Error {
  status: number
  code: string
  retryable: boolean

  constructor(message: string, status: number, code: string, retryable: boolean) {
    super(message)
    this.name = 'DeepSeekApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

export function estimateDeepSeekFlashcardCost(usage: DeepSeekUsage): number {
  const promptTokens = usage.prompt_tokens ?? 0
  const completionTokens = usage.completion_tokens ?? 0
  const cacheHitTokens = usage.prompt_cache_hit_tokens ?? 0
  const explicitCacheMissTokens = usage.prompt_cache_miss_tokens
  const cacheMissTokens =
    explicitCacheMissTokens ?? Math.max(0, promptTokens - cacheHitTokens)

  return (
    (cacheMissTokens / 1_000_000) * 0.14 +
    (cacheHitTokens / 1_000_000) * 0.0028 +
    (completionTokens / 1_000_000) * 0.28
  )
}

export function buildFlashcardCacheKey(input: GeneratePremiumFlashcardsInput): string {
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL
  const promptVersion = process.env.AI_FLASHCARD_PROMPT_VERSION ?? DEFAULT_PROMPT_VERSION
  const ownerScope = input.visibility === 'private' ? input.userId : 'shared'
  const parts = [
    input.documentHash,
    ownerScope,
    input.visibility,
    model,
    promptVersion,
    input.language ?? 'it',
    input.generationMode,
    input.detailLevel ?? 'standard',
    input.chunk.contentSha256 ?? sha256String(normalizeForHash(input.chunk.text)),
  ]

  return sha256String(parts.join('\n'))
}

export async function generatePremiumFlashcards(
  input: GeneratePremiumFlashcardsInput,
): Promise<PremiumFlashcardResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new DeepSeekApiError('DEEPSEEK_API_KEY_MISSING', 500, 'missing_api_key', false)

  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL
  const promptVersion = process.env.AI_FLASHCARD_PROMPT_VERSION ?? DEFAULT_PROMPT_VERSION
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const cacheKey = buildFlashcardCacheKey(input)
  const { systemPrompt, userPrompt } = buildPrompts(input)

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2500,
      stream: false,
      thinking: { type: 'disabled' },
      user_id: safeDeepSeekUserId(input.userId),
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new DeepSeekApiError(
      text || `DeepSeek request failed with HTTP ${response.status}`,
      response.status,
      codeForStatus(response.status),
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }

  const payload = (await response.json()) as DeepSeekChatResponse
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new DeepSeekApiError('DEEPSEEK_EMPTY_CONTENT', 502, 'empty_content', true)

  const parsed = parseJsonObject(content)
  const flashcards = sanitizePremiumFlashcards(parsed.flashcards, input)
  const usage = payload.usage ?? {}

  return {
    flashcards,
    usage,
    model: payload.model ?? model,
    promptVersion,
    costUsd: estimateDeepSeekFlashcardCost(usage),
    cacheKey,
  }
}

function buildPrompts(input: GeneratePremiumFlashcardsInput) {
  const maxCards = input.maxCards ?? 8
  const language = input.language ?? 'it'
  const pageRange = `${input.chunk.pageStart ?? 'unknown'}-${input.chunk.pageEnd ?? 'unknown'}`
  const section = input.chunk.sectionPath?.length ? input.chunk.sectionPath.join(' > ') : 'unknown'

  const systemPrompt = `
Sei un generatore di flashcard per studio universitario.
Devi produrre SOLO json valido.
Non inventare informazioni non presenti nel testo.
Usa esclusivamente il chunk fornito.
Ogni flashcard deve testare un solo concetto, favorire active recall ed essere utile per esami scientifici.
Evita domande vaghe, duplicati, frasi da indice, footer o bibliografia.
`

  const userPrompt = `
Produci json valido nel seguente formato:

{
  "flashcards": [
    {
      "type": "qa | cloze | definition | comparison | process | cause_effect | exam_question",
      "question": "string",
      "answer": "string",
      "cloze_text": "string | null",
      "difficulty": "easy | medium | hard",
      "source_quote": "string",
      "page_start": 1,
      "page_end": 1,
      "tags": ["string"]
    }
  ]
}

Regole:
- massimo ${maxCards} flashcard;
- genera meno card se il testo non contiene concetti abbastanza solidi;
- non inventare;
- ogni source_quote deve essere copiato dal chunk o esserne una citazione breve e verificabile;
- evita risposte oltre 90 parole;
- preferisci definizioni, causa-effetto, confronti, processi, cloze e domande d'esame quando il testo lo consente;
- output solo json, nessun markdown.

Lingua: ${language}
Documento: ${input.documentId}
Chunk: ${input.chunk.id}
Sezione: ${section}
Pagine: ${pageRange}
Livello: ${input.detailLevel ?? 'standard'}

Testo:
"""
${input.chunk.text}
"""
`

  return { systemPrompt, userPrompt }
}

function sanitizePremiumFlashcards(value: unknown, input: GeneratePremiumFlashcardsInput): PremiumFlashcard[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => normalizePremiumCard(item, input))
    .filter((card): card is PremiumFlashcard => Boolean(card))
    .slice(0, input.maxCards ?? 8)
}

function normalizePremiumCard(value: unknown, input: GeneratePremiumFlashcardsInput): PremiumFlashcard | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const question = asText(record.question)
  const answer = asText(record.answer)
  const sourceQuote = asText(record.source_quote)
  const type = normalizeType(record.type)

  if (!question || !answer || !sourceQuote || !type) return null
  if (question.length < 8 || question.length > 280 || answer.length < 4 || answer.length > 900) return null
  if (!quoteIsSupported(sourceQuote, input.chunk.text)) return null

  return {
    type,
    question,
    answer,
    clozeText: asText(record.cloze_text) || null,
    difficulty: normalizeDifficulty(record.difficulty),
    sourceQuote,
    pageStart: asNumber(record.page_start) ?? input.chunk.pageStart ?? null,
    pageEnd: asNumber(record.page_end) ?? input.chunk.pageEnd ?? null,
    tags: Array.isArray(record.tags) ? record.tags.map(asText).filter(Boolean).slice(0, 8) : [],
  }
}

function normalizeType(value: unknown): PremiumFlashcardType | null {
  if (typeof value !== 'string') return null
  if (value === 'cause-effect') return 'cause_effect'
  const allowed = new Set<PremiumFlashcardType>(['qa', 'cloze', 'definition', 'comparison', 'process', 'cause_effect', 'exam_question'])
  return allowed.has(value as PremiumFlashcardType) ? (value as PremiumFlashcardType) : null
}

function normalizeDifficulty(value: unknown): Difficulty {
  return value === 'easy' || value === 'hard' ? value : 'medium'
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function quoteIsSupported(quote: string, source: string): boolean {
  const normalizedQuote = normalizeForHash(quote)
  const normalizedSource = normalizeForHash(source)
  if (normalizedQuote.length < 10) return false
  if (normalizedSource.includes(normalizedQuote)) return true

  const quoteTerms = new Set(tokenizeForOverlap(normalizedQuote))
  const sourceTerms = new Set(tokenizeForOverlap(normalizedSource))
  if (quoteTerms.size < 3) return false

  let shared = 0
  quoteTerms.forEach((term) => {
    if (sourceTerms.has(term)) shared += 1
  })

  return shared / quoteTerms.size >= 0.68
}

function tokenizeForOverlap(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}][\p{L}'-]{2,}/gu) ?? []
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```json\s*|\s*```$/g, '')
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DeepSeekApiError('DEEPSEEK_INVALID_JSON_OBJECT', 502, 'invalid_json', true)
  }
  return parsed as Record<string, unknown>
}

function safeDeepSeekUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 512)
}

function codeForStatus(status: number): string {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'invalid_api_key'
  if (status === 402) return 'insufficient_balance'
  if (status === 422) return 'invalid_parameters'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'provider_unavailable'
  return 'provider_error'
}

function sha256String(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeForHash(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}
