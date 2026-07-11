import path from 'node:path'
import { extractNativeText, scoreNativeText } from '../pipeline.js'
import { runCommand } from '../commands.js'

export type OcrPageOutput = {
  pageNumber: number
  text: string
  qualityScore: number
  confidence: number
}

function pageSelection(pages: number[]): string {
  return [...new Set(pages)].sort((a, b) => a - b).join(',')
}

export async function runOcrMyPdf(input: {
  inputPath: string
  outputDir: string
  pageNumbers: number[]
  languages: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{ outputPdfPath: string; pages: OcrPageOutput[]; version: string }> {
  const outputPdfPath = path.join(input.outputDir, 'ocr-output.pdf')
  const versionResult = await runCommand('ocrmypdf', ['--version'], {
    timeoutMs: 30_000,
    signal: input.signal,
  })
  const version = (versionResult.stdout || versionResult.stderr).trim().split(/\s+/)[0] || 'unknown'
  await runCommand('ocrmypdf', [
    '--skip-text',
    '--rotate-pages',
    '--deskew',
    '--optimize', '1',
    '--jobs', '1',
    '--tesseract-timeout', '180',
    '--language', input.languages,
    '--pages', pageSelection(input.pageNumbers),
    '--output-type', 'pdf',
    input.inputPath,
    outputPdfPath,
  ], {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  })

  const extracted = await extractNativeText(outputPdfPath, {
    timeoutMs: Math.min(input.timeoutMs, 300_000),
    signal: input.signal,
  })
  const requested = new Set(input.pageNumbers)
  const pages = extracted.pages
    .filter((page) => requested.has(page.pageNumber))
    .map((page) => {
      const qualityScore = scoreNativeText(page.text)
      return {
        pageNumber: page.pageNumber,
        text: page.text,
        qualityScore,
        confidence: Math.round(qualityScore * 10000) / 100,
      }
    })
  return { outputPdfPath, pages, version }
}
