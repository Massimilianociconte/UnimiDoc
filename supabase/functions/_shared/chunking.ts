// Section-aware chunking used by rag-index when a document has no persisted
// pdf_chunks yet (i.e. it was uploaded before the flashcard pipeline ran, or
// the pipeline never ran). It mirrors the strategy of
// server/pdf-pipeline/pipeline.ts::chunkStructuredPdf — heading detection,
// token-target windows, moderate overlap — but works from the per-page
// native_text stored in pdf_pages, which is what we always have server-side.
//
// When pdf_chunks already exist for a document, rag-index uses those verbatim
// and this module is not involved (no duplicate chunking).

export type PageText = { pageNumber: number; text: string }

export type BuiltChunk = {
  chunkIndex: number
  pageStart: number
  pageEnd: number
  sectionPath: string[]
  content: string
  tokenEstimate: number
}

// ~4 chars per token is the usual English/Italian heuristic.
const TOKEN_TARGET = 700 // within the 500–900 target band
const TOKEN_MAX = 900
const TOKEN_MIN = 120
const OVERLAP_TOKENS = 120

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function isHeading(line: string): { title: string; level: 1 | 2 | 3 } | null {
  const trimmed = line.trim()
  if (trimmed.length < 3 || trimmed.length > 90) return null
  // Numbered heading: "1", "1.2", "3.4.5 Titolo"
  const numbered = trimmed.match(/^(\d+(?:\.\d+){0,2})[.)]?\s+(.{3,80})$/)
  if (numbered) {
    const depth = numbered[1].split('.').length
    return { title: `${numbered[1]} ${numbered[2]}`.trim(), level: Math.min(depth, 3) as 1 | 2 | 3 }
  }
  // Chapter/section keywords.
  if (/^(capitolo|capitol|chapter|sezione|section|parte|unità|lezione)\b/i.test(trimmed)) {
    return { title: trimmed, level: 1 }
  }
  // Short ALL-CAPS or Title-Case standalone line with no terminal punctuation.
  const words = trimmed.split(/\s+/)
  if (words.length <= 9 && !/[.!?;:]$/.test(trimmed)) {
    const isUpper = trimmed === trimmed.toUpperCase() && /[A-ZÀ-Ù]/.test(trimmed)
    if (isUpper) return { title: trimmed, level: 2 }
  }
  return null
}

function updateSectionPath(path: string[], title: string, level: 1 | 2 | 3): string[] {
  const next = path.slice(0, level - 1)
  next[level - 1] = title
  return next.filter(Boolean)
}

function splitLongLine(line: string): string[] {
  const maxChars = OVERLAP_TOKENS * 4
  if (line.length <= maxChars) return [line]
  const parts: string[] = []
  let current = ''
  for (const word of line.split(/\s+/)) {
    if (word.length > maxChars) {
      if (current) parts.push(current)
      for (let offset = 0; offset < word.length; offset += maxChars) {
        parts.push(word.slice(offset, offset + maxChars))
      }
      current = ''
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      parts.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts
}

/** Splits page text into token-bounded, section-aware chunks with overlap. */
export function chunkPages(pages: PageText[]): BuiltChunk[] {
  const chunks: BuiltChunk[] = []
  let chunkIndex = 0
  let sectionPath: string[] = []

  type BufferedLine = { text: string; pageNumber: number }
  let buffer: BufferedLine[] = []
  let bufferTokens = 0
  let bufferSectionPath: string[] = []
  // Number of leading buffered lines copied from the previously emitted
  // chunk. Keeping this separate from fresh text prevents that overlap from
  // becoming a standalone duplicate at EOF or immediately before a heading.
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
      // Fold only into the same section; crossing a heading would corrupt the
      // chapter/section metadata used by citations and flashcard filters. Only
      // append fresh text: the overlap is already present in the prior chunk.
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
    // Carry a small overlap tail into the next chunk for context continuity.
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
    const lines = page.text.split(/\r?\n/)
    for (const rawLine of lines) {
      const heading = isHeading(rawLine)
      if (heading) {
        // A heading always starts a new semantic section. Do not carry overlap
        // from the previous section or label preceding prose with the new one.
        if (buffer.length > 0) flush(false)
        sectionPath = updateSectionPath(sectionPath, heading.title, heading.level)
      }
      if (rawLine.trim().length === 0) continue
      for (const line of splitLongLine(rawLine)) {
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
      }
    }
  }
  flush()
  return chunks
}
