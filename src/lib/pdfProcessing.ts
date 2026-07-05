import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export type FlashcardSource =
  | 'definizione'
  | 'concetto'
  | 'cloze'
  | 'processo'
  | 'confronto'
  | 'causa'
  | 'classificazione'

export type SourceRef = { page: number; sentenceIndex: number; text: string; section?: string | null }

export type Flashcard = {
  id: string
  front: string
  back: string
  source: FlashcardSource
  score: number
  ref: SourceRef | null
}

export type DocSentence = {
  index: number
  page: number
  text: string
  section?: string | null
  kind: 'sentence' | 'list'
}

export type PageAnalysis = {
  page: number
  chars: number
  needsOcr: boolean
  imageCount?: number
  hasImages?: boolean
  /** Number of raster images large enough to be a real figure (not a logo/rule). */
  figureCount?: number
  /** Placed area of the biggest image on the page, as a fraction of the page (0–1). */
  largestFigureArea?: number
  /** 0–1 likelihood the page carries a study-worthy figure (drives render + occlusion). */
  figureScore?: number
  /** Vector/path operations detected on the page; useful for vector-only diagrams. */
  vectorOpCount?: number
  likelyBlank?: boolean
  textDensity?: number
}

export type DocumentHeading = {
  id: string
  title: string
  page: number
  level: 1 | 2 | 3
  score: number
  source: 'layout' | 'section' | 'topic' | 'page'
}

export type RenderedPdfPage = {
  page: number
  dataUrl: string
  width: number
  height: number
  textChars: number
  imageCount: number
  figureCount?: number
  figureScore?: number
  largestFigureArea?: number
  vectorOpCount?: number
  reason: 'image' | 'ocr' | 'overview' | 'first-page'
}

export type DocumentReviewIssue = {
  id: string
  severity: 'info' | 'warning' | 'danger'
  title: string
  detail: string
  pages: number[]
}

export type DocumentReview = {
  score: number
  textQuality: 'good' | 'partial' | 'poor'
  structureQuality: 'good' | 'partial' | 'poor'
  renderedCoverage: number
  pagesWithImages: number[]
  blankPages: number[]
  lowTextPages: number[]
  flashcardPages: number[]
  occlusionPages: number[]
  issues: DocumentReviewIssue[]
}

export type PdfAnalysis = {
  pageCount: number
  pages: PageAnalysis[]
  ocrPages: number[]
  text: string
  textChars: number
  sentences: DocSentence[]
  language: 'it' | 'en'
  outline?: DocumentHeading[]
  renderedPages?: RenderedPdfPage[]
  review?: DocumentReview
}

export type CompressionResult = {
  originalBytes: number
  compressedBytes: number
  savedBytes: number
  savedPct: number
  data: Uint8Array
  alreadyOptimized: boolean
}

const OCR_TEXT_THRESHOLD = 24
const LOW_TEXT_THRESHOLD = 120
const MAX_RANK_CANDIDATES = 600
const MAX_RENDERED_PAGES = 14

function toUint8(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0))
}

// --------------------------------------------------------------------------
// PDF reading (native text layer, page-by-page) + selective-OCR detection
// --------------------------------------------------------------------------

type SentenceCandidate = {
  text: string
  section: string | null
  kind: DocSentence['kind']
}

const HYphenATED_LINE_BREAK = /(\p{L})-\s*\n\s*(\p{Ll})/gu
const LINE_NOISE =
  /^(?:pag(?:ina)?\.?\s*)?\d+\s*(?:\/\s*\d+)?$|^https?:\/\/|^www\.|^\d+\s*$|^[-–—_]{3,}$/i
const SECTION_NOISE =
  /\b(indice|table of contents|bibliografia|references|sitografia|copyright|creative commons|licenza|ringraziamenti)\b/i
const FOOTER_NOISE = /\b(universit[aà]|facolt[aà]|dipartimento|anno accademico|scaricato|downloaded|slide)\b/i

function normalizePdfText(text: string): string {
  return text
    .replace(HYphenATED_LINE_BREAK, '$1$2')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
}

function isNoiseLine(line: string): boolean {
  const clean = normalizeInlineText(line)
  if (!clean) return true
  if (LINE_NOISE.test(clean)) return true
  if (clean.includes('.....')) return true
  if (SECTION_NOISE.test(clean) && clean.split(/\s+/).length <= 6) return true
  if (FOOTER_NOISE.test(clean) && clean.length < 72) return true

  const digits = clean.match(/\d/g)?.length ?? 0
  return clean.length < 24 && digits / Math.max(1, clean.length) > 0.35
}

function isLikelyHeading(line: string): boolean {
  const clean = normalizeInlineText(line)
  const words = clean.split(/\s+/)
  if (clean.length < 4 || clean.length > 92 || words.length > 11) return false
  if (/[.!?]$/.test(clean)) return false
  if (/^[-•*]/.test(clean)) return false

  const letters = clean.match(/\p{L}/gu)?.length ?? 0
  if (letters < 3) return false

  const upper = clean.match(/\p{Lu}/gu)?.length ?? 0
  const startsNumbered = /^\d+(?:\.\d+)*\s+\p{L}/u.test(clean)
  const titleCase = words.filter((word) => /^\p{Lu}/u.test(word)).length >= Math.ceil(words.length * 0.55)

  return startsNumbered || upper / Math.max(1, letters) > 0.45 || titleCase
}

function cleanPageText(rawText: string): string {
  const normalized = normalizePdfText(rawText)
  const lines = normalized
    .split('\n')
    .map((line) => normalizeInlineText(line))
    .filter((line) => !isNoiseLine(line))

  return lines.join('\n').trim()
}

