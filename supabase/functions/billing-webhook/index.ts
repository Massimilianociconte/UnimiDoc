// Direct Stripe webhook endpoint. It must be deployed with JWT verification
// disabled and registered directly at Supabase so the signed raw body is intact.

import { jsonResponse, errorResponse, AppError } from '../_shared/http.ts'
import { adminClient } from '../_shared/supabase.ts'
import {
  requireBillingRuntime,
  sha256Hex,
  stripeId,
  stripeRequest,
  unixSecondsToIso,
  verifyStripeWebhook,
} from '../_shared/billing.ts'

type JsonObject = Record<string, unknown>
type AdminClient = ReturnType<typeof adminClient>
type StripeWebhookEvent = Awaited<ReturnType<typeof verifyStripeWebhook>>

const objectValue = (value: unknown): JsonObject => value && typeof value === 'object' ? value as JsonObject : {}
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const numeric = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0

function subscriptionFromInvoice(invoice: JsonObject): string | null {
  const parent = objectValue(invoice.parent)
  const subscriptionDetails = objectValue(parent.subscription_details)
  const lines = objectValue(invoice.lines)
  const firstLine = objectValue(arrayValue(lines.data)[0])
  const lineParent = objectValue(firstLine.parent)
  const subscriptionItemDetails = objectValue(lineParent.subscription_item_details)
  return stripeId(invoice.subscription)
    ?? stripeId(subscriptionDetails.subscription)
    ?? stripeId(subscriptionItemDetails.subscription)
}

function paymentIntentFromInvoice(invoice: JsonObject): string | null {
  const payments = objectValue(invoice.payments)
  const firstPayment = objectValue(arrayValue(payments.data)[0])
  const payment = objectValue(firstPayment.payment)
  return stripeId(invoice.payment_intent)
    ?? stripeId(payment.payment_intent)
}

function subscriptionPeriod(subscription: JsonObject): { start: string | null; end: string | null } {
  const items = objectValue(subscription.items)
  const firstItem = objectValue(arrayValue(items.data)[0])
  return {
    start: unixSecondsToIso(subscription.current_period_start ?? firstItem.current_period_start),
    end: unixSecondsToIso(subscription.current_period_end ?? firstItem.current_period_end),
  }
}

async function syncSubscription(
  admin: AdminClient,
  subscription: JsonObject,
  livemode: boolean,
  eventCreated: string,
) {
  const subscriptionId = stripeId(subscription.id)
  const customerId = stripeId(subscription.customer)
  if (!subscriptionId || !customerId) throw new Error('Subscription identity missing')
  const items = objectValue(subscription.items)
  const firstItem = objectValue(arrayValue(items.data)[0])
  const price = objectValue(firstItem.price)
  const period = subscriptionPeriod(subscription)
  const { error } = await admin.rpc('billing_sync_subscription', {
    p_stripe_subscription_id: subscriptionId,
    p_livemode: livemode,
    p_stripe_customer_id: customerId,
    p_stripe_product_id: stripeId(price.product) ?? '',
    p_stripe_price_id: stripeId(price.id) ?? '',
    p_status: String(subscription.status ?? 'incomplete'),
    p_period_start: period.start,
    p_period_end: period.end,
    p_trial_end: unixSecondsToIso(subscription.trial_end),
    p_cancel_at_period_end: subscription.cancel_at_period_end === true,
    p_canceled_at: unixSecondsToIso(subscription.canceled_at),
    p_event_created_at: eventCreated,
  })
  if (error) throw error
}

