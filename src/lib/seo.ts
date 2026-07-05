import { findCourse } from '../courseCatalog'
import type { DocumentItem } from '../data'

// Ogni documento vive su un URL proprio (/appunti/:materia/:titolo) così Google,
// le AI Overview e gli assistenti (ChatGPT, Gemini) possono indicizzare e citare
// la scheda specifica, non solo la home del sito.

export const SITE_NAME = 'UnimiDoc'
export const SITE_TAGLINE = 'Appunti verificati per Scienze Biologiche L-13 · Università degli Studi di Milano'

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function documentSlug(document: DocumentItem): string {
  return `${slugify(document.subject)}/${slugify(document.title)}`
}

export function documentPath(document: DocumentItem): string {
  return `/appunti/${documentSlug(document)}`
}

export function findDocumentByPath(pathname: string, documents: DocumentItem[]): DocumentItem | null {
  const match = pathname.match(/^\/appunti\/([^/]+)\/([^/]+)\/?$/)
  if (!match) return null
  const [, subjectSlug, titleSlug] = match
  return (
    documents.find(
      (document) => slugify(document.subject) === subjectSlug && slugify(document.title) === titleSlug,
    ) ?? null
  )
}

export function documentSeoTitle(document: DocumentItem): string {
  return `${document.title} · ${document.subject} (${document.professor}) | Appunti Scienze Biologiche UniMi`
}

/** "1 anno · 2 semestre · 9 CFU" quando il corso è nel catalogo L-13. */
export function documentCourseMeta(document: DocumentItem): string | null {
  const course = findCourse(document.subject)
  if (!course) return null
  const parts = [course.year, course.semester, `${course.cfu} CFU`].filter(
    (part) => part && part !== 'Non definito',
  )
  return parts.length ? parts.join(' · ') : null
}

export function documentSeoDescription(document: DocumentItem): string {
  const courseMeta = documentCourseMeta(document)
  const summary = document.insights?.abstract || document.description
  return (
    `${document.type} di ${document.subject}, corso di ${document.professor} — Scienze Biologiche L-13` +
    `${courseMeta ? ` (${courseMeta})` : ''}, Università degli Studi di Milano (Statale). ` +
    `${document.pages} pagine, a.a. ${document.academicYear}, qualità ${document.quality.toFixed(1)}/10. ${summary}`
  ).slice(0, 300)
}

// Schema.org LearningResource: il markup che AI Overview e i motori usano per
// capire materia, ateneo, autore e valutazioni della singola dispensa.
export function documentJsonLd(document: DocumentItem, url: string): Record<string, unknown> {
  const course = findCourse(document.subject)
  const insights = document.insights

  const courseNode: Record<string, unknown> = {
    '@type': 'Course',
    name: document.subject,
    provider: universityJsonLd(),
  }
  if (course) {
    // Anno/semestre/CFU del corso L-13: contesto che AI Overview e assistenti
    // usano per rispondere a query tipo "appunti primo anno biologia statale".
    courseNode.description = [course.year, course.semester].filter((part) => part !== 'Non definito').join(', ')
    courseNode.numberOfCredits = course.cfu
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    '@id': url,
    url,
    name: document.title,
    description: document.description,
    inLanguage: insights?.language ?? 'it',
    learningResourceType: document.type,
    numberOfPages: document.pages,
    about: [
      { '@type': 'Thing', name: document.subject },
      courseNode,
      ...(insights?.topics ?? []).slice(0, 8).map((topic) => ({ '@type': 'Thing', name: topic })),
    ],
    educationalLevel: 'Laurea triennale L-13 Scienze Biologiche',
    teaches: insights?.topics?.length ? insights.topics.slice(0, 8).join(', ') : document.subject,
    creator: { '@type': 'Person', name: document.uploader },
    contributor: { '@type': 'Person', name: document.professor, jobTitle: 'Docente' },
    dateModified: isoDateFromItalian(document.uploadedAt),
    isAccessibleForFree: document.credits === 0,
    provider: organizationJsonLd(),
  }

  if (insights?.keywords.length) jsonLd.keywords = insights.keywords.join(', ')
  if (insights?.abstract) jsonLd.abstract = insights.abstract
  if (insights) {
    const flagLabels: Array<[keyof typeof insights.contentFlags, string]> = [
      ['hasImages', 'Immagini'],
      ['hasDiagrams', 'Schemi e diagrammi'],
      ['hasTables', 'Tabelle'],
      ['hasFormulas', 'Formule'],
      ['hasExercises', 'Esercizi svolti'],
      ['hasExamQuestions', "Domande d'esame"],
    ]
    const features = flagLabels.filter(([flag]) => insights.contentFlags[flag]).map(([, label]) => label)
    const properties: Array<Record<string, unknown>> = [
      { '@type': 'PropertyValue', name: 'Livello di approfondimento', value: insights.depthLevel },
    ]
    if (features.length) {
      properties.push({ '@type': 'PropertyValue', name: 'Contenuti presenti', value: features.join(', ') })
    }
    jsonLd.additionalProperty = properties
  }

  if (document.downloads > 0) {
    jsonLd.interactionStatistic = {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/DownloadAction',
      userInteractionCount: document.downloads,
    }
  }

  if (document.quality > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: document.quality,
      bestRating: 10,
      worstRating: 0,
      ratingCount: Math.max(document.downloads, 1),
    }
  }

  return jsonLd
}

