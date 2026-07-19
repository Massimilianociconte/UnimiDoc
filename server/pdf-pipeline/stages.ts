import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunkPages, CHUNKING_VERSION as SHARED_CHUNKING_VERSION } from '../../supabase/functions/_shared/chunking.ts'
import {
  buildStructuredOutline,
  compressLosslessPdf,
  extractNativeText,
  inspectPdf,
  normalizeText,
  readPageCount,
  splitStructuredBlocks,
  validatePdf,
} from './pipeline.js'
import { runCommand } from './commands.js'
import type { WorkerConfig } from './config.js'
import { ProcessingError } from './errors.js'
import { PdfArtifactStore } from './persistence.js'
import { runOcrMyPdf } from './providers/ocrmypdf.js'
import {
  canonicalDocumentPath,
  downloadStorageObject,
  removeStorageObjectBestEffort,
  sha256File,
  uploadStorageObject,
  validateInputStorageReference,
} from './storage.js'
import type {
  AssetArtifact,
  BlockArtifact,
  ChunkArtifact,
  ClaimedPdfJob,
  OutlineArtifact,
  PageArtifact,
  PageClass,
  ProgressReporter,
  StageExecutionResult,
} from './types.js'

export type StageContext = {
  supabase: SupabaseClient
  store: PdfArtifactStore
  config: WorkerConfig
  workDir: string
  signal: AbortSignal
  progress: ProgressReporter
}

type ImageInventory = Record<number, Array<Record<string, unknown>>>

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function classifyPage(input: {
  text: string
  qualityScore: number
  imageCount: number
}): { pageClass: PageClass; ocrReason: string | null } {
  const compactChars = input.text.replace(/\s+/g, '').length
  if (compactChars === 0 && input.imageCount === 0) return { pageClass: 'blank', ocrReason: null }
  if (compactChars < 24 && input.imageCount > 0) return { pageClass: 'scanned', ocrReason: 'no_native_text_with_images' }
  if (input.qualityScore < 0.42 && input.imageCount > 0) return { pageClass: 'low_ocr_quality', ocrReason: 'corrupted_native_text' }
  if (compactChars < 180 && input.imageCount > 0) return { pageClass: 'mixed', ocrReason: 'low_text_with_images' }
  if (input.imageCount >= 2 && compactChars < 500) return { pageClass: 'figure_heavy', ocrReason: null }
  if (compactChars < 80) return { pageClass: 'low_text', ocrReason: null }
  return { pageClass: 'digital_text', ocrReason: null }
}

export function parsePdfImagesList(output: string): ImageInventory {
  const inventory: ImageInventory = {}
  for (const rawLine of output.split(/\r?\n/)) {
    const columns = rawLine.trim().split(/\s+/)
    if (columns.length < 10 || !/^\d+$/.test(columns[0]) || !/^\d+$/.test(columns[1])) continue
    const pageNumber = Number(columns[0])
    const item = {
      imageNumber: Number(columns[1]),
      type: columns[2] ?? 'image',
      width: Number(columns[3]) || null,
      height: Number(columns[4]) || null,
      color: columns[5] ?? null,
      components: Number(columns[6]) || null,
      bitsPerComponent: Number(columns[7]) || null,
      encoding: columns[8] ?? null,
    }
    ;(inventory[pageNumber] ??= []).push(item)
  }
  return inventory
}

async function imageInventory(pdfPath: string, context: StageContext): Promise<ImageInventory> {
  const result = await runCommand('pdfimages', ['-list', pdfPath], {
    timeoutMs: context.config.timeouts.extractMs,
    signal: context.signal,
  })
  return parsePdfImagesList(`${result.stdout}\n${result.stderr}`)
}

async function pdfMagic(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  const bytes = Buffer.alloc(5)
  try {
    await handle.read(bytes, 0, bytes.length, 0)
  } finally {
    await handle.close()
  }
  return bytes.toString('utf8')
}

