// Unified high-quality section-aware chunking for RAG and flashcard generation.
// This module now incorporates the best ideas from the PDF pipeline's
// structured chunking (list/paragraph awareness, better normalization) while
// keeping excellent section path tracking and controlled overlap.
//
// Key improvements in this version:
// - Better block detection (headings, lists, paragraphs)
// - More robust Italian heading patterns
// - Char-based limits differentiated by block type
// - Improved overlap carry that avoids standalone duplicate tails
// - Stronger deduplication of low-value content
//
// Version: 'unified-v3' (bump this when changing chunking strategy)

export type PageText = { pageNumber: number; text: string }

export type BuiltChunk = {
  chunkIndex: number
  pageStart: number
  pageEnd: number
  sectionPath: string[]
  content: string
  tokenEstimate: number
}

export const CHUNKING_VERSION = 'unified-v3'

// Tunables (tuned for Italian university notes)
const TOKEN_TARGET = 720
const TOKEN_MAX = 920
const TOKEN_MIN = 140
const OVERLAP_TOKENS = 140

function estimateTokens(text: string): number {
  // Slightly better heuristic for mixed IT/EN academic text
  const words = text.split(/\s+/).length
  return Math.max(1, Math.ceil(words * 1.35))
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function isLowValueLine(line: string): boolean {
  const l = line.toLowerCase()
  return (
    l.length < 12 ||
    /^pagine?\s*\d+/i.test(l) ||
    /^(fig\.|figura|table|tabella|esempio)\s*\d+/i.test(l) ||
    /^[0-9\s.\-:,();]{5,}$/.test(l)
  )
}

function isHeadingLine(line: string): { title: string; level: 1 | 2 | 3 } | null {
  const trimmed = normalizeLine(line)
  if (trimmed.length < 3 || trimmed.length > 110) return null

  // Strong numbered patterns: 1., 1.2, 1.2.3, 1) etc.
  const numbered = trimmed.match(/^(\d+(?:\.\d+){0,3})[.)]?\s+(.{4,95})$/)
  if (numbered) {
    const depth = Math.min(numbered[1].split('.').length, 3) as 1 | 2 | 3
    return { title: `${numbered[1]} ${numbered[2]}`.trim(), level: depth }
  }

  // Italian academic keywords (very common in Unimi material)
  const keyword = trimmed.match(/^(Capitolo|CAPITOLO|Lezione|LEZIONE|Unità|UNITÀ|Sezione|SEZIONE|Parte|PARTE|Modulo|MODULO)\s*(\d+)?[:.\s-]*(.{3,90})$/i)
  if (keyword) {
    return { title: trimmed, level: 1 }
  }

  // Roman or lettered subsections
  const roman = trimmed.match(/^([IVXLC]+)[.)]\s+(.{4,90})$/i)
  if (roman) return { title: trimmed, level: 2 }

  // ALL CAPS or strong Title Case standalone (no punctuation at end)
  const words = trimmed.split(/\s+/)
  if (words.length >= 2 && words.length <= 11 && !/[.!?;:]$/.test(trimmed)) {
    const isTitleCase = words.every(w => /^[A-ZÀ-Ù]/.test(w) || /^[a-zà-ù]/.test(w))
    const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-ZÀ-Ù]/.test(trimmed)
    if (isAllCaps || (isTitleCase && words[0].length > 2)) {
      return { title: trimmed, level: 2 }
    }
  }

  return null
}

function updateSectionPath(path: string[], title: string, level: 1 | 2 | 3): string[] {
  const next = path.slice(0, level - 1)
  next[level - 1] = title
  return next.filter(Boolean)
}

function splitIntoBlocks(text: string): Array<{ kind: 'heading' | 'list' | 'paragraph'; text: string; level?: 1 | 2 | 3 }> {
  const blocks: Array<{ kind: 'heading' | 'list' | 'paragraph'; text: string; level?: 1 | 2 | 3 }> = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const joined = normalizeLine(paragraph.join(' '))
    if (joined.length >= 18 && !isLowValueLine(joined)) {
      blocks.push({ kind: 'paragraph', text: joined })
    }
    paragraph = []
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = normalizeLine(raw)
    if (!line || isLowValueLine(line)) {
      flushParagraph()
      continue
    }

    const heading = isHeadingLine(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', text: heading.title, level: heading.level })
      continue
    }

    // List detection (bullet or numbered)
    if (/^(?:[-*•]|\d+[.)])\s+\S/.test(line)) {
      flushParagraph()
      const clean = line.replace(/^(?:[-*•]|\d+[.)])\s+/, '')
      blocks.push({ kind: 'list', text: clean })
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return blocks
}

