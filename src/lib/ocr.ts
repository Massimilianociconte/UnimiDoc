import { refreshAnalysisDerivedFields, type PdfAnalysis, type DocSentence } from './pdfProcessing'
import { TESSERACT_WORKER_OPTIONS } from './cdnConfig'
import { getPdfDocumentParams, pdfjsLib } from './pdfjsConfig'

// --------------------------------------------------------------------------
// Real in-browser OCR (zero-cost) with tesseract.js.
//
// analyzePdf() only FLAGS pages that need OCR (no native text). This module
// actually reads them: it rasterises each flagged page at a legible DPI and
// runs tesseract (Italian + English) to recover text. The recovered text is
// merged back into the analysis so it feeds SEO/GEO metadata, flashcards and
// internal search — the pieces that were previously blind to scanned pages.
//
// tesseract.js is lazy-loaded (heavy WASM + language data) so it never weighs
// on users who upload text-native PDFs. Pages are capped to keep it bounded.
// --------------------------------------------------------------------------

export type OcrPageResult = {
  page: number
  text: string
  confidence: number
  chars: number
}

export type OcrResult = {
  pages: OcrPageResult[]
  totalChars: number
  meanConfidence: number
}

export type OcrProgress = { page: number; total: number; status: string }

const DEFAULT_MAX_OCR_PAGES = 12
// Aim for ~300 DPI-equivalent on the long edge: the sweet spot where Tesseract
// accuracy plateaus. Going higher just burns CPU/memory for no gain.
const OCR_TARGET_LONG_EDGE = 2200
const OCR_MIN_SCALE = 1.5
const OCR_MAX_SCALE = 3.5
// Bound total work per document so a 400-page scan can't hang the tab.
const OCR_MAX_TOTAL_MEGAPIXELS = 90
// Below this Tesseract confidence a page's text is treated as unreliable noise
// and dropped rather than polluting search/flashcards/metadata.
const MIN_OCR_CONFIDENCE = 45

/** Pick a render scale that lands the page's long edge near the target DPI. */
function ocrScaleFor(longEdgePts: number): number {
  const raw = OCR_TARGET_LONG_EDGE / Math.max(1, longEdgePts)
  return Math.max(OCR_MIN_SCALE, Math.min(OCR_MAX_SCALE, raw))
}

/**
 * Grayscale + contrast stretch, in place on the canvas. Scanned pages carry
 * colour casts, JPEG noise and uneven lighting that hurt OCR; flattening to a
 * high-contrast grayscale is cheap (one linear pass) and measurably lifts
 * recognition accuracy before Tesseract ever runs.
 */
function preprocessForOcr(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  const { width, height } = canvas
  if (width === 0 || height === 0) return
  const image = context.getImageData(0, 0, width, height)
  const data = image.data

  // First pass: luminance histogram to find robust black/white points (2nd/98th
  // percentile) so we stretch contrast without clipping to pure outliers.
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0
    histogram[luma] += 1
  }
  const totalPixels = width * height
  const lowCut = totalPixels * 0.02
  const highCut = totalPixels * 0.02
  let low = 0
  let high = 255
  for (let acc = 0, v = 0; v < 256; v += 1) {
    acc += histogram[v]
    if (acc >= lowCut) { low = v; break }
  }
  for (let acc = 0, v = 255; v >= 0; v -= 1) {
    acc += histogram[v]
    if (acc >= highCut) { high = v; break }
  }
  const span = Math.max(1, high - low)

  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    const stretched = Math.max(0, Math.min(255, ((luma - low) / span) * 255))
    data[i] = data[i + 1] = data[i + 2] = stretched
  }
  context.putImageData(image, 0, 0)
}

async function renderPageToCanvas(page: unknown): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined') return null
  const pageLike = page as {
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
  }
  const base = pageLike.getViewport({ scale: 1 })
  const scale = ocrScaleFor(Math.max(base.width, base.height))
  const viewport = pageLike.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true } as CanvasRenderingContext2DSettings)
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await pageLike.render({ canvasContext: context, viewport }).promise
  preprocessForOcr(canvas, context)
  return canvas
}

/**
 * Run OCR on the pages `analysis` flagged as needing it (capped). Returns the
 * recovered text per page. Safe to call with an empty ocrPages list (no-op).
 */