async function downloadJobPdf(job: ClaimedPdfJob, context: StageContext, fileName = 'source.pdf'): Promise<string> {
  validateInputStorageReference(job)
  const destination = path.join(context.workDir, fileName)
  await downloadStorageObject(context.supabase, job.storageBucket, job.storagePath, destination)
  return destination
}

async function compressStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  await context.progress(5, 'downloading_upload')
  const inputPath = await downloadJobPdf(job, context, 'incoming.pdf')
  const inputStat = await stat(inputPath)
  if (inputStat.size !== job.originalSizeBytes) {
    throw new ProcessingError({
      code: 'UPLOAD_SIZE_MISMATCH',
      message: `Expected ${job.originalSizeBytes} bytes, downloaded ${inputStat.size}.`,
      publicMessage: 'La dimensione del file caricato non corrisponde alla bozza.',
      retryable: false,
    })
  }
  if (inputStat.size > context.config.maxUploadBytes) {
    throw new ProcessingError({
      code: 'PDF_TOO_LARGE',
      message: `PDF size ${inputStat.size} exceeds ${context.config.maxUploadBytes}.`,
      publicMessage: 'Il PDF supera il limite consentito.',
      retryable: false,
    })
  }
  if (await pdfMagic(inputPath) !== '%PDF-') {
    throw new ProcessingError({
      code: 'INVALID_PDF_MAGIC_BYTES',
      message: 'The uploaded object is not a PDF.',
      publicMessage: 'Il file caricato non è un PDF valido.',
      retryable: false,
    })
  }

  await context.progress(18, 'verifying_sha256')
  const originalSha256 = await sha256File(inputPath)
  if (originalSha256 !== job.inputHash) {
    throw new ProcessingError({
      code: 'UPLOAD_HASH_MISMATCH',
      message: `Expected ${job.inputHash}, got ${originalSha256}.`,
      publicMessage: 'L’integrità del PDF caricato non è verificabile.',
      retryable: false,
    })
  }

  await context.progress(28, 'validating_pdf')
  await validatePdf(inputPath, {
    signal: context.signal,
    timeoutMs: context.config.timeouts.validateMs,
    maxBytes: context.config.maxUploadBytes,
  })
  const before = await inspectPdf(inputPath, { signal: context.signal, timeoutMs: context.config.timeouts.extractMs })
  if (before.pageCount > context.config.maxPages) {
    throw new ProcessingError({
      code: 'PDF_PAGE_LIMIT_EXCEEDED',
      message: `PDF has ${before.pageCount} pages; limit is ${context.config.maxPages}.`,
      publicMessage: 'Il PDF contiene troppe pagine per il piano di elaborazione corrente.',
      retryable: false,
    })
  }

  await context.progress(48, 'compressing_lossless')
  const compressedPath = path.join(context.workDir, 'compressed.pdf')
  const compression = await compressLosslessPdf(inputPath, compressedPath, before, {
    signal: context.signal,
    timeoutMs: context.config.timeouts.compressMs,
  })
  const canonicalSha256 = compression.after.sha256
  const canonicalPath = canonicalDocumentPath(job, canonicalSha256)

  await context.progress(82, 'uploading_canonical_pdf')
  await uploadStorageObject(
    context.supabase,
    'private-documents',
    canonicalPath,
    compression.outputPath,
    'application/pdf',
  )

  return {
    result: {
      storageBucket: 'private-documents',
      storagePath: canonicalPath,
      originalSha256,
      compressedSha256: canonicalSha256,
      compressedSizeBytes: compression.after.bytes,
      pageCount: compression.after.pageCount,
      compressionMethod: compression.method,
      metrics: {
        originalBytes: compression.before.bytes,
        compressedBytes: compression.after.bytes,
        savedBytes: compression.savedBytes,
        pageCount: compression.after.pageCount,
      },
    },
    cleanup: job.storageBucket === 'processing-temp'
      ? () => removeStorageObjectBestEffort(context.supabase, job.storageBucket, job.storagePath)
      : undefined,
  }
}

