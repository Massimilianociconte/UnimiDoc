import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildFlashcardCacheKey, generatePremiumFlashcards, type PremiumFlashcard } from './deepseek.js'

const execFile = promisify(execFileCallback)

export type ProcessingTier = 'free' | 'base' | 'premium'
export type CardType =
  | 'definition'
  | 'function'
  | 'process'
  | 'sequence'
  | 'cause_effect'
  | 'comparison'
  | 'classification'
  | 'qa'
  | 'cloze'
  | 'table'
  | 'image'
  | 'chart'
  | 'formula'
  | 'exam_question'

export type PipelineInput = {
  userId: string
  documentId: string
  originalPath: string
  tier: ProcessingTier
  generateFlashcards: boolean
  visibility?: 'private' | 'submitted' | 'published' | 'rejected'
  language?: 'it' | 'en'
  cacheStore?: FlashcardCacheStore
  hasPremiumEntitlement?: (userId: string) => Promise<boolean>
  recordAiCost?: (entry: AiCostLedgerEntry) => Promise<void>
}

export type PdfMetrics = {
  sha256: string
  bytes: number
  pageCount: number
  textHash: string
  nativeTextChars: number
}

export type FlashcardDraft = {
  type: CardType
  front: string
  back: string
  clozeText?: string
  explanation?: string
  tags: string[]
  difficulty: 'easy' | 'medium' | 'hard'
  sourcePageStart: number
  sourcePageEnd: number
  sourceQuote?: string
  generationMethod: 'heuristic' | 'cheap_ai' | 'premium_ai' | 'multimodal_ai'
  qualityScore: number
  hallucinationRisk: number
  modelName?: string
  promptVersion?: string
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  estimatedCostUsd?: number
}

export type StructuredOutlineEntry = {
  title: string
  level: 1 | 2 | 3
  pageStart: number
  pageEnd: number
  confidence: number
  sources: Array<'layout' | 'section' | 'page'>
  ordinal: number
  parentOrdinal: number | null
}

export type FlashcardCacheEntry = {
  cards: FlashcardDraft[]
  modelName?: string
  promptVersion?: string
  estimatedCostUsd?: number
}

export type FlashcardCacheStore = {
  get(cacheKey: string): Promise<FlashcardCacheEntry | null>
  set(cacheKey: string, entry: FlashcardCacheEntry): Promise<void>
}

export type AiCostLedgerEntry = {
  ownerId: string
  documentId: string
  provider: 'deepseek'
  modelName: string
  operation: 'premium_flashcards'
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  cacheKey: string
  promptVersion: string
}

type FlashcardGenerationContext = {
  userId: string
  documentId: string
  documentHash: string
  visibility: 'private' | 'submitted' | 'published' | 'rejected'
  language?: 'it' | 'en'
  cacheStore?: FlashcardCacheStore
  recordAiCost?: (entry: AiCostLedgerEntry) => Promise<void>
}

export async function processUploadedPdf(input: PipelineInput) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'unimidoc-pdf-'))

  try {
    if (input.tier === 'premium' && input.hasPremiumEntitlement) {
      const allowed = await input.hasPremiumEntitlement(input.userId)
      if (!allowed) throw new Error('PREMIUM_ENTITLEMENT_REQUIRED')
    }

    await validatePdf(input.originalPath)

    const before = await inspectPdf(input.originalPath)
    const compressedPath = path.join(workDir, 'compressed.pdf')
    const compression = await compressLosslessPdf(input.originalPath, compressedPath, before)

    const storedPath = await savePrivatePdf({
      userId: input.userId,
      documentId: input.documentId,
      path: compression.outputPath,
      sha256: compression.after.sha256,
    })

    const extracted = await extractNativeText(compression.outputPath)
    const pagesNeedingOcr = selectPagesForOcr(extracted.pages, input.tier)
    const ocrPages = pagesNeedingOcr.length ? await runSelectiveOcr(compression.outputPath, pagesNeedingOcr, input.tier) : []

    const structuredPages = mergeNativeAndOcr(extracted.pages, ocrPages)
    const chunks = chunkStructuredPdf(structuredPages)
    const outline = buildStructuredOutline(structuredPages)

    const flashcards = input.generateFlashcards
      ? await generateFlashcardsCostFirst(chunks, input.tier, {
        userId: input.userId,
        documentId: input.documentId,
        documentHash: before.textHash || before.sha256,
        visibility: input.visibility ?? 'private',
        language: input.language,
        cacheStore: input.cacheStore,
        recordAiCost: input.recordAiCost,
      })
      : []

    return {
      storagePath: storedPath,
      compression,
      outline,
      chunks,
      flashcards,
    }
  } finally {
    await rm(workDir, { force: true, recursive: true })
  }
}

