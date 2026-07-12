// ---------------------------------------------------------------------------
// Catalogo dei corsi di laurea triennale e magistrale a ciclo unico
// dell'Università degli Studi di Milano (offerta 2025/26–2026/27 — fonte:
// unimi.it/it/corsi, verificato luglio 2026).
// Le classi contrassegnate "R" sugli ordinamenti riformati sono normalizzate
// alla classe base (es. "L-18 R" → "L-18"). "Infermieristica pediatrica" è
// esclusa: in disattivazione progressiva dal 2026/27 (niente nuovi iscritti).
//
// Questo registro è la copia frontend della tabella `degree_programs` su
// Supabase: stessa chiave (slug) e stesso ordinamento (area, poi nome).
// degreeType distingue le triennali dalle 9 magistrali a ciclo unico (Medicina
// e chirurgia ×4 poli, Odontoiatria, Veterinaria, Farmacia, CTF,
// Giurisprudenza). catalogReady: true = piano di studi con docenti disponibile
// (Scienze biologiche dal catalogo statico src/courseCatalog.ts; gli altri
// corsi dalle tabelle degree_courses/professors, importate SOLO da unimi.it;
// vedi tools/unimi-catalog). I corsi senza flag accettano materia e docente in
// inserimento libero: le 3 triennali interateneo con sede amministrativa fuori
// Milano (Artificial Intelligence → Pavia, Interpretariato LIS → Milano-Bicocca,
// impresa casearia → Parma) restano elencate perché co-erogate dalla Statale,
// ma il loro piano NON viene importato da altri atenei per coerenza di brand;
// idem infermieristica e ostetricia (nessun piano strutturato su unimi.it).
// ---------------------------------------------------------------------------

export type DegreeArea =
  | 'Scienze e tecnologie'
  | 'Medicina e professioni sanitarie'
  | 'Agraria e alimentare'
  | 'Farmacia e scienze del farmaco'
  | 'Studi umanistici'
  | 'Giurisprudenza'
  | 'Economia, politica e società'

export type DegreeType = 'triennale' | 'ciclo-unico'

export type DegreeProgram = {
  slug: string
  name: string
  classe: string
  area: DegreeArea
  /** Percorso ufficiale su unimi.it (provenienza dei dati). */
  unimiPath: string
  /** Triennale oppure laurea magistrale a ciclo unico. Default: triennale. */
  degreeType?: DegreeType
  /** Atenei partner per i corsi interateneo. */
  interateneo?: string
  /** Primo anno accademico di attivazione, se successivo al 2025/26. */
  activeFrom?: string
  /** true quando esiste il piano di studi dettagliato con i docenti. */
  catalogReady?: boolean
}

export const DEGREE_AREAS: DegreeArea[] = [
  'Scienze e tecnologie',
  'Medicina e professioni sanitarie',
  'Agraria e alimentare',
  'Farmacia e scienze del farmaco',
  'Studi umanistici',
  'Giurisprudenza',
  'Economia, politica e società',
]

const P = '/it/corsi/laurea-triennale'
const CU = '/it/corsi/laurea-magistrale-ciclo-unico'

