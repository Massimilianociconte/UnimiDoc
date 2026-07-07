import type { ChatMessage } from './ai.ts'

// Versioned prompts. Bump the *_vN suffix (via env) when you change wording so
// the cache and cost ledger stay attributable to a specific prompt revision.

export type AiHelpMode = 'explain' | 'followup' | 'example' | 'memo' | 'visualize'

export type AiHelpContext = {
  question: string
  correctAnswer: string
  userAnswer?: string | null
  answerStatus?: string | null
  sourceText?: string | null
  previousExplanation?: string | null
  followupQuestion?: string | null
  language?: string
}

const SYSTEM: Record<AiHelpMode, string> = {
  explain: [
    'Sei un tutor didattico per studenti universitari (biologia, anatomia, fisiologia, medicina, biochimica, microbiologia).',
    'Spiega una domanda di quiz/flashcard in modo chiaro, sintetico e utile allo studio.',
    'Regole: non inventare; usa il testo sorgente se disponibile; se non basta, dillo chiaramente;',
    'spiega perché la risposta corretta è corretta; se l’utente ha sbagliato, spiega perché la sua risposta è sbagliata e individua il misconcept;',
    'evita risposte troppo lunghe; niente markdown pesante; tono incoraggiante e preciso; rispondi nella lingua richiesta.',
    'Output: 1–3 brevi paragrafi.',
  ].join('\n'),
  followup: [
    'Sei un tutor didattico contestuale. L’utente fa una domanda di approfondimento su una specifica flashcard/quiz.',
    'Mantieni il contesto della domanda originale e del testo sorgente. Non comportarti come una chat generica.',
    'Non inventare: se il testo sorgente non basta, dillo. Resta collegato alla flashcard, chiarisci il dubbio specifico, usa un esempio breve se utile.',
    'Non allungare inutilmente. Rispondi nella lingua dell’utente.',
  ].join('\n'),
  example: [
    'Sei un tutor didattico. Genera un esempio concreto o una mini-applicazione del concetto della flashcard.',
    'Per anatomia: collegamento funzionale/clinico semplice. Biologia: esempio cellulare/molecolare/fisiologico. Biochimica: pathway/regolazione. Microbiologia: meccanismo/condizione sperimentale.',
    'Non inventare casi clinici fuorvianti; se usi un’analogia dichiarala. Mantieni la risposta breve. Rispondi nella lingua richiesta.',
  ].join('\n'),
  memo: [
    'Sei un tutor della memoria. Genera una mnemotecnica per ricordare il concetto: acronimo, associazione, frase mnemonica, analogia o mini-storia.',
    'Deve aiutare davvero a ricordare, essere breve e marcata come supporto mnemonico (non contenuto scientifico primario). Non sostituire la spiegazione. Rispondi nella lingua richiesta.',
  ].join('\n'),
  visualize: [
    'Sei un tutor che aiuta la memoria visiva. Suggerisci una rappresentazione testuale/strutturata del concetto:',
    'descrizione di schema, mini-mappa concettuale testuale, flusso causa-effetto, tabella comparativa o immagine mentale.',
    'Non generare immagini: solo testo strutturato che aiuti a visualizzare. Rispondi nella lingua richiesta.',
  ].join('\n'),
}

export function buildAiHelpPrompt(mode: AiHelpMode, ctx: AiHelpContext): ChatMessage[] {
  const language = ctx.language ?? 'it'
  const source = (ctx.sourceText ?? '').slice(0, 6000)

  if (mode === 'followup') {
    const user = [
      `Domanda originale: ${ctx.question}`,
      `Risposta corretta: ${ctx.correctAnswer}`,
      `Risposta data dall’utente: ${ctx.userAnswer ?? '-'}`,
      `Spiegazione precedente: ${ctx.previousExplanation ?? '-'}`,
      `Testo sorgente: ${source || '-'}`,
      '',
      `Domanda follow-up dell’utente: ${ctx.followupQuestion ?? ''}`,
      `Lingua: ${language}`,
      '',
      'Rispondi in modo breve e didattico.',
    ].join('\n')
    return [{ role: 'system', content: SYSTEM.followup }, { role: 'user', content: user }]
  }

  const user = [
    `Domanda: ${ctx.question}`,
    `Risposta corretta: ${ctx.correctAnswer}`,
    `Risposta utente: ${ctx.userAnswer ?? '-'}`,
    `Stato risposta: ${ctx.answerStatus ?? '-'}`,
    `Testo sorgente: ${source || '-'}`,
    `Lingua: ${language}`,
  ].join('\n')
  return [{ role: 'system', content: SYSTEM[mode] }, { role: 'user', content: user }]
}

