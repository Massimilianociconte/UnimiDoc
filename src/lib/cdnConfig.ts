// Asset OCR self-hosted e version-pinned (niente CDN a runtime): worker e
// core WASM vengono copiati da node_modules, i modelli linguistici scaricati
// e verificati via checksum da scripts/fetch-ocr-assets.mjs → public/tesseract.
// Tesseract stesso resta lazy: gli asset vengono richiesti solo quando una
// pagina scansionata ha davvero bisogno di OCR (come già per PDF.js).
export const TESSERACT_VERSION = '5.1.1'
export const TESSERACT_LANGDATA_VERSION = '4.0.0'

const base = typeof window !== 'undefined' ? window.location.origin : ''

export const TESSERACT_WORKER_PATH = `${base}/tesseract/worker.min.js`

// Directory, non singolo file: Tesseract sceglie il core SIMD/LSTM migliore
// per il dispositivo.
export const TESSERACT_CORE_PATH = `${base}/tesseract`

export const TESSERACT_LANG_PATH = `${base}/tesseract/langs`

export const TESSERACT_WORKER_OPTIONS = {
  workerPath: TESSERACT_WORKER_PATH,
  corePath: TESSERACT_CORE_PATH,
  langPath: TESSERACT_LANG_PATH,
  workerBlobURL: true,
  gzip: true,
} as const