async function validatePdf(filePath: string) {
  const fileHandle = await open(filePath, 'r')
  const header = Buffer.alloc(5)

  try {
    await fileHandle.read(header, 0, header.length, 0)
  } finally {
    await fileHandle.close()
  }

  if (header.toString('utf8') !== '%PDF-') {
    throw new Error('INVALID_PDF_MAGIC_BYTES')
  }

  const file = await stat(filePath)
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('PDF_TOO_LARGE')
  }

  await execFile('qpdf', ['--check', filePath])
}

async function inspectPdf(filePath: string): Promise<PdfMetrics> {
  const [bytes, sha256, pageCount, nativeText] = await Promise.all([
    stat(filePath).then((file) => file.size),
    sha256File(filePath),
    readPageCount(filePath),
    extractTextWithPdftotext(filePath),
  ])

  return {
    sha256,
    bytes,
    pageCount,
    textHash: sha256String(normalizeText(nativeText)),
    nativeTextChars: normalizeText(nativeText).length,
  }
}

async function compressLosslessPdf(inputPath: string, outputPath: string, before: PdfMetrics) {
  await execFile('qpdf', [
    '--object-streams=generate',
    '--stream-data=compress',
    '--recompress-flate',
    '--compression-level=9',
    '--remove-unreferenced-resources=auto',
    inputPath,
    outputPath,
  ])

  const after = await inspectPdf(outputPath)
  const verified = verifyLosslessCompression(before, after)

  if (!verified || after.bytes >= before.bytes) {
    return {
      method: 'kept_original',
      outputPath: inputPath,
      before,
      after: before,
      savedBytes: 0,
    }
  }

  return {
    method: 'qpdf_lossless',
    outputPath,
    before,
    after,
    savedBytes: before.bytes - after.bytes,
  }
}

function verifyLosslessCompression(before: PdfMetrics, after: PdfMetrics) {
  const samePageCount = before.pageCount === after.pageCount
  const sameText = before.textHash === after.textHash
  const reasonableSize = after.bytes > 0 && after.bytes <= before.bytes

  return samePageCount && sameText && reasonableSize
}

async function extractNativeText(filePath: string) {
  const text = await extractTextWithPdftotext(filePath)
  const pages = text.split('\f').map((content, index) => ({
    pageNumber: index + 1,
    text: cleanExtractedPageText(content),
    textQualityScore: scoreNativeText(content),
  }))

  return { pages }
}

function selectPagesForOcr(
  pages: Array<{ pageNumber: number; text: string; textQualityScore: number }>,
  tier: ProcessingTier,
) {
  const maxPages = tier === 'premium' ? 80 : 12

  return pages
    .filter((page) => page.text.length < 350 || page.textQualityScore < 0.58)
    .slice(0, maxPages)
    .map((page) => page.pageNumber)
}

async function runSelectiveOcr(_filePath: string, pageNumbers: number[], tier: ProcessingTier) {
  if (tier === 'free') return []

  // Production worker: render only selected pages, run OCRmyPDF/Tesseract locally,
  // then use premium multimodal AI only when figures or formulas remain ambiguous.
  return pageNumbers.map((pageNumber) => ({
    pageNumber,
    text: '',
    textQualityScore: 0,
  }))
}

function mergeNativeAndOcr(
  nativePages: Array<{ pageNumber: number; text: string; textQualityScore: number }>,
  ocrPages: Array<{ pageNumber: number; text: string; textQualityScore: number }>,
) {
  const ocrByPage = new Map(ocrPages.map((page) => [page.pageNumber, page]))

  return nativePages.map((page) => {
    const ocrPage = ocrByPage.get(page.pageNumber)
    return ocrPage && ocrPage.textQualityScore > page.textQualityScore ? ocrPage : page
  })
}

type StructuredChunk = {
  chunkIndex: number
  pageStart: number
  pageEnd: number
  sectionPath: string[]
  content: string
  contentSha256: string
}

