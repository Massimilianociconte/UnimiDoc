// Creates a short-lived Stripe Customer Portal session. Customer identity and
// return URL are resolved server-side; the browser supplies no Stripe IDs.

import { preflight, jsonResponse, errorResponse } from '../_shared/http.ts'
import { adminClient, requireUser } from '../_shared/supabase.ts'
import { billingReturnUrl, requireBillingRuntime, stripeRequest } from '../_shared/billing.ts'

type PortalContext = { stripe_customer_id: string }
type PortalSession = { url: string }

// deno-lint-ignore no-explicit-any
;(globalThis as any).Deno.serve(async (req: Request) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'method_not_allowed' } }, 405, req)

  try {
    const runtime = requireBillingRuntime('portal')
    const { id: userId } = await requireUser(req)
    const admin = adminClient()
    const { data, error } = await admin.rpc('billing_portal_context', {
      p_owner: userId,
      p_livemode: runtime.livemode,
    })
    if (error || !data) throw error ?? new Error('Portal context unavailable')
    const context = data as PortalContext
    const portal = await stripeRequest<PortalSession>(runtime, '/v1/billing_portal/sessions', {
      form: {
        customer: context.stripe_customer_id,
        return_url: billingReturnUrl(runtime, '/premium', { billing: 'portal_return' }),
      },
    })
    return jsonResponse({ url: portal.url }, 200, req)
  } catch (error) {
    return errorResponse(error, req)
  }
})
