import { config } from './env.ts'

function allowedOrigins(): string[] {
  const origins = config.corsOrigins.length > 0 ? config.corsOrigins : [config.corsOrigin].filter(Boolean)
  return origins.length > 0 ? origins : ['*']
}

function originFor(req?: Request): string {
  const origins = allowedOrigins()
  const requestOrigin = req?.headers.get('Origin') ?? ''
  if (origins.includes('*')) return '*'
  if (requestOrigin && origins.includes(requestOrigin)) return requestOrigin
  return origins[0]
}

function isAllowedOrigin(req: Request): boolean {
  const origins = allowedOrigins()
  if (origins.includes('*')) return true
  const requestOrigin = req.headers.get('Origin')
  return !requestOrigin || origins.includes(requestOrigin)
}

export function corsHeadersFor(req?: Request): Record<string, string> {
  return {
    ...baseCorsHeaders,
    'Access-Control-Allow-Origin': originFor(req),
  }
}

const baseCorsHeaders: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

export const corsHeaders: Record<string, string> = corsHeadersFor()

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(req)) return new Response('forbidden', { status: 403, headers: corsHeadersFor(req) })
    return new Response('ok', { headers: corsHeadersFor(req) })
  }
  return null
}

export function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
  })
}

export class AppError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const errors = {
  unauthorized: () => new AppError(401, 'unauthorized', 'Autenticazione richiesta.'),
  paywall: (message = 'Funzione Premium: attiva Premium per usarla.') => new AppError(402, 'premium_required', message),
  rateLimited: (message = 'Troppe richieste, riprova tra poco.') => new AppError(429, 'rate_limited', message),
  badRequest: (message: string) => new AppError(400, 'bad_request', message),
  upstream: (message = 'Servizio AI temporaneamente non disponibile.') => new AppError(502, 'ai_upstream_error', message),
}

/** Map any thrown value to a safe JSON response (never leak stack/keys). */
export function errorResponse(error: unknown, req?: Request): Response {
  if (error instanceof AppError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, req)
  }
  console.error('Unhandled error:', error)
  return jsonResponse({ error: { code: 'internal_error', message: 'Errore interno del server.' } }, 500, req)
}

/** fetch with timeout + exponential backoff on 429 / 5xx. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { retries = 2, timeoutMs = 45_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200))
          continue
        }
      }
      return res
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt)
        continue
      }
    }
  }
  console.error('Upstream network error:', lastError)
  throw errors.upstream()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
