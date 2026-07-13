// Converts held, cash-backed seller credits into a Stripe transfer. Credits and
// earnings are reserved atomically before the external call and fully restored
// if Stripe rejects the transfer.

import { preflight, jsonResponse, errorResponse, errors, parseJsonBody } from '../_shared/http.ts'
import { adminClient, requireUser, type AdminClient } from '../_shared/supabase.ts'
import { createRequestLogger } from '../_shared/log.ts'
import { isDefinitiveStripeFailure, requireBillingRuntime, stripeRequest } from '../_shared/billing.ts'

type ReservedPayout = {
  request_id: string
  status: string
  stripe_account_id: string
  credits?: number
  amount_minor: number
  currency: string
}

type StripeTransfer = { id: string }
type ProviderAttempt = { attempt_id: string }
const REQUEST_RE = /^[a-zA-Z0-9:_-]{16,160}$/

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'method_not_allowed' } }, 405, req)

  logger.info('payout_request_received')

  try {
    const runtime = requireBillingRuntime('payout')
    const { id: userId } = await requireUser(req)
    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const credits = Number(body.credits)
    const requestId = String(body.requestId ?? '').trim()
    if (!Number.isInteger(credits) || credits <= 0) throw errors.badRequest('Numero di crediti non valido.')
    if (!REQUEST_RE.test(requestId)) throw errors.badRequest('requestId non valido.')

    const admin: AdminClient = adminClient()
    const { data, error } = await admin.rpc('billing_reserve_payout', {
      p_owner: userId,
      p_credits: credits,
      p_request_key: requestId,
      p_livemode: runtime.livemode,
    })
    if (error || !data) throw error ?? new Error('Payout reservation failed')
    const reserved = data as ReservedPayout
    if (reserved.status === 'transferred' || reserved.status === 'paid') {
      return jsonResponse({ requestId: reserved.request_id, status: reserved.status }, 200, req)
    }
    if (reserved.status === 'failed') {
      return jsonResponse({ requestId: reserved.request_id, status: 'failed' }, 409, req)
    }

    const { data: attemptData, error: attemptError } = await admin.rpc('billing_begin_payout_provider_attempt', {
      p_request: reserved.request_id,
    })
    if (attemptError || !attemptData) throw attemptError ?? new Error('Payout attempt persistence failed')
    const providerAttempt = attemptData as ProviderAttempt

    let transfer: StripeTransfer
    try {
      transfer = await stripeRequest<StripeTransfer>(runtime, '/v1/transfers', {
        form: {
          amount: reserved.amount_minor,
          currency: reserved.currency,
          destination: reserved.stripe_account_id,
          transfer_group: `unimidoc_payout_${reserved.request_id}`,
          metadata: {
            unimidoc_user_id: userId,
            unimidoc_payout_request_id: reserved.request_id,
            unimidoc_credits: credits,
          },
        },
        idempotencyKey: `unimidoc-payout-${reserved.request_id}`,
      })
    } catch (stripeError) {
      const definitive = isDefinitiveStripeFailure(stripeError)
      const { error: outcomeError } = await admin.rpc('billing_finish_payout_provider_attempt', {
        p_attempt: providerAttempt.attempt_id,
        p_outcome: definitive ? 'definitive_failed' : 'indeterminate',
        p_stripe_transfer_id: null,
        p_error_code: definitive ? 'stripe_transfer_rejected' : 'stripe_outcome_indeterminate',
      })
      if (outcomeError) console.error('Payout provider outcome persistence failed:', outcomeError.message)
      if (definitive) {
        const { error: releaseError } = await admin.rpc('billing_fail_payout', {
          p_request: reserved.request_id,
          p_failure_code: 'stripe_transfer_rejected',
          p_failure_message: 'Stripe non ha accettato il trasferimento.',
        })
        if (releaseError) console.error('Payout compensation failed:', releaseError.message)
      }
      throw stripeError
    }

    const { error: providerSuccessError } = await admin.rpc('billing_finish_payout_provider_attempt', {
      p_attempt: providerAttempt.attempt_id,
      p_outcome: 'succeeded',
      p_stripe_transfer_id: transfer.id,
      p_error_code: null,
    })
    if (providerSuccessError) throw providerSuccessError

    // If this DB call fails, do not compensate a successful Stripe transfer.
    // A retry reuses the same Stripe idempotency key and completes this step.
    const { data: completed, error: completeError } = await admin.rpc('billing_complete_payout', {
      p_request: reserved.request_id,
      p_stripe_transfer_id: transfer.id,
    })
    if (completeError) throw completeError
    const result = completed as { status?: string } | null
    return jsonResponse({ requestId: reserved.request_id, status: result?.status ?? 'transferred' }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
