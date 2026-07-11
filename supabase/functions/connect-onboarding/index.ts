// Stripe Accounts v2 recipient onboarding. UnimiDoc remains merchant of record
// for top-ups; sellers receive later transfers through the recipient capability.

import { preflight, jsonResponse, errorResponse, errors } from '../_shared/http.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'
import { billingReturnUrl, requireBillingRuntime, stripeRequest } from '../_shared/billing.ts'

type ConnectContext = {
  connected_account_id: string
  stripe_account_id: string | null
  status: string
  email: string
  display_name: string
}

type StripeAccountV2 = {
  id: string
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: { status?: string }
          payouts?: { status?: string }
        }
      }
    }
  }
  requirements?: { entries?: unknown[] } | null
}

type StripeAccountLinkV2 = { url: string }

function capabilityStatus(value: unknown): 'pending' | 'active' | 'restricted' | 'unsupported' {
  return value === 'active' || value === 'restricted' || value === 'unsupported' ? value : 'pending'
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'method_not_allowed' } }, 405, req)

  try {
    const runtime = requireBillingRuntime('connect')
    const { id: userId } = await requireUser(req)
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw errors.badRequest('Body JSON mancante.')
    const acceptedConnectTermsVersion = String(body.acceptedConnectTermsVersion ?? '').trim()
    if (acceptedConnectTermsVersion !== runtime.connectTermsVersion) {
      throw errors.badRequest('Accetta le condizioni venditore correnti.')
    }

    const admin = adminClient()
    const { data, error } = await admin.rpc('billing_prepare_connect', {
      p_owner: userId,
      p_livemode: runtime.livemode,
      p_connect_terms_version: acceptedConnectTermsVersion,
    })
    if (error || !data) throw error ?? new Error('Connect reservation failed')
    const context = data as ConnectContext

    let account: StripeAccountV2
    if (context.stripe_account_id) {
      account = await stripeRequest<StripeAccountV2>(
        runtime,
        `/v2/core/accounts/${encodeURIComponent(context.stripe_account_id)}?include[0]=configuration.recipient&include[1]=requirements`,
        { method: 'GET', apiVersion: runtime.accountsV2Version },
      )
    } else {
      account = await stripeRequest<StripeAccountV2>(runtime, '/v2/core/accounts', {
        json: {
          contact_email: context.email,
          display_name: context.display_name,
          // Stripe-hosted Express dashboard keeps KYC/account management with
          // Stripe while the platform owns fees/losses for indirect transfers.
          dashboard: 'express',
          defaults: {
            currency: 'eur',
            locales: ['it-IT'],
            responsibilities: {
              fees_collector: 'application',
              losses_collector: 'application',
            },
          },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: {
                  stripe_transfers: { requested: true },
                },
              },
            },
          },
          metadata: { unimidoc_user_id: userId },
          include: ['configuration.recipient', 'requirements'],
        },
        idempotencyKey: `unimidoc-connect-${runtime.mode}-${context.connected_account_id}`,
        apiVersion: runtime.accountsV2Version,
      })
    }

    const transfersStatus = capabilityStatus(
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status,
    )
    const payoutsStatus = capabilityStatus(
      account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status,
    )
    const outstanding = Array.isArray(account.requirements?.entries) ? account.requirements!.entries!.length : 0
    const status = transfersStatus === 'active' && outstanding === 0
      ? 'active'
      : transfersStatus === 'restricted' || transfersStatus === 'unsupported'
        ? 'restricted'
        : 'onboarding'

    const { error: attachError } = await admin.rpc('billing_attach_connected_account', {
      p_owner: userId,
      p_livemode: runtime.livemode,
      p_stripe_account_id: account.id,
      p_status: status,
      p_transfers_status: transfersStatus,
      p_payouts_status: payoutsStatus,
      p_details_submitted: outstanding === 0,
      p_requirements: account.requirements ?? {},
    })
    if (attachError) throw attachError

    const useCaseType = status === 'onboarding' ? 'account_onboarding' : 'account_update'
    const flow = {
      configurations: ['recipient'],
      collection_options: { fields: 'eventually_due', future_requirements: 'include' },
      refresh_url: billingReturnUrl(runtime, '/settings', { connect: 'refresh' }),
      return_url: billingReturnUrl(runtime, '/settings', { connect: 'return' }),
    }
    const link = await stripeRequest<StripeAccountLinkV2>(runtime, '/v2/core/account_links', {
      json: {
        account: account.id,
        use_case: {
          type: useCaseType,
          [useCaseType]: flow,
        },
      },
      apiVersion: runtime.accountsV2Version,
    })

    return jsonResponse({ url: link.url, status }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
