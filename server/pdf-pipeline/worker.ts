import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkRuntimeDependencies, CommandError } from './commands.js'
import { loadWorkerConfig, type WorkerConfig } from './config.js'
import { lostLeaseError, normalizeProcessingError, ProcessingError } from './errors.js'
import { log, logError, createJobLogger, logJobMetric } from './logger.ts'
import { PdfArtifactStore } from './persistence.js'
import { PdfJobQueue } from './queue.js'
import { executePdfStage } from './stages.js'
import { drainStorageCleanupQueue } from './storage-gc.js'
import type { ClaimedPdfJob } from './types.js'

type WorkerRuntime = {
  config: WorkerConfig
  supabase: SupabaseClient
  queue: PdfJobQueue
  store: PdfArtifactStore
  shutdown: AbortSignal
}

// Note: structured `log` and `logError` are imported from ./logger.ts above.

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal.removeEventListener('abort', done)
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

function technicalDetails(error: unknown): Record<string, unknown> {
  if (error instanceof CommandError) {
    return {
      name: error.name,
      command: error.command,
      exitCode: error.exitCode,
      timedOut: error.timedOut,
      stderr: error.stderr.slice(0, 4000),
    }
  }
  if (error instanceof ProcessingError) return { ...error.details, name: error.name, message: error.message.slice(0, 1000) }
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 1000) }
  return { message: String(error).slice(0, 1000) }
}

async function processJob(runtime: WorkerRuntime, job: ClaimedPdfJob): Promise<void> {
  const startedAt = Date.now()
  const jobLogger = createJobLogger(job.jobId, job.runId, job.documentId, {
    jobType: job.jobType,
    attempt: job.attempt,
    workerId: runtime.config.workerId,
  })

  const jobAbort = new AbortController()
  const forwardShutdown = () => jobAbort.abort(runtime.shutdown.reason)
  runtime.shutdown.addEventListener('abort', forwardShutdown, { once: true })
  let heartbeatRunning = false
  let lostLease = false
  let lastProgress = 0
  let lastStage = 'claimed'
  let workDir = ''

  const heartbeat = async (progress = lastProgress, stage = lastStage) => {
    lastProgress = progress
    lastStage = stage
    if (heartbeatRunning || jobAbort.signal.aborted) return
    heartbeatRunning = true
    try {
      const owned = await runtime.queue.heartbeat(job, progress, stage)
      if (!owned) {
        lostLease = true
        jobAbort.abort(lostLeaseError())
        jobLogger.leaseContention('lost_during_heartbeat')
        throw lostLeaseError()
      }
    } finally {
      heartbeatRunning = false
    }
  }

  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      jobLogger.error('pdf_job_heartbeat_failed', error)
      jobAbort.abort(error)
    })
  }, runtime.config.heartbeatMs)
  heartbeatTimer.unref()

  try {
    workDir = await mkdtemp(path.join(runtime.config.tempRoot, `job-${job.jobType}-`))
    jobLogger.info('pdf_job_started')

    const execution = await executePdfStage(job, {
      supabase: runtime.supabase,
      store: runtime.store,
      config: runtime.config,
      workDir,
      signal: jobAbort.signal,
      progress: heartbeat,
    })

    if (jobAbort.signal.aborted || lostLease) throw lostLeaseError()

    const completed = await runtime.queue.complete(job, execution.result, execution.skipped === true)
    if (!completed) {
      lostLease = true
      jobLogger.leaseContention('complete_failed')
      throw lostLeaseError()
    }

    await execution.cleanup?.()

    const durationMs = Date.now() - startedAt
    jobLogger.info('pdf_job_completed', { skipped: execution.skipped === true, durationMs })
    logJobMetric(job.jobId, job.runId, job.documentId, 'duration_ms', durationMs, { jobType: job.jobType })

  } catch (error) {
    const normalized = normalizeProcessingError(error)
    if (lostLease || normalized.code === 'LOST_LEASE') {
      jobLogger.error('pdf_job_lost_lease', error)
      return
    }

    let resultingStatus = 'fail_rpc_unavailable'
    try {
      resultingStatus = await runtime.queue.fail(job, {
        code: normalized.code,
        publicMessage: normalized.publicMessage,
        retryable: normalized.retryable,
        technicalError: technicalDetails(error),
        metrics: { durationMs: Date.now() - startedAt, lastProgress, lastStage },
      })
    } catch (failureUpdateError) {
      jobLogger.error('pdf_job_failure_update_failed', failureUpdateError)
    }

    const durationMs = Date.now() - startedAt
    jobLogger.error('pdf_job_failed', error, {
      code: normalized.code,
      retryable: normalized.retryable,
      resultingStatus,
      durationMs,
    })
    logJobMetric(job.jobId, job.runId, job.documentId, 'duration_ms', durationMs, { jobType: job.jobType, status: 'failed', code: normalized.code })
  } finally {
    clearInterval(heartbeatTimer)
    runtime.shutdown.removeEventListener('abort', forwardShutdown)
    if (workDir) await rm(workDir, { recursive: true, force: true })
  }
}

