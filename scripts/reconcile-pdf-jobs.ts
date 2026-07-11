import { createClient } from '@supabase/supabase-js'

type LegacyJob = {
  id: string
  document_id: string
  owner_id: string
  input_hash: string | null
  status: string
}

type DocumentRow = {
  id: string
  owner_id: string
  original_file_sha256: string
  page_count: number | null
  language: string | null
  storage_bucket: string
  metadata: Record<string, unknown> | null
}

const url = process.env.SUPABASE_URL?.trim()
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')

const apply = process.argv.includes('--apply')
const pipelineVersion = process.env.PDF_PIPELINE_VERSION?.trim() || 'pdf-worker-v1'
const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function loadLegacyJobs(): Promise<LegacyJob[]> {
  const rows: LegacyJob[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('pdf_processing_jobs')
      .select('id, document_id, owner_id, input_hash, status')
      .is('run_id', null)
      .in('status', ['queued', 'running', 'failed', 'cancelled'])
      .range(offset, offset + 499)
    if (error) throw new Error(`Cannot read legacy jobs: ${error.message}`)
    rows.push(...(data ?? []) as LegacyJob[])
    if ((data?.length ?? 0) < 500) break
  }
  return rows
}

async function loadDocuments(ids: string[]): Promise<DocumentRow[]> {
  const rows: DocumentRow[] = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from('documents')
      .select('id, owner_id, original_file_sha256, page_count, language, storage_bucket, metadata')
      .in('id', ids.slice(offset, offset + 100))
    if (error) throw new Error(`Cannot read documents: ${error.message}`)
    rows.push(...(data ?? []) as DocumentRow[])
  }
  return rows
}

const legacyJobs = await loadLegacyJobs()
const documentIds = [...new Set(legacyJobs.map((job) => job.document_id))]
const documents = await loadDocuments(documentIds)
const jobsByDocument = new Map<string, LegacyJob[]>()
for (const job of legacyJobs) {
  const list = jobsByDocument.get(job.document_id) ?? []
  list.push(job)
  jobsByDocument.set(job.document_id, list)
}

const eligible = documents.filter((document) => {
  const state = String(document.metadata?.upload_state ?? '')
  return state === 'verified_submitted'
    || (document.storage_bucket === 'processing-temp' && state === 'verification_queued')
})

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  pipelineVersion,
  legacyJobs: legacyJobs.length,
  legacyDocuments: documentIds.length,
  eligibleDocuments: eligible.length,
  skippedDocuments: documentIds.length - eligible.length,
}, null, 2))

if (!apply) {
  console.log('Dry-run only. Re-run with --apply after reviewing these counts.')
  process.exit(0)
}

let enqueued = 0
let cancelledLegacyJobs = 0
for (const document of eligible) {
  const { data, error } = await supabase.rpc('enqueue_pdf_processing_run', {
    p_document: document.id,
    p_owner: document.owner_id,
    p_input_hash: document.original_file_sha256.toLowerCase(),
    p_pipeline_version: pipelineVersion,
    p_requested_tier: 'base',
    p_page_count: document.page_count,
    p_language: document.language,
  })
  if (error) throw new Error(`Cannot enqueue ${document.id}: ${error.message}`)
  const run = Array.isArray(data) ? data[0] : data
  if (!run?.run_id) throw new Error(`No run returned for ${document.id}`)
  enqueued += 1

  const ids = (jobsByDocument.get(document.id) ?? []).map((job) => job.id)
  if (ids.length > 0) {
    const updated = await supabase
      .from('pdf_processing_jobs')
      .update({
        status: 'cancelled',
        error_code: 'superseded_by_pdf_worker_v1',
        error_message: 'Job legacy sostituito dalla pipeline documentale versionata.',
        finished_at: new Date().toISOString(),
      })
      .in('id', ids)
      .is('run_id', null)
      .select('id')
    if (updated.error) throw new Error(`Cannot cancel legacy jobs for ${document.id}: ${updated.error.message}`)
    cancelledLegacyJobs += updated.data?.length ?? 0
  }
}

console.log(JSON.stringify({ mode: 'applied', enqueued, cancelledLegacyJobs }, null, 2))