function splitSentenceChunk(text: string): string[] {
  return normalizeInlineText(text)
    .split(/(?<=[.!?])\s+(?=[«"'“”\p{Lu}0-9])/u)
    .flatMap((chunk) => chunk.split(/\s+•\s+|\s+[-–]\s+(?=\p{Lu})/u))
    .flatMap((chunk) => chunk.split(/\s*;\s+(?=(?:inoltre|poi|quindi|infine|mentre|la|il|le|gli|the)\b)/iu))
    .map((sentence) => normalizeInlineText(sentence))
    .filter((sentence) => sentence.length > 0)
}

function splitIntoSentences(pageText: string): SentenceCandidate[] {
  const candidates: SentenceCandidate[] = []
  let section: string | null = null

  for (const rawLine of pageText.split('\n')) {
    const line = normalizeInlineText(rawLine)
    if (!line || isNoiseLine(line)) continue

    if (isLikelyHeading(line)) {
      section = line.replace(/^\d+(?:\.\d+)*\s+/, '')
      continue
    }

    const listItem = /^[•*–-]\s+/.test(line) || /^\d+[.)]\s+\p{L}/u.test(line)
    const cleanedLine = line.replace(/^[•*–-]\s+/, '').replace(/^\d+[.)]\s+/, '')
    for (const sentence of splitSentenceChunk(cleanedLine)) {
      candidates.push({ text: sentence, section, kind: listItem ? 'list' : 'sentence' })
    }
  }

  return candidates
}

function headingLevelFor(line: string): 1 | 2 | 3 {
  const clean = normalizeInlineText(line)
  if (/^\d+\s+\p{L}/u.test(clean) || /^[A-ZÀ-Ü0-9\s]{8,}$/.test(clean)) return 1
  if (/^\d+\.\d+\s+\p{L}/u.test(clean) || clean.length <= 42) return 2
  return 3
}

function headingScore(line: string): number {
  const clean = normalizeInlineText(line)
  const words = clean.split(/\s+/).length
  let score = 0.45
  if (/^\d+(?:\.\d+)*\s+\p{L}/u.test(clean)) score += 0.25
  if (/^[A-ZÀ-Ü0-9\s]{8,}$/.test(clean)) score += 0.22
  if (words >= 2 && words <= 7) score += 0.16
  if (TECHNICAL_SIGNAL.test(clean)) score += 0.1
  if (LOW_VALUE_TERMS.test(clean)) score -= 0.25
  return Math.max(0.1, Math.min(1, score))
}

function pageHeadings(pageText: string, page: number): DocumentHeading[] {
  return pageText
    .split('\n')
    .map((line) => normalizeInlineText(line))
    .filter((line) => line && isLikelyHeading(line) && !LOW_VALUE_TERMS.test(line))
    .slice(0, 8)
    .map((title, index) => ({
      id: `heading-${page}-${index}-${hashForId(title)}`,
      title: title.replace(/^\d+(?:\.\d+)*\s+/, ''),
      page,
      level: headingLevelFor(title),
      score: headingScore(title),
      source: 'layout' as const,
    }))
}

function hashForId(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function compactTitle(value: string, fallback: string): string {
  const clean = normalizeInlineText(value)
    .replace(/^[•*–-]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/[.:;,\s]+$/, '')
  if (!clean) return fallback
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length <= 9 && clean.length <= 74) return clean
  return `${words.slice(0, 8).join(' ')}…`
}

function buildDocumentOutline(pageTexts: Array<{ page: number; text: string }>, sentences: DocSentence[]): DocumentHeading[] {
  const headings = pageTexts.flatMap(({ page, text }) => pageHeadings(text, page))
  const seen = new Set<string>()
  const uniqueHeadings = headings.filter((heading) => {
    const key = `${heading.page}-${heading.title.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return heading.score >= 0.35
  })

  if (uniqueHeadings.length >= Math.min(4, Math.ceil(pageTexts.length / 3))) {
    return uniqueHeadings.slice(0, 180)
  }

  const bySection = new Map<string, { title: string; page: number; count: number }>()
  for (const sentence of sentences) {
    if (!sentence.section) continue
    const title = compactTitle(sentence.section, `Pagina ${sentence.page}`)
    const key = title.toLowerCase()
    const existing = bySection.get(key)
    if (existing) {
      existing.count += 1
      existing.page = Math.min(existing.page, sentence.page)
    } else {
      bySection.set(key, { title, page: sentence.page, count: 1 })
    }
  }

  const sectionHeadings = [...bySection.values()]
    .filter((item) => item.count >= 2 && !LOW_VALUE_TERMS.test(item.title))
    .map((item, index) => ({
      id: `section-${item.page}-${index}-${hashForId(item.title)}`,
      title: item.title,
      page: item.page,
      level: 2 as const,
      score: Math.min(1, 0.45 + item.count / 24),
      source: 'section' as const,
    }))

  if (sectionHeadings.length >= 3) return sectionHeadings.slice(0, 180)

  const pageTopics: DocumentHeading[] = []
  for (const { page } of pageTexts) {
    const pageSentences = sentences.filter((sentence) => sentence.page === page)
    const firstSection = pageSentences.find((sentence) => sentence.section)?.section
    const topicSource =
      firstSection ??
      pageSentences.find((sentence) => hasTechnicalSignal(sentence.text) && !isNoiseSentence(sentence.text))?.text ??
      pageSentences.find((sentence) => !isNoiseSentence(sentence.text))?.text
    if (!topicSource) continue
    pageTopics.push({
      id: `page-topic-${page}`,
      title: compactTitle(topicSource, `Pagina ${page}`),
      page,
      level: 1,
      score: 0.38,
      source: 'page',
    })
  }

  return pageTopics.slice(0, 220)
}

const EN_HINTS = ['the', 'and', 'of', 'is', 'are', 'this', 'that', 'with', 'from', 'which', 'between', 'into']
const IT_HINTS = ['il', 'lo', 'la', 'che', 'di', 'del', 'della', 'sono', 'viene', 'come', 'tra', 'nel', 'gli']

function detectLanguage(text: string): 'it' | 'en' {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? []
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  const en = EN_HINTS.reduce((sum, hint) => sum + (counts.get(hint) ?? 0), 0)
  const it = IT_HINTS.reduce((sum, hint) => sum + (counts.get(hint) ?? 0), 0)
  return en > it ? 'en' : 'it'
}

export type PageVisuals = {
  /** Total image paint operations (includes tiny/decorative). */
  imageCount: number
  /** Vector/path paint operations that may indicate a diagram without raster images. */
  vectorOpCount: number
  /** Images whose placed area clears the decoration threshold. */
  figureCount: number
  /** Largest single placed image area, as a fraction of the page. */
  largestFigureArea: number
  /** 0–1 study-figure likelihood. */
  figureScore: number
}

const EMPTY_VISUALS: PageVisuals = { imageCount: 0, vectorOpCount: 0, figureCount: 0, largestFigureArea: 0, figureScore: 0 }

// An image counts as a real "figure" only when it covers at least this fraction
// of the page. Logos, header rules, bullet glyphs and separators sit well below
// it; diagrams, charts and anatomical plates sit well above.
const FIGURE_MIN_AREA = 0.05
// Mask-only images (single-channel stencils) are usually decorative; require a
// larger footprint before trusting them as a figure.
const FIGURE_MASK_MIN_AREA = 0.12

/**
 * Classify a page's raster imagery WITHOUT a second render pass. We walk the
 * operator list (same call the old op-counter used, so no extra cost) while
 * tracking only the determinant of the current transformation matrix. The unit
 * image square maps to |det| user-space units², so `|det| / pageArea` is the
 * placed area fraction of each image — rotation/translation invariant and
 * enough to separate a real figure from a decorative glyph.
 */
async function analyzePageVisuals(page: unknown, pageAreaPts: number, textChars: number): Promise<PageVisuals> {
  try {
    const ops = (pdfjsLib as unknown as { OPS?: Record<string, number> }).OPS
    if (!ops || pageAreaPts <= 0) return EMPTY_VISUALS

    const paintOps = new Map<number, 'image' | 'mask'>()
    const tag = (value: number | undefined, kind: 'image' | 'mask') => {
      if (typeof value === 'number') paintOps.set(value, kind)
    }
    tag(ops.paintImageXObject, 'image')
    tag(ops.paintImageXObjectRepeat, 'image')
    tag(ops.paintJpegXObject, 'image')
    tag(ops.paintInlineImageXObject, 'image')
    tag(ops.paintInlineImageXObjectGroup, 'image')
    tag(ops.paintImageMaskXObject, 'mask')
    tag(ops.paintImageMaskXObjectGroup, 'mask')
    const vectorPaintOps = new Set(
      [
        ops.constructPath,
        ops.stroke,
        ops.closeStroke,
        ops.fill,
        ops.eoFill,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
        ops.shadingFill,
      ].filter((value): value is number => typeof value === 'number'),
    )

    const { fnArray, argsArray } = await (page as {
      getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>
    }).getOperatorList()

    // Track |det(CTM)| via a stack; save/restore push/pop, transform multiplies.
    let det = 1
    const stack: number[] = []
    const areas: number[] = []
    let vectorOpCount = 0

    for (let i = 0; i < fnArray.length; i += 1) {
      const fn = fnArray[i]
      if (fn === ops.save) {
        stack.push(det)
      } else if (fn === ops.restore) {
        det = stack.pop() ?? det
      } else if (fn === ops.transform) {
        const m = argsArray[i] as number[] | undefined
        if (m && m.length >= 4) det *= m[0] * m[3] - m[1] * m[2]
      } else {
        const kind = paintOps.get(fn)
        if (kind) {
          const areaFraction = Math.abs(det) / pageAreaPts
          if (Number.isFinite(areaFraction) && areaFraction > 0) {
            areas.push(kind === 'mask' ? -areaFraction : areaFraction)
          }
        } else if (vectorPaintOps.has(fn)) {
          vectorOpCount += 1
        }
      }
    }

    return scoreFigureAreas(areas, { vectorOpCount, textChars })
  } catch {
    return EMPTY_VISUALS
  }
}

/**
 * Pure classifier: given each image's signed placed-area fraction (negative =
 * image mask/stencil), decide how many are real figures and how figure-worthy
 * the page is. Kept pure + exported so it can be unit-tested without pdf.js.
 */
export function scoreFigureAreas(
  signedAreas: number[],
  options: { vectorOpCount?: number; textChars?: number } = {},
): PageVisuals {
  const vectorOpCount = options.vectorOpCount ?? 0
  const textChars = options.textChars ?? 0
  if (signedAreas.length === 0 && vectorOpCount === 0) return EMPTY_VISUALS

  let figureCount = 0
  let largest = 0
  for (const signed of signedAreas) {
    const area = Math.abs(signed)
    if (!Number.isFinite(area) || area <= 0 || area > 1.6) continue
    const minArea = signed < 0 ? FIGURE_MASK_MIN_AREA : FIGURE_MIN_AREA
    if (area >= minArea) figureCount += 1
    if (area > largest) largest = area
  }

  // Score: dominated by the biggest figure's size, nudged up by having a few
  // (but not dozens — a wall of tiny sprites is decoration, not a plate).
  const sizeScore = Math.min(1, largest / 0.4)
  const countBonus = figureCount >= 1 && figureCount <= 6 ? 0.15 : 0
  const rasterScore = figureCount === 0 ? 0 : Math.min(1, sizeScore + countBonus)

  // Some excellent PDF diagrams are vector-only (paths, strokes, shaded areas)
  // and contain no raster image XObject. Count them only when vector complexity
  // is meaningful and text density is not simply a normal full-text page.
  const textPenalty = Math.min(0.35, textChars / 6000)
  const vectorScore = vectorOpCount >= 22
    ? Math.max(0, Math.min(0.8, 0.22 + vectorOpCount / 140 - textPenalty))
    : 0
  const vectorFigure = vectorScore >= 0.28
  const totalFigureCount = figureCount + (vectorFigure ? 1 : 0)
  const figureScore = Math.max(rasterScore, vectorScore)

  return {
    imageCount: signedAreas.length,
    vectorOpCount,
    figureCount: totalFigureCount,
    largestFigureArea: Math.min(1, largest),
    figureScore,
  }
}

// Target long-edge for a rendered preview. Figure pages get more pixels (they
// feed vision/occlusion and must show fine labels); text/overview pages get
// fewer — best quality where it matters, least compute where it doesn't.
function previewScaleFor(page: { getViewport: (o: { scale: number }) => { width: number; height: number } }, reason: RenderedPdfPage['reason']): number {
  const base = page.getViewport({ scale: 1 })
  const longEdge = Math.max(base.width, base.height) || 800
  const targetLongEdge = reason === 'image' ? 1600 : reason === 'ocr' ? 1400 : 1100
  return Math.max(1, Math.min(2.4, targetLongEdge / longEdge))
}

async function renderPdfPage(
  page: unknown,
  input: { pageNumber: number; chars: number; imageCount: number; reason: RenderedPdfPage['reason'] },
  visual?: Partial<Pick<PageVisuals, 'figureCount' | 'figureScore' | 'largestFigureArea' | 'vectorOpCount'>>,
): Promise<RenderedPdfPage | null> {
  if (typeof document === 'undefined') return null
  try {
    const pageLike = page as {
      getViewport: (options: { scale: number }) => { width: number; height: number }
      render: (options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
        promise: Promise<void>
      }
    }
    const viewport = pageLike.getViewport({ scale: previewScaleFor(pageLike, input.reason) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await pageLike.render({ canvasContext: context, viewport }).promise
    let dataUrl = ''
    try {
      dataUrl = canvas.toDataURL('image/webp', 0.82)
    } catch {
      dataUrl = canvas.toDataURL('image/png')
    }
    return {
      page: input.pageNumber,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      textChars: input.chars,
      imageCount: input.imageCount,
      figureCount: visual?.figureCount,
      figureScore: visual?.figureScore,
      largestFigureArea: visual?.largestFigureArea,
      vectorOpCount: visual?.vectorOpCount,
      reason: input.reason,
    }
  } catch {
    return null
  }
}

function shouldRenderPage(page: PageAnalysis, pageNumber: number): RenderedPdfPage['reason'] | null {
  // Real figures first — a page whose only imagery is a logo (figureScore ~0)
  // no longer burns a render slot as an "image" page.
  if ((page.figureScore ?? 0) >= 0.25) return 'image'
  if (page.needsOcr) return 'ocr'
  if (pageNumber === 1) return 'first-page'
  if (page.chars < LOW_TEXT_THRESHOLD) return 'overview'
  return null
}

function selectRenderPages(pages: PageAnalysis[], max = MAX_RENDERED_PAGES): Map<number, RenderedPdfPage['reason']> {
  const scored = pages
    .map((page, index) => {
      const reason = shouldRenderPage(page, page.page)
      if (!reason) return null
      const basePriority = reason === 'image' ? 4 : reason === 'ocr' ? 3 : reason === 'first-page' ? 2 : 1
      // Within figures, bigger/clearer figures win the limited render budget.
      const priority = basePriority + (reason === 'image' ? (page.figureScore ?? 0) : 0)
      return { page: page.page, reason, priority, index }
    })
    .filter((item): item is { page: number; reason: RenderedPdfPage['reason']; priority: number; index: number } => Boolean(item))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.page - b.page)

  return new Map(scored.map((item) => [item.page, item.reason]))
}

function buildDocumentReview(input: {
  pages: PageAnalysis[]
  outline: DocumentHeading[]
  renderedPages: RenderedPdfPage[]
  sentences: DocSentence[]
  textChars: number
}): DocumentReview {
  const { pages, outline, renderedPages, sentences, textChars } = input
  const lowTextPages = pages.filter((page) => page.chars > 0 && page.chars < LOW_TEXT_THRESHOLD).map((page) => page.page)
  const blankPages = pages.filter((page) => page.chars === 0 && (page.figureCount ?? 0) === 0).map((page) => page.page)
  // "Pages with images" now means pages with a real, study-worthy figure — a
  // header logo no longer flags a page as image-bearing.
  const pagesWithImages = pages.filter((page) => (page.figureCount ?? 0) > 0).map((page) => page.page)
  const ocrPages = pages.filter((page) => page.needsOcr).map((page) => page.page)
  const flashcardPages = [...new Set(sentences.filter((sentence) => hasTechnicalSignal(sentence.text) || hasRelationSignal(sentence.text, 'it')).map((sentence) => sentence.page))].slice(0, 60)
  // Occlusion candidates = pages with a real figure (rendered or not) + OCR pages.
  const figurePages = pages.filter((page) => (page.figureScore ?? 0) >= 0.25).map((page) => page.page)
  const occlusionPages = [...new Set([...figurePages, ...ocrPages])].sort((a, b) => a - b)
  const issues: DocumentReviewIssue[] = []

  if (blankPages.length) {
    issues.push({
      id: 'blank-pages',
      severity: 'warning',
      title: 'Pagine vuote o non leggibili',
      detail: 'Alcune pagine non contengono testo né immagini rilevate. Potrebbero non contribuire a indice, ricerca e flashcard.',
      pages: blankPages.slice(0, 18),
    })
  }
  if (ocrPages.length) {
    issues.push({
      id: 'ocr-needed',
      severity: ocrPages.length > pages.length * 0.45 ? 'danger' : 'warning',
      title: 'OCR consigliato',
      detail: 'Il testo nativo è assente o molto scarso su queste pagine. Il reader usa la pagina renderizzata, mentre OCR/vision avanzati possono arricchire testo e card.',
      pages: ocrPages.slice(0, 24),
    })
  }
  if (!outline.length) {
    issues.push({
      id: 'outline-poor',
      severity: 'warning',
      title: 'Struttura poco chiara',
      detail: 'Non sono emersi titoli affidabili. L’indice usa un fallback per pagina, ma un PDF con heading reali funziona meglio.',
      pages: [],
    })
  }
  if (pagesWithImages.length && renderedPages.length === 0) {
    issues.push({
      id: 'render-missing',
      severity: 'warning',
      title: 'Immagini rilevate ma non renderizzate',
      detail: 'Il browser non ha generato preview delle pagine. Image occlusion può richiedere backend rendering in produzione.',
      pages: pagesWithImages.slice(0, 18),
    })
  }

  const avgChars = pages.length ? textChars / pages.length : 0
  const textQuality: DocumentReview['textQuality'] = avgChars > 550 && ocrPages.length <= pages.length * 0.15 ? 'good' : avgChars > 120 ? 'partial' : 'poor'
  const structureQuality: DocumentReview['structureQuality'] = outline.length >= Math.min(8, pages.length) ? 'good' : outline.length >= 3 ? 'partial' : 'poor'
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === 'danger' ? 22 : issue.severity === 'warning' ? 10 : 3), 0)
  const structureBonus = structureQuality === 'good' ? 12 : structureQuality === 'partial' ? 5 : 0
  const imageBonus = renderedPages.length ? 6 : 0

  return {
    score: Math.max(18, Math.min(98, Math.round(72 + structureBonus + imageBonus - penalty))),
    textQuality,
    structureQuality,
    renderedCoverage: pages.length ? Math.round((renderedPages.length / pages.length) * 100) : 0,
    pagesWithImages,
    blankPages,
    lowTextPages,
    flashcardPages,
    occlusionPages,
    issues,
  }
}

export function refreshAnalysisDerivedFields(analysis: PdfAnalysis): PdfAnalysis {
  const pageTexts = analysis.pages.map((page) => ({
    page: page.page,
    text: analysis.sentences
      .filter((sentence) => sentence.page === page.page)
      .map((sentence) => sentence.section ? `${sentence.section}\n${sentence.text}` : sentence.text)
      .join('\n'),
  }))
  const textChars = analysis.text.replace(/\s+/g, '').length
  const outline = buildDocumentOutline(pageTexts, analysis.sentences)
  const review = buildDocumentReview({
    pages: analysis.pages,
    outline,
    renderedPages: analysis.renderedPages ?? [],
    sentences: analysis.sentences,
    textChars,
  })

  return {
    ...analysis,
    textChars,
    language: detectLanguage(analysis.text),
    ocrPages: analysis.pages.filter((page) => page.needsOcr).map((page) => page.page),
    outline,
    review,
  }
}

export async function analyzePdf(buffer: ArrayBuffer): Promise<PdfAnalysis> {
  const loadingTask = pdfjsLib.getDocument({ data: toUint8(buffer) })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const pages: PageAnalysis[] = []
  const chunks: string[] = []
  const pageTexts: Array<{ page: number; text: string }> = []
  const sentences: DocSentence[] = []
  const renderedPages: RenderedPdfPage[] = []
  let sentenceIndex = 0

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const rawPageText = content.items
        .map((item) => {
          if (!('str' in item)) return ''
          return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`
        })
        .join('')
      const pageText = cleanPageText(rawPageText)
      const baseViewport = (page as { getViewport: (o: { scale: number }) => { width: number; height: number } }).getViewport({ scale: 1 })
      const visuals = await analyzePageVisuals(page, baseViewport.width * baseViewport.height, pageText.length)
      chunks.push(pageText)
      pageTexts.push({ page: pageNumber, text: pageText })
      const pageAnalysis: PageAnalysis = {
        page: pageNumber,
        chars: pageText.length,
        needsOcr: pageText.length < OCR_TEXT_THRESHOLD,
        imageCount: visuals.imageCount,
        hasImages: visuals.imageCount > 0,
        figureCount: visuals.figureCount,
        largestFigureArea: visuals.largestFigureArea,
        figureScore: visuals.figureScore,
        vectorOpCount: visuals.vectorOpCount,
        likelyBlank: pageText.length === 0 && visuals.figureCount === 0,
        textDensity: pageText.length,
      }
      pages.push(pageAnalysis)
      for (const sentence of splitIntoSentences(pageText)) {
        sentences.push({ index: sentenceIndex, page: pageNumber, ...sentence })
        sentenceIndex += 1
      }
      page.cleanup()
    }

    const renderPlan = selectRenderPages(pages)
    for (const [pageNumber, reason] of renderPlan) {
      const page = await pdf.getPage(pageNumber)
      const info = pages[pageNumber - 1]
      const rendered = await renderPdfPage(page, {
        pageNumber,
        chars: info?.chars ?? 0,
        imageCount: info?.imageCount ?? 0,
        reason,
      }, info)
      if (rendered) renderedPages.push(rendered)
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }

  const text = chunks.join('\n').trim()
  const outline = buildDocumentOutline(pageTexts, sentences)
  const language = detectLanguage(text)
  const review = buildDocumentReview({
    pages,
    outline,
    renderedPages,
    sentences,
    textChars: text.replace(/\s+/g, '').length,
  })

  return {
    pageCount,
    pages,
    ocrPages: pages.filter((page) => page.needsOcr).map((page) => page.page),
    text,
    textChars: text.replace(/\s+/g, '').length,
    sentences,
    language,
    outline,
    renderedPages,
    review,
  }
}