export function breadcrumbJsonLd(document: DocumentItem, origin: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'UnimiDoc', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: 'Appunti', item: `${origin}/app` },
      {
        '@type': 'ListItem',
        position: 3,
        name: document.subject,
        item: `${origin}/app?materia=${encodeURIComponent(document.subject)}`,
      },
      { '@type': 'ListItem', position: 4, name: document.title, item: `${origin}${documentPath(document)}` },
    ],
  }
}

export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    description: SITE_TAGLINE,
    url: 'https://unimidoc.it',
  }
}

function universityJsonLd(): Record<string, unknown> {
  return {
    '@type': 'CollegeOrUniversity',
    name: 'Università degli Studi di Milano',
    alternateName: 'La Statale',
    sameAs: 'https://www.unimi.it',
  }
}

export function uploaderRankJsonLd(
  entries: Array<{ name: string; score: number; documents: number }>,
  origin: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Classifica autori UnimiDoc',
    description: 'Gli autori di appunti più affidabili per Scienze Biologiche alla Statale di Milano.',
    url: `${origin}/app`,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: { '@type': 'Person', name: entry.name },
    })),
  }
}

// Ricerca interna full-metadata: titolo, corso (con alias del catalogo),
// docente, tipo e i tag semantici estratti automaticamente (keywords/argomenti/
// abstract). Accent-insensitive, tutte le parole della query devono comparire.
export function documentMatchesQuery(document: DocumentItem, query: string): boolean {
  const terms = slugify(query).split('-').filter((term) => term.length >= 2)
  if (!terms.length) return true

  const course = findCourse(document.subject)
  const haystack = slugify(
    [
      document.title,
      document.subject,
      course?.shortName,
      ...(course?.aliases ?? []),
      document.professor,
      document.type,
      document.academicYear,
      document.description,
      ...(document.insights?.keywords ?? []),
      ...(document.insights?.topics ?? []),
      document.insights?.abstract,
    ]
      .filter(Boolean)
      .join(' '),
  )

  return terms.every((term) => haystack.includes(term))
}

function isoDateFromItalian(value: string): string | undefined {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return undefined
  return `${match[3]}-${match[2]}-${match[1]}`
}

// Gestione centralizzata dei blocchi JSON-LD iniettati nel <head>: uno per chiave,
// sostituito a ogni cambio rotta così non si accumulano markup di pagine passate.
export function setJsonLd(key: string, payload: Record<string, unknown> | null) {
  const id = `jsonld-${key}`
  const existing = window.document.getElementById(id)
  if (existing) existing.remove()
  if (!payload) return

  const script = window.document.createElement('script')
  script.type = 'application/ld+json'
  script.id = id
  script.text = JSON.stringify(payload)
  window.document.head.append(script)
}

export function setMetaTag(attribute: 'name' | 'property', key: string, content: string) {
  let tag = window.document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!tag) {
    tag = window.document.createElement('meta')
    tag.setAttribute(attribute, key)
    window.document.head.append(tag)
  }
  tag.content = content
}
