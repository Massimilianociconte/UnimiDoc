import { supabase, type AppAuthUser } from './supabaseClient'

// ============================================================================
// Granular, per-category notification preferences.
// Each event category can be toggled independently across three delivery
// channels: in-app, email, and push (push is reserved for a future release).
// Persisted per user in localStorage immediately, and mirrored to the
// `notification_preferences` table (owner-scoped) when the account is real.
// ============================================================================

export type NotificationChannel = 'inApp' | 'email' | 'push'

export type NotificationChannelState = Record<NotificationChannel, boolean>

export type NotificationPrefs = Record<string, NotificationChannelState>

export type NotificationCategory = {
  id: string
  label: string
  description: string
  group: string
  /** Channels enabled by default at first run. */
  defaults: NotificationChannelState
}

export const NOTIFICATION_CHANNELS: { id: NotificationChannel; label: string; hint?: string }[] = [
  { id: 'inApp', label: 'In-app' },
  { id: 'email', label: 'Email' },
  { id: 'push', label: 'Push', hint: 'In arrivo' },
]

const on = (inApp: boolean, email: boolean, push = false): NotificationChannelState => ({ inApp, email, push })

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    id: 'author_new_doc',
    label: 'Nuova dispensa da un autore seguito',
    description: 'Quando un autore che segui pubblica un nuovo materiale.',
    group: 'Contenuti e autori',
    defaults: on(true, false),
  },
  {
    id: 'wishlist_price_drop',
    label: 'Cambio prezzo in wishlist',
    description: 'Quando una dispensa nella tua wishlist cambia prezzo.',
    group: 'Contenuti e autori',
    defaults: on(true, true),
  },
  {
    id: 'purchased_updated',
    label: 'Dispensa acquistata aggiornata',
    description: 'Quando una dispensa che hai acquistato viene aggiornata.',
    group: 'Contenuti e autori',
    defaults: on(true, true),
  },
  {
    id: 'similar_published',
    label: 'Dispensa simile alle tue ricerche',
    description: 'Quando esce materiale simile a ciò che hai cercato di recente.',
    group: 'Contenuti e autori',
    defaults: on(true, false),
  },
  {
    id: 'doc_reviewed',
    label: 'Recensione su un tuo documento',
    description: 'Quando un tuo documento riceve una recensione.',
    group: 'Le mie dispense',
    defaults: on(true, true),
  },
  {
    id: 'doc_purchased',
    label: 'Un tuo documento è stato acquistato',
    description: 'Quando qualcuno sblocca una tua dispensa.',
    group: 'Le mie dispense',
    defaults: on(true, true),
  },
  {
    id: 'doc_moderation',
    label: 'Esito revisione documento',
    description: 'Quando un tuo upload viene approvato, rifiutato o richiede modifiche.',
    group: 'Le mie dispense',
    defaults: on(true, true),
  },
  {
    id: 'credits_received',
    label: 'Nuovi crediti ricevuti',
    description: 'Quando ricevi crediti da vendite, bonus o rimborsi.',
    group: 'Crediti e offerte',
    defaults: on(true, false),
  },
  {
    id: 'credits_low',
    label: 'Crediti in esaurimento',
    description: 'Quando il saldo crediti sta per terminare.',
    group: 'Crediti e offerte',
    defaults: on(true, true),
  },
  {
    id: 'promotions',
    label: 'Promozioni e bonus',
    description: 'Offerte, promozioni e bonus disponibili per te.',
    group: 'Crediti e offerte',
    defaults: on(true, false),
  },
  {
    id: 'account_updates',
    label: 'Aggiornamenti dell’account',
    description: 'Comunicazioni importanti su sicurezza e stato dell’account.',
    group: 'Account',
    defaults: on(true, true),
  },
]

export const NOTIFICATION_GROUPS = Array.from(new Set(NOTIFICATION_CATEGORIES.map((category) => category.group)))

export function defaultNotificationPrefs(): NotificationPrefs {
  const prefs: NotificationPrefs = {}
  for (const category of NOTIFICATION_CATEGORIES) {
    prefs[category.id] = { ...category.defaults }
  }
  return prefs
}

/** Fill any missing categories/channels so the UI always has a complete map. */
function normalizePrefs(partial: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  const base = defaultNotificationPrefs()
  if (!partial) return base
  for (const category of NOTIFICATION_CATEGORIES) {
    const stored = partial[category.id]
    if (stored) {
      base[category.id] = {
        inApp: typeof stored.inApp === 'boolean' ? stored.inApp : base[category.id].inApp,
        email: typeof stored.email === 'boolean' ? stored.email : base[category.id].email,
        push: typeof stored.push === 'boolean' ? stored.push : base[category.id].push,
      }
    }
  }
  return base
}

function storageKey(user: AppAuthUser): string {
  return `unimidoc:notif-prefs:v1:${user.id}`
}

function readLocal(user: AppAuthUser): NotificationPrefs | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(user))
    return raw ? normalizePrefs(JSON.parse(raw) as Partial<NotificationPrefs>) : null
  } catch {
    return null
  }
}

function writeLocal(user: AppAuthUser, prefs: NotificationPrefs): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(storageKey(user), JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

export async function loadNotificationPrefs(user: AppAuthUser): Promise<NotificationPrefs> {
  const local = readLocal(user)

  if (supabase && !user.isDemo) {
    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('prefs')
        .eq('owner_id', user.id)
        .maybeSingle()
      if (error) throw error
      const remote = (data as { prefs: Partial<NotificationPrefs> } | null)?.prefs
      if (remote) {
        const normalized = normalizePrefs(remote)
        writeLocal(user, normalized)
        return normalized
      }
    } catch {
      // fall back to local / defaults
    }
  }

  return local ?? defaultNotificationPrefs()
}

export type NotificationPrefsSaveResult = {
  localSaved: boolean
  remoteSynced: boolean
  message?: string
}

export async function saveNotificationPrefs(user: AppAuthUser, prefs: NotificationPrefs): Promise<NotificationPrefsSaveResult> {
  const localSaved = writeLocal(user, prefs)

  if (supabase && !user.isDemo) {
    try {
      const { error } = await supabase.from('notification_preferences').upsert(
        { owner_id: user.id, prefs, updated_at: new Date().toISOString() },
        { onConflict: 'owner_id' },
      )
      if (error) throw error
      return { localSaved, remoteSynced: true }
    } catch (error) {
      return {
        localSaved,
        remoteSynced: false,
        message: error instanceof Error ? error.message : 'Sincronizzazione remota non riuscita',
      }
    }
  }

  return { localSaved, remoteSynced: user.isDemo }
}