export const DEGREE_PROGRAMS: DegreeProgram[] = [
  // --- Scienze e tecnologie -----------------------------------------------
  { slug: 'artificial-intelligence', name: 'Artificial Intelligence', classe: 'L-31', area: 'Scienze e tecnologie', unimiPath: `${P}/artificial-intelligence`, interateneo: 'Pavia (capofila) · Milano-Bicocca' },
  { slug: 'beni-culturali-scienze-tecnologie-diagnostica', name: 'Beni culturali: scienze, tecnologie e diagnostica', classe: 'L-43', area: 'Scienze e tecnologie', unimiPath: `${P}/beni-culturali-scienze-tecnologie-e-diagnostica`, catalogReady: true },
  { slug: 'biotecnologia', name: 'Biotecnologia', classe: 'L-2', area: 'Scienze e tecnologie', unimiPath: `${P}/biotecnologia`, catalogReady: true },
  { slug: 'chimica', name: 'Chimica', classe: 'L-27', area: 'Scienze e tecnologie', unimiPath: `${P}/chimica`, catalogReady: true },
  { slug: 'chimica-industriale', name: 'Chimica industriale', classe: 'L-27', area: 'Scienze e tecnologie', unimiPath: `${P}/chimica-industriale`, catalogReady: true },
  { slug: 'fisica', name: 'Fisica', classe: 'L-30', area: 'Scienze e tecnologie', unimiPath: `${P}/fisica`, catalogReady: true },
  { slug: 'informatica', name: 'Informatica', classe: 'L-31', area: 'Scienze e tecnologie', unimiPath: `${P}/informatica`, catalogReady: true },
  { slug: 'informatica-musicale', name: 'Informatica musicale', classe: 'L-31', area: 'Scienze e tecnologie', unimiPath: `${P}/informatica-musicale`, catalogReady: true },
  { slug: 'informatica-comunicazione-digitale', name: 'Informatica per la comunicazione digitale', classe: 'L-31', area: 'Scienze e tecnologie', unimiPath: `${P}/informatica-la-comunicazione-digitale`, catalogReady: true },
  { slug: 'matematica', name: 'Matematica', classe: 'L-35', area: 'Scienze e tecnologie', unimiPath: `${P}/matematica-triennale`, catalogReady: true },
  { slug: 'scienze-ambientali-politiche-sostenibilita', name: 'Scienze ambientali e politiche per la sostenibilità', classe: 'L-32', area: 'Scienze e tecnologie', unimiPath: `${P}/scienze-ambientali-e-politiche-la-sostenibilita`, catalogReady: true },
  { slug: 'scienze-biologiche', name: 'Scienze biologiche', classe: 'L-13', area: 'Scienze e tecnologie', unimiPath: `${P}/scienze-biologiche`, catalogReady: true },
  { slug: 'scienze-geologiche', name: 'Scienze geologiche', classe: 'L-34', area: 'Scienze e tecnologie', unimiPath: `${P}/scienze-geologiche`, catalogReady: true },
  { slug: 'scienze-naturali', name: 'Scienze naturali', classe: 'L-32', area: 'Scienze e tecnologie', unimiPath: `${P}/scienze-naturali`, catalogReady: true },
  { slug: 'sicurezza-sistemi-reti-informatiche', name: 'Sicurezza dei sistemi e delle reti informatiche', classe: 'L-31', area: 'Scienze e tecnologie', unimiPath: `${P}/sicurezza-dei-sistemi-e-delle-reti-informatiche`, catalogReady: true },
  { slug: 'sicurezza-informatica-intelligenza-artificiale', name: 'Sicurezza informatica e intelligenza artificiale', classe: 'L-31', area: 'Scienze e tecnologie', unimiPath: `${P}/sicurezza-informatica-e-intelligenza-artificiale`, catalogReady: true },

  // --- Medicina e professioni sanitarie ------------------------------------
  { slug: 'assistenza-sanitaria', name: 'Assistenza sanitaria', classe: 'L/SNT4', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/assistenza-sanitaria`, catalogReady: true },
  { slug: 'biotecnologie-mediche', name: 'Biotecnologie mediche', classe: 'L-2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/biotecnologie-mediche`, catalogReady: true },
  { slug: 'dietistica', name: 'Dietistica', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/dietistica`, catalogReady: true },
  { slug: 'fisioterapia', name: 'Fisioterapia', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/fisioterapia`, catalogReady: true },
  { slug: 'igiene-dentale', name: 'Igiene dentale', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/igiene-dentale`, catalogReady: true },
  { slug: 'infermieristica', name: 'Infermieristica', classe: 'L/SNT1', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/infermieristica` },
  { slug: 'logopedia', name: 'Logopedia', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/logopedia`, catalogReady: true },
  { slug: 'ortottica-assistenza-oftalmologica', name: 'Ortottica ed assistenza oftalmologica', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/ortottica-ed-assistenza-oftalmologica`, catalogReady: true },
  { slug: 'ostetricia', name: 'Ostetricia', classe: 'L/SNT1', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/ostetricia` },
  { slug: 'podologia', name: 'Podologia', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/podologia`, catalogReady: true },
  { slug: 'scienze-motorie-sport-salute', name: 'Scienze motorie, sport e salute', classe: 'L-22', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/scienze-motorie-sport-e-salute`, catalogReady: true },
  { slug: 'scienze-psicologiche-prevenzione-cura', name: 'Scienze psicologiche per la prevenzione e la cura', classe: 'L-24', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/scienze-psicologiche-la-prevenzione-e-la-cura`, catalogReady: true },
  { slug: 'tecnica-riabilitazione-psichiatrica', name: 'Tecnica della riabilitazione psichiatrica', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecnica-della-riabilitazione-psichiatrica`, catalogReady: true },
  { slug: 'tecniche-audiometriche', name: 'Tecniche audiometriche', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-audiometriche`, catalogReady: true },
  { slug: 'tecniche-audioprotesiche', name: 'Tecniche audioprotesiche', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-audioprotesiche`, catalogReady: true },
  { slug: 'tecniche-prevenzione-ambiente-lavoro', name: "Tecniche della prevenzione nell'ambiente e nei luoghi di lavoro", classe: 'L/SNT4', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-della-prevenzione-nellambiente-e-nei-luoghi-di-lavoro`, catalogReady: true },
  { slug: 'tecniche-fisiopatologia-cardiocircolatoria', name: 'Tecniche di fisiopatologia cardiocircolatoria e perfusione cardiovascolare', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-di-fisiopatologia-cardiocircolatoria-e-perfusione-cardiovascolare`, catalogReady: true },
  { slug: 'tecniche-laboratorio-biomedico', name: 'Tecniche di laboratorio biomedico', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-di-laboratorio-biomedico`, catalogReady: true },
  { slug: 'tecniche-neurofisiopatologia', name: 'Tecniche di neurofisiopatologia', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-di-neurofisiopatologia`, catalogReady: true },
  { slug: 'tecniche-radiologia-medica', name: 'Tecniche di radiologia medica, per immagini e radioterapia', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-di-radiologia-medica-immagini-e-radioterapia`, catalogReady: true },
  { slug: 'tecniche-ortopediche', name: 'Tecniche ortopediche', classe: 'L/SNT3', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/tecniche-ortopediche`, catalogReady: true },
  { slug: 'terapia-neuro-psicomotricita-eta-evolutiva', name: 'Terapia della neuro e psicomotricità dell’età evolutiva', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/terapia-della-neuro-e-psicomotricita-delleta-evolutiva`, catalogReady: true },
  { slug: 'terapia-occupazionale', name: 'Terapia occupazionale', classe: 'L/SNT2', area: 'Medicina e professioni sanitarie', unimiPath: `${P}/terapia-occupazionale`, catalogReady: true },

  // --- Agraria e alimentare -------------------------------------------------
  { slug: 'agricoltura-sostenibile', name: 'Agricoltura sostenibile', classe: 'L-25', area: 'Agraria e alimentare', unimiPath: `${P}/agricoltura-sostenibile`, catalogReady: true },
  { slug: 'allevamento-benessere-animali-affezione', name: "Allevamento e benessere degli animali d'affezione", classe: 'L-38', area: 'Agraria e alimentare', unimiPath: `${P}/allevamento-e-benessere-degli-animali-daffezione`, catalogReady: true },
  { slug: 'produzione-protezione-piante-verde', name: 'Produzione e protezione delle piante e dei sistemi del verde', classe: 'L-25', area: 'Agraria e alimentare', unimiPath: `${P}/produzione-e-protezione-delle-piante-e-dei-sistemi-del-verde`, catalogReady: true },
  { slug: 'scienze-ristorazione-distribuzione-alimenti', name: 'Scienze della ristorazione e distribuzione degli alimenti', classe: 'L-26', area: 'Agraria e alimentare', unimiPath: `${P}/scienze-della-ristorazione-e-distribuzione-degli-alimenti`, catalogReady: true },
  { slug: 'scienze-produzioni-animali', name: 'Scienze delle produzioni animali', classe: 'L-38', area: 'Agraria e alimentare', unimiPath: `${P}/scienze-delle-produzioni-animali`, catalogReady: true },
  { slug: 'scienze-tecnologie-alimenti-sostenibili', name: 'Scienze e tecnologie per alimenti sostenibili', classe: 'L-26', area: 'Agraria e alimentare', unimiPath: `${P}/scienze-e-tecnologie-alimenti-sostenibili`, catalogReady: true },
  { slug: 'sistemi-digitali-agricoltura', name: 'Sistemi digitali in agricoltura', classe: 'L-P02', area: 'Agraria e alimentare', unimiPath: `${P}/sistemi-digitali-agricoltura`, catalogReady: true },
  { slug: 'tecnologie-gestione-impresa-casearia', name: "Tecnologie e gestione dell'impresa casearia", classe: 'L-P02', area: 'Agraria e alimentare', unimiPath: `${P}/tecnologie-e-gestione-dellimpresa-casearia-l-p02-interateneo`, interateneo: 'Parma (capofila)' },
  { slug: 'valorizzazione-tutela-ambiente-territorio-montano', name: "Valorizzazione e tutela dell'ambiente e del territorio montano", classe: 'L-25', area: 'Agraria e alimentare', unimiPath: `${P}/valorizzazione-e-tutela-dellambiente-e-del-territorio-montano`, catalogReady: true },
  { slug: 'viticoltura-enologia', name: 'Viticoltura ed enologia', classe: 'L-25', area: 'Agraria e alimentare', unimiPath: `${P}/viticoltura-ed-enologia`, catalogReady: true },

  // --- Farmacia e scienze del farmaco --------------------------------------
  { slug: 'scienze-prodotti-naturali-salute-sepnas', name: 'Scienze dei prodotti naturali per la salute – SEPNAS', classe: 'L-29', area: 'Farmacia e scienze del farmaco', unimiPath: `${P}/scienze-dei-prodotti-naturali-la-salute-sepnas`, catalogReady: true },
  { slug: 'tossicologia-sicurezza-umana-ambientale-tops', name: 'Tossicologia per la sicurezza umana e ambientale – TopS', classe: 'L-29', area: 'Farmacia e scienze del farmaco', unimiPath: `${P}/tossicologia-la-sicurezza-umana-e-ambientale-tops`, catalogReady: true },

  // --- Studi umanistici ------------------------------------------------------
  { slug: 'ancient-civilizations-contemporary-world', name: 'Ancient Civilizations for the Contemporary World', classe: 'L-1', area: 'Studi umanistici', unimiPath: `${P}/ancient-civilizations-contemporary-world`, catalogReady: true },
  { slug: 'filosofia', name: 'Filosofia', classe: 'L-5', area: 'Studi umanistici', unimiPath: `${P}/filosofia`, catalogReady: true },
  { slug: 'geografia-ambiente-territorio', name: 'Geografia, ambiente e territorio', classe: 'L-6', area: 'Studi umanistici', unimiPath: `${P}/geografia-ambiente-e-territorio`, catalogReady: true },
  { slug: 'interpretariato-traduzione-lis-list', name: 'Interpretariato e traduzione in lingua dei segni italiana (LIS) e tattile (LIST)', classe: 'L-20', area: 'Studi umanistici', unimiPath: `${P}/interpretariato-e-traduzione-lingua-dei-segni-italiana-lis-e-lingua-dei`, interateneo: 'Milano-Bicocca (capofila)' },
  { slug: 'lettere', name: 'Lettere', classe: 'L-10', area: 'Studi umanistici', unimiPath: `${P}/lettere`, catalogReady: true },
  { slug: 'lingue-letterature-moderne', name: 'Lingue e letterature moderne', classe: 'L-11', area: 'Studi umanistici', unimiPath: `${P}/lingue-e-letterature-moderne`, catalogReady: true },
  { slug: 'mediazione-linguistica-culturale', name: 'Mediazione linguistica e culturale', classe: 'L-12', area: 'Studi umanistici', unimiPath: `${P}/mediazione-linguistica-e-culturale-applicata-allambito-economico-giuridico-e`, catalogReady: true },
  { slug: 'scienze-beni-culturali', name: 'Scienze dei beni culturali', classe: 'L-1', area: 'Studi umanistici', unimiPath: `${P}/scienze-dei-beni-culturali`, catalogReady: true },
  { slug: 'scienze-umanistiche-comunicazione', name: 'Scienze umanistiche per la comunicazione', classe: 'L-20', area: 'Studi umanistici', unimiPath: `${P}/scienze-umanistiche-la-comunicazione`, catalogReady: true },
  { slug: 'storia', name: 'Storia', classe: 'L-42', area: 'Studi umanistici', unimiPath: `${P}/storia`, catalogReady: true },

  // --- Giurisprudenza --------------------------------------------------------
  { slug: 'scienze-servizi-giuridici', name: 'Scienze dei servizi giuridici', classe: 'L-14', area: 'Giurisprudenza', unimiPath: `${P}/scienze-dei-servizi-giuridici`, catalogReady: true },

  // --- Economia, politica e società -----------------------------------------
  { slug: 'comunicazione-societa-ces', name: 'Comunicazione e società (CES)', classe: 'L-20', area: 'Economia, politica e società', unimiPath: `${P}/comunicazione-e-societa-ces`, catalogReady: true },
  { slug: 'economia-aziendale', name: 'Economia aziendale', classe: 'L-18', area: 'Economia, politica e società', unimiPath: `${P}/economia-aziendale`, activeFrom: '2026/27', catalogReady: true },
  { slug: 'economia-management-ema', name: 'Economia e management (EMA)', classe: 'L-18', area: 'Economia, politica e società', unimiPath: `${P}/economia-e-management-ema`, catalogReady: true },
  { slug: 'economics-behavior-data-policy', name: 'Economics: behavior, data and policy', classe: 'L-33', area: 'Economia, politica e società', unimiPath: `${P}/economics-behavior-data-and-policy`, catalogReady: true },
  { slug: 'international-politics-law-economics-iple', name: 'International Politics, Law and Economics (IPLE)', classe: 'L-36', area: 'Economia, politica e società', unimiPath: `${P}/international-politics-law-and-economics-iple`, catalogReady: true },
  { slug: 'management-governance-innovazione-magips', name: 'Management, governance e innovazione nel pubblico e nel socio-sanitario (MAGIPS)', classe: 'L-16', area: 'Economia, politica e società', unimiPath: `${P}/management-governance-e-innovazione-nel-pubblico-e-nel-socio-sanitario`, catalogReady: true },
  { slug: 'management-organizzazioni-lavoro-mol', name: 'Management delle organizzazioni e del lavoro (MOL)', classe: 'L-16', area: 'Economia, politica e società', unimiPath: `${P}/management-delle-organizzazioni-e-del-lavoro-mol`, catalogReady: true },
  { slug: 'scienze-internazionali-istituzioni-europee-sie', name: 'Scienze internazionali e istituzioni europee (SIE)', classe: 'L-36', area: 'Economia, politica e società', unimiPath: `${P}/scienze-internazionali-e-istituzioni-europee-sie`, catalogReady: true },
  { slug: 'scienze-politiche-spo', name: 'Scienze politiche (SPO)', classe: 'L-36', area: 'Economia, politica e società', unimiPath: `${P}/scienze-politiche-spo`, catalogReady: true },
  { slug: 'scienze-sociali-globalizzazione-glo', name: 'Scienze sociali per la globalizzazione (GLO)', classe: 'L-37', area: 'Economia, politica e società', unimiPath: `${P}/scienze-sociali-la-globalizzazione-glo`, catalogReady: true },

  // --- Lauree magistrali a ciclo unico (offerta 2026/27) --------------------
  { slug: 'medicina-chirurgia-polo-centrale', name: 'Medicina e chirurgia - Polo Centrale', classe: 'LM-41', area: 'Medicina e professioni sanitarie', unimiPath: `${CU}/medicina-e-chirurgia-polo-centrale`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'medicina-chirurgia-polo-san-paolo', name: 'Medicina e chirurgia - Polo San Paolo', classe: 'LM-41', area: 'Medicina e professioni sanitarie', unimiPath: `${CU}/medicina-e-chirurgia-polo-san-paolo`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'medicina-chirurgia-polo-vialba', name: 'Medicina e chirurgia - Polo Vialba', classe: 'LM-41', area: 'Medicina e professioni sanitarie', unimiPath: `${CU}/medicina-e-chirurgia-polo-vialba`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'medicina-chirurgia-ims', name: 'Medicina e chirurgia - International Medical School', classe: 'LM-41', area: 'Medicina e professioni sanitarie', unimiPath: `${CU}/medicina-e-chirurgia-international-medical-school`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'odontoiatria-protesi-dentaria', name: 'Odontoiatria e protesi dentaria', classe: 'LM-46', area: 'Medicina e professioni sanitarie', unimiPath: `${CU}/odontoiatria-e-protesi-dentaria`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'medicina-veterinaria', name: 'Medicina veterinaria', classe: 'LM-42', area: 'Medicina e professioni sanitarie', unimiPath: `${CU}/medicina-veterinaria-ciclo-unico`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'farmacia', name: 'Farmacia', classe: 'LM-13', area: 'Farmacia e scienze del farmaco', unimiPath: `${CU}/farmacia-ciclo-unico`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'chimica-tecnologia-farmaceutiche', name: 'Chimica e tecnologia farmaceutiche', classe: 'LM-13', area: 'Farmacia e scienze del farmaco', unimiPath: `${CU}/chimica-e-tecnologia-farmaceutiche-ciclo-unico`, degreeType: 'ciclo-unico', catalogReady: true },
  { slug: 'giurisprudenza', name: 'Giurisprudenza', classe: 'LMG/01', area: 'Giurisprudenza', unimiPath: `${CU}/giurisprudenza-ciclo-unico`, degreeType: 'ciclo-unico', catalogReady: true },
]