async function extractStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  await context.progress(8, 'downloading_canonical_pdf')
  const inputPath = await downloadJobPdf(job, context)
  const pageCount = await readPageCount(inputPath, { signal: context.signal, timeoutMs: context.config.timeouts.extractMs })
  if (pageCount > context.config.maxPages) {
    throw new ProcessingError({
      code: 'PDF_PAGE_LIMIT_EXCEEDED',
      message: `PDF has ${pageCount} pages; limit is ${context.config.maxPages}.`,
      publicMessage: 'Il documento supera il limite massimo di pagine.',
      retryable: false,
    })
  }

  await context.progress(28, 'extracting_native_text')
  const [extracted, images] = await Promise.all([
    extractNativeText(inputPath, { signal: context.signal, timeoutMs: context.config.timeouts.extractMs }),
    imageInventory(inputPath, context),
  ])
  const nativePages = extracted.pages.slice(0, pageCount)
  while (nativePages.length < pageCount) {
    nativePages.push({ pageNumber: nativePages.length + 1, text: '', textQualityScore: 0 })
  }

  const rows: PageArtifact[] = nativePages.map((page) => {
    const pageImages = images[page.pageNumber] ?? []
    const classification = classifyPage({
      text: page.text,
      qualityScore: page.textQualityScore,
      imageCount: pageImages.length,
    })
    const resolvedText = page.text.trim()
    return {
      document_id: job.documentId,
      owner_id: job.ownerId,
      page_number: page.pageNumber,
      native_text: resolvedText || null,
      native_text_chars: resolvedText.length,
      text_quality_score: page.textQualityScore,
      ocr_status: classification.ocrReason ? 'queued' : 'not_needed',
      has_images: pageImages.length > 0,
      has_tables: false,
      has_formulas: false,
      has_scientific_figures: pageImages.length > 0,
      image_inventory: pageImages,
      page_class: classification.pageClass,
      is_index_candidate: page.pageNumber <= 12 && /\b(indice|sommario|contents)\b/i.test(resolvedText),
      ocr_confidence: null,
      block_count: 0,
      asset_count: 0,
      processing_run_id: job.runId,
      artifact_version: job.artifactVersion,
      is_active: false,
      ocr_text: null,
      resolved_text: resolvedText,
      resolved_text_sha256: resolvedText ? sha256Text(normalizeText(resolvedText)) : null,
      resolved_text_source: resolvedText ? 'native' : 'none',
      ocr_engine: null,
      ocr_engine_version: null,
      ocr_reason: classification.ocrReason,
    }
  })

  await context.progress(78, 'persisting_pages')
  await context.store.upsertPages(rows)
  const ocrNeeded = rows.filter((page) => page.ocr_status === 'queued').length
  return {
    result: {
      pageCount,
      ocrNeeded,
      nativeTextChars: rows.reduce((sum, page) => sum + page.native_text_chars, 0),
      metrics: {
        pageCount,
        ocrNeeded,
        pagesWithImages: rows.filter((page) => page.has_images).length,
      },
    },
  }
}

