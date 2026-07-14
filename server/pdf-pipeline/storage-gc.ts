import type { SupabaseClient } from '@supabase/supabase-js'

export type StorageGcResult = { scanned: number; removed: number; failed: number; skipped: number }

type QueueRow = { id: string; bucket: string; path: string; attempts: number }

export type StorageGcOptions = {
  /** Max queue rows drained per invocation (default 200). */
  batchSize?: number
  /** Give up on a row after this many failed removals (default 6). */
  maxAttempts?: number
  /** Count what would be removed without touching Storage. */
  dryRun?: boolean
  onLog?: (event: string, detail: Record<string, unknown>) => void
}

/**
 * Drains `public.storage_cleanup_queue`: removes the orphaned Storage objects
 * left behind when a `documents` row is hard-deleted (the BEFORE DELETE trigger
 * enqueues the original PDF and derived previews), then marks each entry
 * processed. Object removal is idempotent — a missing key is treated as done.
 *
 * The queue is RLS-locked (service-role only), so `supabase` MUST be a
 * service-role client. Safe to call repeatedly; each row is processed at most
 * `maxAttempts` times before being left for manual inspection (its `last_error`
 * is recorded). Used by the `gc:storage` CLI script; in production the scheduled
 * `storage-gc` Edge Function is the primary drainer.
 */
export async function drainStorageCleanupQueue(
  supabase: SupabaseClient,
  options: StorageGcOptions = {},
): Promise<StorageGcResult> {
  const batchSize = options.batchSize ?? 200
  const maxAttempts = options.maxAttempts ?? 6
  const dryRun = options.dryRun === true
  const log = options.onLog ?? (() => {})

  const { data, error } = await supabase
    .from('storage_cleanup_queue')
    .select('id, bucket, path, attempts')
    .is('processed_at', null)
    .lt('attempts', maxAttempts)
    .order('enqueued_at', { ascending: true })
    .limit(batchSize)
  if (error) throw new Error(`Cannot read storage_cleanup_queue: ${error.message}`)

  const rows = (data ?? []) as QueueRow[]
  const result: StorageGcResult = { scanned: rows.length, removed: 0, failed: 0, skipped: 0 }
  if (rows.length === 0) return result

  for (const row of rows) {
    if (dryRun) {
      result.skipped += 1
      continue
    }
    const { error: removeError } = await supabase.storage.from(row.bucket).remove([row.path])
    if (removeError) {
      result.failed += 1
      await supabase
        .from('storage_cleanup_queue')
        .update({ attempts: row.attempts + 1, last_error: removeError.message.slice(0, 500) })
        .eq('id', row.id)
      log('storage_gc_remove_failed', { id: row.id, bucket: row.bucket, error: removeError.message })
    } else {
      result.removed += 1
      await supabase
        .from('storage_cleanup_queue')
        .update({ processed_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id)
    }
  }
  return result
}
