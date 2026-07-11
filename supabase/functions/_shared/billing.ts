// Supabase Edge Functions resolve pinned npm dependencies through Deno's npm
// compatibility layer; keeping the version here makes webhook verification
// reproducible across deployments.
// deno-lint-ignore no-import-prefix
import Stripe from 'npm:stripe@22.3.1'
import { AppError } from './http.ts'

export const STRIPE_V1_API_VERSION = '2026-02-25.clover'

export type BillingFeature = 'config' | 'checkout' | 'portal' | 'webhook' | 'connect' | 'payout'

export type BillingRuntime = {
  secretKey: string
  webhookSecret: string
  appUrl: string
  mode: 'test' | 'live'
  livemode: boolean
  termsVersion: string
  privacyVersion: string
  salesTermsVersion: string
  connectTermsVersion: string
  legalEntityName: string
  legalEntityAddress: string
  legalContactEmail: string
  accountsV2Version: string
  automaticTax: boolean
}

export type BillingReadiness = {
  ready: boolean
  missing: string[]
  runtime: BillingRuntime
}

type StripeRequestOptions = {
  method?: 'GET' | 'POST'
  form?: Record<string, unknown>
  json?: Record<string, unknown>
  idempotencyKey?: string
  apiVersion?: string
  timeoutMs?: number
}

export class StripeRequestError extends AppError {
  readonly definitive: boolean
  readonly providerStatus: number | null
  readonly providerRequestId: string | null

  constructor(input: { definitive: boolean; providerStatus?: number | null; providerRequestId?: string | null }) {
    super(502, 'stripe_upstream_error', 'Il provider di pagamento non ha completato la richiesta.')
    this.name = 'StripeRequestError'
    this.definitive = input.definitive
    this.providerStatus = input.providerStatus ?? null
    this.providerRequestId = input.providerRequestId ?? null
  }
}

export function isDefinitiveStripeFailure(error: unknown): error is StripeRequestError {
  return error instanceof StripeRequestError && error.definitive
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() ?? ''
}

function boolEnv(name: string, fallback = false): boolean {
  const value = env(name).toLowerCase()
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function normalizeAppUrl(value: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !local) return ''
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function billingReadiness(feature: BillingFeature): BillingReadiness {
  const mode = env('BILLING_MODE') === 'live' ? 'live' : 'test'
  const runtime: BillingRuntime = {
    secretKey: env('STRIPE_SECRET_KEY'),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
    appUrl: normalizeAppUrl(env('BILLING_APP_URL')),
    mode,
    livemode: mode === 'live',
    termsVersion: env('BILLING_TERMS_VERSION'),
    privacyVersion: env('BILLING_PRIVACY_VERSION'),
    salesTermsVersion: env('BILLING_SALES_TERMS_VERSION'),
    connectTermsVersion: env('BILLING_CONNECT_TERMS_VERSION'),
    legalEntityName: env('LEGAL_ENTITY_NAME'),
    legalEntityAddress: env('LEGAL_ENTITY_ADDRESS'),
    legalContactEmail: env('LEGAL_CONTACT_EMAIL'),
    accountsV2Version: env('STRIPE_ACCOUNTS_V2_VERSION'),
    automaticTax: boolEnv('STRIPE_AUTOMATIC_TAX_ENABLED'),
  }

  const missing: string[] = []
  if (!runtime.secretKey) missing.push('STRIPE_SECRET_KEY')
  if (['config', 'checkout', 'portal', 'connect', 'payout'].includes(feature) && !runtime.appUrl) {
    missing.push('BILLING_APP_URL')
  }
  if (['config', 'checkout', 'connect', 'payout'].includes(feature)) {
    if (!runtime.termsVersion) missing.push('BILLING_TERMS_VERSION')
    if (!runtime.privacyVersion) missing.push('BILLING_PRIVACY_VERSION')
    if (!runtime.salesTermsVersion) missing.push('BILLING_SALES_TERMS_VERSION')
    if (!runtime.legalEntityName) missing.push('LEGAL_ENTITY_NAME')
    if (!runtime.legalEntityAddress) missing.push('LEGAL_ENTITY_ADDRESS')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(runtime.legalContactEmail)) missing.push('LEGAL_CONTACT_EMAIL')
  }
  if (feature === 'webhook' && !runtime.webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET')
  if ((feature === 'connect' || feature === 'payout') && !runtime.connectTermsVersion) {
    missing.push('BILLING_CONNECT_TERMS_VERSION')
  }
  if (feature === 'connect' && !runtime.accountsV2Version) missing.push('STRIPE_ACCOUNTS_V2_VERSION')
  // Tax-inclusive/exclusive accounting needs a jurisdiction-specific launch
  // decision. Until that contract is configured and tested, never let a single
  // env toggle charge tax while the credit ledger expects the catalog amount.
  if (runtime.automaticTax && (feature === 'config' || feature === 'checkout')) {
    missing.push('STRIPE_AUTOMATIC_TAX_ENABLED_UNSUPPORTED')
  }

  return { ready: missing.length === 0, missing, runtime }
}

export function requireBillingRuntime(feature: BillingFeature): BillingRuntime {
  const readiness = billingReadiness(feature)
  if (!readiness.ready) {
    console.error(`Billing ${feature} unavailable: missing ${readiness.missing.join(', ')}`)
    throw new AppError(503, 'billing_unavailable', 'Pagamenti temporaneamente non disponibili.')
  }
  return readiness.runtime
}

export function billingReturnUrl(runtime: BillingRuntime, path: string, params?: Record<string, string>): string {
  const url = new URL(path, `${runtime.appUrl}/`)
  if (url.origin !== new URL(runtime.appUrl).origin) {
    throw new AppError(500, 'billing_url_invalid', 'Configurazione pagamenti non valida.')
  }
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
  return url.toString()
}

function appendForm(target: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendForm(target, `${key}[${index}]`, item))
    return
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendForm(target, key ? `${key}[${childKey}]` : childKey, childValue)
    }
    return
  }
  target.append(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value))
}

function stripeErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Errore del provider di pagamento.'
  const error = (payload as { error?: { message?: unknown; code?: unknown } }).error
  const message = typeof error?.message === 'string' ? error.message : ''
  const code = typeof error?.code === 'string' ? error.code : ''
  return [code, message].filter(Boolean).join(': ') || 'Errore del provider di pagamento.'
}

export async function stripeRequest<T>(
  runtime: BillingRuntime,
  path: string,
  options: StripeRequestOptions = {},
): Promise<T> {
  if (!path.startsWith('/v1/') && !path.startsWith('/v2/')) {
    throw new AppError(500, 'stripe_path_invalid', 'Configurazione provider non valida.')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  const headers = new Headers({
    Authorization: `Bearer ${runtime.secretKey}`,
    'Stripe-Version': options.apiVersion ?? STRIPE_V1_API_VERSION,
  })
  let body: string | undefined
  if (options.json) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.json)
  } else if (options.form) {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(options.form)) appendForm(form, key, value)
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    body = form.toString()
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)

  try {
    const response = await fetch(`https://api.stripe.com${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: options.method === 'GET' ? undefined : body,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      console.error(`Stripe ${path} failed (${response.status}): ${stripeErrorMessage(payload)}`)
      // 409/429/5xx are ambiguous for a mutating request: Stripe may have
      // accepted it before our response was lost. Callers must reconcile by
      // idempotency key instead of compensating economic state immediately.
      const definitive = [400, 401, 402, 403, 404, 422].includes(response.status)
      throw new StripeRequestError({
        definitive,
        providerStatus: response.status,
        providerRequestId: response.headers.get('request-id'),
      })
    }
    return payload as T
  } catch (error) {
    if (error instanceof AppError) throw error
    console.error(`Stripe ${path} network failure:`, error)
    throw new StripeRequestError({ definitive: false })
  } finally {
    clearTimeout(timeout)
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyStripeWebhook(runtime: BillingRuntime, payload: string, signature: string): Promise<Stripe.Event> {
  if (!signature) throw new AppError(400, 'stripe_signature_missing', 'Firma webhook mancante.')
  const stripe = new Stripe(runtime.secretKey, {
    // stripe-node narrows this field to the SDK's latest version, while the
    // platform deliberately pins the API contract independently of SDK bumps.
    apiVersion: STRIPE_V1_API_VERSION as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  })
  try {
    return await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      runtime.webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error)
    throw new AppError(400, 'stripe_signature_invalid', 'Firma webhook non valida.')
  }
}

export function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

export function unixSecondsToIso(value: unknown): string | null {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null
}
