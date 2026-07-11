import type { SupabaseClient } from '@supabase/supabase-js'
import { ProcessingError } from './errors.js'
import { parseClaimedPdfJob, type ClaimedPdfJob, type PdfJobType } from './types.js'

type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null }

function databaseError(operation: string, error: { message: string; code?: string } | null): ProcessingError {
  return new ProcessingError({
    code: `DB_${operation.toUpperCase()}_FAILED`,
    message: `${operation}: ${error?.message ?? 'unknown database error'}`,
    publicMessage: 'Stato di elaborazione temporaneamente non aggiornabile.',
    retryable: true,
    details: { databaseCode: error?.code ?? null },
  })
}

export class PdfJobQueue {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
    private readonly pipelineVersion: string,
  ) {}

  async claim(allowedJobTypes?: PdfJobType[]): Promise<ClaimedPdfJob | null> {
    const { data, error } = await this.supabase.rpc('claim_pdf_processing_job_versioned', {
      p_worker_id: this.workerId,
      p_lease_seconds: this.leaseSeconds,
      p_allowed_job_types: allowedJobTypes?.length ? allowedJobTypes : null,
      p_pipeline_version: this.pipelineVersion,
    }) as RpcResult<unknown>
    if (error) throw databaseError('claim', error)
    if (data == null) return null
    return parseClaimedPdfJob(data)
  }

  async heartbeat(job: ClaimedPdfJob, progress: number, stage: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('heartbeat_pdf_processing_job', {
      p_job: job.jobId,
      p_lease_token: job.leaseToken,
      p_progress: Math.max(0, Math.min(99, Math.floor(progress))),
      p_stage: stage.slice(0, 120),
      p_lease_seconds: this.leaseSeconds,
    }) as RpcResult<boolean>
    if (error) throw databaseError('heartbeat', error)
    return data === true
  }

  async complete(job: ClaimedPdfJob, result: Record<string, unknown>, skipped = false): Promise<boolean> {
    const response = await this.supabase.rpc('complete_pdf_processing_job', {
      p_job: job.jobId,
      p_lease_token: job.leaseToken,
      p_result: result,
      p_skipped: skipped,
    }) as RpcResult<boolean>
    if (response.error) throw databaseError('complete', response.error)
    return response.data === true
  }

  async fail(
    job: ClaimedPdfJob,
    input: {
      code: string
      publicMessage: string
      retryable: boolean
      technicalError?: Record<string, unknown>
      metrics?: Record<string, unknown>
    },
  ): Promise<string> {
    const { data, error } = await this.supabase.rpc('fail_pdf_processing_job', {
      p_job: job.jobId,
      p_lease_token: job.leaseToken,
      p_error_code: input.code,
      p_public_message: input.publicMessage,
      p_retryable: input.retryable,
      p_technical_error: input.technicalError ?? {},
      p_metrics: input.metrics ?? {},
    }) as RpcResult<string>
    if (error) throw databaseError('fail', error)
    return String(data ?? 'unknown')
  }
}
