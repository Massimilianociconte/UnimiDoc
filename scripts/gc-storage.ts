import { createClient } from '@supabase/supabase-js'
import { drainStorageCleanupQueue } from '../server/pdf-pipeline/storage-gc.ts'

// Drains public.storage_cleanup_queue: deletes the orphaned Storage objects left
// behind by hard-deleted documents. Dry-run by default; pass --apply to remove.
// Intended for manual/cron runs; the PDF worker also drains this queue on a loop.

const url = process.env.SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')

const apply = process.argv.includes('--apply')
const batchSize = Number(process.env.STORAGE_GC_BATCH_SIZE) || 500

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const result = await drainStorageCleanupQueue(supabase, {
  batchSize,
  dryRun: !apply,
  onLog: (event, detail) => console.error(JSON.stringify({ event, ...detail })),
})

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }, null, 2))
if (!apply) console.log('Dry-run only. Re-run with --apply to delete the orphaned objects.')