type TextBlock = { kind: 'heading' | 'paragraph' | 'list'; text: string; level?: 1 | 2 | 3 }

function chunkStructuredPdf(pages: Array<{ pageNumber: number; text: string }>): StructuredChunk[] {
  const chunks: StructuredChunk[] = []
  let chunkIndex = 0
  let buffer: string[] = []
  let pageStart = 0
  let pageEnd = 0
  let sectionPath: string[] = []

  const flush = () => {
    const content = buffer.join('\n\n').trim()
    if (!content) return
    chunks.push(createChunk({
      chunkIndex,
      pageStart,
      pageEnd,
      sectionPath,
      content,
    }))
    chunkIndex += 1
    buffer = []
    pageStart = 0
    pageEnd = 0
  }

  for (const page of pages) {
    const blocks = splitStructuredBlocks(page.text)

    for (const block of blocks) {
      if (block.kind === 'heading') {
        if (buffer.join('\n\n').length >= 700) flush()
        sectionPath = updateSectionPath(sectionPath, block.text, block.level ?? 2)
        continue
      }

      if (!pageStart) pageStart = page.pageNumber
      pageEnd = page.pageNumber
      const paragraph = block.kind === 'list' ? `- ${block.text}` : block.text
      const nextLength = buffer.join('\n\n').length + paragraph.length + 2
      const hardLimit = block.kind === 'list' ? 3400 : 3000
      if (buffer.length && nextLength > hardLimit) flush()
      if (!pageStart) pageStart = page.pageNumber
      pageEnd = page.pageNumber
      buffer.push(paragraph)
    }
  }

  flush()
  return chunks
}

function splitStructuredBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = normalizeText(paragraph.join(' '))
    if (text.length >= 18 && !isLowValueLine(text)) blocks.push({ kind: 'paragraph', text })
    paragraph = []
  }

  for (const rawLine of text.split('\n')) {
    const line = normalizeText(rawLine)
    if (!line || isLowValueLine(line)) {
      flushParagraph()
      continue
    }
    if (isHeadingLine(line)) {
      flushParagraph()
      blocks.push({ kind: 'heading', text: stripHeadingNumber(line), level: headingLevel(line) })
      continue
    }
    if (/^(?:[-*•]|\d+[.)])\s+\S/.test(line)) {
      flushParagraph()
      blocks.push({ kind: 'list', text: line.replace(/^(?:[-*•]|\d+[.)])\s+/, '') })
      continue
    }
    paragraph.push(line)
  }

  flushParagraph()
  return blocks
}

function buildStructuredOutline(pages: Array<{ pageNumber: number; text: string }>): StructuredOutlineEntry[] {
  const candidates: Array<Omit<StructuredOutlineEntry, 'pageEnd' | 'ordinal' | 'parentOrdinal'>> = []

  for (const page of pages) {
    const blocks = splitStructuredBlocks(page.text)
    blocks.forEach((block, index) => {
      if (block.kind !== 'heading') return
      const title = normalizeText(block.text).replace(/[.:;,\s]+$/, '')
      if (!title || isLowValueLine(title)) return
      candidates.push({
        title,
        level: block.level ?? 2,
        pageStart: page.pageNumber,
        confidence: Math.min(0.88, 0.54 + (block.level === 1 ? 0.18 : block.level === 2 ? 0.1 : 0.04) + (index <= 2 ? 0.08 : 0)),
        sources: ['layout'],
      })
    })
  }

  const selected = candidates.length >= Math.min(4, Math.ceil(pages.length / 4))
    ? dedupeOutline(candidates)
    : pages
      .map((page) => {
        const firstUseful = splitStructuredBlocks(page.text)
          .find((block) => block.kind !== 'heading' && block.text.length >= 40 && !isLowValueLine(block.text))
        return firstUseful
          ? {
              title: normalizeText(firstUseful.text).split(/[.!?]/)[0]?.slice(0, 82) || `Pagina ${page.pageNumber}`,
              level: 1 as const,
              pageStart: page.pageNumber,
              confidence: 0.34,
              sources: ['page' as const],
            }
          : null
      })
      .filter((entry): entry is Omit<StructuredOutlineEntry, 'pageEnd' | 'ordinal' | 'parentOrdinal'> => Boolean(entry))

  const stack: Array<{ level: 1 | 2 | 3; ordinal: number }> = []
  return selected.slice(0, 220).map((entry, index) => {
    while (stack.length && stack[stack.length - 1].level >= entry.level) stack.pop()
    const next = selected.slice(index + 1).find((candidate) => candidate.level <= entry.level)
    const finalized: StructuredOutlineEntry = {
      ...entry,
      pageEnd: next ? Math.max(entry.pageStart, next.pageStart - 1) : pages.length,
      ordinal: index,
      parentOrdinal: stack[stack.length - 1]?.ordinal ?? null,
    }
    stack.push({ level: finalized.level, ordinal: index })
    return finalized
  })
}

