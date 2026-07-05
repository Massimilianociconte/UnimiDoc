export type CourseYear = '1 anno' | '2 anno' | '3 anno' | 'Scelta'
export type CourseSemester = '1 semestre' | '2 semestre' | 'Annuale' | 'Non definito'
export type CourseActivityType =
  | 'Obbligatorio'
  | 'Alternativa obbligatoria'
  | 'Scelta libera consigliata'
  | 'Accertamento'
  | 'Tirocinio'
  | 'Prova finale'
export type CourseLine = 'A-L' | 'M-Z' | 'Edizione unica' | 'Attivita senza docente unico'

export type CourseProfessorGroup = {
  line: CourseLine
  professors: string[]
  note?: string
}

export type CourseInfo = {
  name: string
  shortName: string
  icon?: string
  year: CourseYear
  semester: CourseSemester
  cfu: number
  type: CourseActivityType
  cohort: 'F62' | 'FAI' | 'F62/FAI'
  cohortNote?: string
  professors?: CourseProfessorGroup[]
  aliases?: string[]
  showInLanding?: boolean
  showInFilters?: boolean
}

const FIRST_YEAR_NOTE =
  "Docenti pubblicati sull'edizione attiva L-13 R/FAI 2025/26; il 1 anno F62 storico non e attivo nel 2025/26."