async function ocrStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  let pages = await context.store.getPages(job)
  const candidates = pages.filter((page) => ['queued', 'running', 'failed'].includes(page.ocr_status))
  const cap = context.config.ocrMaxPages[job.requestedTier]
  const selected = candidates.slice(0, cap)
  const omitted = candidates.slice(cap)

  if (selected.length === 0) {
    if (omitted.length > 0) {
      const omittedIds = new Set(omitted.map((page) => page.page_number))
      pages = pages.map((page) => omittedIds.has(page.page_number) ? { ...page, ocr_status: 'skipped' } : page)
      await context.store.upsertPages(pages)
    }
    await context.store.upsertOcrRun({
      document_id: job.documentId,
      owner_id: job.ownerId,
      job_id: job.jobId,
      processing_run_id: job.runId,
      engine: 'ocrmypdf',
      engine_version: null,
      pages: [],
      pages_requested: candidates.length,
      pages_succeeded: 0,
      pages_failed: candidates.length,
      mean_confidence: null,
      chars_recovered: 0,
      language: context.config.ocrLanguages,
      status: 'succeeded',
      cost_usd: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      metadata: { skippedByTier: true },
    })
    return {
      skipped: true,
      result: {
        partial: candidates.length > 0,
        reason: candidates.length > 0 ? 'ocr_tier_limit' : 'ocr_not_needed',
        metrics: { requestedPages: candidates.length, processedPages: 0 },
      },
    }
  }

  const selectedIds = new Set(selected.map((page) => page.page_number))
  pages = pages.map((page) => selectedIds.has(page.page_number) ? { ...page, ocr_status: 'running' } : page)
  await context.store.upsertPages(pages)
  const startedAt = Date.now()
  await context.progress(12, 'downloading_for_ocr')
  const inputPath = await downloadJobPdf(job, context)

  await context.progress(25, 'running_ocrmypdf')
  const ocr = await runOcrMyPdf({
    inputPath,
    outputDir: context.workDir,
    pageNumbers: selected.map((page) => page.page_number),
    languages: context.config.ocrLanguages,
    timeoutMs: context.config.timeouts.ocrMs,
    signal: context.signal,
  })
  const ocrByPage = new Map(ocr.pages.map((page) => [page.pageNumber, page]))
  const omittedIds = new Set(omitted.map((page) => page.page_number))
  let recoveredChars = 0
  let confidenceSum = 0
  let successCount = 0

  pages = pages.map((page) => {
    if (omittedIds.has(page.page_number)) return { ...page, ocr_status: 'skipped' }
    const recovered = ocrByPage.get(page.page_number)
    if (!selectedIds.has(page.page_number)) return page
    if (!recovered?.text.trim()) return { ...page, ocr_status: 'failed', page_class: 'low_ocr_quality' }
    const nativeQuality = page.text_quality_score
    const useOcr = recovered.qualityScore > nativeQuality || !page.native_text
    const resolvedText = useOcr ? recovered.text.trim() : (page.native_text ?? '').trim()
    recoveredChars += recovered.text.length
    confidenceSum += recovered.confidence
    successCount += 1
    return {
      ...page,
      ocr_status: 'done',
      ocr_text: recovered.text.trim(),
      ocr_confidence: recovered.confidence,
      ocr_engine: 'ocrmypdf',
      ocr_engine_version: ocr.version,
      resolved_text: resolvedText,
      resolved_text_sha256: resolvedText ? sha256Text(normalizeText(resolvedText)) : null,
      resolved_text_source: useOcr ? (page.native_text ? 'mixed' : 'ocr') : 'native',
      page_class: useOcr ? (page.has_images ? 'mixed' : 'digital_text') : page.page_class,
    }
  })

  await context.progress(86, 'persisting_ocr_text')
  await context.store.upsertPages(pages)
  const failedCount = selected.length - successCount + omitted.length
  const durationMs = Date.now() - startedAt
  await context.store.upsertOcrRun({
    document_id: job.documentId,
    owner_id: job.ownerId,
    job_id: job.jobId,
    processing_run_id: job.runId,
    engine: 'ocrmypdf',
    engine_version: ocr.version,
    pages: selected.map((page) => page.page_number),
    pages_requested: candidates.length,
    pages_succeeded: successCount,
    pages_failed: failedCount,
    mean_confidence: successCount ? confidenceSum / successCount : null,
    chars_recovered: recoveredChars,
    language: context.config.ocrLanguages,
    status: 'succeeded',
    cost_usd: 0,
    duration_ms: durationMs,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date().toISOString(),
    metadata: { omittedByTier: omitted.length },
  })

  return {
    result: {
      partial: failedCount > 0,
      ocrPages: selected.length,
      recoveredPages: successCount,
      recoveredChars,
      metrics: { durationMs, requestedPages: candidates.length, processedPages: selected.length, failedPages: failedCount },
    },
  }
}

