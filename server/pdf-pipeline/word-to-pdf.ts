import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export type WordConversionInput = {
  inputPath: string
  outputDir: string
  originalFileName?: string
  timeoutMs?: number
  maxBytes?: number
}

export type WordConversionResult = {
  method: 'libreoffice-headless'
  outputPath: string
  originalBytes: number
  pdfBytes: number
  sourceSha256: string
  pdfSha256: string
  warnings: string[]
}

const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const DOC_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export async function convertWordToPdf(input: WordConversionInput): Promise<WordConversionResult> {
  await validateWordInput(input.inputPath, input.originalFileName, input.maxBytes ?? DEFAULT_MAX_BYTES)
  await mkdir(input.outputDir, { recursive: true })

  const userProfileDir = await mkdtemp(path.join(tmpdir(), 'unimidoc-lo-profile-'))

  try {
    const libreOffice = resolveLibreOfficeBinary()
    const args = [
      '--headless',
      '--nologo',
      '--nodefault',
      '--nofirststartwizard',
      '--nolockcheck',
      `-env:UserInstallation=file://${userProfileDir}`,
      '--convert-to',
      'pdf:writer_pdf_Export',
      '--outdir',
      input.outputDir,
      input.inputPath,
    ]

    await execFile(libreOffice, args, {
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })

    const outputPath = await findConvertedPdf(input.inputPath, input.outputDir)
    await validatePdfOutput(outputPath)

    const [originalBytes, pdfBytes, sourceSha256, pdfSha256] = await Promise.all([
      stat(input.inputPath).then((file) => file.size),
      stat(outputPath).then((file) => file.size),
      sha256File(input.inputPath),
      sha256File(outputPath),
    ])

    return {
      method: 'libreoffice-headless',
      outputPath,
      originalBytes,
      pdfBytes,
      sourceSha256,
      pdfSha256,
      warnings: [
        'Word is accepted as a convenience format, but PDF remains the recommended upload format.',
        'Complex fonts, tables, images, tracked changes, comments, page breaks, and fields can shift during conversion.',
        'The converted PDF must be reviewed before publication; layout artifacts caused by conversion are not guaranteed by the platform.',
      ],
    }
  } finally {
    await rm(userProfileDir, { force: true, recursive: true })
  }
}

function resolveLibreOfficeBinary() {
  return (
    process.env.LIBREOFFICE_BIN ||
    process.env.SOFFICE_BIN ||
    (process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : 'soffice')
  )
}

async function validateWordInput(filePath: string, originalFileName = filePath, maxBytes: number) {
  const file = await stat(filePath)
  if (file.size > maxBytes) throw new Error('WORD_FILE_TOO_LARGE')

  const extension = path.extname(originalFileName).toLowerCase()
  if (extension !== '.docx' && extension !== '.doc') throw new Error('UNSUPPORTED_WORD_EXTENSION')

  const fileHandle = await open(filePath, 'r')
  const header = Buffer.alloc(8)

  try {
    await fileHandle.read(header, 0, header.length, 0)
  } finally {
    await fileHandle.close()
  }

  const isDocx = extension === '.docx' && header.subarray(0, 4).equals(DOCX_MAGIC)
  const isDoc = extension === '.doc' && header.equals(DOC_MAGIC)
  if (!isDocx && !isDoc) throw new Error('INVALID_WORD_MAGIC_BYTES')
}

async function findConvertedPdf(inputPath: string, outputDir: string) {
  const expected = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`)
  const file = await stat(expected).catch(() => null)
  if (!file?.isFile()) throw new Error('WORD_TO_PDF_OUTPUT_MISSING')
  return expected
}

async function validatePdfOutput(filePath: string) {
  const fileHandle = await open(filePath, 'r')
  const header = Buffer.alloc(5)

  try {
    await fileHandle.read(header, 0, header.length, 0)
  } finally {
    await fileHandle.close()
  }

  if (header.toString('utf8') !== '%PDF-') throw new Error('WORD_TO_PDF_INVALID_OUTPUT')

  await execFile('qpdf', ['--check', filePath]).catch(() => undefined)
}

async function sha256File(filePath: string) {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}
