import { isSupabaseConfigured, supabase } from './supabaseClient'

// Client-side premium hint. This is ONLY used to decide whether to show a
// paywall or attempt an AI call — the authoritative entitlement check lives in
// the Edge Functions (they re-read the entitlement server-side, so a tampered
// client flag cannot unlock paid generations).
//
// With Supabase configured the hint is NOT user-togglable: refreshPremiumState()
// reads the caller's own `user_entitlements` row (owner-scoped RLS) and the
// manual setter is reserved for demo mode.

export type PremiumState = { isPremium: boolean }

const PREMIUM_KEY = 'unimidoc:premium'

export function getPremiumState(): PremiumState {
  if (typeof window === 'undefined') return { isPremium: false }
  try {
    return { isPremium: window.localStorage.getItem(PREMIUM_KEY) === '1' }
  } catch {
    return { isPremium: false }
  }
}

export function setPremiumState(isPremium: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PREMIUM_KEY, isPremium ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/**
 * Refresh the local hint from the real entitlement (plan=premium and not
 * expired). Returns the fresh value, or the current hint when Supabase is not
 * configured (demo) or the read fails (offline: keep last known state).
 */
export async function refreshPremiumState(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return getPremiumState().isPremium

  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user.id
    if (!userId) {
      setPremiumState(false)
      return false
    }

    const { data, error } = await supabase
      .from('user_entitlements')
      .select('plan, premium_until')
      .eq('owner_id', userId)
      .maybeSingle()
    if (error) return getPremiumState().isPremium

    const isPremium =
      data?.plan === 'premium' && (!data.premium_until || new Date(data.premium_until).getTime() > Date.now())
    setPremiumState(Boolean(isPremium))
    return Boolean(isPremium)
  } catch {
    return getPremiumState().isPremium
  }
}