async function layoutStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  let pages = await context.store.getPages(job)
  if (pages.length === 0) throw new Error('NO_EXTRACTED_PAGES')
  const blocks: BlockArtifact[] = []
  for (const page of pages) {
    const pageBlocks = splitStructuredBlocks(page.resolved_text)
    pageBlocks.forEach((block, index) => {
      const text = block.text.trim()
      const blockType = block.kind === 'heading' ? 'heading' : block.kind === 'list' ? 'list' : 'paragraph'
      blocks.push({
        document_id: job.documentId,
        owner_id: job.ownerId,
        page_number: page.page_number,
        block_type: blockType,
        text,
        bbox: null,
        reading_order: index,
        confidence: page.resolved_text_source === 'ocr' || page.resolved_text_source === 'mixed'
          ? Math.max(0.3, (page.ocr_confidence ?? 60) / 100)
          : page.text_quality_score,
        source: page.resolved_text_source === 'ocr' || page.resolved_text_source === 'mixed' ? 'ocrmypdf' : 'native',
        metadata: { headingLevel: block.level ?? null },
        processing_run_id: job.runId,
        artifact_version: job.artifactVersion,
        artifact_key: sha256Text(`${page.page_number}:${index}:${blockType}:${normalizeText(text)}`),
        is_active: false,
        content_sha256: text ? sha256Text(normalizeText(text)) : null,
      })
    })
  }

  await context.progress(38, 'persisting_layout_blocks')
  await context.store.replaceBlocks(job, blocks)
  const blockCountByPage = new Map<number, number>()
  for (const block of blocks) blockCountByPage.set(block.page_number, (blockCountByPage.get(block.page_number) ?? 0) + 1)
  pages = pages.map((page) => ({ ...page, block_count: blockCountByPage.get(page.page_number) ?? 0 }))
  await context.store.upsertPages(pages)

  await context.progress(58, 'building_chunks')
  const built = chunkPages(pages.map((page) => ({ pageNumber: page.page_number, text: page.resolved_text })))
  const sourceTextSha256 = sha256Text(pages.map((page) => `${page.page_number}\n${normalizeText(page.resolved_text)}`).join('\n\f\n'))
  const seen = new Set<string>()
  const chunks: ChunkArtifact[] = []
  for (const chunk of built) {
    const contentSha256 = sha256Text(normalizeText(chunk.content))
    if (seen.has(contentSha256)) continue
    seen.add(contentSha256)
    chunks.push({
      document_id: job.documentId,
      owner_id: job.ownerId,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      section_path: chunk.sectionPath,
      chunk_index: chunks.length,
      content: chunk.content,
      content_sha256: contentSha256,
      token_estimate: chunk.tokenEstimate,
      structure: { artifactVersion: job.artifactVersion },
      processing_state: 'ready',
      semantic_score: 0,
      excluded_reason: null,
      processing_run_id: job.runId,
      artifact_version: job.artifactVersion,
      is_active: false,
      chunking_version: SHARED_CHUNKING_VERSION || context.config.chunkingVersion,
      source_text_sha256: sourceTextSha256,
    })
  }
  await context.store.replaceChunks(job, chunks)
  return {
    result: {
      blocks: blocks.length,
      chunks: chunks.length,
      sourceTextSha256,
      metrics: { blocks: blocks.length, chunks: chunks.length, deduplicatedChunks: built.length - chunks.length },
    },
  }
}

/** First N pages are always free preview (signed by document-access). */
const FREE_PREVIEW_PAGES = 2
/** Cap full-access page previews written for document-access. */
const MAX_DOCUMENT_PREVIEW_PAGES = 24

