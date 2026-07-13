// Structured logger for the PDF worker (Node).
// Produces single-line JSON logs with consistent fields for observability (job metrics, lease contention, costs).
// Aligned with Edge Function logger for cross-component correlation.

export type LogFields = Record<string, unknown>

export type JobContext = {
  jobId?: string
  runId?: string
  documentId?: string
  stage?: string
  attempt?: number
  [key: string]: unknown
}

function enrich(fields: LogFields = {}) {
  return {
    ts: new Date().toISOString(),
    ...fields,
  }
}

export function log(event: string, fields: LogFields = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', event, ...enrich(fields) }))
}

export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack?.slice(0, 3000) }
      : { message: String(error) }
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', event, error: err, ...enrich(fields) }))
}

export function logWarn(event: string, fields: LogFields = {}): void {
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ level: 'warn', event, ...enrich(fields) }))
}

/** High-level job-scoped logger. Use throughout the worker for excellent traceability. */
export function createJobLogger(jobId: string, runId: string, documentId?: string, extra: JobContext = {}) {
  const base: JobContext = { jobId, runId, documentId, ...extra }

  return {
    info(event: string, fields: LogFields = {}) {
      log(event, { ...base, ...fields })
    },
    error(event: string, error: unknown, fields: LogFields = {}) {
      logError(event, error, { ...base, ...fields })
    },
    warn(event: string, fields: LogFields = {}) {
      logWarn(event, { ...base, ...fields })
    },
    /** For stage transitions and metrics */
    stage(stageName: string, fields: LogFields = {}) {
      log('pdf_job_stage', { ...base, stage: stageName, ...fields })
    },
    /** Record lease contention or lost lease events */
    leaseContention(reason: string, fields: LogFields = {}) {
      logWarn('pdf_job_lease_contention', { ...base, reason, ...fields })
    },
    getContext() {
      return { ...base }
    },
  }
}

/** Helper to emit job-level metrics (duration, tokens, cost, pages, etc.). */
export function logJobMetric(jobId: string, runId: string, documentId: string | undefined, metric: string, value: number | string, fields: LogFields = {}) {
  log('pdf_job_metric', {
    jobId,
    runId,
    documentId,
    metric,
    value,
    ...fields,
  })
}
