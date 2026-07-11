import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadWorkerConfig } from './config.js'
import { normalizeProcessingError, ProcessingError } from './errors.js'
import { buildQualityReport, classifyPage, parsePdfImagesList, sha256Text } from './stages.js'
import { canonicalDocumentPath, validateInputStorageReference } from './storage.js'
import { parseClaimedPdfJob, type ClaimedPdfJob, type PageArtifact } from './types.js'

const claim = (overrides: Partial<ClaimedPdfJob> = {}): ClaimedPdfJob => ({
  jobId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  documentId: '33333333-3333-4333-8333-333333333333',
  ownerId: '44444444-4444-4444-8444-444444444444',
  jobType: 'compress',
  requestedTier: 'base',
  attempt: 1,
  maxAttempts: 5,
  leaseToken: '55555555-5555-4555-8555-555555555555',
  leaseExpiresAt: '2026-07-11T00:00:00.000Z',
  pipelineVersion: 'pdf-worker-v1',
  artifactVersion: 'pdf-worker-v1:22222222-2222-4222-8222-222222222222',
  inputHash: 'a'.repeat(64),
  storageBucket: 'processing-temp',
  storagePath: '44444444-4444-4444-8444-444444444444/incoming/33333333-3333-4333-8333-333333333333/source.pdf',
  originalSizeBytes: 1024,
  mimeType: 'application/pdf',
  language: 'it',
  metadata: { upload_state: 'verification_queued' },
  ...overrides,
})

const page = (overrides: Partial<PageArtifact> = {}): PageArtifact => ({
  document_id: claim().documentId,
  owner_id: claim().ownerId,
  page_number: 1,
  native_text: 'Testo nativo leggibile.',
  native_text_chars: 23,
  text_quality_score: 0.9,
  ocr_status: 'not_needed',
  has_images: false,
  has_tables: false,
  has_formulas: false,
  has_scientific_figures: false,
  image_inventory: [],
  page_class: 'digital_text',
  is_index_candidate: false,
  ocr_confidence: null,
  block_count: 1,
  asset_count: 0,
  processing_run_id: claim().runId,
  artifact_version: claim().artifactVersion,
  is_active: false,
  ocr_text: null,
  resolved_text: 'Testo nativo leggibile.',
  resolved_text_sha256: sha256Text('Testo nativo leggibile.'),
  resolved_text_source: 'native',
  ocr_engine: null,
  ocr_engine_version: null,
  ocr_reason: null,
  ...overrides,
})

describe('PDF worker claim contract', () => {
  it('accepts a complete RPC payload and rejects tampered identifiers', () => {
    expect(parseClaimedPdfJob(claim())).toMatchObject({ jobType: 'compress', attempt: 1 })
    expect(() => parseClaimedPdfJob({ ...claim(), leaseToken: 'not-a-uuid' })).toThrow('INVALID_CLAIM_UUID')
    expect(() => parseClaimedPdfJob({ ...claim(), inputHash: 'bad' })).toThrow('INVALID_CLAIM_HASH')
  })

  it('validates incoming and canonical storage namespaces', () => {
    expect(() => validateInputStorageReference(claim())).not.toThrow()
    const canonical = claim({
      storageBucket: 'private-documents',
      storagePath: `${claim().ownerId}/documents/${claim().documentId}/source/${'b'.repeat(64)}.pdf`,
      metadata: { upload_state: 'verified_submitted' },
    })
    expect(() => validateInputStorageReference(canonical)).not.toThrow()
    expect(() => validateInputStorageReference(claim({ storagePath: '../escape.pdf' }))).toThrow('Unexpected incoming path')
    expect(canonicalDocumentPath(claim(), 'c'.repeat(64))).toContain('/source/')
  })
})

describe('PDF worker deterministic analysis', () => {
  it('routes only image-backed or corrupted sparse pages to OCR', () => {
    expect(classifyPage({ text: '', qualityScore: 0, imageCount: 0 })).toEqual({ pageClass: 'blank', ocrReason: null })
    expect(classifyPage({ text: '', qualityScore: 0, imageCount: 1 }).ocrReason).toBe('no_native_text_with_images')
    expect(classifyPage({ text: 'Titolo breve', qualityScore: 0.9, imageCount: 0 }).ocrReason).toBeNull()
  })

  it('parses Poppler image inventory without trusting headers', () => {
    const output = `page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1   0 image    1200  800  rgb     3   8  jpeg   no       12  0   144   144 20K 1.0%
   2   1 image     300  200  gray    1   8  image  no       18  0    72    72  2K 0.5%`
    const parsed = parsePdfImagesList(output)
    expect(parsed[1]).toHaveLength(1)
    expect(parsed[2]?.[0]).toMatchObject({ imageNumber: 1, width: 300, height: 200 })
  })

  it('marks unresolved OCR as partial and produces a stable document hash', () => {
    const report = buildQualityReport({
      pages: [page(), page({ page_number: 2, resolved_text: '', resolved_text_sha256: null, ocr_status: 'failed', page_class: 'scanned' })],
      chunks: [],
      blocks: [],
      assets: [],
      outline: [],
    })
    expect(report.partial).toBe(true)
    expect(report.normalizedTextSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.qualityReport.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unresolved_ocr_pages' })]))
  })
})

describe('PDF worker operational safeguards', () => {
  it('clamps concurrency and requires backend credentials', () => {
    expect(() => loadWorkerConfig({})).toThrow('MISSING_SUPABASE_URL')
    const config = loadWorkerConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
      PDF_WORKER_CALLBACK_SECRET: 'w'.repeat(32),
      PDF_WORKER_CONCURRENCY: '99',
      PDF_JOB_LEASE_SECONDS: '1',
    })
    expect(config.concurrency).toBe(4)
    expect(config.leaseSeconds).toBe(30)
    expect(config.callbackSecret).toHaveLength(32)
  })

  it('keeps permanent validation failures out of the retry loop', () => {
    const permanent = normalizeProcessingError(new Error('INVALID_PDF_MAGIC_BYTES'))
    expect(permanent.retryable).toBe(false)
    const transient = normalizeProcessingError(new Error('connection reset'))
    expect(transient.retryable).toBe(true)
    expect(new ProcessingError({ code: 'X', message: 'x', publicMessage: 'safe', retryable: true }).publicMessage).toBe('safe')
  })

  it('migration contains atomic lease, dependency and anti-zombie guards', async () => {
    const sql = await readFile('supabase/migrations/20260711011123_pdf_worker_leases_pipeline_20260711.sql', 'utf8')
    expect(sql).toContain('for update of job skip locked')
    expect(sql).toContain('lease_token = p_lease_token')
    expect(sql).toContain('pdf_processing_job_dependencies')
    expect(sql).toContain("v_status := 'dead_lettered'")
    expect(sql).toContain('chunk.is_active')
  })
})
