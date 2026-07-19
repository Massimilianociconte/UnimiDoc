// Guardia sulla dimensione del bundle: fallisce la CI se l'entry chunk o il
// totale JS (gzip) superano il budget. Baseline 2026-07-15: entry ~219 kB,
// totale ~670 kB gzip. Abbassare i budget man mano che il code-splitting
// procede, mai alzarli senza una motivazione scritta nel PR.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets')
const ENTRY_BUDGET_KB = Number(process.env.BUNDLE_ENTRY_BUDGET_KB ?? 240)
const TOTAL_BUDGET_KB = Number(process.env.BUNDLE_TOTAL_BUDGET_KB ?? 720)

if (!existsSync(DIST_ASSETS)) {
  console.error(`check-bundle-size: ${DIST_ASSETS} non esiste. Esegui prima "npm run build".`)
  process.exit(2)
}

const jsFiles = readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))
const sizes = jsFiles
  .map((name) => {
    const gzip = gzipSync(readFileSync(join(DIST_ASSETS, name)), { level: 9 }).length
    // I web worker (pdf.worker, futuri OCR worker) vengono scaricati solo su
    // richiesta dal viewer: non pesano sul caricamento iniziale dell'app.
    return { name, gzipKb: gzip / 1024, lazyWorker: /worker/i.test(name) }
  })
  .sort((a, b) => b.gzipKb - a.gzipKb)

const entry = sizes.find((file) => /^index-.*\.js$/.test(file.name))
const totalKb = sizes.filter((file) => !file.lazyWorker).reduce((sum, file) => sum + file.gzipKb, 0)

console.log('Bundle (gzip):')
for (const file of sizes) {
  console.log(`  ${file.gzipKb.toFixed(1).padStart(8)} kB  ${file.name}${file.lazyWorker ? '  (worker on-demand, escluso dal totale)' : ''}`)
}
console.log(`  entry: ${entry ? entry.gzipKb.toFixed(1) : 'n/d'} kB (budget ${ENTRY_BUDGET_KB} kB)`)
console.log(`  total: ${totalKb.toFixed(1)} kB (budget ${TOTAL_BUDGET_KB} kB)`)

let failed = false
if (!entry) {
  console.error('check-bundle-size: entry chunk index-*.js non trovato.')
  failed = true
} else if (entry.gzipKb > ENTRY_BUDGET_KB) {
  console.error(`check-bundle-size: entry ${entry.gzipKb.toFixed(1)} kB > budget ${ENTRY_BUDGET_KB} kB`)
  failed = true
}
if (totalKb > TOTAL_BUDGET_KB) {
  console.error(`check-bundle-size: totale JS ${totalKb.toFixed(1)} kB > budget ${TOTAL_BUDGET_KB} kB`)
  failed = true
}
process.exit(failed ? 1 : 0)
