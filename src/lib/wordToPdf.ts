import mammoth from 'mammoth'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'

// --------------------------------------------------------------------------
// Client-side Word (.docx) -> PDF conversion.
//
// The HIGH-FIDELITY path is LibreOffice headless on the backend
// (server/pdf-pipeline/word-to-pdf.ts, see docs/word-to-pdf-conversion.md).
// This in-browser converter is the zero-cost fallback: mammoth extracts the
// document's semantic HTML and we lay it out into a clean paginated A4 PDF with
// pdf-lib. It now preserves, beyond text + structure:
//   • images  — embedded as PNG/JPEG (Word EMF/WMF vectors are skipped, they
//               can't be embedded by pdf-lib);
//   • tables  — drawn as a real bordered grid, not flattened to text.
// Rich page layout (columns, exact fonts, floats) is still approximated.
//
// Legacy binary .doc is NOT supported by mammoth — callers should reject it.
// --------------------------------------------------------------------------

export type WordConversion = {
  pdf: ArrayBuffer
  blocks: number
  textLength: number
  images: number
  tables: number
}

type BlockKind = 'h1' | 'h2' | 'h3' | 'p' | 'li'
type TextBlock = { type: 'text'; text: string; kind: BlockKind }
type ImageBlock = { type: 'image'; dataUrl: string }
type TableBlock = { type: 'table'; rows: string[][] }
type Block = TextBlock | ImageBlock | TableBlock

export async function convertDocxToPdf(buffer: ArrayBuffer): Promise<WordConversion> {
  // Ask mammoth to inline images as data URIs so we can embed them downstream.
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read('base64')
        return { src: `data:${image.contentType};base64,${base64}` }
      }),
    },
  )
  const blocks = htmlToBlocks(html)
  const textLength = blocks.reduce(
    (total, block) => total + (block.type === 'text' ? block.text.length : 0),
    0,
  )
  const images = blocks.filter((block) => block.type === 'image').length
  const tables = blocks.filter((block) => block.type === 'table').length
  const pdf = await renderBlocksToPdf(blocks)
  return { pdf, blocks: blocks.length, textLength, images, tables }
}

function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: Block[] = []

  const clean = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim()

  const pushImages = (element: Element) => {
    for (const img of Array.from(element.querySelectorAll('img'))) {
      const src = img.getAttribute('src')
      if (src && src.startsWith('data:')) blocks.push({ type: 'image', dataUrl: src })
    }
  }

  const walk = (element: Element) => {
    for (const node of Array.from(element.children)) {
      const tag = node.tagName.toLowerCase()
      const text = clean(node.textContent)
      if (tag === 'h1') pushText(blocks, text, 'h1')
      else if (tag === 'h2') pushText(blocks, text, 'h2')
      else if (tag === 'h3' || tag === 'h4' || tag === 'h5') pushText(blocks, text, 'h3')
      else if (tag === 'table') {
        pushTable(blocks, node)
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(node.querySelectorAll(':scope > li'))) pushText(blocks, clean(li.textContent), 'li')
        pushImages(node)
      } else if (tag === 'img') {
        const src = node.getAttribute('src')
        if (src && src.startsWith('data:')) blocks.push({ type: 'image', dataUrl: src })
      } else if (tag === 'p') {
        // A paragraph can wrap an image (common in Word exports).
        pushText(blocks, text, 'p')
        pushImages(node)
      } else if (node.children.length) walk(node)
      else pushText(blocks, text, 'p')
    }
  }

  walk(doc.body)
  return blocks
}

function pushText(blocks: Block[], text: string, kind: BlockKind): void {
  if (text) blocks.push({ type: 'text', text: sanitizeWinAnsi(text), kind })
}

function pushTable(blocks: Block[], table: Element): void {
  const rows: string[][] = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((cell) =>
      sanitizeWinAnsi((cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
    )
    if (cells.length) rows.push(cells)
  }
  if (rows.length) blocks.push({ type: 'table', rows })
}

// StandardFonts use WinAnsi encoding — replace smart punctuation and drop any
// character outside Latin-1 so pdf-lib's drawText never throws.
function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\t\n\r\x20-\x7E¡-ÿ]/g, '')
}

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 56
const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2
const INK = rgb(0.09, 0.12, 0.11)
const RULE = rgb(0.78, 0.82, 0.8)