// --------------------------------------------------------------------------
// Lossless compression (object streams) — no rasterization
// --------------------------------------------------------------------------

export async function compressPdfLossless(buffer: ArrayBuffer): Promise<CompressionResult> {
  const originalBytes = buffer.byteLength
  try {
    const pdfDoc = await PDFDocument.load(toUint8(buffer), { updateMetadata: false })

    // Strip document-info metadata (producer/creator/keywords/dates). It never
    // affects rendered content but can shave a few KB and removes authoring
    // fingerprints — a genuine lossless win before the object-stream rebuild.
    try {
      pdfDoc.setProducer('')
      pdfDoc.setCreator('')
      pdfDoc.setKeywords([])
      pdfDoc.setTitle('')
      pdfDoc.setAuthor('')
      pdfDoc.setSubject('')
    } catch {
      /* some PDFs have locked info dicts — ignore and continue */
    }

    // Object streams + full flate recompression: the ceiling of what pdf-lib can
    // do losslessly in the browser. Deeper gains (image recompression, unused
    // resource removal) require the backend qpdf/pikepdf pipeline — see
    // docs/pdf-flashcards-compression-architecture.md §8.
    const rebuilt = await pdfDoc.save({ useObjectStreams: true })
    const compressedBytes = rebuilt.byteLength

    if (compressedBytes < originalBytes) {
      const savedBytes = originalBytes - compressedBytes
      return {
        originalBytes,
        compressedBytes,
        savedBytes,
        savedPct: Math.round((savedBytes / originalBytes) * 1000) / 10,
        data: rebuilt,
        alreadyOptimized: false,
      }
    }
  } catch {
    // Encrypted or malformed PDFs can't be re-serialized safely — keep the original.
  }

  return {
    originalBytes,
    compressedBytes: originalBytes,
    savedBytes: 0,
    savedPct: 0,
    data: toUint8(buffer),
    alreadyOptimized: true,
  }
}

