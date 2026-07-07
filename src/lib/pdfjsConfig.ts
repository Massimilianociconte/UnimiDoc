import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const publicBase = (import.meta.env.BASE_URL || '/').endsWith('/')
  ? (import.meta.env.BASE_URL || '/')
  : `${import.meta.env.BASE_URL}/`

const pdfjsAssetBase = `${publicBase}pdfjs/`

export function getPdfDocumentParams(data: Uint8Array) {
  return {
    data,
    cMapPacked: true,
    cMapUrl: `${pdfjsAssetBase}cmaps/`,
    standardFontDataUrl: `${pdfjsAssetBase}standard_fonts/`,
  }
}

export { pdfjsLib }
