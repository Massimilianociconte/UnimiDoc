// Authenticated, ownership-scoped projection for checkout, subscription, wallet,
// Connect and the latest payout. It remains available during Stripe outages.

import { preflight, jsonResponse, errorResponse, errors, parseJsonBody } from '../_shared/http.ts'
import { adminClient, requireUser, type AdminClient } from '../_shared/supabase.ts'
import { createRequestLogger } from '../_shared/log.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CheckoutStatus = {
  id: string
  status: string
  kind: string
  expected_amount_minor: number
  currency: string
  paid_credits: number
  promotional_credits: number
  stripe_checkout_session_id: string | null
  expires_at: string | null
  fulfilled_at: string | null
  created_at: string
}

type SubscriptionStatus = {
  status: string
  current_period_start: string | null
  current_period_end: string | null
  trial_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  stripe_product_id: string | null
  stripe_price_id: string | null
}

type ConnectedAccountStatus = {
  status: string
  transfersStatus: string
  payoutsStatus: string
  detailsSubmitted: boolean
  termsCurrent: boolean
}

type BillingStatus = {
  checkout?: CheckoutStatus | null
  subscription?: SubscriptionStatus | null
  wallet?: unknown
  connectedAccount?: ConnectedAccountStatus | null
  payout?: unknown
}

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'method_not_allowed' } }, 405, req)

  logger.info('billing_status_start')

  try {
    const { id: userId } = await requireUser(req)
    const body = await parseJsonBody(req) ?? {}
    const checkoutRequestId = String(body?.checkoutRequestId ?? '').trim()
    if (checkoutRequestId && !UUID_RE.test(checkoutRequestId)) throw errors.badRequest('checkoutRequestId non valido.')

    const admin: AdminClient = adminClient()
    const { data, error } = await admin.rpc('billing_get_status', {
      p_owner: userId,
      p_checkout_request: checkoutRequestId || null,
    })
    if (error) throw error
    const status = (data ?? {}) as BillingStatus
    const checkout = status.checkout
      ? {
          id: status.checkout.id,
          status: status.checkout.status,
          kind: status.checkout.kind,
          expectedAmountMinor: status.checkout.expected_amount_minor,
          currency: status.checkout.currency,
          paidCredits: status.checkout.paid_credits,
          promotionalCredits: status.checkout.promotional_credits,
          stripeSessionId: status.checkout.stripe_checkout_session_id,
          expiresAt: status.checkout.expires_at,
          fulfilledAt: status.checkout.fulfilled_at,
          createdAt: status.checkout.created_at,
        }
      : null
    const subscription = status.subscription
      ? {
          status: status.subscription.status,
          currentPeriodStart: status.subscription.current_period_start,
          currentPeriodEnd: status.subscription.current_period_end,
          trialEnd: status.subscription.trial_end,
          cancelAtPeriodEnd: status.subscription.cancel_at_period_end,
          canceledAt: status.subscription.canceled_at,
          productId: status.subscription.stripe_product_id,
          priceId: status.subscription.stripe_price_id,
        }
      : null

    const connectedAccount = status.connectedAccount
      ? {
          status: status.connectedAccount.status,
          transfersStatus: status.connectedAccount.transfersStatus,
          payoutsStatus: status.connectedAccount.payoutsStatus,
          payoutsEnabled: status.connectedAccount.payoutsStatus === 'active'
            && status.connectedAccount.transfersStatus === 'active'
            && status.connectedAccount.termsCurrent === true,
          detailsSubmitted: status.connectedAccount.detailsSubmitted === true,
          termsCurrent: status.connectedAccount.termsCurrent === true,
        }
      : null

    return jsonResponse({
      checkout,
      subscription,
      wallet: status.wallet ?? null,
      connectedAccount,
      payout: status.payout ?? null,
    }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
