import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
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
import type { ClaimedPdfJob } from './types.js'

type WorkerHealth = {
  startedAt: number
  lastClaimAt: number | null
  lastCompletedAt: number | null
  lastFailedAt: number | null
  lastPollErrorAt: number | null
  jobsCompleted: number
  jobsFailed: number
}

type WorkerRuntime = {
  config: WorkerConfig
  supabase: SupabaseClient
  queue: PdfJobQueue
  store: PdfArtifactStore
  shutdown: AbortSignal
  health: WorkerHealth
}

/**
 * Liveness/readiness endpoint for the container orchestrator. Answers from
 * the main event loop, so a wedged process fails the probe; job-level
 * failures do not (the lease queue already retries those).
 */
function startHealthServer(runtime: WorkerRuntime): Server | null {
  if (!runtime.config.healthPort) return null
  const server = createServer((request, response) => {
    if (request.url !== '/healthz' && request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not_found"}')
      return
    }
    const shuttingDown = runtime.shutdown.aborted
    response.writeHead(shuttingDown ? 503 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      status: shuttingDown ? 'shutting_down' : 'ok',
      workerId: runtime.config.workerId,
      pipelineVersion: runtime.config.pipelineVersion,
      uptimeSeconds: Math.floor((Date.now() - runtime.health.startedAt) / 1000),
      jobsCompleted: runtime.health.jobsCompleted,
      jobsFailed: runtime.health.jobsFailed,
      lastClaimAt: runtime.health.lastClaimAt,
      lastCompletedAt: runtime.health.lastCompletedAt,
      lastFailedAt: runtime.health.lastFailedAt,
      lastPollErrorAt: runtime.health.lastPollErrorAt,
    }))
  })
  // Bind loopback only: if the port is accidentally published, do not expose
  // workerId / job counters on all interfaces.
  server.listen(runtime.config.healthPort, '127.0.0.1', () => {
    log('pdf_worker_health_listening', { port: runtime.config.healthPort, host: '127.0.0.1' })
  })
  server.unref()
  return server
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
      // Retry transient network/RPC blips before treating the job as lost.
      // Only a definitive "not owned" response aborts immediately.
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (jobAbort.signal.aborted) return
        try {
          const owned = await runtime.queue.heartbeat(job, progress, stage)
          if (!owned) {
            lostLease = true
            jobAbort.abort(lostLeaseError())
            jobLogger.leaseContention('lost_during_heartbeat')
            throw lostLeaseError()
          }
          return
        } catch (error) {
          if (lostLease) throw error
          lastError = error
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    } finally {
      heartbeatRunning = false
    }
  }

  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => {
      // Lost lease is expected under contention; abort without extra noise.
      if (lostLease) return
      jobLogger.error('pdf_job_heartbeat_failed', error)
      // Only abort after the retried heartbeat path still fails.
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
    runtime.health.jobsCompleted += 1
    runtime.health.lastCompletedAt = Date.now()
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
    runtime.health.jobsFailed += 1
    runtime.health.lastFailedAt = Date.now()
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
      runtime.health.lastClaimAt = Date.now()
      log('pdf_worker_claimed', { slot, jobId: job.jobId, runId: job.runId, jobType: job.jobType })
      await processJob(runtime, job)
      if (once) return
    } catch (error) {
      runtime.health.lastPollErrorAt = Date.now()
      log('pdf_worker_poll_failed', {
        slot,
        error: error instanceof Error ? error.message : String(error),
      })
      if (once) throw error
      await abortableDelay(Math.max(runtime.config.pollMs, 3_000), runtime.shutdown)
    }
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
    health: {
      startedAt: Date.now(),
      lastClaimAt: null,
      lastCompletedAt: null,
      lastFailedAt: null,
      lastPollErrorAt: null,
      jobsCompleted: 0,
      jobsFailed: 0,
    },
  }
  const healthServer = input.once ? null : startHealthServer(runtime)
  log('pdf_worker_started', {
    workerId: config.workerId,
    pipelineVersion: config.pipelineVersion,
    concurrency: input.once ? 1 : config.concurrency,
    once: input.once === true,
  })
  try {
    const slots = Array.from(
      { length: input.once ? 1 : config.concurrency },
      (_, index) => workerSlot(runtime, index, input.once === true),
    )
    await Promise.all(slots)
  } finally {
    healthServer?.close()
  }
  log('pdf_worker_stopped', { workerId: config.workerId })
}

const directEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === directEntry) {
  runPdfWorker({ once: process.argv.includes('--once') }).catch((error) => {
    logError('pdf_worker_fatal', error)
    process.exitCode = 1
  })
}
