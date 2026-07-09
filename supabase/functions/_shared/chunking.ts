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

/** Splits page text into token-bounded, section-aware chunks with overlap. */
export function chunkPages(pages: PageText[]): BuiltChunk[] {
  const chunks: BuiltChunk[] = []
  let chunkIndex = 0
  let sectionPath: string[] = []

  let buffer: string[] = []
  let bufferTokens = 0
  let pageStart = pages[0]?.pageNumber ?? 1
  let pageEnd = pageStart

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content.length === 0) return
    if (estimateTokens(content) < TOKEN_MIN && chunks.length > 0) {
      // Too small to stand alone — fold into the previous chunk.
      const prev = chunks[chunks.length - 1]
      prev.content = `${prev.content}\n${content}`.trim()
      prev.pageEnd = pageEnd
      prev.tokenEstimate = estimateTokens(prev.content)
      buffer = []
      bufferTokens = 0
      return
    }
    chunks.push({
      chunkIndex: chunkIndex++,
      pageStart,
      pageEnd,
      sectionPath: [...sectionPath],
      content,
      tokenEstimate: estimateTokens(content),
    })
    // Carry a small overlap tail into the next chunk for context continuity.
    const tail: string[] = []
    let tailTokens = 0
    for (let i = buffer.length - 1; i >= 0 && tailTokens < OVERLAP_TOKENS; i -= 1) {
      tail.unshift(buffer[i])
      tailTokens += estimateTokens(buffer[i])
    }
    buffer = tail
    bufferTokens = tailTokens
    pageStart = pageEnd
  }

  for (const page of pages) {
    const lines = page.text.split(/\r?\n/)
    for (const line of lines) {
      const heading = isHeading(line)
      if (heading) {
        // Start a fresh chunk at a heading boundary if the current one is sizeable.
        if (bufferTokens >= TOKEN_TARGET * 0.6) flush()
        sectionPath = updateSectionPath(sectionPath, heading.title, heading.level)
      }
      if (line.trim().length === 0) continue
      buffer.push(line)
      bufferTokens += estimateTokens(line)
      pageEnd = page.pageNumber
      if (bufferTokens >= TOKEN_MAX) flush()
      else if (bufferTokens >= TOKEN_TARGET && /[.!?]$/.test(line.trim())) flush()
    }
  }
  flush()
  return chunks
}
