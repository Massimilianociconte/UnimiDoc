import { allL13Professors, searchableCourses } from './courseCatalog'
import type { DocumentInsights } from './lib/pdfProcessing'

export type ViewKey = 'explore' | 'upload' | 'credits' | 'dashboard' | 'moderation'

export type DocumentStatus =
  | 'approved'
  | 'quarantined'
  | 'pendingreview'
  | 'copyrightsuspected'
  | 'duplicateblocked'
  | 'rejected'
  | 'removed'

export type RiskLevel = 'basso' | 'medio' | 'alto'

export type DocumentItem = {
  id: string
  title: string
  subject: string
  professor: string
  academicYear: string
  type: string
  examType: string
  pages: number
  sizeMb: number
  quality: number
  flashcardQualityPercent?: number
  flashcardQualityVotes?: number
  credits: number
  downloads: number
  description: string
  status: DocumentStatus
  verified: boolean
  premium: boolean
  uploader: string
  /** Stable public identifier, present only when the seller opted in. */
  sellerId?: string
  sellerPublic?: boolean
  uploaderTrust: number
  fileHash: string
  malwareScan: 'pulito' | 'in corso' | 'sospetto'
  copyrightRisk: RiskLevel
  reportCount: number
  uploadedAt: string
  language: string
  previewKind: 'notes' | 'diagram' | 'exercise' | 'map'
  // Metadati SEO/GEO estratti automaticamente dal contenuto al momento
  // dell'upload (keywords, argomenti, abstract, flag contenuto, livello).
  insights?: DocumentInsights
  // Metadati aggiuntivi raccolti nel form di upload (o ricavati dal catalogo).
  degreeCourse?: string
  university?: string
  semester?: string
  tags?: string[]
  compatibleExams?: string[]
  /** Punteggi autoritativi dal DB (vista public_document_rankings). */
  serverRanking?: { overall: number; recent: number; didactic: number; reviewAvg?: number | null; reviewCount?: number }
}

export type AuditEntry = {
  id: string
  title: string
  detail: string
  time: string
  tone: 'good' | 'warning' | 'danger' | 'info'
}

export const subjects = searchableCourses.map((course) => course.name)

export const professors = allL13Professors

export const documentTypes = [
  'Appunti delle lezioni',
  'Schema riassuntivo',
  'Esercizi svolti',
  'Domande d\'esame',
  'Guida allo studio',
  'Formulario',
]

