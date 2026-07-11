export type LegalRoute = 'privacy' | 'terms' | 'cookies' | 'sales' | 'copyright'

export type LegalSection = {
  title: string
  paragraphs?: string[]
  items?: string[]
}

export type LegalDocument = {
  route: LegalRoute
  title: string
  description: string
  sections: LegalSection[]
}

export const LEGAL_VERSION = '2026-07-11'

const value = (name: string) => String(import.meta.env[name] ?? '').trim()

export const legalOperator = {
  name: value('VITE_LEGAL_ENTITY_NAME'),
  address: value('VITE_LEGAL_ENTITY_ADDRESS'),
  email: value('VITE_LEGAL_CONTACT_EMAIL'),
  vatId: value('VITE_LEGAL_VAT_ID'),
}

export const isLegalOperatorConfigured = Boolean(
  legalOperator.name && legalOperator.address && legalOperator.email,
)

export const legalDocuments: Record<LegalRoute, LegalDocument> = {
  privacy: {
    route: 'privacy',
    title: 'Informativa privacy',
    description: 'Come UnimiDoc tratta dati account, materiali, studio e transazioni.',
    sections: [
      {
        title: 'Titolare e contatti',
        paragraphs: [
          'Il titolare del trattamento è il soggetto indicato nel riquadro identificativo in questa pagina. Le richieste privacy possono essere inviate al contatto dedicato indicato nello stesso riquadro.',
        ],
      },
      {
        title: 'Dati trattati',
        items: [
          'Dati account e autenticazione: email, nome o pseudonimo, identificativi tecnici di sessione e, se scelto, avatar.',
          'Materiali e metadati: file caricati, titolo, corso, docente, hash di integrità, pagine, testo estratto, OCR, indice, chunk, flashcard e stato di elaborazione.',
          'Attività di studio: risposte, preferiti, valutazioni, progressi, scadenze SRS, filtri e preferenze di notifica.',
          'Dati economici: saldo crediti, acquisti, rimborsi, contestazioni, abbonamenti e informazioni tecniche restituite dal provider di pagamento. UnimiDoc non memorizza i dati completi della carta.',
          'Dati di sicurezza e funzionamento: log, indirizzo IP nei sistemi dei fornitori, errori, limiti d’uso e segnali necessari a prevenire frodi e abusi.',
        ],
      },
      {
        title: 'Finalità e basi giuridiche',
        items: [
          'Esecuzione del servizio: registrazione, libreria, elaborazione documenti, studio, acquisti, crediti e assistenza.',
          'Adempimenti di legge: obblighi fiscali, contabili, tutela dei consumatori, gestione di contestazioni e richieste delle autorità.',
          'Legittimo interesse: sicurezza, prevenzione abusi, diagnostica, difesa dei diritti e miglioramento affidabile del servizio, con minimizzazione dei dati.',
          'Consenso, quando necessario: comunicazioni facoltative o tecnologie non essenziali. Il consenso può essere revocato senza pregiudicare i trattamenti già effettuati.',
        ],
      },
      {
        title: 'Fornitori e trasferimenti',
        paragraphs: [
          'UnimiDoc usa fornitori tecnici per hosting, database, autenticazione, storage, elaborazione AI e, quando attivato, pagamenti. I fornitori ricevono solo i dati necessari al compito affidato e sono configurati con credenziali server e accessi separati. Eventuali trasferimenti fuori dallo SEE devono basarsi su una garanzia prevista dal GDPR, come decisioni di adeguatezza o clausole contrattuali standard.',
        ],
      },
      {
        title: 'Conservazione',
        items: [
          'Account, libreria, progressi e preferenze: finché l’account rimane attivo o fino a richiesta di cancellazione, salvo obblighi ulteriori.',
          'Documenti e derivati: finché necessari al servizio, alla moderazione o alla tutela da duplicazioni e abusi; le copie temporanee devono essere eliminate al termine o al fallimento definitivo dell’elaborazione.',
          'Transazioni e documenti contabili: per il periodo richiesto dalla normativa applicabile.',
          'Log di sicurezza: per un periodo proporzionato alla diagnosi e alla prevenzione degli abusi, con accesso limitato.',
        ],
      },
      {
        title: 'Diritti',
        paragraphs: [
          'Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità e opposizione, oltre a revocare il consenso quando costituisce la base del trattamento. Puoi inoltre proporre reclamo al Garante per la protezione dei dati personali. Le richieste vengono verificate per proteggere l’account e possono essere limitate quando la legge impone di conservare determinati dati.',
        ],
      },
    ],
  },
  terms: {
    route: 'terms',
    title: 'Termini di utilizzo',
    description: 'Regole del servizio, account, contenuti e strumenti di studio UnimiDoc.',
    sections: [
      {
        title: 'Ambito del servizio',
        paragraphs: [
          'UnimiDoc è una piattaforma indipendente per organizzare, condividere e studiare materiali universitari. Non è affiliata né approvata dall’Università degli Studi di Milano e non sostituisce fonti ufficiali, docenti o programmi d’esame.',
        ],
      },
      {
        title: 'Account e sicurezza',
        items: [
          'Fornisci dati corretti, mantieni riservate le credenziali e segnala accessi non autorizzati.',
          'Non creare account multipli per ottenere bonus, aggirare limiti o alterare valutazioni e classifiche.',
          'Il servizio è destinato a persone che possono validamente concludere un contratto; i minori devono usarlo solo con l’autorizzazione richiesta dalla legge applicabile.',
        ],
      },
      {
        title: 'Materiali caricati',
        items: [
          'Carica soltanto contenuti tuoi, liberamente utilizzabili o per i quali possiedi autorizzazioni adeguate.',
          'Non caricare libri, dispense riservate, prove d’esame sottratte, dati personali di terzi o materiale illecito.',
          'Conservi la titolarità dei contenuti e concedi a UnimiDoc una licenza non esclusiva, limitata al funzionamento, alla protezione, alla moderazione e alla distribuzione scelta nel servizio.',
          'Puoi rendere pubblico un profilo venditore solo volontariamente. I dati privati non devono essere usati come identità pubblica senza consenso.',
        ],
      },
      {
        title: 'Qualità, AI e responsabilità nello studio',
        paragraphs: [
          'OCR, parsing, flashcard, riassunti e risposte RAG possono contenere errori. Le citazioni servono a ricontrollare il documento sorgente: l’utente resta responsabile della verifica prima di usare il contenuto per studio, esami o decisioni importanti.',
        ],
      },
      {
        title: 'Moderazione e sospensione',
        paragraphs: [
          'UnimiDoc può limitare la visibilità, rimuovere materiali, sospendere funzioni economiche o bloccare account quando ciò è necessario per sicurezza, diritti di terzi, obblighi legali, frodi o violazioni sostanziali. Quando possibile vengono indicati motivo e strumenti di contestazione.',
        ],
      },
    ],
  },
  cookies: {
    route: 'cookies',
    title: 'Cookie e tecnologie locali',
    description: 'Tecnologie necessarie, preferenze e criteri per eventuali strumenti facoltativi.',
    sections: [
      {
        title: 'Configurazione attuale',
        paragraphs: [
          'La versione attuale usa tecnologie strettamente necessarie per sessione, sicurezza, navigazione e preferenze. Non attiva cookie pubblicitari o profilazione di terze parti. Per questo non viene mostrato un consenso artificiale per tecnologie che non sono presenti.',
        ],
      },
      {
        title: 'Tecnologie essenziali',
        items: [
          'Sessione Supabase Auth e token di aggiornamento, necessari per mantenere l’accesso sicuro.',
          'Local storage per preferenze dell’interfaccia e dati della sola modalità demo. I dati live dell’account restano nel backend.',
          'Dati tecnici temporanei necessari a upload, prevenzione duplicazioni e ripresa dei flussi.',
        ],
      },
      {
        title: 'Modifiche future',
        paragraphs: [
          'Se verranno introdotti analytics non essenziali, advertising o profilazione, saranno disattivati per impostazione iniziale e verrà aggiunto un controllo granulare prima del loro utilizzo. Questa pagina indicherà fornitore, finalità, durata e modalità di revoca.',
        ],
      },
    ],
  },
  sales: {
    route: 'sales',
    title: 'Condizioni di vendita, crediti e rimborsi',
    description: 'Regole economiche per ricariche, Premium, contenuti digitali e venditori.',
    sections: [
      {
        title: 'Prezzi e pagamento',
        paragraphs: [
          'Prima del checkout vengono mostrati prezzo, valuta, natura una tantum o ricorrente, eventuali imposte e contenuto acquistato. Il pagamento viene gestito dal provider indicato nel checkout. Crediti e Premium vengono attivati solo dopo conferma server-to-server del pagamento, mai sulla sola pagina di ritorno.',
        ],
      },
      {
        title: 'Crediti',
        items: [
          'I crediti sono unità d’uso interne, non moneta elettronica e non maturano interessi.',
          'I crediti gratuiti non sono rimborsabili né prelevabili e possono avere limiti di utilizzo esplicitati prima dell’acquisto del materiale.',
          'I crediti acquistati vengono accreditati una sola volta per evento di pagamento verificato. Rimborsi o chargeback generano una rettifica coerente; un saldo già speso può produrre un debito interno e la sospensione temporanea degli acquisti.',
        ],
      },
      {
        title: 'Premium e rinnovo',
        paragraphs: [
          'Premium si rinnova con la frequenza mostrata nel checkout finché non viene annullato. La disdetta interrompe i rinnovi futuri e mantiene l’accesso fino alla fine del periodo già pagato, salvo rimborsi o obblighi di legge. Metodo di pagamento, fatture e disdetta sono gestibili dal portale cliente sicuro.',
        ],
      },
      {
        title: 'Contenuti digitali e recesso',
        paragraphs: [
          'Quando chiedi accesso immediato a contenuti o servizi digitali, il checkout raccoglie le dichiarazioni richieste dalla normativa applicabile. L’eventuale perdita del diritto di recesso opera soltanto nei casi e con le condizioni previste dalla legge. Restano sempre salvi i rimedi per contenuto non conforme, addebito errato o mancata erogazione.',
        ],
      },
      {
        title: 'Autori e payout',
        paragraphs: [
          'La quota convertibile deriva soltanto da valore economico effettivamente incassato e resta soggetta a commissione, soglia minima, controlli antifrode, rimborsi e verifica identità del provider Connect. Tempi e importi vengono mostrati prima della richiesta; nessun payout è promesso finché l’onboarding non è completato e il saldo non è disponibile.',
        ],
      },
    ],
  },
  copyright: {
    route: 'copyright',
    title: 'Copyright e segnalazioni',
    description: 'Come segnalare contenuti che violano diritti o contengono dati non autorizzati.',
    sections: [
      {
        title: 'Inviare una segnalazione',
        items: [
          'Identifica con precisione il materiale e il relativo URL o ID.',
          'Descrivi il diritto coinvolto e perché ritieni che l’uso non sia autorizzato.',
          'Indica un recapito valido e dichiara in buona fede che le informazioni fornite sono accurate.',
          'Non inviare documenti di identità finché non vengono richiesti tramite un canale sicuro.',
        ],
      },
      {
        title: 'Valutazione e contraddittorio',
        paragraphs: [
          'UnimiDoc può oscurare temporaneamente il materiale durante la verifica, chiedere chiarimenti all’autore e conservare le evidenze necessarie. Le segnalazioni manifestamente abusive possono comportare limitazioni. L’esito viene comunicato quando possibile e nel rispetto dei diritti delle parti.',
        ],
      },
      {
        title: 'Altri contenuti sensibili',
        paragraphs: [
          'Lo stesso canale può essere usato per segnalare dati personali, prove d’esame riservate, contenuti illeciti o rischi di sicurezza. Per vulnerabilità tecniche non pubblicare dettagli sfruttabili: usa il contatto dedicato e attendi conferma di ricezione.',
        ],
      },
    ],
  },
}

export function legalDocumentForRoute(route: LegalRoute): LegalDocument {
  return legalDocuments[route]
}