export const DEFAULT_DEGREE_SLUG = 'scienze-biologiche'

const programBySlug = new Map(DEGREE_PROGRAMS.map((program) => [program.slug, program]))

export function findDegreeProgram(slug: string): DegreeProgram | undefined {
  return programBySlug.get(slug)
}

/** Etichetta usata in documents.degree_course, es. "Scienze biologiche (L-13)". */
export function degreeCourseLabel(program: DegreeProgram): string {
  return `${program.name} (${program.classe})`
}

export function degreeProgramPath(program: DegreeProgram): string {
  return `/corsi/${program.slug}`
}

export function findDegreeByPath(pathname: string): DegreeProgram | null {
  const match = pathname.match(/^\/corsi\/([^/]+)\/?$/)
  if (!match) return null
  return programBySlug.get(match[1]) ?? null
}

export function degreeProgramsByArea(): Array<{ area: DegreeArea; programs: DegreeProgram[] }> {
  return DEGREE_AREAS.map((area) => ({
    area,
    programs: DEGREE_PROGRAMS.filter((program) => program.area === area),
  }))
}

export function degreeTypeOf(program: DegreeProgram): DegreeType {
  return program.degreeType ?? 'triennale'
}

/** Etichetta breve per il tipo di corso, usata nei badge di /corsi. */
export function degreeTypeLabel(program: DegreeProgram): string {
  return degreeTypeOf(program) === 'ciclo-unico' ? 'Ciclo unico' : 'Triennale'
}
