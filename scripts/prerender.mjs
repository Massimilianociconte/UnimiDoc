#!/usr/bin/env node
// Prerender SEO post-build: genera pagine statiche per /corsi e /corsi/:slug
// (title/description/canonical/OG/JSON-LD + piano di studi renderizzato dentro
// #root, sostituito dall'app al mount) e rigenera dist/sitemap.xml con lastmod
// corrente. I dati arrivano dalle tabelle pubbliche Supabase a build time, così
// i crawler senza JavaScript vedono contenuto reale e sempre aggiornato.
//
// Richiede VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (presenti nel build
// Netlify; in locale letti anche da .env). Senza credenziali il prerender
// viene saltato con un warning: la SPA resta pienamente funzionante.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ORIGIN = process.env.PRERENDER_ORIGIN ?? 'https://unimidoc.netlify.app'

function loadEnvFile() {
  for (const name of ['.env', '.env.local']) {
    const path = join(ROOT, name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line.trim())
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
    }
  }
}
loadEnvFile()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !ANON_KEY) {
  console.warn('[prerender] VITE_SUPABASE_URL/ANON_KEY assenti: prerender saltato.')
  process.exit(0)
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[prerender] dist/index.html mancante: esegui prima vite build.')
  process.exit(1)
}

/** Fetch PostgREST con paginazione (limite server 1000 righe per pagina). */
async function fetchAll(table, select, order) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${order ? `&order=${order}` : ''}`
    const res = await fetch(url, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
      },
    })
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

const esc = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

console.log('[prerender] carico catalogo da Supabase…')
const [programs, courses, teachers, professors] = await Promise.all([
  fetchAll('degree_programs', 'slug,name,classe,area,unimi_path,interateneo,catalog_ready,sort_order', 'sort_order.asc'),
  fetchAll('degree_courses', 'id,degree_slug,name,curriculum,year_number,year_label,cfu,ssd,language,sort_order', 'degree_slug.asc,year_number.asc,sort_order.asc'),
  fetchAll('degree_course_teachers', 'course_id,professor_id,role'),
  fetchAll('professors', 'id,full_name'),
])
console.log(`[prerender] ${programs.length} corsi, ${courses.length} insegnamenti, ${professors.length} docenti`)

const professorById = new Map(professors.map((p) => [p.id, p.full_name]))
const teachersByCourse = new Map()
for (const t of teachers) {
  const list = teachersByCourse.get(t.course_id) ?? []
  const name = professorById.get(t.professor_id)
  if (name) list.push({ name, role: t.role })
  teachersByCourse.set(t.course_id, list)
}
const coursesByDegree = new Map()
for (const c of courses) {
  const list = coursesByDegree.get(c.degree_slug) ?? []
  list.push(c)
  coursesByDegree.set(c.degree_slug, list)
}

const template = readFileSync(join(DIST, 'index.html'), 'utf8')

function renderPage({ path, title, description, jsonLd, bodyHtml }) {
  const canonical = `${ORIGIN}${path}`
  let html = template
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
  const headExtra = [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="UnimiDoc" />`,
    `<meta property="og:locale" content="it_IT" />`,
    `<meta property="og:image" content="${ORIGIN}/og-image.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:image" content="${ORIGIN}/og-image.png" />`,
    ...jsonLd.map((entry) => `<script type="application/ld+json">${JSON.stringify(entry)}</script>`),
  ].join('\n    ')
  html = html.replace('</head>', `    ${headExtra}\n  </head>`)
  // Il contenuto statico vive DENTRO #root: i crawler lo leggono, React lo
  // sostituisce integralmente al mount (createRoot().render).
  html = html.replace(/<div id="root">\s*<\/div>/, `<div id="root">${bodyHtml}</div>`)
  const outDir = join(DIST, ...path.split('/').filter(Boolean))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html)
}

function degreeDescription(program) {
  const detail = program.catalog_ready
    ? 'Catalogo completo di materie e docenti del piano di studi, con dispense, schemi ed esercizi verificati dalla community.'
    : 'Carica e trova dispense, riassunti, schemi ed esercizi condivisi dagli studenti del corso, verificati prima della pubblicazione.'
  return (
    `Appunti per ${program.name} (classe ${program.classe}), laurea triennale` +
    `${program.interateneo ? ` interateneo (${program.interateneo})` : ''} dell'Università degli Studi di Milano. ${detail}`
  ).slice(0, 300)
}