export const courseCatalog: CourseInfo[] = [
  {
    name: 'Chimica generale con elementi di chimica-fisica',
    shortName: 'Chimica generale',
    icon: '/course-icons/chimica-generale.png',
    year: '1 anno',
    semester: '1 semestre',
    cfu: 6,
    type: 'Obbligatorio',
    cohort: 'F62/FAI',
    cohortNote: FIRST_YEAR_NOTE,
    professors: [
      { line: 'A-L', professors: ['Monica Panigati'] },
      { line: 'M-Z', professors: ['Caterina Damiano'] },
    ],
  },
  {
    name: 'Citologia e istologia',
    shortName: 'Citologia e istologia',
    icon: '/course-icons/citologia-istologia.png',
    year: '1 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62/FAI',
    cohortNote: FIRST_YEAR_NOTE,
    professors: [
      { line: 'A-L', professors: ['Isabella Dalle Donne'] },
      { line: 'M-Z', professors: ['Isabella Dalle Donne'] },
    ],
  },
  {
    name: 'Matematica generale e laboratorio di informatica',
    shortName: 'Matematica e informatica',
    icon: '/course-icons/matematica-informatica.png',
    year: '1 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62/FAI',
    cohortNote: FIRST_YEAR_NOTE,
    professors: [
      { line: 'A-L', professors: ['Niels Patriz Benedikter', 'Tiziano Penati'] },
      { line: 'M-Z', professors: ['Giuseppe Gaeta', 'Giorgio Gubbiotti'] },
    ],
  },
  {
    name: 'Biologia e sistematica vegetale',
    shortName: 'Sistematica vegetale',
    icon: '/course-icons/biologia-sistematica-vegetale.png',
    year: '1 anno',
    semester: '2 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62/FAI',
    cohortNote: FIRST_YEAR_NOTE,
    professors: [
      { line: 'A-L', professors: ['Elisabetta Caporali', 'Juan Ignacio Ezquer Garin'] },
      { line: 'M-Z', professors: ['Lucia Colombo', 'Mara Cucinotta', 'Carla Lambertini'] },
    ],
  },
  {
    name: 'Chimica organica e laboratorio di chimica',
    shortName: 'Chimica organica',
    icon: '/course-icons/chimica-organica.png',
    year: '1 anno',
    semester: '2 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62/FAI',
    cohortNote: FIRST_YEAR_NOTE,
    professors: [
      {
        line: 'A-L',
        professors: ['Silvia Cauteruccio', 'Lucia Carlucci', 'Alessia Colombo', 'Francesco Fagnani', 'Pierluigi Mercandelli'],
      },
      { line: 'M-Z', professors: ['Alberto Dal Corso', 'Monica Civera', 'Sara Sattin'] },
    ],
  },
  {
    name: 'Fisica, laboratorio di fisica, laboratorio di metodi matematici e statistici',
    shortName: 'Fisica e metodi',
    icon: '/course-icons/fisica-metodi.png',
    year: '1 anno',
    semester: '2 semestre',
    cfu: 12,
    type: 'Obbligatorio',
    cohort: 'F62/FAI',
    cohortNote: FIRST_YEAR_NOTE,
    professors: [
      { line: 'A-L', professors: ['Alessandro Ferraro', 'Lorenzo Migliorini', 'Bruno Paroli', 'Federico Sau', 'Elena Villa'] },
      { line: 'M-Z', professors: ['Carlo Camilloni', 'Lino Miramonti', 'Federico Sau', 'Elena Villa'] },
    ],
  },
  {
    name: 'Accertamento di lingua inglese B1',
    shortName: 'Inglese B1',
    year: '1 anno',
    semester: 'Non definito',
    cfu: 3,
    type: 'Accertamento',
    cohort: 'F62',
    professors: [{ line: 'Attivita senza docente unico', professors: [], note: 'Accertamento linguistico senza docente unico nel piano.' }],
    showInLanding: false,
    showInFilters: false,
  },
  {
    name: 'Biologia e sistematica animale',
    shortName: 'Sistematica animale',
    icon: '/course-icons/biologia-sistematica-animale.png',
    year: '2 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [
      { line: 'A-L', professors: ['Carlo Polidori', 'Paolo Gabrieli'] },
      { line: 'M-Z', professors: ['Francesco Bonasoro', 'Silvia Caccia'] },
    ],
  },
  {
    name: 'Chimica biologica',
    shortName: 'Chimica biologica',
    icon: '/course-icons/chimica-biologica.png',
    year: '2 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62',
    aliases: ['Biochimica'],
    professors: [
      { line: 'A-L', professors: ['Stefano Ricagno', 'Cristina Visentin'] },
      { line: 'M-Z', professors: ['Maria Antonietta Vanoni'] },
    ],
  },
  {
    name: 'Evoluzione biologica e storia della biologia',
    shortName: 'Evoluzione biologica',
    icon: '/course-icons/evoluzione-biologia.png',
    year: '2 anno',
    semester: '1 semestre',
    cfu: 6,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Claudio Bandi', 'Agata Negri'] }],
  },
  {
    name: 'Genetica',
    shortName: 'Genetica',
    icon: '/course-icons/genetica.png',
    year: '2 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Alternativa obbligatoria',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Giorgio Perrella', 'Katia Petroni'] }],
  },
  {
    name: 'Genetics',
    shortName: 'Genetics',
    icon: '/course-icons/genetica.png',
    year: '2 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Alternativa obbligatoria',
    cohort: 'F62',
    aliases: ['Genetica in inglese'],
    professors: [{ line: 'Edizione unica', professors: ['Andrea Bernardini', 'Diletta Dolfini', 'Roberto Mantovani'] }],
  },
  {
    name: 'Anatomia comparata',
    shortName: 'Anatomia comparata',
    icon: '/course-icons/anatomia-comparata.png',
    year: '2 anno',
    semester: '2 semestre',
    cfu: 6,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [
      { line: 'A-L', professors: ['Elena Menegola'] },
      { line: 'M-Z', professors: ['Luca Del Giacco'] },
    ],
  },
  {
    name: 'Fisiologia vegetale',
    shortName: 'Fisiologia vegetale',
    icon: '/course-icons/fisiologia-vegetale.png',
    year: '2 anno',
    semester: '2 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Maria Cristina Bonza', 'Alex Costa'] }],
  },
  {
    name: 'Biologia molecolare e bioinformatica',
    shortName: 'Biologia molecolare',
    icon: '/course-icons/biologia-molecolare-bioinformatica.png',
    year: '2 anno',
    semester: '2 semestre',
    cfu: 12,
    type: 'Alternativa obbligatoria',
    cohort: 'F62',
    aliases: ['Biologia Molecolare'],
    professors: [{ line: 'Edizione unica', professors: ['Federico Lazzaro', 'Federico Zambelli'] }],
  },
  {
    name: 'Molecular biology and bioinformatics',
    shortName: 'Molecular biology',
    icon: '/course-icons/biologia-molecolare-bioinformatica.png',
    year: '2 anno',
    semester: '2 semestre',
    cfu: 12,
    type: 'Alternativa obbligatoria',
    cohort: 'F62',
    aliases: ['Biologia molecolare e bioinformatica in inglese'],
    professors: [{ line: 'Edizione unica', professors: ['David Stephen Horner', 'Marco Muzi Falconi'] }],
  },
  {
    name: 'Tirocinio interno presso laboratori universitari',
    shortName: 'Tirocinio interno',
    year: '3 anno',
    semester: 'Annuale',
    cfu: 6,
    type: 'Tirocinio',
    cohort: 'F62',
    professors: [{ line: 'Attivita senza docente unico', professors: [], note: 'Tutor assegnato in base al laboratorio.' }],
    showInLanding: false,
    showInFilters: false,
  },
  {
    name: 'Biologia dello sviluppo',
    shortName: 'Biologia sviluppo',
    icon: '/course-icons/biologia-sviluppo.png',
    year: '3 anno',
    semester: '1 semestre',
    cfu: 6,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [
      { line: 'A-L', professors: ['Stefano Biffo', 'Lucia Colombo'] },
      { line: 'M-Z', professors: ['Luca Del Giacco', 'Marta Adelina Miranda Mendes'] },
    ],
  },
  {
    name: 'Ecologia',
    shortName: 'Ecologia',
    icon: '/course-icons/ecologia.png',
    year: '3 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [
      { line: 'A-L', professors: ['Andrea Paolo Binelli'] },
      { line: 'M-Z', professors: ['Alessandra Costanzo', 'Diego Rubolini'] },
    ],
  },
  {
    name: 'Elementi di anatomia umana, farmacologia e immunologia',
    shortName: 'Anatomia, farmaco, immuno',
    icon: '/course-icons/anatomia-farmacologia-immunologia.png',
    year: '3 anno',
    semester: '1 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62',
    aliases: ['Elementi di anatomia umana'],
    professors: [
      { line: 'A-L', professors: ['Dario Besusso', 'Isabella Dalle Donne', 'Saverio Minucci'] },
      { line: 'M-Z', professors: ['Alida Amadeo', 'Caterina Anna Maria La Porta', 'Paola Giuseppina Sacerdote'] },
    ],
  },
  {
    name: 'Microbiologia generale',
    shortName: 'Microbiologia',
    icon: '/course-icons/microbiologia-generale.png',
    year: '3 anno',
    semester: '2 semestre',
    cfu: 9,
    type: 'Obbligatorio',
    cohort: 'F62',
    professors: [
      { line: 'A-L', professors: ['Federica Briani', 'Paolo Landini'] },
      { line: 'M-Z', professors: ['Giovanni Bertoni', 'Moira Paroni'] },
    ],
  },
  {
    name: 'Fisiologia generale e animale',
    shortName: 'Fisiologia animale',
    icon: '/course-icons/fisiologia-generale-animale.png',
    year: '3 anno',
    semester: '2 semestre',
    cfu: 9,
    type: 'Alternativa obbligatoria',
    cohort: 'F62',
    aliases: ['General physiology and animal physiology'],
    professors: [{ line: 'Edizione unica', professors: ['Michele Mazzanti'] }],
  },
  {
    name: 'Prova finale',
    shortName: 'Prova finale',
    year: '3 anno',
    semester: 'Non definito',
    cfu: 3,
    type: 'Prova finale',
    cohort: 'F62',
    professors: [{ line: 'Attivita senza docente unico', professors: [], note: 'Attivita conclusiva senza docente unico.' }],
    showInLanding: false,
    showInFilters: false,
  },
  {
    name: 'Analisi biochimico-cliniche',
    shortName: 'Analisi cliniche',
    icon: '/course-icons/analisi-biochimico-cliniche.png',
    year: 'Scelta',
    semester: '1 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Renata Paleari'] }],
  },
  {
    name: 'Metodologie di biologia molecolare',
    shortName: 'Metodi biologia molecolare',
    icon: '/course-icons/metodologie-biologia-molecolare.png',
    year: 'Scelta',
    semester: '1 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Federico Lazzaro', 'Stefano Manzo'] }],
  },
  {
    name: 'Metodologie di embriologia sperimentale',
    shortName: 'Embriologia sperimentale',
    icon: '/course-icons/metodologie-embriologia.png',
    year: 'Scelta',
    semester: '1 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Sara Ricciardi'] }],
  },
  {
    name: 'Metodologie innovative di biologia vegetale',
    shortName: 'Metodi biologia vegetale',
    icon: '/course-icons/metodologie-biologia-vegetale.png',
    year: 'Scelta',
    semester: '1 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Juan Ignacio Ezquer Garin', 'Marta Adelina Miranda Mendes'] }],
  },
  {
    name: 'Approcci di genomica vegetale per adattare le piante ai cambiamenti climatici e ambientali',
    shortName: 'Genomica vegetale',
    icon: '/course-icons/genomica-vegetale-biodiversita.png',
    year: 'Scelta',
    semester: '2 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Veronica Gregis', 'Luca Tadini'] }],
  },
  {
    name: 'Metodologie di ecologia applicata',
    shortName: 'Ecologia applicata',
    icon: '/course-icons/metodologie-ecologia-applicata.png',
    year: 'Scelta',
    semester: '2 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Stefano Magni'] }],
  },
  {
    name: 'Metodologie di genetica e genomica umana',
    shortName: 'Genomica umana',
    icon: '/course-icons/metodologie-genetica-genomica-umana.png',
    year: 'Scelta',
    semester: '2 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Diletta Dolfini', 'Roberto Mantovani'] }],
  },
  {
    name: 'Metodologie di indagine in biologia cellulare animale e istologia',
    shortName: 'Biologia cellulare animale',
    icon: '/course-icons/metodologie-biologia-cellulare-istologia.png',
    year: 'Scelta',
    semester: '2 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Sara Ricciardi'] }],
  },
  {
    name: 'Metodologie farmacologiche e tossicologiche',
    shortName: 'Farmacologia e tossicologia',
    icon: '/course-icons/metodologie-farmacologiche-tossicologiche.png',
    year: 'Scelta',
    semester: '2 semestre',
    cfu: 6,
    type: 'Scelta libera consigliata',
    cohort: 'F62',
    professors: [{ line: 'Edizione unica', professors: ['Marta Valenza'] }],
  },
]