async function figuresStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  let pages = await context.store.getPages(job)
  // Always render the free teaser pages + image-backed pages (for figures).
  const freePages = pages
    .filter((page) => page.page_number <= FREE_PREVIEW_PAGES)
    .sort((a, b) => a.page_number - b.page_number)
  const imagePages = pages
    .filter((page) => page.has_images && page.page_number > FREE_PREVIEW_PAGES)
    .slice(0, context.config.figureMaxPages)
  const byNumber = new Map<number, (typeof pages)[number]>()
  for (const page of [...freePages, ...imagePages]) byNumber.set(page.page_number, page)
  const candidates = [...byNumber.values()].sort((a, b) => a.page_number - b.page_number)
  const omitted = Math.max(0, pages.filter((page) => page.has_images).length - imagePages.length)

  if (candidates.length === 0) {
    await context.store.replaceAssets(job, [])
    await context.store.replaceDocumentPreviews(job.documentId, [])
    return { skipped: true, result: { reason: 'no_pages', metrics: { candidates: 0 } } }
  }

  const inputPath = await downloadJobPdf(job, context)
  const assets: AssetArtifact[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    if (context.signal.aborted) throw new Error('JOB_ABORTED')
    const page = candidates[index]
    await context.progress(10 + Math.floor((index / candidates.length) * 75), `rendering_figure_page_${page.page_number}`)
    const outputPrefix = path.join(context.workDir, `page-${page.page_number}`)
    await runCommand('pdftocairo', [
      '-f', String(page.page_number),
      '-l', String(page.page_number),
      '-r', '144',
      '-jpeg',
      '-singlefile',
      inputPath,
      outputPrefix,
    ], { timeoutMs: context.config.timeouts.renderMs, signal: context.signal })
    const localPath = `${outputPrefix}.jpg`
    const storagePath = `${job.ownerId}/documents/${job.documentId}/${job.runId}/pages/${page.page_number}.jpg`
    await uploadStorageObject(context.supabase, 'derived-previews', storagePath, localPath, 'image/jpeg')
    assets.push({
      document_id: job.documentId,
      owner_id: job.ownerId,
      page_number: page.page_number,
      asset_type: 'figure',
      bbox: null,
      storage_bucket: 'derived-previews',
      storage_path: storagePath,
      caption: null,
      confidence: 0.55,
      source: 'layout_detection',
      approved_by_user: false,
      metadata: {
        scope: page.page_number <= FREE_PREVIEW_PAGES ? 'free_preview' : 'page_preview',
        imageCount: page.image_inventory.length,
        requiresUserCropApproval: page.page_number > FREE_PREVIEW_PAGES,
        isFreePreview: page.page_number <= FREE_PREVIEW_PAGES,
      },
      processing_run_id: job.runId,
      artifact_version: job.artifactVersion,
      artifact_key: sha256Text(`page-preview:${page.page_number}:${job.artifactVersion}`),
      is_active: false,
    })
  }
  await context.store.replaceAssets(job, assets)

  // document-access reads document_previews (not assets). First N pages are free.
  const previewRows = assets
    .slice()
    .sort((a, b) => a.page_number - b.page_number)
    .slice(0, MAX_DOCUMENT_PREVIEW_PAGES)
    .map((asset) => ({
      document_id: job.documentId,
      owner_id: job.ownerId,
      page_number: asset.page_number,
      storage_bucket: asset.storage_bucket ?? 'derived-previews',
      storage_path: asset.storage_path!,
      is_free_preview: asset.page_number <= FREE_PREVIEW_PAGES,
      watermarked: true,
    }))
  await context.store.replaceDocumentPreviews(job.documentId, previewRows)

  const assetCountByPage = new Map(assets.map((asset) => [asset.page_number, 1]))
  pages = pages.map((page) => ({ ...page, asset_count: assetCountByPage.get(page.page_number) ?? 0 }))
  await context.store.upsertPages(pages)
  return {
    result: {
      partial: omitted > 0,
      assets: assets.length,
      freePreviews: previewRows.filter((row) => row.is_free_preview).length,
      previews: previewRows.length,
      omitted,
      metrics: {
        candidates: candidates.length + omitted,
        rendered: assets.length,
        freePreviews: previewRows.filter((row) => row.is_free_preview).length,
        omitted,
      },
    },
  }
}