// --------------------------------------------------------------------------
// flashcards_v1 — premium AI flashcard generation (JSON only).
// --------------------------------------------------------------------------
export function buildFlashcardsPrompt(params: {
  chunkText: string
  maxCards: number
  language: string
  pageStart?: number | null
  pageEnd?: number | null
}): ChatMessage[] {
  const system = [
    'Sei un generatore di flashcard per studio universitario e documenti scientifici.',
    'Devi produrre SOLO json valido. Non inventare: usa esclusivamente il testo fornito.',
    'Se il testo non contiene informazioni sufficienti, restituisci {"flashcards": []}.',
    'Genera flashcard utili per active recall. Evita duplicati, domande vaghe e risposte troppo lunghe.',
    'Ogni flashcard deve essere autonoma e comprensibile fuori dal chunk. Mantieni la lingua richiesta.',
    'DIVERSIFICA le tipologie: non più del 40% dello stesso type in un batch. Copri, quando il testo lo permette:',
    '- "definition": che cos\'è / significato di un termine tecnico;',
    '- "qa": domanda secca su un fatto puntuale (chi/dove/quanto/quale);',
    '- "reasoning": domanda ragionata su causa, effetto, perché o meccanismo;',
    '- "comparison": differenza o confronto tra due entità del testo;',
    '- "application": applicare il concetto a un caso concreto PRESENTE o direttamente derivabile dal testo;',
    '- "cloze": frase del testo con il termine chiave sostituito da _____ (metti la frase in cloze_text).',
    'Ogni domanda deve puntare a UN concetto specifico: mai "parla di…", "descrivi tutto…", "cosa dice il testo su…".',
    'Non generare due card sullo stesso identico concetto. source_quote deve citare la frase esatta del testo usata.',
    'Formato: {"flashcards":[{"type":"qa"|"cloze"|"definition"|"comparison"|"reasoning"|"application","question":string,"answer":string,"cloze_text":string|null,"difficulty":"easy"|"medium"|"hard","source_quote":string,"page_start":number|null,"page_end":number|null,"tags":[string]}]}',
    'Solo json, nessun markdown.',
  ].join('\n')

  const user = [
    `Massimo ${params.maxCards} flashcard.`,
    `Lingua: ${params.language}`,
    `Pagine: ${params.pageStart ?? '?'}-${params.pageEnd ?? '?'}`,
    'Testo:',
    '"""',
    params.chunkText.slice(0, 12000),
    '"""',
  ].join('\n')

  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

// --------------------------------------------------------------------------
// image_occlusion_v1 — Gemini vision prompt (JSON only).
// --------------------------------------------------------------------------
export function buildImageOcclusionPrompt(params: { language: string; pageNumber?: number | null }): string {
  return [
    'Sei un assistente vision per generare image occlusion card da FIGURE scientifiche: diagrammi, schemi, grafici, illustrazioni anatomiche, mappe, cicli e strutture etichettate.',
    'PRIMA valuta se la pagina contiene una figura reale. NON è una figura: testo colorato, testo evidenziato, titoli, elenchi, tabelle di solo testo, blocchi di paragrafo, loghi o intestazioni. Se la pagina è solo testo (anche colorato o evidenziato), restituisci {"occlusion_candidates": []}.',
    'Se c\'è una figura, proponi occlusioni SOLO sulle etichette/strutture nominate DENTRO la figura (nomi di parti, frecce con didascalia, callout anatomici, assi/legenda di un grafico).',
    'Ogni bbox deve coprire una sola etichetta/struttura, mai un paragrafo o un\'intera figura. Non coprire aree troppo grandi (width o height > 0.5 quasi sempre errati: abbassa la confidence o scarta).',
    'Distingui esplicitamente: se l\'elemento è testo normale del documento (non una label dentro una figura) NON crearne una card.',
    'Restituisci SOLO json valido nel formato:',
    '{"is_figure":boolean,"figure_type":"diagram"|"chart"|"anatomy"|"map"|"scheme"|"none","occlusion_candidates":[{"label":string,"question":string,"answer":string,"hint":string,"difficulty":"easy"|"medium"|"hard","bbox":{"x":number,"y":number,"width":number,"height":number},"confidence":number,"reason":string}]}',
    'Regole coordinate: normalizzate 0-1; x,y = angolo superiore sinistro; width,height relativi; il bbox copre solo la label/struttura da nascondere; se non sei sicuro abbassa confidence.',
    'Se non è una figura o non ci sono etichette adatte: {"is_figure":false,"figure_type":"none","occlusion_candidates":[]}.',
    `Lingua output: ${params.language}`,
    `Pagina documento: ${params.pageNumber ?? 'unknown'}`,
  ].join('\n')
}

// --------------------------------------------------------------------------
// outline_v1 — cost-first document outline refinement (JSON only).
// --------------------------------------------------------------------------
export type OutlineCandidateForPrompt = {
  title: string
  page: number
  level?: number
  score?: number
  source?: string
  evidence?: string
}

export function buildOutlinePrompt(params: {
  candidates: OutlineCandidateForPrompt[]
  pageCount: number
  language: string
}): ChatMessage[] {
  const system = [
    'Sei un assistente per costruire indici verificabili di dispense universitarie.',
    'Devi produrre SOLO json valido. Non inventare capitoli o titoli non supportati dai candidati forniti.',
    'Obiettivo: trasformare candidati rumorosi in un indice gerarchico breve, cliccabile e utile allo studio.',
    'Mantieni i titoli nella lingua del documento. Puoi correggere maiuscole/minuscole e accorciare titoli lunghi, ma il significato deve restare ancorato ai candidati.',
    'Scarta footer, header, bibliografia, copyright, indice analitico, numeri pagina e frasi generiche.',
    'Non usare contenuti esterni. Se i candidati sono scarsi, restituisci poche voci ad alta confidenza.',
    'Formato json: {"outline":[{"title":string,"level":1|2|3,"page_start":number,"page_end":number|null,"confidence":number,"source_candidate_titles":[string]}],"notes":[string]}',
    'Regole: level coerente; page_start tra 1 e page_count; page_end null o >= page_start; confidence 0..1; massimo 120 voci; nessun markdown.',
  ].join('\n')

  const user = [
    `Lingua: ${params.language}`,
    `page_count: ${params.pageCount}`,
    'Candidati verificabili:',
    JSON.stringify(params.candidates.slice(0, 220)),
    '',
    'Restituisci SOLO json valido.',
  ].join('\n')

  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}
