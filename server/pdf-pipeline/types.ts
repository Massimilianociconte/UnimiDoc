export type ProcessingTier = 'free' | 'base' | 'premium'

export type PdfJobType =
  | 'compress'
  | 'extract'
  | 'ocr'
  | 'layout'
  | 'figures'
  | 'outline'
  | 'quality_review'
  | 'rag_index'

export type ClaimedPdfJob = {
  jobId: string
  runId: string
  documentId: string
  ownerId: string
  jobType: PdfJobType
  requestedTier: ProcessingTier
  attempt: number
  maxAttempts: number
  leaseToken: string
  leaseExpiresAt: string
  pipelineVersion: string
  artifactVersion: string
  inputHash: string
  storageBucket: string
  storagePath: string
  originalSizeBytes: number
  mimeType: string
  language: string
  metadata: Record<string, unknown>
}

export type PageClass =
  | 'digital_text'
  | 'scanned'
  | 'mixed'
  | 'figure_heavy'
  | 'table_heavy'
  | 'formula_heavy'
  | 'low_text'
  | 'index_candidate'
  | 'low_ocr_quality'
  | 'blank'

export type ResolvedTextSource = 'native' | 'ocr' | 'mixed' | 'none'

export type PageArtifact = {
  document_id: string
  owner_id: string
  page_number: number
  native_text: string | null
  native_text_chars: number
  text_quality_score: number
  ocr_status: 'not_needed' | 'queued' | 'running' | 'done' | 'failed' | 'skipped'
  has_images: boolean
  has_tables: boolean
  has_formulas: boolean
  has_scientific_figures: boolean
  image_inventory: Array<Record<string, unknown>>
  page_class: PageClass
  is_index_candidate: boolean
  ocr_confidence: number | null
  block_count: number
  asset_count: number
  processing_run_id: string
  artifact_version: string
  is_active: boolean
  ocr_text: string | null
  resolved_text: string
  resolved_text_sha256: string | null
  resolved_text_source: ResolvedTextSource
  ocr_engine: string | null
  ocr_engine_version: string | null
  ocr_reason: string | null
}

export type BlockArtifact = {
  document_id: string
  owner_id: string
  page_number: number
  block_type: 'paragraph' | 'heading' | 'title' | 'list' | 'table' | 'figure' | 'formula' | 'caption' | 'footnote' | 'other'
  text: string | null
  bbox: [number, number, number, number] | null
  reading_order: number
  confidence: number
  source: 'native' | 'tesseract' | 'ocrmypdf' | 'docling' | 'paddle' | 'vision'
  metadata: Record<string, unknown>
  processing_run_id: string
  artifact_version: string
  artifact_key: string
  is_active: boolean
  content_sha256: string | null
}

export type ChunkArtifact = {
  document_id: string
  owner_id: string
  page_start: number
  page_end: number
  section_path: string[]
  chunk_index: number
  content: string
  content_sha256: string
  token_estimate: number
  structure: Record<string, unknown>
  processing_state: 'ready' | 'cached' | 'needs_ai' | 'processed' | 'failed'
  semantic_score: number
  excluded_reason: string | null
  processing_run_id: string
  artifact_version: string
  is_active: boolean
  chunking_version: string
  source_text_sha256: string | null
}

export type AssetArtifact = {
  document_id: string
  owner_id: string
  page_number: number
  asset_type: 'figure' | 'table' | 'formula' | 'chart' | 'scheme' | 'diagram'
  bbox: [number, number, number, number] | null
  storage_bucket: string
  storage_path: string | null
  caption: string | null
  confidence: number
  source: 'layout_detection' | 'vision' | 'manual'
  approved_by_user: boolean
  metadata: Record<string, unknown>
  processing_run_id: string
  artifact_version: string
  artifact_key: string
  is_active: boolean
}

export type OutlineArtifact = {
  document_id: string
  owner_id: string
  title: string
  level: number
  page_start: number
  page_end: number
  ordinal: number
  confidence: number
  sources: string[]
  parent_id: null
  parent_ordinal: number | null
  source_block_ids: string[]
  metadata: Record<string, unknown>
  processing_run_id: string
  artifact_version: string
  artifact_key: string
  is_active: boolean
}

export type StageExecutionResult = {
  skipped?: boolean
  result: Record<string, unknown>
  cleanup?: () => Promise<void>
}

export type ProgressReporter = (progress: number, stage: string) => Promise<void>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_RE = /^[0-9a-f]{64}$/i
const JOB_TYPES = new Set<PdfJobType>(['compress', 'extract', 'ocr', 'layout', 'figures', 'outline', 'quality_review', 'rag_index'])
const TIERS = new Set<ProcessingTier>(['free', 'base', 'premium'])

export function parseClaimedPdfJob(value: unknown): ClaimedPdfJob {
  if (!value || typeof value !== 'object') throw new Error('INVALID_CLAIM_PAYLOAD')
  const row = value as Record<string, unknown>
  const text = (key: string) => String(row[key] ?? '')
  const jobType = text('jobType') as PdfJobType
  const tier = text('requestedTier') as ProcessingTier
  const parsed: ClaimedPdfJob = {
    jobId: text('jobId'),
    runId: text('runId'),
    documentId: text('documentId'),
    ownerId: text('ownerId'),
    jobType,
    requestedTier: tier,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.maxAttempts),
    leaseToken: text('leaseToken'),
    leaseExpiresAt: text('leaseExpiresAt'),
    pipelineVersion: text('pipelineVersion'),
    artifactVersion: text('artifactVersion'),
    inputHash: text('inputHash').toLowerCase(),
    storageBucket: text('storageBucket'),
    storagePath: text('storagePath'),
    originalSizeBytes: Number(row.originalSizeBytes),
    mimeType: text('mimeType'),
    language: text('language') || 'it',
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
  }

  if (![parsed.jobId, parsed.runId, parsed.documentId, parsed.ownerId, parsed.leaseToken].every((item) => UUID_RE.test(item))) {
    throw new Error('INVALID_CLAIM_UUID')
  }
  if (!JOB_TYPES.has(jobType)) throw new Error('INVALID_CLAIM_JOB_TYPE')
  if (!TIERS.has(tier)) throw new Error('INVALID_CLAIM_TIER')
  if (!HASH_RE.test(parsed.inputHash)) throw new Error('INVALID_CLAIM_HASH')
  if (!Number.isInteger(parsed.attempt) || parsed.attempt < 1) throw new Error('INVALID_CLAIM_ATTEMPT')
  if (!Number.isInteger(parsed.maxAttempts) || parsed.maxAttempts < parsed.attempt) throw new Error('INVALID_CLAIM_MAX_ATTEMPTS')
  if (!Number.isFinite(parsed.originalSizeBytes) || parsed.originalSizeBytes <= 0) throw new Error('INVALID_CLAIM_SIZE')
  if (!parsed.pipelineVersion || !parsed.artifactVersion || !parsed.storageBucket || !parsed.storagePath) {
    throw new Error('INVALID_CLAIM_FIELDS')
  }
  return parsed
}
