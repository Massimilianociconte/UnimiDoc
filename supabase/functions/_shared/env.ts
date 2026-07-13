// Central configuration for the Edge Functions. All secrets are read from the
// Deno environment (set via `supabase secrets set ...`) and never shipped to
// the client. Model ids and prices are env-driven so they can change without a
// code deploy.

// deno-lint-ignore no-explicit-any
const env = (key: string, fallback = ''): string => (globalThis as any).Deno?.env.get(key) ?? fallback
const num = (key: string, fallback: number): number => {
  const raw = env(key)
  const parsed = Number(raw)
  return raw && Number.isFinite(parsed) ? parsed : fallback
}

const DEFAULT_CORS_ALLOW_ORIGINS = [
  'https://unimidoc.it',
  'https://www.unimidoc.it',
  'https://unimidoc.netlify.app',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]

function csvList(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

const configuredCorsOrigins = csvList(env('CORS_ALLOW_ORIGINS', env('CORS_ALLOW_ORIGIN', '')))

export const config = {
  supabaseUrl: env('SUPABASE_URL'),
  serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  anonKey: env('SUPABASE_ANON_KEY'),
  corsOrigin: env('CORS_ALLOW_ORIGIN', ''),
  corsOrigins: unique([...configuredCorsOrigins, ...DEFAULT_CORS_ALLOW_ORIGINS]),

  deepseek: {
    apiKey: env('DEEPSEEK_API_KEY'),
    baseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    model: env('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    // DeepSeek V4 Flash internal pricing (USD per 1M tokens).
    pricing: { inputCacheMissPer1M: 0.14, inputCacheHitPer1M: 0.0028, outputPer1M: 0.28 },
  },

  gemini: {
    apiKey: env('GEMINI_API_KEY'),
    model: env('GEMINI_VISION_MODEL', 'gemini-3-flash-preview'),
    inputPricePer1M: num('GEMINI_INPUT_PRICE_PER_1M', 0.5),
    outputPricePer1M: num('GEMINI_OUTPUT_PRICE_PER_1M', 3.0),
  },

  promptVersions: {
    flashcards: env('AI_FLASHCARD_PROMPT_VERSION', 'flashcards_v2'),
    explain: env('AI_EXPLAIN_PROMPT_VERSION', 'explain_v1'),
    followup: env('AI_FOLLOWUP_PROMPT_VERSION', 'followup_v1'),
    example: env('AI_EXAMPLE_PROMPT_VERSION', 'example_v1'),
    memo: env('AI_MEMO_PROMPT_VERSION', 'memo_v1'),
    visualize: env('AI_VISUALIZE_PROMPT_VERSION', 'visualize_v1'),
    imageOcclusion: env('AI_IMAGE_OCCLUSION_PROMPT_VERSION', 'image_occlusion_v2'),
    outline: env('AI_OUTLINE_PROMPT_VERSION', 'outline_v1'),
  },

  limits: {
    perMinute: num('AI_MAX_CALLS_PER_MINUTE', 12),
    explainsPerMonth: num('PREMIUM_MAX_EXPLAINS_PER_MONTH', 1000),
    followupsPerMonth: num('PREMIUM_MAX_FOLLOWUPS_PER_MONTH', 500),
    aiHelpsPerMonth: num('PREMIUM_MAX_AI_HELPS_PER_MONTH', 2000),
    geminiPerMonth: num('PREMIUM_MAX_GEMINI_VISION_CALLS_PER_MONTH', 300),
    maxSourceCharsExplain: num('AI_MAX_SOURCE_CHARS_EXPLAIN', 6000),
    explainMaxTokens: num('AI_EXPLAIN_MAX_TOKENS', 900),
    followupMaxTokens: num('AI_FOLLOWUP_MAX_TOKENS', 900),
    maxOcclusionMasks: num('MAX_OCCLUSION_MASKS_PER_CARD', 20),
    maxHighlightChars: num('MAX_HIGHLIGHT_SELECTION_CHARS', 8000),
    maxImageBase64Chars: num('MAX_IMAGE_BASE64_CHARS', 12_000_000),
    maxCardsPerGeneration: num('AI_MAX_CARDS_PER_GENERATION', 40),
    outlineRefinementsPerMonth: num('PREMIUM_MAX_OUTLINE_REFINEMENTS_PER_MONTH', 120),
    maxOutlineCandidates: num('AI_MAX_OUTLINE_CANDIDATES', 220),
    outlineMaxTokens: num('AI_OUTLINE_MAX_TOKENS', 2200),
    ragQueriesFreePerMonth: num('RAG_MAX_QUERIES_FREE_PER_MONTH', 30),
    ragQueriesPremiumPerMonth: num('RAG_MAX_QUERIES_PREMIUM_PER_MONTH', 1000),
    ragIndexesPerMonth: num('RAG_MAX_INDEX_RUNS_PER_MONTH', 60),
  },

  rag: {
    hybridAlpha: num('RAG_HYBRID_ALPHA', 0.30),
    mmrLambda: num('RAG_MMR_LAMBDA', 0.65),
    recallK: num('RAG_RECALL_K', 30),
    minSimilarity: num('RAG_MIN_SIMILARITY', 0.15),
    maxContextChars: num('RAG_MAX_CONTEXT_CHARS', 14000),
  },
}

export type AiFeature =
  | 'explain'
  | 'followup'
  | 'example'
  | 'memo'
  | 'visualize'
  | 'flashcards'
  | 'image_occlusion'
  | 'outline'
  | 'rag_query'
  | 'rag_index'
