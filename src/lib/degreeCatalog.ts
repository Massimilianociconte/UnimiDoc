import { supabase } from './supabaseClient'

// Catalogo insegnamenti dei corsi di laurea (tabelle degree_courses /
// professors / degree_course_teachers, lettura pubblica). I dati arrivano dai
// piani didattici unimi.it e vengono usati dalle pagine /corsi/:slug e dal
// form di upload per materia e docente. Cache in memoria per sessione: il
// catalogo cambia al massimo una volta l'anno.

export type DegreeCourseTeacher = {
  name: string
  role: 'responsabile' | 'docente'
}

export type DegreeCourse = {
  id: string
  name: string
  unimiSlug: string
  curriculum: string | null
  yearNumber: number
  yearLabel: string | null
  period: string | null
  grouping: string | null
  cfu: number | null
  totalHours: number | null
  language: string | null
  ssd: string | null
  teachers: DegreeCourseTeacher[]
}

type DegreeCourseRow = {
  id: string
  name: string
  unimi_slug: string
  curriculum: string | null
  year_number: number
  year_label: string | null
  period: string | null
  grouping: string | null
  cfu: number | null
  total_hours: number | null
  language: string | null
  ssd: string | null
  degree_course_teachers: Array<{
    role: string
    professors: { full_name: string } | null
  }> | null
}

const cache = new Map<string, Promise<DegreeCourse[]>>()

export function loadDegreeCatalog(degreeSlug: string): Promise<DegreeCourse[]> {
  const cached = cache.get(degreeSlug)
  if (cached) return cached

  const promise = (async () => {
    if (!supabase) return []
    const { data, error } = await supabase
      .from('degree_courses')
      .select(
        'id, name, unimi_slug, curriculum, year_number, year_label, period, grouping, cfu, total_hours, language, ssd, sort_order, degree_course_teachers(role, professors(full_name))',
      )
      .eq('degree_slug', degreeSlug)
      .order('year_number', { ascending: true })
      .order('sort_order', { ascending: true })
    if (error) throw error
    return ((data ?? []) as unknown as DegreeCourseRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      unimiSlug: row.unimi_slug,
      curriculum: row.curriculum,
      yearNumber: row.year_number,
      yearLabel: row.year_label,
      period: row.period,
      grouping: row.grouping,
      cfu: row.cfu == null ? null : Number(row.cfu),
      totalHours: row.total_hours,
      language: row.language,
      ssd: row.ssd,
      teachers: (row.degree_course_teachers ?? [])
        .filter((entry) => entry.professors?.full_name)
        .map((entry): DegreeCourseTeacher => ({
          name: entry.professors!.full_name,
          role: entry.role === 'responsabile' ? 'responsabile' : 'docente',
        }))
        // responsabile in testa: è il nome che gli studenti riconoscono
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, 'it') : a.role === 'responsabile' ? -1 : 1)),
    }))
  })().catch((error) => {
    cache.delete(degreeSlug) // consenti un retry al prossimo accesso
    throw error
  })

  cache.set(degreeSlug, promise)
  return promise
}

export type DegreeCatalogYear = {
  yearNumber: number
  yearLabel: string
  courses: DegreeCourse[]
}

export type DegreeCatalogCurriculum = {
  curriculum: string
  years: DegreeCatalogYear[]
}

/** Raggruppa per curriculum e anno mantenendo l'ordine del piano didattico. */
export function groupDegreeCatalog(courses: DegreeCourse[]): DegreeCatalogCurriculum[] {
  const curricula = new Map<string, Map<number, DegreeCatalogYear>>()
  for (const course of courses) {
    const currKey = course.curriculum?.trim() || 'Piano didattico'
    let years = curricula.get(currKey)
    if (!years) {
      years = new Map()
      curricula.set(currKey, years)
    }
    let year = years.get(course.yearNumber)
    if (!year) {
      year = {
        yearNumber: course.yearNumber,
        yearLabel: course.yearLabel?.trim() || (course.yearNumber > 0 ? `Anno ${course.yearNumber}` : 'Attività trasversali'),
        courses: [],
      }
      years.set(course.yearNumber, year)
    }
    year.courses.push(course)
  }
  return [...curricula.entries()].map(([curriculum, years]) => ({
    curriculum,
    years: [...years.values()].sort((a, b) => (a.yearNumber || 99) - (b.yearNumber || 99)),
  }))
}

/** Nomi materia unici (prima occorrenza), per select del form di upload. */
export function uniqueCourseNames(courses: DegreeCourse[]): DegreeCourse[] {
  const seen = new Set<string>()
  const out: DegreeCourse[] = []
  for (const course of courses) {
    const key = course.name.toLocaleLowerCase('it')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(course)
  }
  return out
}