async function outlineStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  const pages = await context.store.getPages(job)
  const outline = buildStructuredOutline(pages.map((page) => ({
    pageNumber: page.page_number,
    text: page.resolved_text,
  })))
  const rows: OutlineArtifact[] = outline.map((entry) => ({
    document_id: job.documentId,
    owner_id: job.ownerId,
    title: entry.title,
    level: entry.level,
    page_start: entry.pageStart,
    page_end: entry.pageEnd,
    ordinal: entry.ordinal,
    confidence: entry.confidence,
    sources: entry.sources,
    parent_id: null,
    parent_ordinal: entry.parentOrdinal,
    source_block_ids: [],
    metadata: { generatedBy: 'deterministic_worker' },
    processing_run_id: job.runId,
    artifact_version: job.artifactVersion,
    artifact_key: sha256Text(`${entry.ordinal}:${entry.pageStart}:${normalizeText(entry.title)}`),
    is_active: false,
  }))
  await context.store.replaceOutline(job, rows)
  return {
    result: {
      entries: rows.length,
      outlineConfidence: rows.length ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length : 0,
      metrics: { entries: rows.length },
    },
  }
}

export function buildQualityReport(input: {
  pages: PageArtifact[]
  chunks: ChunkArtifact[]
  blocks: BlockArtifact[]
  assets: AssetArtifact[]
  outline: OutlineArtifact[]
}): { partial: boolean; normalizedTextSha256: string; qualityReport: Record<string, unknown> } {
  const pageCount = input.pages.length
  const nativeQuality = pageCount
    ? input.pages.reduce((sum, page) => sum + page.text_quality_score, 0) / pageCount * 100
    : 0
  const ocrPages = input.pages.filter((page) => page.ocr_confidence != null)
  const ocrQuality = ocrPages.length
    ? ocrPages.reduce((sum, page) => sum + (page.ocr_confidence ?? 0), 0) / ocrPages.length
    : null
  const scannedPages = input.pages.filter((page) => ['scanned', 'mixed', 'low_ocr_quality'].includes(page.page_class)).length
  const unresolvedOcr = input.pages.filter((page) => ['queued', 'running', 'failed', 'skipped'].includes(page.ocr_status))
  const emptyPages = input.pages.filter((page) => !page.resolved_text.trim()).length
  const outlineConfidence = input.outline.length
    ? input.outline.reduce((sum, entry) => sum + entry.confidence, 0) / input.outline.length
    : 0
  const issues: Array<Record<string, unknown>> = []
  if (unresolvedOcr.length) issues.push({ code: 'unresolved_ocr_pages', pages: unresolvedOcr.map((page) => page.page_number).slice(0, 100) })
  if (emptyPages) issues.push({ code: 'empty_pages', count: emptyPages })
  if (input.chunks.length === 0) issues.push({ code: 'no_searchable_chunks' })
  if (outlineConfidence < 0.5) issues.push({ code: 'low_outline_confidence' })
  const penalty = unresolvedOcr.length * 1.5 + emptyPages + (input.chunks.length ? 0 : 30) + (outlineConfidence < 0.5 ? 12 : 0)
  const overallScore = Math.max(0, Math.min(100, Math.round(nativeQuality * 0.55 + (ocrQuality ?? nativeQuality) * 0.2 + outlineConfidence * 25 - penalty)))
  const normalizedDocumentText = input.pages.map((page) => normalizeText(page.resolved_text)).join('\n\f\n')
  return {
    partial: unresolvedOcr.length > 0 || input.chunks.length === 0 || overallScore < 55,
    normalizedTextSha256: sha256Text(normalizedDocumentText),
    qualityReport: {
      nativeTextQuality: Math.round(nativeQuality * 100) / 100,
      ocrQuality: ocrQuality == null ? null : Math.round(ocrQuality * 100) / 100,
      scannedPagesPct: pageCount ? Math.round((scannedPages / pageCount) * 10_000) / 100 : 0,
      figuresDetected: input.assets.length,
      tablesDetected: input.pages.filter((page) => page.has_tables).length,
      formulasDetected: input.pages.filter((page) => page.has_formulas).length,
      outlineReliable: outlineConfidence >= 0.62 && input.outline.length > 0,
      readability: Math.max(0, Math.min(100, Math.round(nativeQuality))),
      overallScore,
      issues,
      outlineConfidence: Math.round(outlineConfidence * 10_000) / 10_000,
      outlineStrategy: input.outline.length ? 'layout' : 'page',
      outlineAiRecommended: outlineConfidence < 0.62,
    },
  }
}