function dedupeOutline<T extends { title: string; pageStart: number; confidence: number }>(candidates: T[]): T[] {
  const seen = new Map<string, T>()
  for (const candidate of candidates) {
    const key = `${candidate.pageStart}-${candidate.title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()}`
    const existing = seen.get(key)
    if (!existing || candidate.confidence > existing.confidence) seen.set(key, candidate)
  }
  return [...seen.values()].sort((a, b) => a.pageStart - b.pageStart || b.confidence - a.confidence)
}

function updateSectionPath(current: string[], title: string, level: 1 | 2 | 3) {
  const next = [...current]
  next[level - 1] = title
  next.length = level
  return next
}

async function generateFlashcardsCostFirst(
  chunks: ReturnType<typeof chunkStructuredPdf>,
  tier: ProcessingTier,
  context: FlashcardGenerationContext,
): Promise<FlashcardDraft[]> {
  const heuristicCards = chunks.flatMap(generateHeuristicCards)
  const cardsNeedingAi = rankChunksForPremiumAi(chunks.filter((chunk) => shouldUseAi(chunk.content, tier)))
  const aiCards = await batchGenerateAiCards(cardsNeedingAi, tier, context)
  const merged = dedupeFlashcards([...heuristicCards, ...aiCards])

  return qualityGate(merged).slice(0, flashcardLimitForTier(tier))
}

function generateHeuristicCards(chunk: ReturnType<typeof chunkStructuredPdf>[number]): FlashcardDraft[] {
  const cards: FlashcardDraft[] = []
  const sentences = chunk.content
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 380)

  for (const sentence of sentences) {
    const definition = sentence.match(/^(.{3,80}?)\s+(?:è|sono|si definisce|viene definito|indica|rappresenta|costituisce)\s+(.{12,260})[.]?$/i)
    if (definition) {
      cards.push(createHeuristicCard({
        chunk,
        type: 'definition',
        front: `Che cos'è ${stripArticle(definition[1])}?`,
        back: definition[2],
        sourceQuote: sentence,
        qualityScore: 0.78,
      }))
      continue
    }

    const classification = sentence.match(/^(.{4,90}?)\s+(?:si distinguono in|si classificano in|comprendono|include|includono|sono costituit[ie]? da|sono compost[ie]? da)\s+(.{12,260})[.]?$/i)
    if (classification) {
      cards.push(createHeuristicCard({
        chunk,
        type: 'classification',
        front: `In quali categorie si distingue ${stripArticle(classification[1])}?`,
        back: classification[2],
        sourceQuote: sentence,
        qualityScore: 0.76,
      }))
      continue
    }

    const cause = sentence.match(/^(.{4,95}?)\s+(?:causa|provoca|determina|induce|favorisce|inibisce|porta a|riduce|aumenta)\s+(.{8,260})[.]?$/i)
    if (cause) {
      cards.push(createHeuristicCard({
        chunk,
        type: 'cause_effect',
        front: `Quale effetto ha ${stripArticle(cause[1])}?`,
        back: cause[2],
        sourceQuote: sentence,
        qualityScore: 0.75,
      }))
      continue
    }

    const comparison = sentence.match(/^(.{4,90}?)\s+(?:differisce|differiscono|si distingue|si distinguono)\s+(?:da|dal|dalla|dai|dagli|dalle)\s+(.{8,220})[.]?$/i)
    if (comparison) {
      cards.push(createHeuristicCard({
        chunk,
        type: 'comparison',
        front: `Da cosa si distingue ${stripArticle(comparison[1])}?`,
        back: comparison[2],
        sourceQuote: sentence,
        qualityScore: 0.74,
      }))
      continue
    }

    const acronym = sentence.match(/\b([A-Z]{2,8})\s*\(([^)]{4,90})\)|\b([^().]{4,90})\s+\(([A-Z]{2,8})\)/)
    if (acronym) {
      const short = acronym[1] ?? acronym[4]
      const long = acronym[2] ?? acronym[3]
      if (short && long && long.split(/\s+/).length <= 10) {
        cards.push(createHeuristicCard({
          chunk,
          type: 'definition',
          front: `Che cosa significa ${short}?`,
          back: long,
          sourceQuote: sentence,
          qualityScore: 0.8,
        }))
      }
    }
  }

  return cards.slice(0, 5)
}