export const initialDocuments: DocumentItem[] = [
  {
    id: 'doc-gen-01',
    title: 'Genetica molecolare - Appunti completi',
    subject: 'Genetica',
    professor: 'Giorgio Perrella',
    academicYear: '2023/24',
    type: 'Appunti delle lezioni',
    examType: 'Scritto + orale',
    pages: 142,
    sizeMb: 18.4,
    quality: 9.6,
    flashcardQualityPercent: 86,
    flashcardQualityVotes: 74,
    credits: 12,
    downloads: 284,
    description:
      'Trascrizione, replicazione, espressione genica e tecnologia del DNA ricombinante con esempi d\'esame.',
    status: 'approved',
    verified: true,
    premium: true,
    uploader: 'Anna Studente',
    uploaderTrust: 92,
    fileHash: 'a3f5e0c19c2d',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: '15/05/2025 10:21',
    language: 'Italiano',
    previewKind: 'notes',
    insights: {
      keywords: ['trascrizione', 'replicazione del dna', 'espressione genica', 'dna ricombinante', 'rna polimerasi', 'operone lac', 'splicing', 'codice genetico'],
      topics: ['Replicazione del DNA', 'Trascrizione', 'Traduzione', 'Regolazione genica', 'Tecnologia del DNA ricombinante'],
      abstract: 'Appunti completi sui meccanismi molecolari dell\'informazione genetica: replicazione, trascrizione e traduzione, con approfondimenti sulla regolazione dell\'espressione genica e sulle tecniche di DNA ricombinante applicate in laboratorio.',
      depthLevel: 'avanzato',
      contentFlags: { hasImages: true, hasDiagrams: true, hasTables: true, hasFormulas: false, hasExercises: true, hasExamQuestions: true },
      language: 'it',
      qualityScore: 92,
    },
  },
  {
    id: 'doc-gen-02',
    title: 'Genetica - Schema riassuntivo',
    subject: 'Genetica',
    professor: 'Katia Petroni',
    academicYear: '2023/24',
    type: 'Schema riassuntivo',
    examType: 'Scritto',
    pages: 38,
    sizeMb: 5.2,
    quality: 8.7,
    flashcardQualityPercent: 78,
    flashcardQualityVotes: 31,
    credits: 6,
    downloads: 193,
    description:
      'Mappe concettuali e tabelle riassuntive per preparare l\'esame in modo rapido ed efficace.',
    status: 'approved',
    verified: true,
    premium: false,
    uploader: 'Andrea S.',
    uploaderTrust: 88,
    fileHash: '0b9ad63f77ea',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: '14/05/2025 18:47',
    language: 'Italiano',
    previewKind: 'diagram',
  },
  {
    id: 'doc-gen-03',
    title: 'Esercizi di genetica con soluzioni',
    subject: 'Genetica',
    professor: 'Giorgio Perrella',
    academicYear: '2022/23',
    type: 'Esercizi svolti',
    examType: 'Scritto',
    pages: 72,
    sizeMb: 9.8,
    quality: 8.2,
    flashcardQualityPercent: 72,
    flashcardQualityVotes: 28,
    credits: 8,
    downloads: 151,
    description:
      'Raccolta di esercizi svolti su genetica mendeliana, popolazione e molecolare.',
    status: 'approved',
    verified: true,
    premium: false,
    uploader: 'MartaBio',
    uploaderTrust: 84,
    fileHash: 'fb42d9c31ad0',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 1,
    uploadedAt: '12/05/2025 12:02',
    language: 'Italiano',
    previewKind: 'exercise',
  },
  {
    id: 'doc-mic-01',
    title: 'Microbiologia generale - Domande frequenti',
    subject: 'Microbiologia generale',
    professor: 'Federica Briani',
    academicYear: '2023/24',
    type: 'Domande d\'esame',
    examType: 'Orale',
    pages: 44,
    sizeMb: 4.1,
    quality: 8.9,
    flashcardQualityPercent: 84,
    flashcardQualityVotes: 42,
    credits: 7,
    downloads: 204,
    description:
      'Domande rielaborate dagli appelli, organizzate per argomento e difficolta.',
    status: 'approved',
    verified: true,
    premium: false,
    uploader: 'LabNotes',
    uploaderTrust: 90,
    fileHash: '1c9e4ac7b23f',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: '10/05/2025 09:34',
    language: 'Italiano',
    previewKind: 'map',
    insights: {
      keywords: ['batteri', 'parete cellulare', 'gram positivi', 'metabolismo batterico', 'antibiotici', 'virus', 'sterilizzazione', 'colorazione di gram'],
      topics: ['Struttura della cellula batterica', 'Metabolismo microbico', 'Genetica batterica', 'Controllo della crescita microbica'],
      abstract: 'Raccolta di domande d\'esame rielaborate dagli appelli di Microbiologia generale, organizzate per argomento: struttura e metabolismo batterico, genetica microbica e meccanismi d\'azione degli antibiotici.',
      depthLevel: 'intermedio',
      contentFlags: { hasImages: false, hasDiagrams: true, hasTables: false, hasFormulas: false, hasExercises: false, hasExamQuestions: true },
      language: 'it',
      qualityScore: 84,
    },
  },
  {
    id: 'doc-bio-01',
    title: 'Biochimica - Appunti integrati',
    subject: 'Chimica biologica',
    professor: 'Stefano Ricagno',
    academicYear: '2024/25',
    type: 'Appunti delle lezioni',
    examType: 'Scritto + orale',
    pages: 105,
    sizeMb: 16.8,
    quality: 0,
    credits: 10,
    downloads: 0,
    description:
      'Materiale appena caricato: controlli automatici completati, revisione manuale in attesa.',
    status: 'pendingreview',
    verified: false,
    premium: false,
    uploader: 'Marco Rossi',
    uploaderTrust: 78,
    fileHash: 'b19ae70c2d7f',
    malwareScan: 'pulito',
    copyrightRisk: 'basso',
    reportCount: 0,
    uploadedAt: '10/05/2025 08:47',
    language: 'Italiano',
    previewKind: 'notes',
  },
  {
    id: 'doc-ist-01',
    title: 'Principi di istologia - Dispensa sospetta',
    subject: 'Citologia e istologia',
    professor: 'Isabella Dalle Donne',
    academicYear: '2023/24',
    type: 'Appunti delle lezioni',
    examType: 'Scritto',
    pages: 118,
    sizeMb: 22.4,
    quality: 0,
    credits: 9,
    downloads: 0,
    description:
      'Possibile materiale non originale: richiede verifica copyright e controllo pagine.',
    status: 'copyrightsuspected',
    verified: false,
    premium: false,
    uploader: 'BioHelp93',
    uploaderTrust: 65,
    fileHash: 'd7c4a51a8a91',
    malwareScan: 'pulito',
    copyrightRisk: 'alto',
    reportCount: 2,
    uploadedAt: '09/05/2025 16:22',
    language: 'Italiano',
    previewKind: 'notes',
  },
  {
    id: 'doc-krebs-01',
    title: 'Ciclo di Krebs - Appunti',
    subject: 'Chimica biologica',
    professor: 'Cristina Visentin',
    academicYear: '2022/23',
    type: 'Appunti delle lezioni',
    examType: 'Scritto',
    pages: 26,
    sizeMb: 3.6,
    quality: 0,
    credits: 5,
    downloads: 0,
    description:
      'Documento bloccato per hash gia visto in una rimozione precedente.',
    status: 'duplicateblocked',
    verified: false,
    premium: false,
    uploader: 'KrebsRunner',
    uploaderTrust: 80,
    fileHash: 'f64b2cd0e21c',
    malwareScan: 'pulito',
    copyrightRisk: 'medio',
    reportCount: 1,
    uploadedAt: '09/05/2025 11:05',
    language: 'Italiano',
    previewKind: 'diagram',
  },
]