function degreeBody(program) {
  const rows = coursesByDegree.get(program.slug) ?? []
  const byCurriculum = new Map()
  for (const row of rows) {
    const curr = (row.curriculum ?? '').trim() || 'Piano didattico'
    const years = byCurriculum.get(curr) ?? new Map()
    const label = (row.year_label ?? '').trim() || (row.year_number > 0 ? `Anno ${row.year_number}` : 'Attività trasversali')
    const list = years.get(label) ?? []
    list.push(row)
    years.set(label, list)
    byCurriculum.set(curr, years)
  }

  let plan = ''
  for (const [curriculum, years] of byCurriculum) {
    plan += byCurriculum.size > 1 ? `<h3>${esc(curriculum)}</h3>` : ''
    for (const [label, list] of years) {
      plan += `<section><h4>${esc(label)}</h4><ul>`
      for (const course of list) {
        const meta = [course.cfu ? `${course.cfu} CFU` : null, course.ssd, course.language !== 'Italiano' ? course.language : null]
          .filter(Boolean)
          .join(' · ')
        const names = (teachersByCourse.get(course.id) ?? []).map((t) => t.name).join(', ')
        plan += `<li><strong>${esc(course.name)}</strong>${meta ? ` <small>(${esc(meta)})</small>` : ''}${names ? ` — ${esc(names)}` : ''}</li>`
      }
      plan += '</ul></section>'
    }
  }

  return `
<main>
  <nav><a href="/">UnimiDoc</a> › <a href="/corsi">Corsi di laurea</a> › ${esc(program.name)}</nav>
  <h1>Appunti per ${esc(program.name)}</h1>
  <p>Laurea triennale, classe ${esc(program.classe)}${program.interateneo ? ` · interateneo con ${esc(program.interateneo)}` : ''} — Università degli Studi di Milano.
     Dispense, riassunti, schemi ed esercizi caricati dagli studenti e verificati prima della pubblicazione.</p>
  <p><a href="/upload">Carica appunti</a> · <a href="/app">Esplora i materiali</a></p>
  ${plan ? `<h2>Materie e docenti del corso</h2>${plan}` : `<p>Piano di studi presso l'ateneo di riferimento: <a href="https://www.unimi.it${esc(program.unimi_path)}" rel="noreferrer">unimi.it</a>.</p>`}
</main>`
}

// --- /corsi/:slug -----------------------------------------------------------
for (const program of programs) {
  const path = `/corsi/${program.slug}`
  renderPage({
    path,
    title: `Appunti ${program.name} (${program.classe}) · Statale di Milano | UnimiDoc`,
    description: degreeDescription(program),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Course',
        '@id': `${ORIGIN}${path}`,
        url: `${ORIGIN}${path}`,
        name: program.name,
        courseCode: program.classe,
        description: degreeDescription(program),
        inLanguage: 'it',
        educationalLevel: 'Laurea triennale',
        provider: {
          '@type': 'CollegeOrUniversity',
          name: 'Università degli Studi di Milano',
          alternateName: 'La Statale',
          sameAs: `https://www.unimi.it${program.unimi_path}`,
        },
      },
    ],
    bodyHtml: degreeBody(program),
  })
}

// --- /corsi (directory) ------------------------------------------------------
const areas = new Map()
for (const program of programs) {
  const list = areas.get(program.area) ?? []
  list.push(program)
  areas.set(program.area, list)
}
let directory = '<main><h1>I corsi di laurea triennale della Statale di Milano</h1>'
directory += `<p>${programs.length} corsi triennali attivi. Scienze biologiche e altri ${programs.filter((p) => p.catalog_ready).length - 1} corsi hanno il catalogo completo di materie e docenti.</p>`
for (const [area, list] of areas) {
  directory += `<section><h2>${esc(area)}</h2><ul>`
  for (const program of list) {
    directory += `<li><a href="/corsi/${program.slug}">${esc(program.name)} (${esc(program.classe)})</a></li>`
  }
  directory += '</ul></section>'
}
directory += '</main>'

renderPage({
  path: '/corsi',
  title: 'Corsi di laurea triennale della Statale di Milano - UnimiDoc',
  description:
    'Tutti i corsi di laurea triennale dell’Università degli Studi di Milano su UnimiDoc: trova o carica appunti per il tuo corso, con materie e docenti del piano di studi.',
  jsonLd: [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Corsi di laurea triennale — Università degli Studi di Milano',
      url: `${ORIGIN}/corsi`,
      numberOfItems: programs.length,
      itemListElement: programs.map((program, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: `${program.name} (${program.classe})`,
        url: `${ORIGIN}/corsi/${program.slug}`,
      })),
    },
  ],
  bodyHtml: directory,
})

// --- sitemap.xml -------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10)
const staticRoutes = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/app', priority: '0.9', changefreq: 'daily' },
  { path: '/corsi', priority: '0.8', changefreq: 'monthly' },
  { path: '/premium', priority: '0.8', changefreq: 'monthly' },
  { path: '/upload', priority: '0.7', changefreq: 'monthly' },
  { path: '/login', priority: '0.5', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.4', changefreq: 'monthly' },
  { path: '/termini', priority: '0.4', changefreq: 'monthly' },
  { path: '/cookie', priority: '0.4', changefreq: 'monthly' },
  { path: '/condizioni-di-vendita', priority: '0.4', changefreq: 'monthly' },
  { path: '/rimborsi', priority: '0.4', changefreq: 'monthly' },
  { path: '/condizioni-autori', priority: '0.4', changefreq: 'monthly' },
  { path: '/regole-contenuti', priority: '0.4', changefreq: 'monthly' },
  { path: '/ai-e-documenti', priority: '0.4', changefreq: 'monthly' },
  { path: '/copyright-segnalazioni', priority: '0.4', changefreq: 'monthly' },
]
const urls = [
  ...staticRoutes.map(
    ({ path, priority, changefreq }) =>
      `  <url><loc>${ORIGIN}${path}</loc><lastmod>${today}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
  ),
  ...programs.map(
    (program) =>
      `  <url><loc>${ORIGIN}/corsi/${program.slug}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
  ),
]
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
)

console.log(`[prerender] generate ${programs.length + 1} pagine statiche + sitemap (${urls.length} URL).`)
