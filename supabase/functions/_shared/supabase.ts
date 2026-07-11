import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { config } from './env.ts'
import { errors } from './http.ts'

/** Service-role client — bypasses RLS. Use ONLY server-side for privileged writes. */
export function adminClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } })
}

/** Client scoped to the caller's JWT — all reads/writes respect RLS. */
export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization') ?? ''
  return createClient(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
}

export async function requireUser(req: Request): Promise<{ id: string; supabase: SupabaseClient }> {
  const supabase = userClient(req)
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw errors.unauthorized()
  return { id: data.user.id, supabase }
}

// --------------------------------------------------------------------------
// Entitlements — plan access and feature-specific grants are deliberately
// separate. A flashcard-only grant must never unlock unrelated Premium APIs.
// --------------------------------------------------------------------------
export type Entitlement = {
  isPremium: boolean
  canUseAiFlashcards: boolean
  plan: string
}

export async function getEntitlement(admin: SupabaseClient, userId: string): Promise<Entitlement> {
  const { data } = await admin
    .from('user_entitlements')
    .select('plan, premium_until, ai_flashcards_enabled')
    .eq('owner_id', userId)
    .maybeSingle()

  const premiumNotExpired = !data?.premium_until || new Date(data.premium_until) > new Date()
  const isPremium = Boolean(data) && data!.plan === 'premium' && premiumNotExpired
  const canUseAiFlashcards = isPremium || data?.ai_flashcards_enabled === true
  return { isPremium, canUseAiFlashcards, plan: data?.plan ?? 'free' }
}

/** Throws a 402 paywall unless the user has an active Premium plan. */
export async function requirePremium(admin: SupabaseClient, userId: string): Promise<Entitlement> {
  const entitlement = await getEntitlement(admin, userId)
  if (!entitlement.isPremium) throw errors.paywall()
  return entitlement
}

/** Allows Premium users and explicit flashcard-only feature grants. */
export async function requireAiFlashcards(admin: SupabaseClient, userId: string): Promise<Entitlement> {
  const entitlement = await getEntitlement(admin, userId)
  if (!entitlement.canUseAiFlashcards) {
    throw errors.paywall('Generazione AI delle flashcard non abilitata per questo account.')
  }
  return entitlement
}

/** Per-minute + per-month rate limiting via the ai_cost_ledger. */
export async function enforceRateLimit(
  admin: SupabaseClient,
  userId: string,
  feature: string,
  monthlyLimit: number,
): Promise<void> {
  const now = Date.now()
  const minuteAgo = new Date(now - 60_000).toISOString()
  const monthAgo = new Date(now - 30 * 24 * 3_600_000).toISOString()

  const perMinute = await admin
    .from('ai_cost_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .gte('created_at', minuteAgo)
  if ((perMinute.count ?? 0) >= config.limits.perMinute) throw errors.rateLimited()

  const perMonth = await admin
    .from('ai_cost_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('operation', feature)
    .gte('created_at', monthAgo)
  if ((perMonth.count ?? 0) >= monthlyLimit) {
    throw errors.rateLimited(`Limite mensile raggiunto per "${feature}".`)
  }
}

// --------------------------------------------------------------------------
// Cost tracking — one row per call in ai_cost_ledger + an atomic monthly
// rollup in ai_monthly_usage (both keep DeepSeek and Gemini separable).
// --------------------------------------------------------------------------
export type UsageRow = {
  user_id: string
  document_id?: string | null
  provider: 'deepseek' | 'gemini'
  model_used: string
  feature: string
  prompt_version?: string | null
  input_tokens?: number
  output_tokens?: number
  cache_hit_tokens?: number
  cache_miss_tokens?: number
  image_count?: number
  estimated_cost_usd: number
}

export async function recordUsage(admin: SupabaseClient, row: UsageRow): Promise<void> {
  const inputTokens = row.cache_miss_tokens ?? row.input_tokens ?? 0
  const cachedTokens = row.cache_hit_tokens ?? 0
  const outputTokens = row.output_tokens ?? 0

  const { error } = await admin.from('ai_cost_ledger').insert({
    owner_id: row.user_id,
    document_id: row.document_id ?? null,
    provider: row.provider,
    model_name: row.model_used,
    operation: row.feature,
    input_tokens: inputTokens,
    cached_input_tokens: cachedTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: row.estimated_cost_usd,
  })
  if (error) console.error('recordUsage failed:', error.message)

  // Best-effort monthly rollup (atomic via RPC) — never fails the request.
  const { error: rpcError } = await admin.rpc('record_ai_monthly_usage', {
    p_owner: row.user_id,
    p_input: inputTokens,
    p_cached: cachedTokens,
    p_output: outputTokens,
    p_cost: row.estimated_cost_usd,
  })
  if (rpcError) console.error('record_ai_monthly_usage failed:', rpcError.message)
}

// deno-lint-ignore no-explicit-any
export async function recordAiHelp(admin: SupabaseClient, row: Record<string, any>): Promise<void> {
  const { error } = await admin.from('ai_helps').insert({
    owner_id: row.user_id,
    flashcard_id: row.flashcard_id ?? null,
    mode: row.mode,
    input: row.input ?? null,
    output: row.output ?? null,
    provider: row.provider,
    model_name: row.model_used,
    prompt_version: row.prompt_version,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    estimated_cost_usd: row.estimated_cost_usd ?? 0,
  })
  if (error) console.error('recordAiHelp failed:', error.message)
}

// --------------------------------------------------------------------------
// Generic AI cache (ai_cache) — content-hash reuse to avoid re-billing.
// --------------------------------------------------------------------------
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function cacheKey(parts: (string | number | null | undefined)[]): Promise<string> {
  return sha256Hex(parts.map((part) => String(part ?? '')).join('|'))
}

export async function getCached(admin: SupabaseClient, key: string): Promise<unknown | null> {
  const { data } = await admin.from('ai_cache').select('output').eq('cache_key', key).maybeSingle()
  return data?.output ?? null
}

export async function putCached(
  admin: SupabaseClient,
  key: string,
  meta: { provider: string; model_used: string; prompt_version: string; feature: string; language?: string },
  output: unknown,
): Promise<void> {
  const { error } = await admin.from('ai_cache').upsert(
    {
      cache_key: key,
      output,
      provider: meta.provider,
      model_name: meta.model_used,
      prompt_version: meta.prompt_version,
      feature: meta.feature,
      language: meta.language ?? null,
    },
    { onConflict: 'cache_key', ignoreDuplicates: true },
  )
  if (error) console.error('putCached failed:', error.message)
}