export const auditSeed: AuditEntry[] = [
  {
    id: 'audit-1',
    title: 'Documento selezionato per revisione',
    detail: 'Appunti di Biochimica - Appunti integrati',
    time: 'oggi, 09:14',
    tone: 'info',
  },
  {
    id: 'audit-2',
    title: 'Malware scan completato',
    detail: 'Risultato: pulito, MIME application/pdf',
    time: 'oggi, 09:11',
    tone: 'good',
  },
  {
    id: 'audit-3',
    title: 'Rischio copyright valutato',
    detail: 'Livello: basso, nessuna corrispondenza bloccata',
    time: 'oggi, 09:10',
    tone: 'good',
  },
  {
    id: 'audit-4',
    title: 'Segnalazione RPT-4421 aperta',
    detail: 'Motivo: possibile contenuto protetto',
    time: 'ieri, 18:40',
    tone: 'warning',
  },
]

export const creditLedger = [
  { reason: 'Upload approvato', amount: 25, date: '15/05/2025', type: 'gain' },
  { reason: 'Download documento premium', amount: -12, date: '15/05/2025', type: 'spend' },
  { reason: 'Recensione utile', amount: 4, date: '14/05/2025', type: 'gain' },
  { reason: 'Segnalazione valida', amount: 6, date: '13/05/2025', type: 'gain' },
]

export const popularSubjects = [
  { name: 'Genetica', downloads: '27.4k', trend: '+12%' },
  { name: 'Chimica biologica', downloads: '19.8k', trend: '+8%' },
  { name: 'Fisiologia', downloads: '18.1k', trend: '+6%' },
  { name: 'Biologia cellulare', downloads: '14.7k', trend: '+5%' },
  { name: 'Anatomia umana', downloads: '12.9k', trend: '+4%' },
]