export const featuredCourses = [
  'Genetica',
  'Microbiologia generale',
  'Chimica biologica',
  'Fisiologia generale e animale',
  'Anatomia comparata',
]

export const searchableCourses = courseCatalog.filter((course) => course.showInFilters !== false)
export const landingCourses = courseCatalog.filter((course) => course.showInLanding !== false && course.icon)

export const allL13Professors = Array.from(
  new Set(courseCatalog.flatMap((course) => course.professors?.flatMap((group) => group.professors) ?? [])),
).sort((a, b) => a.localeCompare(b, 'it-IT'))

export function getCourseProfessors(course: CourseInfo | undefined, line?: CourseLine | 'Tutti') {
  if (!course?.professors) return []

  const groups =
    !line || line === 'Tutti'
      ? course.professors
      : course.professors.filter((group) => group.line === line)

  return Array.from(new Set(groups.flatMap((group) => group.professors)))
}

export function getCourseLines(course: CourseInfo | undefined) {
  return course?.professors?.map((group) => group.line).filter((line) => line !== 'Attivita senza docente unico') ?? []
}

export function formatCourseMeta(course: CourseInfo | undefined) {
  if (!course) return ''
  return `${course.year} · ${course.semester} · ${course.cfu} CFU · ${course.type}`
}

export function findCourse(value: string) {
  const normalized = value.trim().toLocaleLowerCase('it-IT')
  if (!normalized) return undefined

  return courseCatalog.find((course) => {
    const names = [course.name, course.shortName, ...(course.aliases ?? [])]
    return names.some((name) => {
      const normalizedName = name.toLocaleLowerCase('it-IT')
      return normalizedName === normalized || normalizedName.includes(normalized) || normalized.includes(normalizedName)
    })
  })
}
