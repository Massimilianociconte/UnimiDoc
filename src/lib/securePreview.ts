import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// --------------------------------------------------------------------------
// Secure preview generation.
//
// The security model matches how document platforms (Scribd / StuDocu /
// Course Hero) protect paid files: a non-owner NEVER receives the original PDF
// bytes. Instead the owner's browser renders a limited number of pages to
// raster images, stamps a per-viewer diagonal watermark, and those images are
// the only thing ever served (through short-lived signed URLs) to a viewer who
// hasn't purchased the document. Text is rasterised, so it can't be re-selected
// or reflowed, and the watermark deters redistribution.
//
// This module renders + watermarks client-side; the storage upload + signed-URL
// gating happens in the `document-access` Edge Function.
// --------------------------------------------------------------------------

export type PreviewImage = {
  page: number
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

export type PreviewOptions = {
  /** How many leading pages to expose as the free/watermarked preview. */
  maxPages?: number
  /** Watermark text — use a per-viewer identifier (email hash / user id). */
  watermark?: string
  /** Render scale; higher = sharper but heavier. */
  scale?: number
}

export async function renderWatermarkedPreviews(
  buffer: ArrayBuffer,
  options: PreviewOptions = {},
): Promise<PreviewImage[]> {
  const { maxPages = 3, watermark = 'UnimiDoc · anteprima', scale = 1.5 } = options
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) })
  const pdf = await loadingTask.promise
  const images: PreviewImage[] = []

  try {
    const pageCount = Math.min(pdf.numPages, Math.max(1, maxPages))
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas non disponibile per il rendering anteprima.')

      await page.render({ canvas, canvasContext: context, viewport }).promise
      drawWatermark(context, canvas.width, canvas.height, watermark)

      const blob = await canvasToBlob(canvas)
      images.push({
        page: pageNumber,
        blob,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      })
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }

  return images
}

function drawWatermark(context: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  context.save()
  context.globalAlpha = 0.13
  context.fillStyle = '#0f5a3e'
  context.font = `${Math.max(14, Math.round(width / 18))}px "Helvetica Neue", Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  const stepX = width / 2
  const stepY = height / 4
  for (let y = stepY / 2; y < height; y += stepY) {
    for (let x = stepX / 2; x < width; x += stepX) {
      context.save()
      context.translate(x, y)
      context.rotate(-Math.PI / 6)
      context.fillText(text, 0, 0)
      context.restore()
    }
  }
  context.restore()
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Impossibile esportare l’immagine di anteprima.'))
    }, 'image/png')
  })
}
