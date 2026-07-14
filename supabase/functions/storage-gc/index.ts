// Scheduled Storage garbage collector.
//
// Drains public.storage_cleanup_queue: deletes the orphaned Storage objects left
// behind when a document is hard-deleted (the BEFORE DELETE trigger enqueues the
// original PDF + derived previews), then marks each entry processed. Object
// removal is idempotent — a missing key is treated as done.
//
// Deployed with verify_jwt=false because it performs its OWN authentication: the
// caller must present the project's service-role key as a Bearer token. Only
// pg_cron (reading that key from Vault) can trigger it — it is NOT a public
// endpoint. It never accepts caller-controlled input; it only processes the
// internal queue with the service-role key Supabase injects into its env.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BATCH_SIZE = Number(Deno.env.get('STORAGE_GC_BATCH_SIZE')) || 200
const MAX_ATTEMPTS = Number(Deno.env.get('STORAGE_GC_MAX_ATTEMPTS')) || 6

/** Constant-time string comparison to avoid leaking the token via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type QueueRow = { id: number; bucket: string; path: string; attempts: number }

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Authenticate: only holders of the service-role key (i.e. the scheduled cron)
  // may run the collector.
  const authorization = req.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!SERVICE_ROLE_KEY || !timingSafeEqual(token, SERVICE_ROLE_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data, error } = await admin
    .from('storage_cleanup_queue')
    .select('id, bucket, path, attempts')
    .is('processed_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('enqueued_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = (data ?? []) as QueueRow[]
  let removed = 0
  let failed = 0
  for (const row of rows) {
    const { error: removeError } = await admin.storage.from(row.bucket).remove([row.path])
    if (removeError) {
      failed += 1
      await admin.from('storage_cleanup_queue')
        .update({ attempts: row.attempts + 1, last_error: removeError.message.slice(0, 500) })
        .eq('id', row.id)
    } else {
      removed += 1
      await admin.from('storage_cleanup_queue')
        .update({ processed_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id)
    }
  }

  return new Response(JSON.stringify({ scanned: rows.length, removed, failed }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
