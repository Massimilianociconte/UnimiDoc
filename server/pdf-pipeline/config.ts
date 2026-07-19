import os from 'node:os'
import path from 'node:path'

export type WorkerConfig = ReturnType<typeof loadWorkerConfig>

type Environment = Record<string, string | undefined>

function numberValue(env: Environment, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]
  const parsed = Number(raw)
  if (!raw || !Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`MISSING_${key}`)
  return value
}

export function loadWorkerConfig(env: Environment = process.env) {
  const leaseSeconds = numberValue(env, 'PDF_JOB_LEASE_SECONDS', 180, 30, 900)
  const supabaseUrl = required(env, 'SUPABASE_URL')
  const serviceRoleKey = required(env, 'SUPABASE_SERVICE_ROLE_KEY')
  const callbackSecret = required(env, 'PDF_WORKER_CALLBACK_SECRET')
  if (callbackSecret.length < 32) throw new Error('INVALID_PDF_WORKER_CALLBACK_SECRET')
  const heartbeatMs = numberValue(env, 'PDF_WORKER_HEARTBEAT_MS', Math.min(30_000, leaseSeconds * 250), 5_000, 60_000)
  // Heartbeat must fire multiple times within a lease window; otherwise OCR
  // jobs lose the lease before the first renewal lands.
  if (heartbeatMs * 2 >= leaseSeconds * 1000) {
    throw new Error('INVALID_HEARTBEAT_VS_LEASE: PDF_WORKER_HEARTBEAT_MS must be well below PDF_JOB_LEASE_SECONDS')
  }
  return {
    supabaseUrl,
    serviceRoleKey,
    callbackSecret,
    workerId: env.PDF_WORKER_ID?.trim() || `${os.hostname()}:${process.pid}`,
    pipelineVersion: env.PDF_PIPELINE_VERSION?.trim() || 'pdf-worker-v1',
    chunkingVersion: env.PDF_CHUNKING_VERSION?.trim() || 'unified-v3',
    concurrency: numberValue(env, 'PDF_WORKER_CONCURRENCY', 1, 1, 4),
    pollMs: numberValue(env, 'PDF_WORKER_POLL_MS', 1500, 250, 60_000),
    leaseSeconds,
    heartbeatMs,
    tempRoot: env.PDF_WORKER_TMP_DIR?.trim() || path.join(os.tmpdir(), 'unimidoc-worker'),
    maxUploadBytes: numberValue(env, 'PDF_MAX_UPLOAD_BYTES', 50 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    maxPages: numberValue(env, 'PDF_MAX_PAGES', 2000, 1, 5000),
    ocrLanguages: env.PDF_OCR_LANGUAGES?.trim() || 'ita+eng',
    ocrMaxPages: {
      free: numberValue(env, 'PDF_OCR_MAX_PAGES_FREE', 0, 0, 2000),
      base: numberValue(env, 'PDF_OCR_MAX_PAGES_BASE', 24, 0, 2000),
      premium: numberValue(env, 'PDF_OCR_MAX_PAGES_PREMIUM', 160, 0, 2000),
    },
    figureMaxPages: numberValue(env, 'PDF_FIGURE_MAX_PAGES', 36, 0, 300),
    timeouts: {
      validateMs: numberValue(env, 'PDF_VALIDATE_TIMEOUT_MS', 120_000, 5_000, 900_000),
      compressMs: numberValue(env, 'PDF_COMPRESS_TIMEOUT_MS', 300_000, 10_000, 1_800_000),
      extractMs: numberValue(env, 'PDF_EXTRACT_TIMEOUT_MS', 300_000, 10_000, 1_800_000),
      ocrMs: numberValue(env, 'PDF_OCR_TIMEOUT_MS', 1_500_000, 30_000, 3_600_000),
      renderMs: numberValue(env, 'PDF_RENDER_TIMEOUT_MS', 120_000, 5_000, 600_000),
      ragIndexMs: numberValue(env, 'PDF_RAG_INDEX_TIMEOUT_MS', 900_000, 30_000, 1_800_000),
    },
    skipDependencyCheck: env.PDF_WORKER_SKIP_DEPENDENCY_CHECK === 'true',
    // 0 disables the endpoint (e.g. worker:pdf:once in CI).
    healthPort: numberValue(env, 'PDF_WORKER_HEALTH_PORT', 8080, 0, 65_535),
  }
}