// --------------------------------------------------------------------------
// Extractive concept engine — TextRank + TF-IDF + keyphrases (no AI models)
// --------------------------------------------------------------------------

const STOPWORDS = new Set([
  // Italian
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'dello', 'della', 'dei', 'degli',
  'delle', 'da', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'in', 'nel', 'nello', 'nella', 'nei',
  'negli', 'nelle', 'con', 'col', 'su', 'sul', 'sullo', 'sulla', 'per', 'tra', 'fra', 'che', 'chi', 'cui',
  'non', 'come', 'più', 'anche', 'quando', 'perché', 'quindi', 'mentre', 'ovvero', 'ossia', 'sono', 'essere',
  'stato', 'viene', 'vengono', 'questa', 'questo', 'questi', 'queste', 'quello', 'quella', 'suo', 'sua',
  'loro', 'ogni', 'ciascun', 'alcuni', 'tutti', 'tutte', 'può', 'possono', 'deve', 'devono', 'inoltre',
  'infatti', 'esempio', 'esempi', 'seguente', 'seguenti', 'presenta', 'presentano', 'dove',
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'they',
  'them', 'their', 'which', 'who', 'whom', 'whose', 'what', 'when', 'where', 'why', 'how', 'can', 'could',
  'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'not', 'also', 'such', 'than', 'then', 'so',
  'more', 'most', 'some', 'any', 'all', 'each', 'both', 'between', 'into', 'through', 'during', 'about',
  'above', 'below', 'over', 'under', 'again', 'there', 'here', 'while', 'because', 'therefore', 'thus',
  'however', 'e.g', 'i.e', 'etc',
])

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? [])
    .map((word) => word.replace(/['’-]+$/, ''))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

type IdfFn = (term: string) => number

function buildIdf(sentences: DocSentence[]): IdfFn {
  const df = new Map<string, number>()
  for (const sentence of sentences) {
    for (const term of new Set(tokenize(sentence.text))) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const total = sentences.length
  return (term) => Math.log(1 + total / ((df.get(term) ?? 0) + 1))
}

function vectorize(tokens: string[], idf: IdfFn): Map<string, number> {
  const tf = new Map<string, number>()
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
  const vector = new Map<string, number>()
  const length = Math.max(1, tokens.length)
  tf.forEach((count, term) => vector.set(term, (count / length) * idf(term)))
  return vector
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  a.forEach((value) => {
    normA += value * value
  })
  b.forEach((value) => {
    normB += value * value
  })
  if (normA === 0 || normB === 0) return 0
  const [small, big] = a.size < b.size ? [a, b] : [b, a]
  small.forEach((value, key) => {
    const other = big.get(key)
    if (other) dot += value * other
  })
  return dot / Math.sqrt(normA * normB)
}

function textRank(vectors: Map<string, number>[], iterations = 28, damping = 0.85): number[] {
  const n = vectors.length
  if (n <= 1) return new Array(n).fill(1)
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const rowSum = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const similarity = cosine(vectors[i], vectors[j])
      if (similarity > 0.06) {
        sim[i][j] = similarity
        sim[j][i] = similarity
        rowSum[i] += similarity
        rowSum[j] += similarity
      }
    }
  }

  let score = new Array<number>(n).fill(1 / n)
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Array<number>(n).fill((1 - damping) / n)
    for (let i = 0; i < n; i += 1) {
      if (rowSum[i] === 0) continue
      const share = (damping * score[i]) / rowSum[i]
      for (let j = 0; j < n; j += 1) {
        if (sim[i][j] > 0) next[j] += share * sim[i][j]
      }
    }
    score = next
  }
  return score
}

type Keyphrase = { phrase: string; score: number; count: number }

function extractKeyphrases(sentences: DocSentence[], idf: IdfFn): Keyphrase[] {
  const aggregate = new Map<string, { score: number; count: number }>()

  for (const sentence of sentences) {
    const words = sentence.text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []
    let run: string[] = []
    const flush = () => {
      if (run.length) {
        const phrase = run.join(' ')
        if (phrase.length >= 4) {
          const phraseScore = run.reduce((sum, word) => sum + idf(word), 0)
          const entry = aggregate.get(phrase) ?? { score: 0, count: 0 }
          entry.score = Math.max(entry.score, phraseScore)
          entry.count += 1
          aggregate.set(phrase, entry)
        }
      }
      run = []
    }
    for (const word of words) {
      if (word.length >= 3 && !STOPWORDS.has(word)) {
        run.push(word)
        if (run.length === 3) flush()
      } else {
        flush()
      }
    }
    flush()
  }

  return [...aggregate.entries()]
    .map(([phrase, entry]) => ({ phrase, score: entry.score * Math.log(1 + entry.count), count: entry.count }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 32)
}

// --------------------------------------------------------------------------
// Card construction — template question generation from ranked sentences
// --------------------------------------------------------------------------

const EN_ARTICLES = new Set(['the', 'a', 'an'])
const IT_ARTICLES = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', "l'", 'un', 'uno', 'una', "un'"])

const PASSIVE_EN: Record<string, string> = {
  separated: 'separates', divided: 'divides', connected: 'connects', produced: 'produces',
  controlled: 'controls', regulated: 'regulates', covered: 'covers', surrounded: 'surrounds',
  supplied: 'supplies', formed: 'forms', bounded: 'bounds', innervated: 'innervates',
  drained: 'drains', composed: 'composes', enclosed: 'encloses', protected: 'protects',
}
const RELATION_EN = new Set([
  'separates', 'divides', 'connects', 'contains', 'produces', 'controls', 'regulates', 'surrounds',
  'supplies', 'carries', 'covers', 'encloses', 'protects', 'forms', 'drains', 'innervates', 'links', 'joins',
])
const PASSIVE_IT: Record<string, string> = {
  separato: 'separa', separata: 'separa', separati: 'separano', separate: 'separano',
  diviso: 'divide', divisa: 'divide', prodotto: 'produce', controllato: 'controlla',
  regolato: 'regola', circondato: 'circonda', formato: 'forma', protetto: 'protegge', costituito: 'costituisce',
}
const RELATION_IT = new Set([
  'separa', 'divide', 'collega', 'contiene', 'produce', 'controlla', 'regola', 'circonda',
  'protegge', 'costituisce', 'forma', 'trasporta', 'irrora',
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function capitalizeFirst(value: string): string {
  const trimmed = value.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed
}

function ensurePeriod(value: string): string {
  const trimmed = value.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function stripArticle(term: string, lang: 'it' | 'en'): string {
  const parts = term.trim().split(/\s+/)
  const first = (parts[0] ?? '').toLowerCase().replace(/[’]/g, "'")
  const set = lang === 'en' ? EN_ARTICLES : IT_ARTICLES
  if (parts.length > 1 && set.has(first)) return parts.slice(1).join(' ')
  return term.trim()
}

function questionWhatIs(term: string, lang: 'it' | 'en', plural: boolean): string {
  const clean = term.replace(/[.,;:]+$/, '').trim()
  if (lang === 'en') return plural ? `What are ${clean}?` : `What is ${clean}?`
  return plural ? `Che cosa sono ${clean}?` : `Che cos'è ${clean}?`
}

function bestKeyphraseMatch(text: string, keyphrases: Keyphrase[]): Keyphrase | null {
  const lower = text.toLowerCase()
  let best: Keyphrase | null = null
  let bestScore = -1
  for (const keyphrase of keyphrases) {
    const { phrase, score } = keyphrase
    if (phrase.length < 4) continue
    if (new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(lower) && score > bestScore) {
      best = keyphrase
      bestScore = score
    }
  }
  return best
}

function bestKeyphraseInSentence(text: string, keyphrases: Keyphrase[]): string | null {
  return bestKeyphraseMatch(text, keyphrases)?.phrase ?? null
}

function isDefinitional(text: string, lang: 'it' | 'en'): boolean {
  const regex =
    lang === 'en'
      ? /^.{2,60}?\s+(?:is|are|refers\s+to|represents|means|consists\s+of|is\s+defined\s+as)\s+/i
      : /^.{2,60}?\s+(?:è|sono|si\s+definisce|si\s+definiscono|consiste|rappresenta|indica|si\s+riferisce|si\s+intende|costituisce)\s+/i
  return regex.test(text) || /^[\p{Lu}][^:]{2,58}:\s/u.test(text)
}

const TECHNICAL_SIGNAL =
  /\b(DNA|RNA|ATP|NADH|PCR|enzim\w*|gene\w*|genom\w*|cellul\w*|prote\w*|membran\w*|recettor\w*|metabol\w*|cromosom\w*|sequenz\w*|mitosi|meiosi|osmosi|diffusion\w*|gradiente|organello|tessuto|epitel\w*|fisiolog\w*|molecol\w*|biochim\w*|microbi\w*|ecolog\w*)\b/i
const GENERIC_FRONT =
  /\b(cosa sai|parla|descrivi tutto|spiega tutto|argomento|questa frase|questo testo|quale informazione|cosa viene detto)\b/i
const LOW_VALUE_TERMS =
  /\b(figura|tabella|slide|lezione|pagina|capitolo|paragrafo|immagine|autore|copyright|bibliografia|riferimenti)\b/i
const ACRONYM = /\b([A-Z]{2,8})\s*\(([^)]{4,90})\)|\b([^().]{4,90})\s+\(([A-Z]{2,8})\)/u

function isNoiseSentence(text: string): boolean {
  const clean = normalizeInlineText(text)
  const words = clean.split(/\s+/)
  if (clean.length < 18 || words.length < 4) return true
  if (SECTION_NOISE.test(clean) && words.length < 12) return true
  if (/^(?:figura|tabella|slide|pagina)\s+\d+/i.test(clean)) return true
  if (/\.{4,}|_{4,}/.test(clean)) return true
  if (/^(?:obiettivi|programma|indice|bibliografia|riferimenti)$/i.test(clean)) return true

  const letters = clean.match(/\p{L}/gu)?.length ?? 0
  const digits = clean.match(/\d/g)?.length ?? 0
  return letters < 12 || digits / Math.max(1, clean.length) > 0.45
}

function hasTechnicalSignal(text: string): boolean {
  const tokens = tokenize(text)
  const longTerms = tokens.filter((token) => token.length >= 9).length
  const acronyms = text.match(/\b[A-Z]{2,8}\b/g)?.length ?? 0
  return TECHNICAL_SIGNAL.test(text) || acronyms > 0 || longTerms >= 2
}

function hasRelationSignal(text: string, lang: 'it' | 'en'): boolean {
  if (isDefinitional(text, lang)) return true
  return (
    /\b(causa|provoca|determina|induce|favorisce|inibisce|porta a|dipende da|a causa di|perch[eé]|quindi)\b/i.test(text) ||
    /\b(differisce|differenza|rispetto a|mentre|invece|confronto|al contrario)\b/i.test(text) ||
    /\b(fase|fasi|prima|poi|successivamente|infine|inizia|termina|passaggio|sequenza)\b/i.test(text) ||
    /\b(si distinguono in|si classificano in|comprende|comprendono|include|includono|costituit[oa] da|compost[oa] da)\b/i.test(text)
  )
}

function compactAnswer(answer: string, maxLength = 360): string {
  const clean = normalizeInlineText(answer).replace(/^[,:;\s-]+/, '')
  if (clean.length <= maxLength) return clean
  const sentenceEnd = clean.slice(0, maxLength).lastIndexOf('.')
  if (sentenceEnd > 120) return clean.slice(0, sentenceEnd + 1)
  return `${clean.slice(0, maxLength).replace(/\s+\S*$/, '')}…`
}

function firstUsefulTerm(text: string, keyphrases: Keyphrase[], fallbackSection?: string | null): string | null {
  const match = bestKeyphraseInSentence(text, keyphrases)
  if (match && !LOW_VALUE_TERMS.test(match)) return match
  if (fallbackSection && !LOW_VALUE_TERMS.test(fallbackSection)) return fallbackSection

  const technical = text.match(/\b(?:[A-Z]{2,8}|[\p{Lu}\p{Ll}]{5,}(?:\s+[\p{Lu}\p{Ll}]{4,}){0,2})\b/u)
  return technical ? technical[0] : null
}

function scorePedagogicalCard(card: Flashcard, sentence: DocSentence, baseScore: number): number {
  let score = baseScore
  const frontWords = card.front.split(/\s+/).length
  const backWords = card.back.split(/\s+/).length

  if (card.source === 'definizione') score += 0.2
  if (card.source === 'causa' || card.source === 'confronto' || card.source === 'processo') score += 0.18
  if (card.source === 'classificazione') score += 0.14
  if (sentence.kind === 'list') score += 0.08
  if (sentence.section) score += 0.06
  if (hasTechnicalSignal(`${card.front} ${card.back}`)) score += 0.12
  if (frontWords < 4 || frontWords > 32) score -= 0.22
  if (backWords < 3 || backWords > 80) score -= 0.22
  if (GENERIC_FRONT.test(card.front) || LOW_VALUE_TERMS.test(card.front)) score -= 0.3
  if (normalizeInlineText(card.front).toLowerCase() === normalizeInlineText(card.back).toLowerCase()) score -= 0.45

  return Math.min(1.8, Math.max(0, score))
}

function passesFlashcardQuality(card: Flashcard): boolean {
  const front = normalizeInlineText(card.front)
  const back = normalizeInlineText(card.back)
  if (front.length < 12 || front.length > 240) return false
  if (back.length < 8 || back.length > 620) return false
  if (GENERIC_FRONT.test(front)) return false
  if (LOW_VALUE_TERMS.test(front) && !hasTechnicalSignal(back)) return false
  if (front.toLowerCase().replace(/[?!.]/g, '') === back.toLowerCase().replace(/[?!.]/g, '')) return false
  return card.score >= 0.55
}

function buildCard(
  sentence: DocSentence,
  lang: 'it' | 'en',
  keyphrases: Keyphrase[],
  id: string,
): Flashcard | null {
  const text = sentence.text.replace(/\s+/g, ' ').trim()
  const ref: SourceRef = { page: sentence.page, sentenceIndex: sentence.index, text, section: sentence.section }
  const make = (front: string, back: string, source: FlashcardSource): Flashcard => ({
    id,
    front: front.replace(/\s+/g, ' ').trim(),
    back: ensurePeriod(capitalizeFirst(compactAnswer(back))),
    source,
    score: 0,
    ref,
  })

  const acronym = text.match(ACRONYM)
  if (acronym) {
    const short = acronym[1] ?? acronym[4]
    const long = acronym[2] ?? acronym[3]
    if (short && long && long.split(/\s+/).length <= 10 && !LOW_VALUE_TERMS.test(long)) {
      const question = lang === 'en' ? `What does ${short} stand for?` : `Che cosa significa ${short}?`
      return make(question, long, 'definizione')
    }
  }

  const classification = text.match(
    /^(.{4,90}?)\s+(?:si\s+distinguono\s+in|si\s+classificano\s+in|comprendono|include|includono|sono\s+costituit[ie]?\s+da|sono\s+compost[ie]?\s+da)\s+(.{12,260})[.]?$/i,
  )
  if (classification) {
    const term = stripArticle(classification[1].trim(), lang)
    if (term.split(/\s+/).length <= 8) {
      const question = lang === 'en' ? `Which categories belong to ${term}?` : `In quali categorie si distingue ${term}?`
      return make(question, classification[2].trim(), 'classificazione')
    }
  }

  const cause = text.match(/^(.{4,95}?)\s+(?:causa|provoca|determina|induce|favorisce|inibisce|porta\s+a|riduce|aumenta)\s+(.{8,260})[.]?$/i)
  if (cause) {
    const term = stripArticle(cause[1].trim(), lang)
    if (term.split(/\s+/).length <= 9 && !LOW_VALUE_TERMS.test(term)) {
      const question = lang === 'en' ? `What effect does ${term} have?` : `Quale effetto ha ${term}?`
      return make(question, cause[2].trim(), 'causa')
    }
  }

  const reason = text.match(/^(.{10,150}?)\s+(?:perch[eé]|poich[eé]|in quanto|because)\s+(.{10,220})[.]?$/i)
  if (reason) {
    const prompt = reason[1].replace(/[.,;:]+$/, '').trim()
    if (prompt.length <= 130) {
      const question = lang === 'en' ? `Why does ${prompt}?` : `Perché ${prompt}?`
      return make(question, reason[2].trim(), 'causa')
    }
  }

  const comparison = text.match(/^(.{4,90}?)\s+(?:differisce|differiscono|si\s+distingue|si\s+distinguono)\s+(?:da|dal|dalla|dai|dagli|dalle)\s+(.{8,220})[.]?$/i)
  if (comparison) {
    const term = stripArticle(comparison[1].trim(), lang)
    if (term.split(/\s+/).length <= 8) {
      const question = lang === 'en' ? `What distinguishes ${term}?` : `Da cosa si distingue ${term}?`
      return make(question, comparison[2].trim(), 'confronto')
    }
  }

  if (/\b(?:mentre|invece|al contrario|rispetto a|whereas|while|unlike)\b/i.test(text)) {
    const term = firstUsefulTerm(text, keyphrases, sentence.section)
    if (term) {
      const question = lang === 'en' ? `What comparison is made about ${term}?` : `Quale confronto va ricordato su ${term}?`
      return make(question, text, 'confronto')
    }
  }

  if (/\b(?:fase|fasi|prima|poi|successivamente|infine|inizia|termina|passaggio|sequenza|step|first|then|finally)\b/i.test(text)) {
    const term = firstUsefulTerm(text, keyphrases, sentence.section)
    if (term) {
      const question = lang === 'en' ? `What sequence describes ${term}?` : `Quale sequenza descrive ${term}?`
      return make(question, text, 'processo')
    }
  }

  // 1. Passive with agent -> active question ("... is separated ... by the diaphragm" -> "What separates ...?")
  if (lang === 'en') {
    const match = text.match(/^(.{4,90}?)\s+(?:is|are|was|were)\s+([a-z]+ed)\s+(.*?)\s+by\s+(?:the\s+)?(.{2,70}?)[.]?$/i)
    if (match) {
      const verb = PASSIVE_EN[match[2].toLowerCase()]
      if (verb) {
        const middle = match[3].trim()
        return make(`What ${verb} ${match[1].trim()}${middle ? ` ${middle}` : ''}?`, match[4].trim(), 'concetto')
      }
    }
  } else {
    const match = text.match(/^(.{4,90}?)\s+(?:è|viene|sono|vengono)\s+([a-zà-ù]+[oaie])\s+(.*?)\s+(?:dal|dallo|dalla|dai|dagli|dalle|da)\s+(.{2,70}?)[.]?$/i)
    if (match) {
      const verb = PASSIVE_IT[match[2].toLowerCase()]
      if (verb) {
        const middle = match[3].trim()
        return make(`Che cosa ${verb} ${match[1].trim()}${middle ? ` ${middle}` : ''}?`, match[4].trim(), 'concetto')
      }
    }
  }

  // 2. Active relational verb near the start ("The diaphragm separates …" → "What separates …?")
  const words = text.split(' ')
  const relations = lang === 'en' ? RELATION_EN : RELATION_IT
  for (let k = 1; k < Math.min(words.length - 1, 7); k += 1) {
    const verb = words[k].toLowerCase().replace(/[.,;:]$/, '')
    if (relations.has(verb)) {
      const term = words.slice(0, k).join(' ').trim()
      const rest = words.slice(k + 1).join(' ').replace(/[.]$/, '').trim()
      if (term.split(' ').length <= 6 && rest.length >= 4) {
        const question = lang === 'en' ? `What ${verb} ${rest}?` : `Che cosa ${verb} ${rest}?`
        return make(question, term, 'concetto')
      }
      break
    }
  }

  // 3. Colon definition ("Term: definition")
  const colon = text.match(/^([\p{L}][^:]{2,58}):\s+(.{15,300})$/u)
  if (colon) {
    const term = stripArticle(colon[1].trim(), lang)
    return make(questionWhatIs(term, lang, /\b(?:sono|are)\b/i.test(colon[1])), colon[2].trim(), 'definizione')
  }

  // 4. Copula definition ("X is/è …")
  const copula =
    lang === 'en'
      ? text.match(/^(.{2,60}?)\s+(is|are|was|were|refers\s+to|represents|means|consists\s+of|is\s+defined\s+as)\s+/i)
      : text.match(/^(.{2,60}?)\s+(è|sono|era|erano|si\s+definisce|si\s+definiscono|consiste|rappresenta|indica|si\s+riferisce|si\s+intende|costituisce)\s+/i)
  if (copula) {
    const plural = /^(?:are|were|sono|erano)$/i.test(copula[2].trim())
    const term = stripArticle(copula[1].trim(), lang)
    const definition = text.slice(copula[0].length).trim()
    if (term.split(' ').length <= 7 && term.length >= 2 && definition.length >= 12) {
      return make(questionWhatIs(term, lang, plural), definition, 'definizione')
    }
  }

  // 5. Cloze deletion on the strongest keyphrase in the sentence
  const keyphrase = bestKeyphraseInSentence(text, keyphrases)
  if (keyphrase) {
    const regex = new RegExp(`\\b${escapeRegExp(keyphrase)}\\b`, 'i')
    const position = text.search(regex)
    const words = keyphrase.split(/\s+/).length
    if (position > 12 && words <= 4 && !LOW_VALUE_TERMS.test(keyphrase)) {
      const blanked = text.replace(regex, '_____')
      if (blanked !== text && blanked.length >= 40) return make(blanked, keyphrase, 'cloze')
    }
  }

  return null
}

// --------------------------------------------------------------------------
// Document insights — metadati SEO/GEO estratti automaticamente dal contenuto
// (riusa TextRank/TF-IDF/keyphrases: zero chiamate AI, gira nel browser)
// --------------------------------------------------------------------------

export type DocumentDepthLevel = 'introduttivo' | 'intermedio' | 'avanzato'

export type DocumentContentFlags = {
  hasImages: boolean
  hasDiagrams: boolean
  hasTables: boolean
  hasFormulas: boolean
  hasExercises: boolean
  hasExamQuestions: boolean
}

export type DocumentInsights = {
  keywords: string[]
  topics: string[]
  abstract: string
  depthLevel: DocumentDepthLevel
  contentFlags: DocumentContentFlags
  language: 'it' | 'en'
  qualityScore: number
}

const TABLE_SIGNAL = /\btabell[ae]\b|\btable\s+\d|\|\s*[^|\n]+\s*\|/i
const FORMULA_SIGNAL = /[∑∫∂√≈≤≥±×Δλμπ→⇌]|\b(equazion[ei]|formul[ae]|reazione chimica)\b|[A-Z][a-z]?\d(?![\d/])/
const EXERCISE_SIGNAL = /\b(eserci[sz]i?o?|problema svolto|soluzion[ei]|svolgimento|exercise|problem set)\b/i
const EXAM_SIGNAL = /\b(domand[ae] (?:d.esame|frequent[ei]|aperte)|appell[oi]|prova (?:scritta|orale|in itinere)|exam question|past paper|temi d.esame)\b/i
const DIAGRAM_SIGNAL = /\b(schema|diagramma|grafico|figura|mappa concettuale|ciclo di|struttura d)\b/i

export function buildDocumentInsights(analysis: PdfAnalysis): DocumentInsights {
  const candidates = analysis.sentences
    .filter((sentence) => {
      const text = normalizeInlineText(sentence.text)
      return !isNoiseSentence(text) && text.length >= 30 && text.length <= 400
    })
    .slice(0, MAX_RANK_CANDIDATES)

  let keywords: string[] = []
  let abstract = ''

  if (candidates.length > 0) {
    const idf = buildIdf(candidates)
    const vectors = candidates.map((sentence) => vectorize(tokenize(sentence.text), idf))
    const rank = textRank(vectors)
    keywords = extractKeyphrases(candidates, idf)
      .slice(0, 12)
      .map((entry) => entry.phrase)

    // Abstract estrattivo: le 3 frasi più centrali in ordine di apparizione,
    // così il riassunto resta fedele al testo (niente allucinazioni).
    const topIndexes = rank
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => a.index - b.index)
    abstract = topIndexes
      .map(({ index }) => normalizeInlineText(candidates[index].text))
      .join(' ')
      .slice(0, 480)
  }

  const topics: string[] = []
  const seenTopics = new Set<string>()
  for (const heading of analysis.outline ?? []) {
    if (heading.level > 2) continue
    const clean = normalizeInlineText(heading.title)
    const key = clean.toLowerCase()
    if (clean.length < 4 || clean.length > 70 || seenTopics.has(key)) continue
    seenTopics.add(key)
    topics.push(clean)
    if (topics.length >= 8) break
  }
  if (topics.length < 4) {
    for (const phrase of keywords) {
      const key = phrase.toLowerCase()
      if (seenTopics.has(key)) continue
      seenTopics.add(key)
      topics.push(capitalizeFirst(phrase))
      if (topics.length >= 6) break
    }
  }

  const text = analysis.text
  const contentFlags: DocumentContentFlags = {
    hasImages: analysis.pages.some((page) => page.hasImages),
    hasDiagrams: DIAGRAM_SIGNAL.test(text),
    hasTables: TABLE_SIGNAL.test(text),
    hasFormulas: FORMULA_SIGNAL.test(text),
    hasExercises: EXERCISE_SIGNAL.test(text),
    hasExamQuestions: EXAM_SIGNAL.test(text),
  }

  // Livello di approfondimento: densità testuale + struttura + segnali tecnici.
  const charsPerPage = analysis.textChars / Math.max(analysis.pageCount, 1)
  const structureScore = (analysis.outline?.length ?? 0) / Math.max(analysis.pageCount, 1)
  let depthPoints = 0
  if (analysis.pageCount >= 40) depthPoints += 1
  if (charsPerPage > 1400) depthPoints += 1
  if (structureScore > 0.35) depthPoints += 1
  if (contentFlags.hasFormulas) depthPoints += 1
  if (keywords.length >= 10) depthPoints += 1
  const depthLevel: DocumentDepthLevel = depthPoints >= 4 ? 'avanzato' : depthPoints >= 2 ? 'intermedio' : 'introduttivo'

  return {
    keywords,
    topics,
    abstract,
    depthLevel,
    contentFlags,
    language: analysis.language,
    qualityScore: analysis.review?.score ?? 0,
  }
}

export function generateFlashcards(
  analysis: PdfAnalysis,
  options: { max: number; premium: boolean },
): Flashcard[] {
  const lang = analysis.language
  const candidates = analysis.sentences
    .filter((sentence) => {
      const text = normalizeInlineText(sentence.text)
      const length = text.length
      const words = text.split(/\s+/).length
      if (isNoiseSentence(text)) return false
      if (length < 30 || length > 360 || words < 6) return false
      return hasTechnicalSignal(text) || hasRelationSignal(text, lang) || sentence.kind === 'list'
    })
    .slice(0, MAX_RANK_CANDIDATES)

  if (candidates.length === 0) return []

  const idf = buildIdf(candidates)
  const vectors = candidates.map((sentence) => vectorize(tokenize(sentence.text), idf))
  const rank = textRank(vectors)
  const maxRank = Math.max(...rank, 1e-9)
  const keyphrases = extractKeyphrases(candidates, idf)
  const topKeyphrases = keyphrases.slice(0, options.premium ? 30 : 18)

  const scored = candidates
    .map((sentence, i) => {
      let score = rank[i] / maxRank
      const keyphrase = bestKeyphraseMatch(sentence.text, topKeyphrases)
      if (isDefinitional(sentence.text, lang)) score += 0.5
      if (hasRelationSignal(sentence.text, lang)) score += 0.28
      if (hasTechnicalSignal(sentence.text)) score += 0.18
      if (sentence.kind === 'list') score += 0.12
      if (sentence.section) score += 0.08
      if (keyphrase) score += keyphrase.count > 1 ? 0.32 : 0.22
      if (LOW_VALUE_TERMS.test(sentence.text)) score -= 0.28
      return { sentence, vector: vectors[i], score }
    })
    .sort((a, b) => b.score - a.score)

  const cards: Flashcard[] = []
  const pickedVectors: Map<string, number>[] = []
  const usedFingerprints = new Set<string>()
  let counter = 0

  for (const candidate of scored) {
    if (cards.length >= options.max) break
    if (pickedVectors.some((vector) => cosine(vector, candidate.vector) > 0.72)) continue
    const card = buildCard(candidate.sentence, lang, topKeyphrases, `fc-${(counter += 1)}`)
    if (!card) continue
    card.score = scorePedagogicalCard(card, candidate.sentence, candidate.score)
    if (!passesFlashcardQuality(card)) continue
    const key = `${card.source}:${normalizeInlineText(card.front).toLowerCase().replace(/[?!.]/g, '')}:${normalizeInlineText(card.back).toLowerCase().slice(0, 90)}`
    if (usedFingerprints.has(key)) continue
    usedFingerprints.add(key)
    cards.push(card)
    pickedVectors.push(candidate.vector)
  }

  return cards.sort((a, b) => b.score - a.score).slice(0, options.max)
}