export async function runOcr(
  buffer: ArrayBuffer,
  analysis: Pick<PdfAnalysis, 'ocrPages'>,
  options: { maxPages?: number; languages?: string; onProgress?: (progress: OcrProgress) => void } = {},
): Promise<OcrResult> {
  const targetPages = analysis.ocrPages.slice(0, options.maxPages ?? DEFAULT_MAX_OCR_PAGES)
  if (targetPages.length === 0) {
    return { pages: [], totalChars: 0, meanConfidence: 0 }
  }

  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(options.languages ?? 'ita+eng', 1, {
    ...TESSERACT_WORKER_OPTIONS,
  }, {
    preserve_interword_spaces: '1',
    user_patterns_suffix: '',
    user_words_suffix: '',
  } as Record<string, string>)
  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  })
  const loadingTask = pdfjsLib.getDocument(getPdfDocumentParams(new Uint8Array(buffer.slice(0))))
  const pdf = await loadingTask.promise
  const results: OcrPageResult[] = []
  let megapixelsUsed = 0

  try {
    for (let i = 0; i < targetPages.length; i += 1) {
      const pageNumber = targetPages[i]
      if (megapixelsUsed >= OCR_MAX_TOTAL_MEGAPIXELS) break // compute budget reached
      options.onProgress?.({ page: pageNumber, total: targetPages.length, status: 'recognizing' })
      const page = await pdf.getPage(pageNumber)
      const canvas = await renderPageToCanvas(page)
      page.cleanup()
      if (!canvas) continue
      megapixelsUsed += (canvas.width * canvas.height) / 1_000_000

      const { data } = await worker.recognize(canvas)
      const confidence = data.confidence ?? 0
      const text = (data.text ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      // Confidence gate: keep only text Tesseract is reasonably sure about, or a
      // short-but-confident line. Garbage OCR (low confidence, few real words)
      // is dropped so it never pollutes search / flashcards / SEO metadata.
      const realWords = (text.match(/\p{L}{3,}/gu) ?? []).length
      const trustworthy = text.length > 0 && (confidence >= MIN_OCR_CONFIDENCE || (confidence >= 30 && realWords >= 8))
      if (trustworthy) {
        results.push({ page: pageNumber, text, confidence, chars: text.length })
      }
    }
  } finally {
    await worker.terminate()
    await loadingTask.destroy()
  }

  const totalChars = results.reduce((sum, r) => sum + r.chars, 0)
  const meanConfidence = results.length
    ? Math.round(results.reduce((sum, r) => sum + r.confidence, 0) / results.length)
    : 0
  return { pages: results, totalChars, meanConfidence }
}

/**
 * Merge OCR text back into an existing analysis: appends recovered text to the
 * document text, adds sentences (so keyphrase/flashcard/search see them) and
 * flips the affected pages' `needsOcr`/`chars`. Pure (returns a new analysis).
 */
export function mergeOcrIntoAnalysis(analysis: PdfAnalysis, ocr: OcrResult): PdfAnalysis {
  if (ocr.pages.length === 0) return analysis

  const ocrByPage = new Map(ocr.pages.map((p) => [p.page, p]))
  let nextIndex = analysis.sentences.reduce((max, s) => Math.max(max, s.index), -1) + 1
  const extraSentences: DocSentence[] = []

  for (const ocrPage of ocr.pages) {
    for (const raw of ocrPage.text.split(/(?<=[.!?])\s+|\n+/)) {
      const text = raw.replace(/\s+/g, ' ').trim()
      if (text.length >= 24) {
        extraSentences.push({ index: nextIndex++, page: ocrPage.page, text, section: null, kind: 'sentence' })
      }
    }
  }

  const pages = analysis.pages.map((page) => {
    const ocrPage = ocrByPage.get(page.page)
    if (!ocrPage) return page
    return { ...page, chars: page.chars + ocrPage.chars, needsOcr: false }
  })

  const mergedText = `${analysis.text}\n${ocr.pages.map((p) => p.text).join('\n')}`.trim()
  const merged: PdfAnalysis = {
    ...analysis,
    pages,
    text: mergedText,
    textChars: mergedText.replace(/\s+/g, '').length,
    sentences: [...analysis.sentences, ...extraSentences].sort((a, b) => a.page - b.page || a.index - b.index),
  }

  return refreshAnalysisDerivedFields(merged)
}
