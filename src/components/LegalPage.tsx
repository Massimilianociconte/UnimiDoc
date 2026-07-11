import { AlertTriangle, ArrowLeft, Mail, ShieldCheck } from 'lucide-react'
import {
  LEGAL_VERSION,
  isLegalOperatorConfigured,
  legalDocumentForRoute,
  legalDocuments,
  legalOperator,
  type LegalRoute,
} from '../legalContent'

export function LegalPage({
  route,
  onRoute,
}: {
  route: LegalRoute
  onRoute: (route: LegalRoute | 'landing') => void
}) {
  const document = legalDocumentForRoute(route)

  return (
    <main className="legal-page section-wrap">
      <header className="legal-hero">
        <button className="secondary-action" onClick={() => onRoute('landing')} type="button">
          <ArrowLeft size={17} /> Torna a UnimiDoc
        </button>
        <span className="legal-kicker"><ShieldCheck size={16} /> Trasparenza e regole del servizio</span>
        <h1>{document.title}</h1>
        <p>{document.description}</p>
        <small>Versione {LEGAL_VERSION} · Ultimo aggiornamento 11 luglio 2026</small>
      </header>

      {!isLegalOperatorConfigured ? (
        <section className="legal-config-warning" role="status">
          <AlertTriangle size={22} />
          <div>
            <strong>Identità del gestore da completare prima della monetizzazione</strong>
            <p>
              Il testo operativo è disponibile, ma ragione sociale o nome, indirizzo e contatto legale devono essere
              configurati e approvati prima di abilitare checkout e payout.
            </p>
          </div>
        </section>
      ) : null}

      <section className="legal-operator-card" aria-label="Identità e contatti del gestore">
        <div>
          <span>Gestore del servizio</span>
          <strong>{legalOperator.name || 'Dato non ancora configurato'}</strong>
        </div>
        <div>
          <span>Sede o indirizzo</span>
          <strong>{legalOperator.address || 'Dato non ancora configurato'}</strong>
        </div>
        {legalOperator.vatId ? (
          <div>
            <span>Identificativo fiscale</span>
            <strong>{legalOperator.vatId}</strong>
          </div>
        ) : null}
        <div>
          <span>Contatto legale e privacy</span>
          {legalOperator.email ? (
            <a href={`mailto:${legalOperator.email}`}><Mail size={15} /> {legalOperator.email}</a>
          ) : (
            <strong>Dato non ancora configurato</strong>
          )}
        </div>
      </section>

      <nav className="legal-nav" aria-label="Documenti legali">
        {(Object.keys(legalDocuments) as LegalRoute[]).map((item) => (
          <button className={item === route ? 'active' : ''} key={item} onClick={() => onRoute(item)} type="button">
            {legalDocuments[item].title}
          </button>
        ))}
      </nav>

      <article className="legal-document">
        {document.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items ? (
              <ul>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
          </section>
        ))}
      </article>

      <aside className="legal-review-note">
        <strong>Revisione professionale richiesta</strong>
        <p>
          Queste pagine descrivono i flussi tecnici implementati e costituiscono una base operativa. Prima del go-live
          economico devono essere validate da un professionista rispetto a identità del gestore, regime fiscale,
          consumatori, marketplace e trattamenti effettivamente configurati.
        </p>
      </aside>
    </main>
  )
}
