import { createClient, type Session, type User } from '@supabase/supabase-js'

export type AppAuthUser = {
  id: string
  email: string
  name: string
  avatarUrl?: string
  isDemo: boolean
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

function profileNameFromUser(user: User) {
  const metadata = user.user_metadata ?? {}
  const name =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : user.email?.split('@')[0]

  return name || 'Studente UnimiDoc'
}

function avatarFromUser(user: User) {
  const metadata = user.user_metadata ?? {}
  return typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined
}

export function authUserFromSession(session: Session | null): AppAuthUser | null {
  if (!session?.user?.email) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: profileNameFromUser(session.user),
    avatarUrl: avatarFromUser(session.user),
    isDemo: false,
  }
}

export async function getSupabaseSessionUser() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return authUserFromSession(data.session)
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function getUserCreditBalance(): Promise<number | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user?.id
  if (!uid) return null
  const { data: account } = await supabase
    .from('user_credit_accounts')
    .select('balance')
    .eq('owner_id', uid)
    .maybeSingle()
  return (account as { balance: number } | null)?.balance ?? null
}

export function subscribeSupabaseAuth(onUser: (user: AppAuthUser | null) => void) {
  if (!supabase) return () => undefined

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onUser(authUserFromSession(session))
  })

  return () => data.subscription.unsubscribe()
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return authUserFromSession(data.session)
}

export type SignUpResult =
  | { status: 'active'; user: AppAuthUser }
  | { status: 'confirm'; email: string }

export async function signUpWithEmail(email: string, password: string, fullName: string): Promise<SignUpResult> {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  })
  if (error) throw error

  // A session is only returned when email confirmation is disabled. Otherwise the
  // account exists but is unverified — the caller must ask the user to confirm.
  if (data.session) {
    const user = authUserFromSession(data.session)
    if (user) return { status: 'active', user }
  }

  return { status: 'confirm', email }
}

export async function requestPasswordReset(email: string) {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const redirectTo = `${window.location.origin}/login`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw error
}

export async function signInWithGoogle(redirectPath = '/dashboard') {
  if (!supabase) {
    throw new Error('Supabase non configurato')
  }

  const redirectTo = `${window.location.origin}${redirectPath}`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) throw error
}

export async function signOutSupabase() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
