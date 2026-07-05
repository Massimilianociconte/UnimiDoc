# Backend: upload reale, image occlusion, generazione indice

Stato onesto di cosa è pronto lato codice e cosa richiede il deploy live
(Edge Functions + storage) del progetto Supabase `pmpzfkikwfylesehfezv`.

## 1. Upload reale su storage + DB

**Pronto (codice/schema):**
- Migrazioni: `documents` con tutti i metadati (incl.
  `202607040010_document_metadata_fields.sql`: description, exam_type, semester,
  degree_course, university, tags, compatible_exams, insights).
- Bucket privati previsti: `processing-temp`, `private-documents`,
  `derived-previews` (vedi pdf-flashcards-compression-architecture.md §6).
- RLS owner-scoped su `documents`; acquisto atomico via `purchase_document`.

**Deploy live completato (2026-07-05):** la Edge Function `document-upload`:
1. crea il record `documents` privato (`owner_id = auth.uid()`);
2. rilascia un signed upload URL verso `processing-temp/{uid}/incoming/{doc}.pdf`;
3. accoda i job `compress`, `extract`, `layout`, `figures`, `outline`,
   `quality_review` per il worker (`server/pdf-pipeline/pipeline.ts`);
4. mantiene il documento non pubblico finché il worker non verifica hash/bytes,
   sposta il file validato in `private-documents/...` e imposta lo stato finale.

Il gate anti-"documento visibile ma non salvato" resta server-side: pubblicare
(`visibility='published'`) SOLO dopo conferma del worker. Il client non deve mai
marcare un documento come pubblicato da solo.

## 2. Image occlusion (Gemini)

**Fatto:** prompt `image_occlusion_v2` (env `AI_IMAGE_OCCLUSION_PROMPT_VERSION`)
molto più severo: distingue FIGURE reali (diagrammi, grafici, anatomia, schemi,
mappe) da testo colorato / evidenziazioni / tabelle di solo testo, e restituisce
`is_figure` + `figure_type`. Le occlusioni sono ammesse solo sulle etichette
dentro una figura, mai su paragrafi o sull'intera figura. Modello binding:
Gemini 3 Flash Preview (`_shared/ai.ts resolveAiProvider`).

Client (zero-costo): il lab occlusion evidenzia le pagine con `imageCount > 0`
come "figure reali" selezionabili (badge + conteggio), così l'utente sceglie su
quali immagini creare esercizi. L'editor manuale supporta disegno drag-to-draw,
move/resize e controlli da tastiera.

**Deploy live completato (2026-07-05):** la Edge Function `image-occlusion` è
attiva con JWT obbligatorio. Serve ancora il secret `GEMINI_API_KEY` se non è
già stato impostato nel progetto Supabase. In produzione la pagina renderizzata
viene inviata al backend, le bbox proposte vengono validate e mostrate come
candidate da confermare (mai auto-applicate).

## 3. Generazione indice — sistema più robusto e sostenibile

L'indice attuale (`buildDocumentOutline` in `pdfProcessing.ts`) è **euristico e
gratuito**: heading da layout → sezioni ricorrenti → topic per pagina. Robusto
per PDF con heading reali, fragile su scansioni o PDF senza struttura.

**Piano a 3 livelli (copre i costi senza sacrificare la sostenibilità):**

- **Gratuito (attuale):** heuristica layout/TextRank. Sempre disponibile.
- **Base:** stesso motore ma alimentato dal testo OCR reale (tesseract.js, già
  integrato) sulle pagine scansionate → l'indice non è più cieco sugli scan.
  Zero costo marginale (OCR gira nel browser).
- **Premium / analisi a pagamento:** un passaggio LLM economico (DeepSeek V4
  Flash, testo-only, già configurato) che struttura l'indice gerarchico da testo
  già pulito — SOLO per documenti lunghi/complessi e a consumo di crediti,
  tracciato in `ai_monthly_usage`. Costo contenuto perché testo-only e cache per
  `content_sha256 + settings_hash`.

Raccomandazione: tenere l'indice euristico gratuito come default, offrire
l'indice LLM come funzione Premium (o micro-acquisto in crediti) sui documenti
dove l'euristica segnala bassa qualità struttura (`review.structureQuality`).