function createHeuristicCard(input: {
  chunk: ReturnType<typeof chunkStructuredPdf>[number]
  type: CardType
  front: string
  back: string
  sourceQuote: string
  qualityScore: number
}): FlashcardDraft {
  return {
    type: input.type,
    front: normalizeText(input.front),
    back: compactAnswer(input.back),
    sourceQuote: compactAnswer(input.sourceQuote, 420),
    tags: inferTags(input.chunk.content),
    difficulty: 'medium',
    sourcePageStart: input.chunk.pageStart,
    sourcePageEnd: input.chunk.pageEnd,
    generationMethod: 'heuristic',
    qualityScore: input.qualityScore,
    hallucinationRisk: 0.05,
  }
}

function shouldUseAi(content: string, tier: ProcessingTier) {
  if (tier !== 'premium') return false

  const hasDenseScience = /enzim|gene|cellul|prote|membran|metabol|cromosom|sequenz|formula/i.test(content)
  const hasComparison = /\b(differenza|rispetto a|mentre|invece|confronto)\b/i.test(content)
  const hasProcess = /\b(fase|fasi|prima|poi|successivamente|infine|meccanismo|processo)\b/i.test(content)
  const hasCauseEffect = /\b(causa|provoca|determina|induce|favorisce|inibisce|porta a)\b/i.test(content)

  return hasDenseScience || hasComparison || hasProcess || hasCauseEffect
}

async function batchGenerateAiCards(
  chunks: ReturnType<typeof chunkStructuredPdf>,
  tier: ProcessingTier,
  context: FlashcardGenerationContext,
): Promise<FlashcardDraft[]> {
  if (tier !== 'premium' || chunks.length === 0) return []

  const cards: FlashcardDraft[] = []
  const maxChunks = readPositiveInt(process.env.PREMIUM_FLASHCARD_CHUNK_LIMIT, 8)

  for (const chunk of chunks.slice(0, maxChunks)) {
    const request = {
      userId: context.userId,
      documentId: context.documentId,
      documentHash: context.documentHash,
      visibility: context.visibility,
      generationMode: 'premium' as const,
      language: context.language ?? 'it',
      detailLevel: 'standard' as const,
      maxCards: 8,
      chunk: {
        id: `chunk-${chunk.chunkIndex}`,
        text: chunk.content,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        contentSha256: chunk.contentSha256,
        sectionPath: chunk.sectionPath,
      },
    }
    const cacheKey = buildFlashcardCacheKey(request)
    const cached = await context.cacheStore?.get(cacheKey)
    if (cached) {
      cards.push(...cached.cards.map((card) => ({ ...card, generationMethod: 'premium_ai' as const })))
      continue
    }

    const result = await generatePremiumFlashcards(request)
    const mapped = result.flashcards.map((card) => mapPremiumCard(card, result, chunk))
    cards.push(...mapped)

    await context.cacheStore?.set(cacheKey, {
      cards: mapped,
      modelName: result.model,
      promptVersion: result.promptVersion,
      estimatedCostUsd: result.costUsd,
    })

    await context.recordAiCost?.({
      ownerId: context.userId,
      documentId: context.documentId,
      provider: 'deepseek',
      modelName: result.model,
      operation: 'premium_flashcards',
      inputTokens: result.usage.prompt_tokens ?? 0,
      cachedInputTokens: result.usage.prompt_cache_hit_tokens ?? 0,
      outputTokens: result.usage.completion_tokens ?? 0,
      estimatedCostUsd: result.costUsd,
      cacheKey: result.cacheKey,
      promptVersion: result.promptVersion,
    })
  }

  return cards
}