async function workerSlot(runtime: WorkerRuntime, slot: number, once: boolean): Promise<void> {
  while (!runtime.shutdown.aborted) {
    try {
      const job = await runtime.queue.claim()
      if (!job) {
        if (once) return
        await abortableDelay(runtime.config.pollMs, runtime.shutdown)
        continue
      }
      log('pdf_worker_claimed', { slot, jobId: job.jobId, runId: job.runId, jobType: job.jobType })
      await processJob(runtime, job)
      if (once) return
    } catch (error) {
      log('pdf_worker_poll_failed', {
        slot,
        error: error instanceof Error ? error.message : String(error),
      })
      if (once) throw error
      await abortableDelay(Math.max(runtime.config.pollMs, 3_000), runtime.shutdown)
    }
  }
}

async function runStorageGcOnce(runtime: WorkerRuntime): Promise<void> {
  try {
    const result = await drainStorageCleanupQueue(runtime.supabase, { onLog: (event, detail) => log(event, detail) })
    if (result.scanned > 0) log('storage_gc_drained', result)
  } catch (error) {
    log('storage_gc_failed', { error: error instanceof Error ? error.message : String(error) })
  }
}

async function storageGcLoop(runtime: WorkerRuntime): Promise<void> {
  const intervalMs = Number(process.env.STORAGE_GC_INTERVAL_MS) || 300_000
  while (!runtime.shutdown.aborted) {
    await runStorageGcOnce(runtime)
    await abortableDelay(intervalMs, runtime.shutdown)
  }
}

export async function runPdfWorker(input: { once?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  const config = loadWorkerConfig(input.env)
  await mkdir(config.tempRoot, { recursive: true, mode: 0o700 })
  const shutdownController = new AbortController()
  const shutdown = (signal: string) => {
    if (!shutdownController.signal.aborted) {
      log('pdf_worker_shutdown_requested', { signal })
      shutdownController.abort(new Error(signal))
    }
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))

  if (!config.skipDependencyCheck) {
    const versions = await checkRuntimeDependencies(shutdownController.signal)
    log('pdf_worker_dependencies_ready', { versions })
  }

  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-UnimiDoc-Worker': config.workerId } },
  })
  const runtime: WorkerRuntime = {
    config,
    supabase,
    queue: new PdfJobQueue(supabase, config.workerId, config.leaseSeconds, config.pipelineVersion),
    store: new PdfArtifactStore(supabase),
    shutdown: shutdownController.signal,
  }
  log('pdf_worker_started', {
    workerId: config.workerId,
    pipelineVersion: config.pipelineVersion,
    concurrency: input.once ? 1 : config.concurrency,
    once: input.once === true,
  })
  const slots = Array.from(
    { length: input.once ? 1 : config.concurrency },
    (_, index) => workerSlot(runtime, index, input.once === true),
  )
  // Storage GC drains orphaned objects left by hard-deleted documents. One pass
  // in --once mode, otherwise a periodic loop alongside the job slots.
  const maintenance = input.once ? runStorageGcOnce(runtime) : storageGcLoop(runtime)
  await Promise.all([...slots, maintenance])
  log('pdf_worker_stopped', { workerId: config.workerId })
}

const directEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === directEntry) {
  runPdfWorker({ once: process.argv.includes('--once') }).catch((error) => {
    logError('pdf_worker_fatal', error)
    process.exitCode = 1
  })
}