async function dispatchEvent(
  admin: AdminClient,
  runtime: ReturnType<typeof requireBillingRuntime>,
  event: StripeWebhookEvent,
): Promise<'processed' | 'ignored'> {
  const object = objectValue(event.data.object)
  const livemode = event.livemode === true
  const eventCreated = unixSecondsToIso(event.created) ?? new Date().toISOString()

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const sessionId = stripeId(object.id)
    if (!sessionId) throw new Error('Checkout session ID missing')
    const mode = String(object.mode ?? '')
    const paid = object.payment_status === 'paid' || object.payment_status === 'no_payment_required'
    if (mode === 'payment' && paid) {
      const { error } = await admin.rpc('billing_apply_paid_checkout', {
        p_stripe_session_id: sessionId,
        p_livemode: livemode,
        p_stripe_customer_id: stripeId(object.customer) ?? '',
        p_stripe_payment_intent_id: stripeId(object.payment_intent) ?? '',
        p_stripe_charge_id: '',
        p_amount_minor: numeric(object.amount_total),
        p_currency: String(object.currency ?? '').toLowerCase(),
        p_paid_at: eventCreated,
      })
      if (error) throw error
    } else {
      const { error } = await admin.rpc('billing_mark_checkout_event', {
        p_stripe_session_id: sessionId,
        p_livemode: livemode,
        p_status: paid ? 'paid' : 'processing',
        p_stripe_customer_id: stripeId(object.customer) ?? '',
        p_stripe_payment_intent_id: stripeId(object.payment_intent) ?? '',
        p_stripe_subscription_id: stripeId(object.subscription) ?? '',
      })
      if (error) throw error
    }
    return 'processed'
  }

  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
    const sessionId = stripeId(object.id)
    if (!sessionId) throw new Error('Checkout session ID missing')
    const { error } = await admin.rpc('billing_mark_checkout_event', {
      p_stripe_session_id: sessionId,
      p_livemode: livemode,
      p_status: event.type.endsWith('expired') ? 'expired' : 'failed',
      p_stripe_customer_id: stripeId(object.customer) ?? '',
      p_stripe_payment_intent_id: stripeId(object.payment_intent) ?? '',
      p_stripe_subscription_id: stripeId(object.subscription) ?? '',
    })
    if (error) throw error
    return 'processed'
  }

  if (event.type.startsWith('customer.subscription.')) {
    await syncSubscription(admin, object, livemode, eventCreated)
    return 'processed'
  }

  if (event.type.startsWith('invoice.')) {
    const subscriptionId = subscriptionFromInvoice(object)
    if (!subscriptionId) return 'ignored'
    const subscription = await stripeRequest<JsonObject>(
      runtime,
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: 'GET' },
    )
    await syncSubscription(admin, subscription, livemode, eventCreated)

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoiceId = stripeId(object.id)
      if (!invoiceId) throw new Error('Invoice ID missing')
      const { error } = await admin.rpc('billing_record_invoice_payment', {
        p_stripe_subscription_id: subscriptionId,
        p_stripe_invoice_id: invoiceId,
        p_stripe_payment_intent_id: paymentIntentFromInvoice(object) ?? '',
        p_stripe_charge_id: stripeId(object.charge) ?? '',
        p_livemode: livemode,
        p_status: event.type === 'invoice.paid' ? 'succeeded' : 'failed',
        p_amount_minor: event.type === 'invoice.paid' ? numeric(object.amount_paid) : numeric(object.amount_due),
        p_currency: String(object.currency ?? '').toLowerCase(),
        p_paid_at: event.type === 'invoice.paid' ? eventCreated : null,
      })
      if (error) throw error
    }
    return 'processed'
  }

  if (event.type === 'refund.created' || event.type === 'refund.updated' || event.type === 'refund.failed') {
    const refundId = stripeId(object.id)
    if (!refundId) throw new Error('Refund ID missing')
    const rawStatus = String(object.status ?? (event.type === 'refund.failed' ? 'failed' : 'pending'))
    const status = rawStatus === 'requires_action' ? 'pending' : rawStatus
    const { error } = await admin.rpc('billing_apply_refund', {
      p_stripe_refund_id: refundId,
      p_livemode: livemode,
      p_stripe_payment_intent_id: stripeId(object.payment_intent) ?? '',
      p_stripe_charge_id: stripeId(object.charge) ?? '',
      p_status: status,
      p_amount_minor: numeric(object.amount),
      p_currency: String(object.currency ?? '').toLowerCase(),
      p_reason: String(object.reason ?? ''),
    })
    if (error) throw error
    return 'processed'
  }

  if (event.type.startsWith('charge.dispute.')) {
    const disputeId = stripeId(object.id)
    if (!disputeId) throw new Error('Dispute ID missing')
    const { error } = await admin.rpc('billing_apply_dispute', {
      p_stripe_dispute_id: disputeId,
      p_livemode: livemode,
      p_stripe_payment_intent_id: stripeId(object.payment_intent) ?? '',
      p_stripe_charge_id: stripeId(object.charge) ?? '',
      p_status: String(object.status ?? 'needs_response'),
      p_amount_minor: numeric(object.amount),
      p_currency: String(object.currency ?? '').toLowerCase(),
      p_reason: String(object.reason ?? ''),
    })
    if (error) throw error
    return 'processed'
  }

  return 'ignored'
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'method_not_allowed' } }, 405)

  let storedEventId: string | null = null
  try {
    const runtime = requireBillingRuntime('webhook')
    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > 2_000_000) throw new AppError(413, 'webhook_too_large', 'Payload webhook troppo grande.')
    const payload = await req.text()
    if (payload.length > 2_000_000) throw new AppError(413, 'webhook_too_large', 'Payload webhook troppo grande.')
    const event = await verifyStripeWebhook(runtime, payload, req.headers.get('stripe-signature') ?? '')
    if (event.livemode !== runtime.livemode) {
      throw new AppError(400, 'billing_mode_mismatch', 'Evento Stripe per ambiente errato.')
    }

    const parsedPayload: unknown = JSON.parse(payload)
    const object = objectValue(event.data.object)
    const admin = adminClient()
    const { data: stored, error: storeError } = await admin.rpc('billing_store_webhook', {
      p_provider_event_id: event.id,
      p_livemode: event.livemode,
      p_event_type: event.type,
      p_api_version: event.api_version ?? '',
      p_object_id: stripeId(object.id) ?? '',
      p_payload_sha256: await sha256Hex(payload),
      p_payload: parsedPayload,
    })
    if (storeError || !stored) throw storeError ?? new Error('Webhook persistence failed')
    storedEventId = String((stored as { id: string }).id)
    const existingStatus = String((stored as { status?: string }).status ?? '')
    if (existingStatus === 'processed' || existingStatus === 'ignored') {
      return jsonResponse({ received: true, duplicate: true }, 200)
    }

    const finalStatus = await dispatchEvent(admin, runtime, event)
    const { error: finishError } = await admin.rpc('billing_finish_webhook', {
      p_event: storedEventId,
      p_status: finalStatus,
      p_error: null,
    })
    if (finishError) throw finishError
    return jsonResponse({ received: true }, 200)
  } catch (error) {
    if (storedEventId) {
      try {
        const admin = adminClient()
        await admin.rpc('billing_finish_webhook', {
          p_event: storedEventId,
          p_status: 'failed',
          p_error: error instanceof Error ? error.message : 'processing_failed',
        })
      } catch (finishError) {
        console.error('Unable to persist webhook failure:', finishError)
      }
    }
    return errorResponse(error)
  }
})