async function qualityStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  const [pages, chunks, blocks, assets, outline] = await Promise.all([
    context.store.getPages(job),
    context.store.getChunks(job),
    context.store.getBlocks(job),
    context.store.getAssets(job),
    context.store.getOutline(job),
  ])
  if (pages.length === 0) throw new Error('NO_PAGES_FOR_QUALITY_REVIEW')
  const quality = buildQualityReport({ pages, chunks, blocks, assets, outline })
  return {
    result: {
      ...quality,
      metrics: {
        pages: pages.length,
        chunks: chunks.length,
        blocks: blocks.length,
        assets: assets.length,
        outlineEntries: outline.length,
      },
    },
  }
}

async function ragIndexStage(job: ClaimedPdfJob, context: StageContext): Promise<StageExecutionResult> {
  await context.progress(10, 'dispatching_rag_index')
  const timeout = AbortSignal.timeout(context.config.timeouts.ragIndexMs)
  const signal = AbortSignal.any([context.signal, timeout])
  const response = await fetch(`${context.config.supabaseUrl}/functions/v1/rag-index`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.config.serviceRoleKey}`,
      apikey: context.config.serviceRoleKey,
      'Content-Type': 'application/json',
      'X-UnimiDoc-Worker-Secret': context.config.callbackSecret,
    },
    body: JSON.stringify({ documentId: job.documentId, force: false }),
    signal,
  }).catch((error) => {
    throw new ProcessingError({
      code: 'RAG_INDEX_DISPATCH_FAILED',
      message: error instanceof Error ? error.message : String(error),
      publicMessage: 'Indicizzazione temporaneamente non disponibile.',
      retryable: true,
      cause: error,
    })
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || !['indexed', 'partial'].includes(String(payload.status ?? ''))) {
    // 401/403 = misconfigured worker secret or auth; do not burn retry budget.
    const retryable = response.status === 202 || response.status === 409
      || response.status === 429 || response.status >= 500
    throw new ProcessingError({
      code: `RAG_INDEX_HTTP_${response.status}`,
      message: `rag-index returned ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`,
      publicMessage: retryable
        ? 'Indicizzazione temporaneamente non disponibile.'
        : 'Il documento non può essere indicizzato nello stato corrente.',
      retryable,
      details: { status: response.status },
    })
  }
  await context.progress(95, 'rag_index_persisted')
  return {
    result: {
      status: payload.status,
      chunksTotal: payload.chunksTotal ?? null,
      chunksEmbedded: payload.chunksEmbedded ?? null,
      embeddingModel: payload.embeddingModel ?? null,
      metrics: {
        chunksTotal: payload.chunksTotal ?? 0,
        chunksEmbedded: payload.chunksEmbedded ?? 0,
      },
    },
  }
}

export async function executePdfStage(
  job: ClaimedPdfJob,
  context: StageContext,
): Promise<StageExecutionResult> {
  switch (job.jobType) {
    case 'compress': return compressStage(job, context)
    case 'extract': return extractStage(job, context)
    case 'ocr': return ocrStage(job, context)
    case 'layout': return layoutStage(job, context)
    case 'figures': return figuresStage(job, context)
    case 'outline': return outlineStage(job, context)
    case 'quality_review': return qualityStage(job, context)
    case 'rag_index': return ragIndexStage(job, context)
  }
}