function mapPremiumCard(
  card: PremiumFlashcard,
  result: Awaited<ReturnType<typeof generatePremiumFlashcards>>,
  chunk: ReturnType<typeof chunkStructuredPdf>[number],
): FlashcardDraft {
  const typeMap: Record<PremiumFlashcard['type'], CardType> = {
    qa: 'qa',
    cloze: 'cloze',
    definition: 'definition',
    comparison: 'comparison',
    process: 'process',
    cause_effect: 'cause_effect',
    exam_question: 'exam_question',
  }

  return {
    type: typeMap[card.type],
    front: card.question,
    back: card.answer,
    clozeText: card.clozeText ?? undefined,
    tags: card.tags,
    difficulty: card.difficulty,
    sourcePageStart: card.pageStart ?? chunk.pageStart,
    sourcePageEnd: card.pageEnd ?? chunk.pageEnd,
    sourceQuote: card.sourceQuote,
    generationMethod: 'premium_ai',
    qualityScore: 0.86,
    hallucinationRisk: 0.08,
    modelName: result.model,
    promptVersion: result.promptVersion,
    inputTokens: result.usage.prompt_tokens ?? 0,
    outputTokens: result.usage.completion_tokens ?? 0,
    cachedInputTokens: result.usage.prompt_cache_hit_tokens ?? 0,
    estimatedCostUsd: result.costUsd,
  }
}

