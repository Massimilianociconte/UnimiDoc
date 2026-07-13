// Public, read-only billing capabilities. Secrets and Stripe IDs never leave the
// service boundary; missing env/legal configuration disables every offer.

import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts'
import { adminClient } from '../_shared/supabase.ts'
import { createRequestLogger } from '../_shared/log.ts'
import { billingReadiness } from '../_shared/billing.ts'

type DbOffer = {
  key: string
  kind: 'topup' | 'subscription'
  name: string
  amount_minor: number
  currency: string
  paid_credits: number
  promotional_credits: number
  total_credits: number
  interval: 'month' | 'year' | null
}

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  if (!['GET', 'POST'].includes(req.method)) return jsonResponse({ error: { code: 'method_not_allowed' } }, 405, req)

  logger.info('billing_config_served')

  if (req.method === 'POST') await parseJsonBody(req) // for future use or validation

  try {
    const readiness = billingReadiness('config')
    const connectReadiness = billingReadiness('connect')
    if (!readiness.ready) {
      return jsonResponse({
        enabled: false,
        mode: readiness.runtime.mode,
        legalReady: false,
        offers: [],
        connectEnabled: false,
      }, 200, req)
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('billing_get_config')
    if (error || !data) throw error ?? new Error('Billing config unavailable')
    const config = data as {
      enabled?: boolean
      mode?: string
      legal_ready?: boolean
      connect_enabled?: boolean
      offers?: DbOffer[]
    }
    const modeMatches = config.mode === readiness.runtime.mode
    const legalReady = config.legal_ready === true
    const enabled = config.enabled === true && modeMatches && legalReady

    return jsonResponse({
      enabled,
      mode: readiness.runtime.mode,
      legalReady,
      offers: enabled
        ? (config.offers ?? []).map((offer) => ({
            key: offer.key,
            kind: offer.kind,
            name: offer.name,
            amountMinor: offer.amount_minor,
            currency: offer.currency,
            paidCredits: offer.paid_credits,
            promotionalCredits: offer.promotional_credits,
            totalCredits: offer.total_credits,
            interval: offer.interval,
          }))
        : [],
      connectEnabled: enabled && config.connect_enabled === true && connectReadiness.ready,
    }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