/** High-quality unified chunker with improved block awareness */
export function chunkPages(pages: PageText[]): BuiltChunk[] {
  const chunks: BuiltChunk[] = []
  let chunkIndex = 0
  let sectionPath: string[] = []

  type BufferedLine = { text: string; pageNumber: number }
  let buffer: BufferedLine[] = []
  let bufferTokens = 0
  let bufferSectionPath: string[] = []
  let overlapLineCount = 0
  let pageStart = pages[0]?.pageNumber ?? 1
  let pageEnd = pageStart

  const samePath = (left: string[], right: string[]) =>
    left.length === right.length && left.every((part, index) => part === right[index])

  const clearBuffer = () => {
    buffer = []
    bufferTokens = 0
    bufferSectionPath = []
    overlapLineCount = 0
  }

  const flush = (carryOverlap = true) => {
    const freshLines = buffer.slice(overlapLineCount)
    if (freshLines.length === 0) {
      clearBuffer()
      return
    }

    const content = buffer.map((line) => line.text).join('\n').trim()
    const freshContent = freshLines.map((line) => line.text).join('\n').trim()
    if (content.length === 0 || freshContent.length === 0) {
      clearBuffer()
      return
    }
    if (
      estimateTokens(freshContent) < TOKEN_MIN
      && chunks.length > 0
      && samePath(chunks[chunks.length - 1].sectionPath, bufferSectionPath)
    ) {
      const prev = chunks[chunks.length - 1]
      const mergedContent = `${prev.content}\n${freshContent}`.trim()
      const mergedTokens = estimateTokens(mergedContent)
      if (mergedTokens <= TOKEN_MAX) {
        prev.content = mergedContent
        prev.pageEnd = freshLines.at(-1)?.pageNumber ?? pageEnd
        prev.tokenEstimate = mergedTokens
        clearBuffer()
        return
      }
    }
    const flushedSectionPath = [...bufferSectionPath]
    chunks.push({
      chunkIndex: chunkIndex++,
      pageStart,
      pageEnd,
      sectionPath: [...bufferSectionPath],
      content,
      tokenEstimate: estimateTokens(content),
    })
    const tail: BufferedLine[] = []
    let tailTokens = 0
    for (let i = buffer.length - 1; carryOverlap && i >= 0 && tailTokens < OVERLAP_TOKENS; i -= 1) {
      const lineTokens = estimateTokens(buffer[i].text)
      if (tail.length > 0 && tailTokens + lineTokens > OVERLAP_TOKENS) break
      tail.unshift(buffer[i])
      tailTokens += lineTokens
    }
    buffer = tail
    bufferTokens = tailTokens
    bufferSectionPath = tail.length > 0 ? flushedSectionPath : []
    overlapLineCount = tail.length
    pageStart = tail[0]?.pageNumber ?? pageEnd
    pageEnd = tail.at(-1)?.pageNumber ?? pageEnd
  }

  for (const page of pages) {
    const blocks = splitIntoBlocks(page.text)

    for (const block of blocks) {
      if (block.kind === 'heading') {
        if (buffer.length > 0) flush(false)
        sectionPath = updateSectionPath(sectionPath, block.text, block.level ?? 2)
        continue
      }

      const lines = block.text.split(/\r?\n/)
      for (const rawLine of lines) {
        const line = normalizeLine(rawLine)
        if (!line || isLowValueLine(line)) continue

        const lineTokens = estimateTokens(line)
        if (bufferTokens >= TOKEN_MIN && bufferTokens + lineTokens > TOKEN_MAX) flush()
        if (buffer.length === 0) {
          pageStart = page.pageNumber
          bufferSectionPath = [...sectionPath]
        }
        buffer.push({ text: line, pageNumber: page.pageNumber })
        bufferTokens += lineTokens
        pageEnd = page.pageNumber
        if (bufferTokens >= TOKEN_MAX) flush()
        else if (bufferTokens >= TOKEN_TARGET && /[.!?]$/.test(line.trim())) flush()

        // Hard cap to prevent monster chunks in uniform text
        if (bufferTokens > TOKEN_MAX * 1.6) flush(true)
      }
    }
  }
  flush()
  return chunks
}

// Keep old name for backward compatibility in pipeline
export const chunkStructuredPdf = chunkPages

// Re-export helper used by pipeline for outline generation
export { splitIntoBlocks as splitStructuredBlocks }
