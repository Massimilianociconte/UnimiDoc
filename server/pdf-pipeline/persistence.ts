import type { SupabaseClient } from '@supabase/supabase-js'
import { ProcessingError } from './errors.js'
import type {
  AssetArtifact,
  BlockArtifact,
  ChunkArtifact,
  ClaimedPdfJob,
  OutlineArtifact,
  PageArtifact,
} from './types.js'

const BATCH_SIZE = 100

function persistenceError(operation: string, message: string): ProcessingError {
  return new ProcessingError({
    code: 'PERSISTENCE_FAILED',
    message: `${operation}: ${message}`,
    publicMessage: 'I risultati non sono stati salvati: il sistema riproverà automaticamente.',
    retryable: true,
    details: { operation },
  })
}

async function inBatches<T>(rows: T[], operation: (batch: T[]) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await operation(rows.slice(offset, offset + BATCH_SIZE))
  }
}

export class PdfArtifactStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async upsertPages(rows: PageArtifact[]): Promise<void> {
    await inBatches(rows, async (batch) => {
      const { error } = await this.supabase
        .from('pdf_pages')
        .upsert(batch, { onConflict: 'document_id,artifact_version,page_number' })
      if (error) throw persistenceError('upsert_pages', error.message)
    })
  }

  async getPages(job: ClaimedPdfJob): Promise<PageArtifact[]> {
    const { data, error } = await this.supabase
      .from('pdf_pages')
      .select('*')
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
      .order('page_number', { ascending: true })
    if (error) throw persistenceError('get_pages', error.message)
    return (data ?? []) as PageArtifact[]
  }

  async replaceBlocks(job: ClaimedPdfJob, rows: BlockArtifact[]): Promise<void> {
    const deleted = await this.supabase
      .from('document_blocks')
      .delete()
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
    if (deleted.error) throw persistenceError('clear_blocks', deleted.error.message)
    await inBatches(rows, async (batch) => {
      const { error } = await this.supabase.from('document_blocks').insert(batch)
      if (error) throw persistenceError('insert_blocks', error.message)
    })
  }

  async getBlocks(job: ClaimedPdfJob): Promise<BlockArtifact[]> {
    const { data, error } = await this.supabase
      .from('document_blocks')
      .select('*')
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
      .order('page_number', { ascending: true })
      .order('reading_order', { ascending: true })
    if (error) throw persistenceError('get_blocks', error.message)
    return (data ?? []) as BlockArtifact[]
  }

  async replaceChunks(job: ClaimedPdfJob, rows: ChunkArtifact[]): Promise<void> {
    const deleted = await this.supabase
      .from('pdf_chunks')
      .delete()
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
    if (deleted.error) throw persistenceError('clear_chunks', deleted.error.message)
    await inBatches(rows, async (batch) => {
      const { error } = await this.supabase.from('pdf_chunks').insert(batch)
      if (error) throw persistenceError('insert_chunks', error.message)
    })
  }

  async getChunks(job: ClaimedPdfJob): Promise<ChunkArtifact[]> {
    const { data, error } = await this.supabase
      .from('pdf_chunks')
      .select('*')
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
      .order('chunk_index', { ascending: true })
    if (error) throw persistenceError('get_chunks', error.message)
    return (data ?? []) as ChunkArtifact[]
  }

  async replaceAssets(job: ClaimedPdfJob, rows: AssetArtifact[]): Promise<void> {
    const deleted = await this.supabase
      .from('document_assets')
      .delete()
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
    if (deleted.error) throw persistenceError('clear_assets', deleted.error.message)
    await inBatches(rows, async (batch) => {
      const { error } = await this.supabase.from('document_assets').insert(batch)
      if (error) throw persistenceError('insert_assets', error.message)
    })
  }

  async getAssets(job: ClaimedPdfJob): Promise<AssetArtifact[]> {
    const { data, error } = await this.supabase
      .from('document_assets')
      .select('*')
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
      .order('page_number', { ascending: true })
    if (error) throw persistenceError('get_assets', error.message)
    return (data ?? []) as AssetArtifact[]
  }

  async replaceOutline(job: ClaimedPdfJob, rows: OutlineArtifact[]): Promise<void> {
    const deleted = await this.supabase
      .from('document_outline')
      .delete()
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
    if (deleted.error) throw persistenceError('clear_outline', deleted.error.message)
    await inBatches(rows, async (batch) => {
      const { error } = await this.supabase.from('document_outline').insert(batch)
      if (error) throw persistenceError('insert_outline', error.message)
    })
  }

  async getOutline(job: ClaimedPdfJob): Promise<OutlineArtifact[]> {
    const { data, error } = await this.supabase
      .from('document_outline')
      .select('*')
      .eq('processing_run_id', job.runId)
      .eq('artifact_version', job.artifactVersion)
      .order('ordinal', { ascending: true })
    if (error) throw persistenceError('get_outline', error.message)
    return (data ?? []) as OutlineArtifact[]
  }

  async upsertOcrRun(row: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.from('ocr_runs').upsert(row, { onConflict: 'job_id' })
    if (error) throw persistenceError('upsert_ocr_run', error.message)
  }

  /**
   * Replace free/full page preview rows used by document-access.
   * Unique on (document_id, page_number); delete-then-insert is intentional.
   */
  async replaceDocumentPreviews(
    documentId: string,
    rows: Array<{
      document_id: string
      owner_id: string
      page_number: number
      storage_bucket: string
      storage_path: string
      is_free_preview: boolean
      watermarked: boolean
    }>,
  ): Promise<void> {
    const deleted = await this.supabase.from('document_previews').delete().eq('document_id', documentId)
    if (deleted.error) throw persistenceError('clear_document_previews', deleted.error.message)
    if (rows.length === 0) return
    await inBatches(rows, async (batch) => {
      const { error } = await this.supabase.from('document_previews').insert(batch)
      if (error) throw persistenceError('insert_document_previews', error.message)
    })
  }
}