async function renderBlocksToPdf(blocks: Block[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN
  }
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) newPage()
  }

  const styleFor = (kind: BlockKind) => {
    switch (kind) {
      case 'h1': return { size: 20, face: bold, before: 16, after: 10, bullet: false }
      case 'h2': return { size: 16, face: bold, before: 13, after: 8, bullet: false }
      case 'h3': return { size: 13, face: bold, before: 11, after: 6, bullet: false }
      case 'li': return { size: 11, face: font, before: 2, after: 4, bullet: true }
      default: return { size: 11, face: font, before: 2, after: 7, bullet: false }
    }
  }

  const drawText = (block: TextBlock) => {
    const style = styleFor(block.kind)
    const indent = style.bullet ? 16 : 0
    const lineHeight = style.size * 1.42
    const lines = wrapText((style.bullet ? '•  ' : '') + block.text, style.face, style.size, MAX_WIDTH - indent)

    y -= style.before
    lines.forEach((line, index) => {
      if (y - lineHeight < MARGIN) newPage()
      const x = MARGIN + (style.bullet && index > 0 ? indent : 0)
      page.drawText(line, { x, y: y - style.size, size: style.size, font: style.face, color: INK })
      y -= lineHeight
    })
    y -= style.after
  }

  for (const block of blocks) {
    if (block.type === 'text') {
      drawText(block)
    } else if (block.type === 'image') {
      const embedded = await embedImage(doc, block.dataUrl)
      if (!embedded) continue
      const scale = Math.min(1, MAX_WIDTH / embedded.width)
      const drawW = embedded.width * scale
      const drawH = embedded.height * scale
      // An image taller than a full text area gets its own fresh page top.
      ensureSpace(drawH + 12)
      if (drawH > PAGE_HEIGHT - MARGIN * 2 && y < PAGE_HEIGHT - MARGIN - 1) newPage()
      y -= 6
      page.drawImage(embedded, { x: MARGIN + (MAX_WIDTH - drawW) / 2, y: y - drawH, width: drawW, height: drawH })
      y -= drawH + 10
    } else {
      y = drawTable(page, block.rows, y, font, bold, () => {
        newPage()
        return page
      })
    }
  }

  if (doc.getPageCount() === 0) doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const bytes = await doc.save({ useObjectStreams: true })
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function embedImage(doc: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
    if (!match) return null
    const mime = match[1].toLowerCase()
    const bytes = base64ToBytes(match[2])
    if (mime.includes('png')) return await doc.embedPng(bytes)
    if (mime.includes('jpeg') || mime.includes('jpg')) return await doc.embedJpg(bytes)
    // gif/emf/wmf/tiff etc. can't be embedded by pdf-lib — skip gracefully.
    return null
  } catch {
    return null
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Draw a simple bordered table. Columns share width equally; cells wrap and the
// table breaks across pages row-by-row. Returns the new y cursor.
function drawTable(
  startPage: PDFPage,
  rows: string[][],
  startY: number,
  font: PDFFont,
  bold: PDFFont,
  nextPage: () => PDFPage,
): number {
  let page = startPage
  let y = startY - 8
  const cols = Math.max(...rows.map((row) => row.length))
  if (cols === 0) return y
  const colWidth = MAX_WIDTH / cols
  const fontSize = 10
  const lineHeight = fontSize * 1.3
  const padding = 4

  rows.forEach((row, rowIndex) => {
    const isHeader = rowIndex === 0
    const face = isHeader ? bold : font
    const cellLines = Array.from({ length: cols }, (_, col) =>
      wrapText(row[col] ?? '', face, fontSize, colWidth - padding * 2),
    )
    const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * lineHeight + padding * 2

    if (y - rowHeight < MARGIN) {
      page = nextPage()
      y = PAGE_HEIGHT - MARGIN - 8
    }

    if (isHeader) {
      page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: MAX_WIDTH, height: rowHeight, color: rgb(0.93, 0.97, 0.95) })
    }

    for (let col = 0; col < cols; col += 1) {
      const cellX = MARGIN + col * colWidth
      page.drawRectangle({
        x: cellX,
        y: y - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderColor: RULE,
        borderWidth: 0.75,
      })
      cellLines[col].forEach((line, lineIndex) => {
        page.drawText(line, {
          x: cellX + padding,
          y: y - padding - fontSize - lineIndex * lineHeight,
          size: fontSize,
          font: face,
          color: INK,
        })
      })
    }
    y -= rowHeight
  })

  return y - 10
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}
