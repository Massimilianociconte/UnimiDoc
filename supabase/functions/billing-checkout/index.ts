// Authenticated Stripe-hosted Checkout. Offer, amount, Price ID and redirect
// origins are server authoritative; requestId drives end-to-end idempotency.

import { preflight, jsonResponse, errorResponse, errors, AppError, parseJsonBody } from '../_shared/http.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'
import { billingReturnUrl, requireBillingRuntime, stripeRequest, unixSecondsToIso } from '../_shared/billing.ts'
import { createRequestLogger } from '../_shared/log.ts'

type PreparedCheckout = {
  checkout_request_id: string
  status: string
  kind?: 'topup' | 'subscription'
  offer_key?: string
  stripe_price_id?: string
  stripe_product_id?: string | null
  stripe_customer_id?: string | null
  stripe_checkout_url?: string | null
  expires_at?: string | null
}

type StripeCustomer = { id: string }
type StripeCheckoutSession = { id: string; url: string | null; expires_at: number }

const REQUEST_RE = /^[a-zA-Z0-9:_-]{16,160}$/
const OFFER_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/

;(globalThis as any).Deno.serve(async (req: Request) => {
  const logger = createRequestLogger(req)
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'method_not_allowed' } }, 405, req)

  logger.info('billing_checkout_start')

  try {
    const runtime = requireBillingRuntime('checkout')
    const { id: userId } = await requireUser(req)
    const body = await parseJsonBody(req)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')

    const offerKey = String(body.offerKey ?? '').trim()
    const requestId = String(body.requestId ?? '').trim()
    const acceptedTermsVersion = String(body.acceptedTermsVersion ?? '').trim()
    const acceptedSalesVersion = String(body.acceptedSalesVersion ?? '').trim()
    if (!OFFER_RE.test(offerKey)) throw errors.badRequest('Offerta non valida.')
    if (!REQUEST_RE.test(requestId)) throw errors.badRequest('requestId non valido.')
    if (acceptedTermsVersion !== runtime.termsVersion || acceptedSalesVersion !== runtime.salesTermsVersion) {
      throw new AppError(409, 'billing_terms_outdated', 'Aggiorna e accetta le condizioni di vendita correnti.')
    }

    const admin = adminClient()
    const { data: preparedData, error: prepareError } = await admin.rpc('billing_prepare_checkout', {
      p_owner: userId,
      p_offer_key: offerKey,
      p_request_key: requestId,
      p_livemode: runtime.livemode,
      p_terms_version: acceptedTermsVersion,
      p_privacy_version: runtime.privacyVersion,
      p_sales_version: acceptedSalesVersion,
    })
    if (prepareError || !preparedData) throw prepareError ?? new Error('Checkout reservation failed')
    const prepared = preparedData as PreparedCheckout

    if (prepared.stripe_checkout_url && prepared.status === 'open') {
      const expiresAt = prepared.expires_at ? new Date(prepared.expires_at).getTime() : 0
      if (expiresAt > Date.now() + 15_000) {
        return jsonResponse({ url: prepared.stripe_checkout_url, checkoutRequestId: prepared.checkout_request_id }, 200, req)
      }
      throw new AppError(409, 'billing_checkout_expired', 'Sessione scaduta: avvia un nuovo checkout.')
    }
    if (!prepared.kind || !prepared.stripe_price_id || !prepared.offer_key) {
      throw new AppError(503, 'billing_offer_unavailable', 'Offerta temporaneamente non disponibile.')
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId)
    if (userError || !userData.user?.email) throw new AppError(409, 'billing_email_required', 'Email account non disponibile.')

    let customerId = prepared.stripe_customer_id ?? null
    if (!customerId) {
      const customer = await stripeRequest<StripeCustomer>(runtime, '/v1/customers', {
        form: {
          email: userData.user.email,
          metadata: { unimidoc_user_id: userId },
        },
        idempotencyKey: `unimidoc-customer-${runtime.mode}-${userId}`,
      })
      customerId = customer.id
    }

    const successBase = billingReturnUrl(runtime, '/premium', { billing: 'success' })
    const successUrl = `${successBase}&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = billingReturnUrl(runtime, '/premium', { billing: 'cancelled' })
    const metadata = {
      unimidoc_user_id: userId,
      unimidoc_checkout_request_id: prepared.checkout_request_id,
      unimidoc_offer_key: prepared.offer_key,
    }
    const session = await stripeRequest<StripeCheckoutSession>(runtime, '/v1/checkout/sessions', {
      form: {
        mode: prepared.kind === 'subscription' ? 'subscription' : 'payment',
        customer: customerId,
        client_reference_id: userId,
        locale: 'it',
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{ price: prepared.stripe_price_id, quantity: 1 }],
        automatic_tax: { enabled: false },
        metadata,
        ...(prepared.kind === 'subscription'
          ? { subscription_data: { metadata } }
          : { payment_intent_data: { metadata } }),
      },
      idempotencyKey: `unimidoc-checkout-${prepared.checkout_request_id}`,
    })
    if (!session.url) throw new AppError(502, 'stripe_checkout_url_missing', 'Stripe non ha restituito il checkout.')

    const { error: attachError } = await admin.rpc('billing_attach_checkout', {
      p_owner: userId,
      p_checkout_request: prepared.checkout_request_id,
      p_stripe_customer_id: customerId,
      p_email_snapshot: userData.user.email,
      p_stripe_session_id: session.id,
      p_stripe_session_url: session.url,
      p_expires_at: unixSecondsToIso(session.expires_at),
      p_livemode: runtime.livemode,
    })
    if (attachError) throw attachError

    return jsonResponse({ url: session.url, checkoutRequestId: prepared.checkout_request_id }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
