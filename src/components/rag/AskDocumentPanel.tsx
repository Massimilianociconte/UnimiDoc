// "Chiedi al documento" — the RAG UI surface embedded in the document viewer /
// personal library. It talks ONLY to the RagRetrievalProvider abstraction and
// the thin index/status helpers, never to pgvector directly, so a future native
// build can swap in a ZVec provider without touching this component.

import { useCallback, useEffect, useState } from 'react'
import { BrainCircuit, Loader2, Send, Sparkles, Layers } from 'lucide-react'
import { getRagProvider, indexDocument, getIndexStatuses } from '../../lib/rag/provider'
import type { RagAnswer, RagIndexStatus } from '../../lib/rag/types'
import { generateFlashcardsFromDocument } from '../../lib/aiClient'
import { RichMarkdown } from './RichMarkdown'

type Props = {
  documentId: string
  documentTitle?: string
  /** Optional: jump the viewer to a page when a citation is clicked. */
  onOpenPage?: (page: number) => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function AskDocumentPanel({ documentId, documentTitle, onOpenPage }: Props) {
  const [status, setStatus] = useState<RagIndexStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [indexing, setIndexing] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<RagAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buildingCards, setBuildingCards] = useState(false)
  const [cardsNotice, setCardsNotice] = useState<string | null>(null)
  const isRealDocumentId = UUID_RE.test(documentId)

  const refreshStatus = useCallback(async () => {
    const statuses = await getIndexStatuses([documentId])
    setStatus(statuses[0] ?? { documentId, status: 'not_indexed', chunkCount: 0, indexVersion: 0, indexedAt: null, job: null })
    setLoadingStatus(false)
  }, [documentId])

  useEffect(() => {
    if (!isRealDocumentId) return
    setLoadingStatus(true)
    setAnswer(null)
    setError(null)
    refreshStatus()
  }, [isRealDocumentId, refreshStatus])

  // Poll while a job is in flight.
  useEffect(() => {
    if (!indexing && status?.status !== 'processing' && status?.status !== 'queued') return
    const timer = setInterval(refreshStatus, 3000)
    return () => clearInterval(timer)
  }, [indexing, status?.status, refreshStatus])

  const startIndexing = async () => {
    setIndexing(true)
    setError(null)
    const res = await indexDocument(documentId)
    setIndexing(false)
    if (!res.ok) {
      setError(
        res.code === 'login_required'
          ? 'Accedi per avviare l’analisi del documento.'
          : res.message,
      )
    }
    await refreshStatus()
  }

  const ask = async () => {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setError(null)
    setAnswer(null)
    const res = await getRagProvider().search({ query: q, documentIds: [documentId], matchCount: 8 })
    setAsking(false)
    if (res.ok) setAnswer(res.data)
    else
      setError(
        res.code === 'login_required'
          ? 'Accedi per usare la ricerca intelligente.'
          : res.code === 'not_configured'
            ? 'Ricerca intelligente non ancora configurata su questo ambiente.'
            : res.message,
      )
  }

  const buildFlashcards = async () => {
    if (!isRealDocumentId) {
      setError('Le flashcard persistenti sono disponibili solo per documenti salvati nel tuo account.')
      return
    }
    setBuildingCards(true)
    setCardsNotice(null)
    setError(null)
    const focus = question.trim()
    const res = await generateFlashcardsFromDocument({
      documentId,
      maxCards: 20,
      language: 'it',
      ...(focus ? { focusQuery: focus } : {}),
    })
    setBuildingCards(false)
    if (res.ok) {
      const count = res.data.flashcards.length
      const savedCount = res.data.savedIds?.length ?? 0
      setCardsNotice(
        count > 0 && savedCount === count
          ? `${count} flashcard generate dagli argomenti più rilevanti${focus ? ` su “${focus}”` : ''} e salvate nella tua libreria.`
          : count === 0
            ? 'Nessuna flashcard generata: il documento potrebbe avere poco testo indicizzato.'
            : null,
      )
      if (count > 0 && savedCount !== count) {
        setError(`Deck incompleto: ${savedCount}/${count} flashcard confermate dal server. Riprova senza rigenerare.`)
      }
    } else {
      setError(
        res.code === 'login_required'
          ? 'Accedi per generare flashcard dal documento.'
          : res.code === 'premium_required'
            ? 'La generazione di flashcard dai contenuti è una funzione Premium.'
            : res.message,
      )
    }
  }

  const isIndexed = status?.status === 'indexed' || status?.status === 'partial'
  const isBusy = indexing || status?.status === 'processing' || status?.status === 'queued'

  if (!isRealDocumentId) return null

  return (
    <section className="rag-panel" aria-label={documentTitle ? `Chiedi al documento: ${documentTitle}` : 'Chiedi al documento'}>
      <header className="rag-panel-head">
        <BrainCircuit size={18} />
        <h2>Chiedi al documento</h2>
        {status?.status ? <span className={`rag-status-chip ${status.status}`}>{statusLabel(status.status)}</span> : null}
      </header>

      {loadingStatus ? (
        <p className="rag-muted"><Loader2 size={14} className="spin" /> Verifico lo stato dell'indicizzazione...</p>
      ) : isBusy ? (
        <div className="rag-notice">
          <Loader2 size={14} className="spin" /> Ricerca intelligente: in preparazione
          {status?.job ? (
            <span> — chunk elaborati {status.job.chunksEmbedded}/{status.job.chunksTotal || '…'}</span>
          ) : null}
        </div>
      ) : !isIndexed ? (
        <div className="rag-notice">
          <p>
            Questo documento non è ancora indicizzato per la ricerca intelligente.
            {status?.status === 'failed' && status.job?.error ? ` Ultimo errore: ${status.job.error}` : ''}
          </p>
          <button type="button" className="rag-primary-action" onClick={startIndexing} disabled={indexing}>
            <Sparkles size={15} /> {indexing ? 'Avvio...' : 'Avvia analisi'}
          </button>
        </div>
      ) : null}

      {isIndexed ? (
        <>
          <div className="rag-input-row">
            <input
              type="text"
              value={question}
              placeholder="Es. Qual è la differenza tra fago litico e temperato?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !asking) ask() }}
              disabled={asking}
            />
            <button type="button" className="rag-primary-action" onClick={ask} disabled={asking || !question.trim()}>
              {asking ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Chiedi
            </button>
          </div>
          <div className="rag-secondary-row">
            <button type="button" className="rag-ghost-action" onClick={buildFlashcards} disabled={buildingCards}>
              {buildingCards ? <Loader2 size={14} className="spin" /> : <Layers size={14} />}
              {buildingCards
                ? 'Genero flashcard…'
                : question.trim()
                  ? 'Flashcard su questo argomento'
                  : 'Flashcard dagli argomenti chiave'}
            </button>
          </div>
          {cardsNotice ? <p className="rag-muted">{cardsNotice}</p> : null}
          {status?.status === 'partial' ? (
            <p className="rag-muted">Indicizzazione parziale ({status.chunkCount} chunk): alcune parti del documento potrebbero non essere coperte.</p>
          ) : null}
        </>
      ) : null}

      {error ? <p className="rag-error">{error}</p> : null}

      {answer ? (
        <div className="rag-answer">
          <RichMarkdown text={answer.answer} className="rag-answer-text" />
          {answer.sources.length > 0 ? (
            <div className="rag-sources">
              <span>Fonti</span>
              {answer.sources.map((s) => {
                const pages = s.page_start === s.page_end ? `p. ${s.page_start}` : `pp. ${s.page_start}-${s.page_end}`
                const section = s.section_path?.length ? ` · ${s.section_path.join(' › ')}` : ''
                return (
                  <button
                    key={s.chunk_id}
                    type="button"
                    className="rag-source-chip"
                    onClick={() => onOpenPage?.(s.page_start)}
                    title={`${s.title ?? ''}${section}`}
                  >
                    {s.marker} {pages}{section} · {(s.similarity * 100).toFixed(0)}%
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="rag-muted">Nessun passaggio rilevante trovato per questa domanda.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function statusLabel(status: RagIndexStatus['status']): string {
  switch (status) {
    case 'indexed':
      return 'Pronto'
    case 'partial':
      return 'Parziale'
    case 'processing':
    case 'queued':
      return 'In preparazione'
    case 'failed':
      return 'Da riprovare'
    default:
      return 'Non indicizzato'
  }
}
