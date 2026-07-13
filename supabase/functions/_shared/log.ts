// Lightweight structured logging helper for Supabase Edge Functions (Deno).
// Keeps logs parseable (JSON when possible) and consistent.
// Supports correlation IDs (requestId / jobId) for cross-component tracing.
// Non-fatal errors are logged but never throw.

export type LogFields = Record<string, unknown>

export type LogContext = {
  requestId?: string
  jobId?: string
  runId?: string
  documentId?: string
  userId?: string
  [key: string]: unknown
}

function toJson(fields: LogFields): string {
  try {
    return JSON.stringify({ ts: new Date().toISOString(), ...fields })
  } catch {
    return JSON.stringify({ ts: new Date().toISOString(), message: 'log serialization failed' })
  }
}

/** Base log functions. Always pass correlation fields (requestId, jobId, etc.) for traceability. */
export function log(event: string, fields: LogFields = {}): void {
  console.log(toJson({ level: 'info', event, ...fields }))
}

export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  const errInfo =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) }
  console.error(toJson({ level: 'error', event, error: errInfo, ...fields }))
}

export function logWarn(event: string, fields: LogFields = {}): void {
  console.warn(toJson({ level: 'warn', event, ...fields }))
}

/**
 * Creates a request-scoped logger pre-seeded with correlation ID.
 * Use at the start of every Edge Function handler:
 *
 *   const log = createRequestLogger(req);
 *   log.info('handler_started', { userId });
 */
export function createRequestLogger(req: Request, extraContext: LogContext = {}) {
  const headerId = req.headers.get('x-request-id') || req.headers.get('x-correlation-id');
  const requestId = headerId || crypto.randomUUID();

  const base: LogContext = { requestId, ...extraContext };

  return {
    info(event: string, fields: LogFields = {}) {
      log(event, { ...base, ...fields });
    },
    error(event: string, error: unknown, fields: LogFields = {}) {
      logError(event, error, { ...base, ...fields });
    },
    warn(event: string, fields: LogFields = {}) {
      logWarn(event, { ...base, ...fields });
    },
    /** Returns the correlation id for this request (useful for responses or passing to worker). */
    getRequestId() {
      return requestId;
    },
    /** Merge additional context (e.g. userId, documentId) and return a new logger. */
    withContext(additional: LogContext) {
      return createRequestLogger(req, { ...base, ...additional });
    },
  };
}

/**
 * Creates a job-scoped logger for the PDF worker (Node side).
 * Use inside processJob etc.
 */
export function createJobLogger(jobId: string, runId: string, documentId?: string, extra: LogContext = {}) {
  const base: LogContext = { jobId, runId, documentId, ...extra };

  return {
    info(event: string, fields: LogFields = {}) {
      log(event, { ...base, ...fields });
    },
    error(event: string, error: unknown, fields: LogFields = {}) {
      logError(event, error, { ...base, ...fields });
    },
    warn(event: string, fields: LogFields = {}) {
      logWarn(event, { ...base, ...fields });
    },
    getJobContext() {
      return { ...base };
    },
  };
}