function dedupeFlashcards(cards: FlashcardDraft[]) {
  const seen = new Set<string>()

  return cards.filter((card) => {
    const fingerprint = sha256String(`${normalizeText(card.front)}\n${normalizeText(card.back)}`)
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

function qualityGate(cards: FlashcardDraft[]) {
  return cards.filter((card) => {
    const isAtomic = card.front.length < 280 && card.back.length < 900
    const isSpecific = !/spiega tutto|parla di|cosa sai/i.test(card.front)
    const isSafe = card.hallucinationRisk <= 0.25

    return card.qualityScore >= 0.65 && isAtomic && isSpecific && isSafe
  })
}

function rankChunksForPremiumAi(chunks: ReturnType<typeof chunkStructuredPdf>) {
  return [...chunks].sort((a, b) => scoreChunkForFlashcards(b.content) - scoreChunkForFlashcards(a.content))
}

function scoreChunkForFlashcards(content: string) {
  let score = 0
  if (/enzim|gene|cellul|prote|membran|metabol|cromosom|sequenz|formula/i.test(content)) score += 3
  if (/\b(è|sono|si definisce|rappresenta|indica|costituisce)\b/i.test(content)) score += 2
  if (/\b(causa|provoca|determina|induce|favorisce|inibisce|porta a)\b/i.test(content)) score += 2
  if (/\b(differenza|rispetto a|mentre|invece|confronto)\b/i.test(content)) score += 1.5
  if (/\b(fase|fasi|prima|poi|successivamente|infine|processo|meccanismo)\b/i.test(content)) score += 1.5
  score += Math.min(2, normalizeText(content).length / 1800)
  return score
}

function flashcardLimitForTier(tier: ProcessingTier) {
  if (tier === 'premium') return readPositiveInt(process.env.PREMIUM_MAX_FLASHCARDS_PER_DOCUMENT, 120)
  if (tier === 'base') return readPositiveInt(process.env.BASE_FLASHCARD_LIMIT, 40)
  return readPositiveInt(process.env.FREE_FLASHCARD_LIMIT, 15)
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function stripArticle(term: string) {
  return term
    .replace(/^(?:il|lo|la|i|gli|le|un|uno|una|l')\s+/i, '')
    .replace(/[.,;:]+$/, '')
    .trim()
}

function compactAnswer(value: string, maxLength = 420) {
  const clean = normalizeText(value).replace(/^[,:;\s-]+/, '')
  if (clean.length <= maxLength) return clean
  const stop = clean.slice(0, maxLength).lastIndexOf('.')
  if (stop > 120) return clean.slice(0, stop + 1)
  return `${clean.slice(0, maxLength).replace(/\s+\S*$/, '')}…`
}

function createChunk(input: {
  chunkIndex: number
  pageStart: number
  pageEnd: number
  sectionPath: string[]
  content: string
}) {
  return {
    chunkIndex: input.chunkIndex,
    pageStart: input.pageStart,
    pageEnd: input.pageEnd,
    sectionPath: input.sectionPath.length ? input.sectionPath : inferSectionPath(input.content),
    content: input.content,
    contentSha256: sha256String(normalizeText(input.content)),
  }
}

function inferSectionPath(content: string) {
  const firstLine = content.split('\n').find((line) => line.trim().length > 4)
  return firstLine && firstLine.length < 90 ? [firstLine.trim()] : []
}

function inferTags(content: string) {
  return Array.from(content.matchAll(/\b(DNA|RNA|ATP|enzima|gene|cellula|proteina|membrana)\b/gi))
    .map((match) => match[0].toLocaleLowerCase('it-IT'))
    .slice(0, 5)
}

function cleanExtractedPageText(text: string) {
  return text
    .replace(/([A-Za-zÀ-ÿ])-\s*\n\s*([a-zà-ÿ])/g, '$1$2')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !isLowValueLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isLowValueLine(line: string) {
  const clean = normalizeText(line)
  if (!clean) return true
  if (/^(?:pag(?:ina)?\.?\s*)?\d+\s*(?:\/\s*\d+)?$/i.test(clean)) return true
  if (/^https?:\/\/|^www\.|^[-_—–]{3,}$/.test(clean)) return true
  if (/\b(copyright|creative commons|licenza|bibliografia|references|table of contents)\b/i.test(clean) && clean.length < 90) {
    return true
  }
  const digits = clean.match(/\d/g)?.length ?? 0
  return clean.length < 24 && digits / Math.max(1, clean.length) > 0.35
}

function isHeadingLine(line: string) {
  const clean = normalizeText(line)
  if (clean.length < 4 || clean.length > 110) return false
  if (/[.!?]$/.test(clean)) return false
  const words = clean.split(/\s+/)
  if (words.length > 12) return false
  if (/^\d+(?:\.\d+){0,3}\s+\S/.test(clean)) return true
  const letters = clean.match(/[A-Za-zÀ-ÿ]/g)?.length ?? 0
  const uppercase = clean.match(/[A-ZÀ-Ü]/g)?.length ?? 0
  const titleCase = words.filter((word) => /^[A-ZÀ-Ü]/.test(word)).length >= Math.ceil(words.length * 0.55)
  return letters >= 3 && (uppercase / Math.max(1, letters) > 0.5 || titleCase)
}

function headingLevel(line: string): 1 | 2 | 3 {
  const clean = normalizeText(line)
  if (/^\d+\s+\S/.test(clean) || /^[A-ZÀ-Ü0-9\s]{8,}$/.test(clean)) return 1
  if (/^\d+\.\d+\s+\S/.test(clean) || clean.length <= 54) return 2
  return 3
}

function stripHeadingNumber(line: string) {
  return normalizeText(line).replace(/^\d+(?:\.\d+)*\s+/, '').replace(/[.:;,\s]+$/, '')
}

function scoreNativeText(text: string) {
  const normalized = normalizeText(text)
  if (!normalized) return 0

  const replacementRatio = (normalized.match(/\uFFFD/g)?.length ?? 0) / normalized.length
  const alphaRatio = (normalized.match(/[A-Za-zÀ-Úà-ú]/g)?.length ?? 0) / normalized.length
  const averageLineLength = normalized.split('\n').reduce((sum, line) => sum + line.length, 0) / Math.max(1, normalized.split('\n').length)

  return clamp(alphaRatio * 0.7 + Math.min(averageLineLength / 70, 1) * 0.3 - replacementRatio, 0, 1)
}

async function savePrivatePdf(_input: { userId: string; documentId: string; path: string; sha256: string }) {
  // Production implementation: upload to Supabase Storage with service role.
  // Path format: `${userId}/documents/${documentId}/document.pdf`.
  return 'private-documents/user-id/documents/document-id/document.pdf'
}

async function readPageCount(filePath: string) {
  const { stdout } = await execFile('pdfinfo', [filePath])
  const match = stdout.match(/^Pages:\s+(\d+)/m)
  if (!match) throw new Error('PDFINFO_PAGE_COUNT_FAILED')
  return Number(match[1])
}

async function extractTextWithPdftotext(filePath: string) {
  const { stdout } = await execFile('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-'], {
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

async function sha256File(filePath: string) {
  return sha256String(await readFile(filePath))
}

function sha256String(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
