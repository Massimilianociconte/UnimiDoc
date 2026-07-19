// Porta gli asset OCR sotto controllo del progetto (niente CDN a runtime):
// - worker e core WASM copiati da node_modules (versione lockata da npm);
// - modelli linguistici ita/eng scaricati una volta da fonte pinnata e
//   verificati via SHA-256 (fail hard su mismatch), poi riusati dalla cache.
// Output: public/tesseract/ (gitignored, rigenerato in build).
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'public', 'tesseract')
const LANG_DIR = join(OUT_DIR, 'langs')

// Stessa fonte già usata a runtime finora, ora pinnata e verificata.
const LANG_BASE = 'https://tessdata.projectnaptha.com/4.0.0'
const LANGS = [
  { file: 'ita.traineddata.gz', sha256: null },
  { file: 'eng.traineddata.gz', sha256: null },
]
// Checksum attesi: valorizzati alla prima esecuzione e committati nel repo,
// da quel momento vincolanti. Se la fonte cambiasse contenuto, il build fallisce.
const CHECKSUM_FILE = join(ROOT, 'scripts', 'ocr-asset-checksums.json')

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

mkdirSync(LANG_DIR, { recursive: true })

// 1) worker + core dal lockfile npm.
const workerSrc = join(ROOT, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
copyFileSync(workerSrc, join(OUT_DIR, 'worker.min.js'))

const coreSrcDir = join(ROOT, 'node_modules', 'tesseract.js-core')
for (const name of readdirSync(coreSrcDir)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(name)) {
    copyFileSync(join(coreSrcDir, name), join(OUT_DIR, name))
  }
}
console.log('[ocr-assets] worker + core copiati da node_modules')

// 2) lang data con checksum pinnato.
const savedChecksums = existsSync(CHECKSUM_FILE) ? JSON.parse(readFileSync(CHECKSUM_FILE, 'utf8')) : {}

for (const lang of LANGS) {
  const target = join(LANG_DIR, lang.file)
  const expected = lang.sha256 ?? savedChecksums[lang.file] ?? null

  if (existsSync(target)) {
    const actual = sha256(readFileSync(target))
    if (expected && actual !== expected) {
      console.error(`[ocr-assets] checksum mismatch per ${lang.file} in cache: atteso ${expected}, trovato ${actual}`)
      process.exit(1)
    }
    savedChecksums[lang.file] = actual
    console.log(`[ocr-assets] ${lang.file} già in cache (${actual.slice(0, 12)}…)`)
    continue
  }

  const url = `${LANG_BASE}/${lang.file}`
  console.log(`[ocr-assets] scarico ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`[ocr-assets] download fallito (${response.status}) per ${url}`)
    process.exit(1)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const actual = sha256(buffer)
  if (expected && actual !== expected) {
    console.error(`[ocr-assets] checksum mismatch per ${lang.file}: atteso ${expected}, scaricato ${actual}`)
    process.exit(1)
  }
  writeFileSync(target, buffer)
  savedChecksums[lang.file] = actual
  console.log(`[ocr-assets] ${lang.file} salvato (${(buffer.length / 1024 / 1024).toFixed(1)} MB, sha256 ${actual.slice(0, 12)}…)`)
}

writeFileSync(CHECKSUM_FILE, `${JSON.stringify(savedChecksums, null, 2)}\n`)
console.log('[ocr-assets] completato: public/tesseract pronto')
