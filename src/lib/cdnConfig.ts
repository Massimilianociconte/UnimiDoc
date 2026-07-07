// Version-pinned OCR assets. Tesseract itself is imported lazily by Vite, while
// the browser worker/core/language data are fetched only when a scanned page
// really needs OCR.
export const TESSERACT_CDN_VERSION = '5.1.1'
export const TESSERACT_LANGDATA_VERSION = '4.0.0'

export const TESSERACT_WORKER_PATH =
  `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESSERACT_CDN_VERSION}/dist/worker.min.js`

// Keep this as a directory, not a single .wasm.js file: Tesseract selects the
// best SIMD/LSTM core per device.
export const TESSERACT_CORE_PATH =
  `https://cdn.jsdelivr.net/npm/tesseract.js-core@v${TESSERACT_CDN_VERSION}`

export const TESSERACT_LANG_PATH =
  `https://tessdata.projectnaptha.com/${TESSERACT_LANGDATA_VERSION}`

export const TESSERACT_WORKER_OPTIONS = {
  workerPath: TESSERACT_WORKER_PATH,
  corePath: TESSERACT_CORE_PATH,
  langPath: TESSERACT_LANG_PATH,
  workerBlobURL: true,
  gzip: true,
} as const
