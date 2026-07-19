export type LegalRoute =
  | 'privacy'
  | 'terms'
  | 'cookies'
  | 'sales'
  | 'refunds'
  | 'authors'
  | 'content'
  | 'ai'
  | 'copyright'

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

// Versione contrattuale unica per tutti i documenti. Ogni modifica sostanziale
// ai testi deve incrementare questa data: il consenso registrato in
// public.legal_consents fa riferimento a questa stringa.
export const LEGAL_VERSION = '2026-07-15'

// Documenti che richiedono accettazione esplicita alla registrazione.
export const LEGAL_CONSENT_DOCUMENT_TYPES = ['terms', 'privacy'] as const
export type LegalConsentDocumentType = (typeof LEGAL_CONSENT_DOCUMENT_TYPES)[number]

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

// Finché l'identità del titolare non è configurata, ogni documento è una bozza
// operativa: descrive i flussi implementati ma non può essere presentato come
// testo contrattuale definitivo.
export const legalDocumentsAreDraft = !isLegalOperatorConfigured

export const legalDocuments: Record<LegalRoute, LegalDocument> = {
  privacy: {
    route: 'privacy',
    title: 'Informativa privacy',
    description: 'Come UnimiDoc tratta dati account, materiali, studio e transazioni.',
    sections: [
      {
        title: 'Titolare e contatti',
        paragraphs: [
          'Il titolare del trattamento è il soggetto indicato nel riquadro identificativo in questa pagina. Le richieste privacy possono essere inviate al contatto dedicato indicato nello stesso riquadro. Finché i dati identificativi non sono configurati, il riquadro mostra un segnaposto esplicito e il documento resta una bozza operativa.',
        ],
      },
      {
        title: 'Dati trattati',
        items: [
          'Dati account e autenticazione: email, nome o pseudonimo, identificativi tecnici di sessione e, se scelto, avatar.',
          'Materiali e metadati: file caricati, titolo, corso, docente, hash di integrità, pagine, testo estratto, OCR, indice, chunk, flashcard e stato di elaborazione.',
          'Attività di studio: risposte, preferiti, valutazioni, progressi, scadenze SRS, filtri e preferenze di notifica.',
          'Dati economici: saldo crediti, acquisti, rimborsi, contestazioni, abbonamenti e informazioni tecniche restituite dal provider di pagamento. UnimiDoc non memorizza i dati completi della carta.',
          'Recensioni e segnalazioni: testo, voto, data e collegamento al materiale recensito o segnalato.',
          'Dati di sicurezza e funzionamento: log, indirizzo IP nei sistemi dei fornitori, errori, limiti d’uso e segnali necessari a prevenire frodi e abusi.',
        ],
      },
      {
        title: 'Finalità e basi giuridiche',
        items: [
          'Esecuzione del servizio (art. 6.1.b GDPR): registrazione, libreria, elaborazione documenti, studio, acquisti, crediti e assistenza.',
          'Adempimenti di legge (art. 6.1.c GDPR): obblighi fiscali, contabili, tutela dei consumatori, gestione di contestazioni e richieste delle autorità.',
          'Legittimo interesse (art. 6.1.f GDPR): sicurezza, prevenzione abusi, diagnostica, difesa dei diritti e miglioramento affidabile del servizio, con minimizzazione dei dati.',
          'Consenso (art. 6.1.a GDPR), quando necessario: comunicazioni facoltative o tecnologie non essenziali. Il consenso può essere revocato senza pregiudicare i trattamenti già effettuati.',
        ],
      },
      {
        title: 'Elaborazione automatizzata dei documenti',
        paragraphs: [
          'I documenti caricati vengono elaborati automaticamente con OCR, estrazione del testo, indicizzazione, generazione di embedding e funzioni AI (flashcard, riassunti, risposte con citazioni). I dettagli, i fornitori coinvolti e i limiti sono descritti nel documento dedicato "AI e trattamento dei documenti", che costituisce parte integrante di questa informativa.',
        ],
      },
      {
        title: 'Account, profili pubblici, recensioni e notifiche',
        items: [
          'Il profilo venditore pubblico è disattivato finché non lo abiliti; il nome pubblico è scelto da te e può essere diverso dal nome dell’account.',
          'Le recensioni e i voti che pubblichi sono visibili agli altri utenti insieme al nome pubblico o a un identificativo non riconducibile ai tuoi dati privati.',
          'Le notifiche non essenziali seguono le preferenze configurabili nelle impostazioni e possono essere disattivate in ogni momento.',
        ],
      },
      {
        title: 'Fornitori e trasferimenti',
        paragraphs: [
          'UnimiDoc usa fornitori tecnici per hosting, database, autenticazione, storage, elaborazione AI e, quando attivato, pagamenti. I fornitori ricevono solo i dati necessari al compito affidato e sono configurati con credenziali server e accessi separati. Eventuali trasferimenti fuori dallo SEE devono basarsi su una garanzia prevista dal GDPR, come decisioni di adeguatezza o clausole contrattuali standard. L’elenco aggiornato delle categorie di fornitori è disponibile su richiesta al contatto privacy.',
        ],
      },
      {
        title: 'Conservazione',
        items: [
          'Account, libreria, progressi e preferenze: finché l’account rimane attivo o fino a richiesta di cancellazione, salvo obblighi ulteriori.',
          'Documenti e derivati (testo estratto, chunk, embedding, flashcard): finché necessari al servizio, alla moderazione o alla tutela da duplicazioni e abusi; le copie temporanee devono essere eliminate al termine o al fallimento definitivo dell’elaborazione.',
          'Transazioni e documenti contabili: per il periodo richiesto dalla normativa applicabile.',
          'Log di sicurezza: per un periodo proporzionato alla diagnosi e alla prevenzione degli abusi, con accesso limitato.',
          'Registrazioni del consenso ai documenti contrattuali: per la durata dell’account e per il periodo necessario alla difesa dei diritti.',
        ],
      },
      {
        title: 'Cancellazione dell’account e dei dati',
        paragraphs: [
          'Puoi chiedere la cancellazione dell’account dalle impostazioni o scrivendo al contatto privacy. La richiesta viene verificata per proteggere l’account; i dati personali vengono cancellati o resi anonimi, mentre i dati che la legge impone di conservare (ad esempio documenti contabili) vengono isolati e mantenuti solo per il periodo obbligatorio. I materiali già acquistati da altri utenti possono restare accessibili agli acquirenti secondo le condizioni di vendita, senza dati personali dell’autore.',
        ],
      },
      {
        title: 'Diritti',
        paragraphs: [
          'Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità e opposizione, oltre a revocare il consenso quando costituisce la base del trattamento. Puoi inoltre proporre reclamo al Garante per la protezione dei dati personali. Le richieste vengono verificate per proteggere l’account e possono essere limitate quando la legge impone di conservare determinati dati. Per esercitare i diritti scrivi al contatto privacy indicato nel riquadro identificativo; la risposta arriva entro i termini di legge.',
        ],
      },
    ],
  },
  terms: {
    route: 'terms',
    title: 'Termini e condizioni generali',
    description: 'Regole del servizio, account, contenuti e strumenti di studio UnimiDoc.',
    sections: [
      {
        title: 'Ambito del servizio',
        paragraphs: [
          'UnimiDoc è una piattaforma indipendente per organizzare, condividere e studiare materiali universitari. Non è affiliata né approvata dall’Università degli Studi di Milano e non sostituisce fonti ufficiali, docenti o programmi d’esame.',
          'Il gestore del servizio è il soggetto indicato nel riquadro identificativo di questa pagina. Le presenti condizioni si integrano con i documenti dedicati a vendite e crediti, rimborsi, autori e venditori, regole sui contenuti, AI e privacy.',
        ],
      },
      {
        title: 'Account e sicurezza',
        items: [
          'Fornisci dati corretti, mantieni riservate le credenziali e segnala accessi non autorizzati.',
          'Non creare account multipli per ottenere bonus, aggirare limiti o alterare valutazioni e classifiche.',
          'Il servizio è destinato a persone che possono validamente concludere un contratto; i minori devono usarlo solo con l’autorizzazione richiesta dalla legge applicabile.',
          'Puoi chiudere l’account in ogni momento; la procedura di cancellazione dei dati è descritta nell’informativa privacy.',
        ],
      },
      {
        title: 'Materiali caricati',
        items: [
          'Carica soltanto contenuti tuoi, liberamente utilizzabili o per i quali possiedi autorizzazioni adeguate.',
          'Le regole di dettaglio su contenuti ammessi, vietati e moderazione sono nel documento "Regole sui contenuti".',
          'Conservi la titolarità dei contenuti e concedi a UnimiDoc una licenza non esclusiva, limitata al funzionamento, alla protezione, alla moderazione e alla distribuzione scelta nel servizio.',
          'Puoi rendere pubblico un profilo venditore solo volontariamente. I dati privati non devono essere usati come identità pubblica senza consenso.',
        ],
      },
      {
        title: 'Qualità, AI e responsabilità nello studio',
        paragraphs: [
          'OCR, parsing, flashcard, riassunti e risposte RAG possono contenere errori. Le citazioni servono a ricontrollare il documento sorgente: l’utente resta responsabile della verifica prima di usare il contenuto per studio, esami o decisioni importanti. I limiti delle funzioni AI sono descritti nel documento "AI e trattamento dei documenti".',
        ],
      },
      {
        title: 'Moderazione e sospensione',
        paragraphs: [
          'UnimiDoc può limitare la visibilità, rimuovere materiali, sospendere funzioni economiche o bloccare account quando ciò è necessario per sicurezza, diritti di terzi, obblighi legali, frodi o violazioni sostanziali. Quando possibile vengono indicati motivo e strumenti di contestazione.',
        ],
      },
      {
        title: 'Modifiche a servizio, prezzi e documenti contrattuali',
        items: [
          'Il servizio, i prezzi in crediti, i pacchetti e le funzioni possono evolvere. Le modifiche non retroattive vengono comunicate con anticipo ragionevole tramite il servizio o email.',
          'Ogni versione dei documenti contrattuali è identificata da una data di versione. L’accettazione viene registrata con utente, tipo di documento, versione, data e lingua.',
          'Se una modifica sostanziale riduce i tuoi diritti, puoi recedere prima dell’entrata in vigore; l’uso del servizio dopo la data di efficacia vale come accettazione solo dove la legge lo consente e per le modifiche non sostanziali.',
          'I crediti già acquistati mantengono le condizioni in vigore al momento dell’acquisto, salvo adeguamenti imposti dalla legge.',
        ],
      },
      {
        title: 'Legge applicabile e foro',
        paragraphs: [
          'Le presenti condizioni sono regolate dalla legge italiana. Per i consumatori resta fermo il foro inderogabile previsto dal Codice del consumo. I dettagli definitivi su foro e ADR saranno completati con i dati del titolare prima del lancio commerciale.',
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
          'Local storage per preferenze dell’interfaccia (ad esempio tema e filtri) e dati della sola modalità demo. I dati live dell’account restano nel backend.',
          'Dati tecnici temporanei necessari a upload, prevenzione duplicazioni e ripresa dei flussi.',
          'Misurazione d’uso first-party: eventi minimi (es. ricerca effettuata, documento aperto, caricamento completato) registrati nei nostri sistemi senza cookie di terze parti, senza profilazione e con cancellazione automatica dopo 180 giorni.',
        ],
      },
      {
        title: 'Strumenti facoltativi e consenso',
        paragraphs: [
          'Se verranno introdotti analytics non essenziali, advertising o profilazione, saranno disattivati per impostazione iniziale e verranno caricati soltanto dopo una scelta esplicita, con un controllo granulare per categoria. Questa pagina indicherà fornitore, finalità, durata e modalità di revoca, e le preferenze saranno modificabili in ogni momento dalle impostazioni.',
        ],
      },
    ],
  },
  sales: {
    route: 'sales',
    title: 'Condizioni di acquisto e crediti',
    description: 'Prezzi, ricariche, Premium e regole di utilizzo dei crediti interni.',
    sections: [
      {
        title: 'Prezzi e pagamento',
        paragraphs: [
          'Prima del checkout vengono mostrati prezzo, valuta, natura una tantum o ricorrente, eventuali imposte e contenuto acquistato. Il pagamento viene gestito dal provider indicato nel checkout. Crediti e Premium vengono attivati solo dopo conferma server-to-server del pagamento, mai sulla sola pagina di ritorno.',
        ],
      },
      {
        title: 'Tipi di crediti',
        items: [
          'Crediti gratuiti di benvenuto: assegnati una sola volta per persona, servono a provare il servizio; possono avere limiti di utilizzo esplicitati prima dell’acquisto del materiale e non sono rimborsabili né prelevabili.',
          'Crediti bonus o promozionali: assegnati da promozioni o dal caricamento di materiale approvato; seguono le regole indicate nella promozione e non sono convertibili in denaro.',
          'Crediti acquistati: accreditati una sola volta per evento di pagamento verificato; sono la sola categoria collegata a valore economico effettivamente incassato.',
          'In caso di spesa, il sistema utilizza prima i crediti gratuiti e bonus, poi quelli acquistati, salvo diversa indicazione mostrata al momento dell’acquisto.',
        ],
      },
      {
        title: 'Regole di utilizzo',
        items: [
          'I crediti sono unità d’uso interne, non moneta elettronica, non maturano interessi e non sono trasferibili tra account.',
          'Rimborsi o chargeback generano una rettifica coerente; un saldo già speso può produrre un debito interno e la sospensione temporanea degli acquisti.',
          'Manipolazioni, abusi delle promozioni o account multipli possono comportare l’annullamento dei crediti non acquistati e la sospensione delle funzioni economiche.',
        ],
      },
      {
        title: 'Premium e rinnovo',
        paragraphs: [
          'Premium si rinnova con la frequenza mostrata nel checkout finché non viene annullato. La disdetta interrompe i rinnovi futuri e mantiene l’accesso fino alla fine del periodo già pagato, salvo rimborsi o obblighi di legge. Metodo di pagamento, fatture e disdetta sono gestibili dal portale cliente sicuro.',
        ],
      },
      {
        title: 'Recesso e rimborsi',
        paragraphs: [
          'Diritto di recesso, eccezioni per i contenuti digitali e procedura di rimborso sono descritti nel documento dedicato "Rimborsi e recesso".',
        ],
      },
    ],
  },
  refunds: {
    route: 'refunds',
    title: 'Rimborsi e recesso',
    description: 'Diritto di recesso, eccezioni per contenuti digitali e procedura di rimborso.',
    sections: [
      {
        title: 'Diritto di recesso del consumatore',
        paragraphs: [
          'Per gli acquisti a distanza il consumatore dispone di 14 giorni per recedere senza motivazione, ai sensi del Codice del consumo. Il termine decorre dalla conclusione del contratto per i servizi e per i contenuti digitali.',
        ],
      },
      {
        title: 'Contenuti digitali con accesso immediato',
        paragraphs: [
          'Quando chiedi l’accesso immediato a un contenuto digitale (ad esempio l’apertura completa di una dispensa acquistata con crediti oppure l’attivazione immediata di una ricarica), il checkout raccoglie il consenso espresso all’esecuzione immediata e la presa d’atto della perdita del diritto di recesso, come previsto dall’art. 59 del Codice del consumo. La perdita del recesso opera soltanto nei casi e con le condizioni previste dalla legge.',
        ],
      },
      {
        title: 'Cosa resta sempre rimborsabile',
        items: [
          'Addebiti errati o duplicati: vengono stornati dopo verifica.',
          'Contenuto non conforme alla descrizione, illeggibile o non erogato: rimborso in crediti o, per i pagamenti in denaro, tramite il provider di pagamento.',
          'Crediti acquistati e non ancora spesi, nei limiti del diritto di recesso quando applicabile.',
          'I crediti gratuiti e bonus non sono mai rimborsabili né convertibili in denaro.',
        ],
      },
      {
        title: 'Come chiedere un rimborso',
        items: [
          'Scrivi al contatto indicato nel riquadro identificativo con: email dell’account, data dell’operazione, materiale o ricarica interessata e motivo.',
          'La richiesta viene riscontrata entro tempi ragionevoli e comunque nei termini di legge; il rimborso in denaro usa lo stesso mezzo di pagamento dell’acquisto, salvo accordo diverso.',
          'In caso di contestazione con un autore, UnimiDoc può sospendere temporaneamente le somme o i crediti coinvolti fino alla verifica.',
        ],
      },
    ],
  },
  authors: {
    route: 'authors',
    title: 'Condizioni per autori e venditori',
    description: 'Regole per chi carica e vende materiali: responsabilità, ricavi, payout.',
    sections: [
      {
        title: 'Chi può vendere',
        items: [
          'Solo titolari di account in regola con i termini generali e, per i payout in denaro, con la verifica identità richiesta dal provider di pagamento.',
          'Il profilo venditore pubblico è facoltativo: puoi vendere con un nome pubblico scelto da te, diverso dai dati privati dell’account.',
        ],
      },
      {
        title: 'Responsabilità sui contenuti',
        items: [
          'Dichiari di essere autore del materiale o di disporre dei diritti e delle autorizzazioni necessarie alla vendita.',
          'Rispondi dei contenuti pubblicati: violazioni di copyright, dati personali di terzi o materiale vietato comportano rimozione, sospensione delle funzioni economiche e, nei casi gravi, chiusura dell’account.',
          'Le regole di dettaglio sono nel documento "Regole sui contenuti"; le segnalazioni di terzi seguono la procedura del documento "Copyright e segnalazioni".',
        ],
      },
      {
        title: 'Divieto di contatti diretti nei campi pubblici',
        paragraphs: [
          'Titoli, descrizioni, tag e ogni campo pubblico non devono contenere email, numeri di telefono, link a chat esterne o altri recapiti diretti. Il divieto protegge gli utenti da truffe e mantiene le transazioni nel circuito tracciato della piattaforma; i contenuti che violano la regola vengono moderati automaticamente o manualmente.',
        ],
      },
      {
        title: 'Ricavi, commissioni e payout',
        items: [
          'La vendita di un materiale accredita crediti secondo lo split mostrato al momento della pubblicazione.',
          'La quota convertibile in denaro deriva soltanto da valore economico effettivamente incassato dalla piattaforma e resta soggetta a commissione, soglia minima, controlli antifrode, rimborsi e verifica identità del provider Connect.',
          'Tempi e importi vengono mostrati prima della richiesta; nessun payout è promesso finché l’onboarding non è completato e il saldo non è disponibile.',
          'Rimborsi e chargeback sugli acquisti riducono in modo coerente i ricavi correlati.',
        ],
      },
      {
        title: 'Rimozione e ritiro dei materiali',
        paragraphs: [
          'Puoi ritirare un materiale dalla vendita in ogni momento: gli acquirenti esistenti conservano l’accesso già pagato. La rimozione per violazioni può comportare la perdita dei ricavi non ancora consolidati relativi al materiale rimosso.',
        ],
      },
    ],
  },
  content: {
    route: 'content',
    title: 'Regole sui contenuti',
    description: 'Contenuti ammessi e vietati, moderazione e conseguenze delle violazioni.',
    sections: [
      {
        title: 'Contenuti ammessi',
        items: [
          'Appunti personali, schemi, riassunti ed esercizi svolti creati da te.',
          'Materiale liberamente utilizzabile o per il quale possiedi autorizzazioni adeguate e dimostrabili.',
        ],
      },
      {
        title: 'Contenuti vietati',
        items: [
          'Libri, dispense ufficiali riservate, slide dei docenti non autorizzate e scansioni integrali di opere protette.',
          'Prove d’esame sottratte, soluzioni distribuite in violazione di regolamenti universitari.',
          'Dati personali di terzi (nomi, foto, valutazioni, contatti) senza base giuridica.',
          'Contenuti illeciti, diffamatori, discriminatori o pericolosi.',
          'Recapiti diretti (email, telefono, chat esterne) in titoli, descrizioni, recensioni e ogni campo pubblico.',
          'Contenuti generati in massa o duplicati per manipolare classifiche, ricerca o crediti.',
        ],
      },
      {
        title: 'Moderazione',
        items: [
          'I caricamenti passano controlli automatici (integrità, duplicazione, segnali di contenuto vietato) e possono essere sottoposti a revisione manuale.',
          'Gli utenti possono segnalare i materiali; le segnalazioni alimentano una coda di moderazione con esiti registrati.',
          'Le violazioni comportano, in proporzione alla gravità: riduzione di visibilità, rimozione, sospensione delle funzioni economiche, blocco dell’account.',
          'Quando possibile vengono comunicati il motivo della decisione e lo strumento per contestarla.',
        ],
      },
    ],
  },
  ai: {
    route: 'ai',
    title: 'AI e trattamento dei documenti',
    description: 'Come OCR, embedding, RAG e modelli AI elaborano i materiali caricati.',
    sections: [
      {
        title: 'Cosa succede a un documento caricato',
        items: [
          'Estrazione del testo e, per le scansioni, OCR per rendere il contenuto ricercabile.',
          'Suddivisione in porzioni (chunk) e generazione di rappresentazioni numeriche (embedding) per la ricerca semantica.',
          'Generazione assistita di flashcard, riassunti e indici a partire dal testo estratto.',
          'Risposte a domande (RAG): il sistema recupera i passaggi pertinenti dai documenti a cui hai accesso e li fornisce a un modello linguistico insieme alla tua domanda, con citazioni verso le pagine di origine.',
        ],
      },
      {
        title: 'Fornitori AI esterni',
        paragraphs: [
          'Per generare embedding, flashcard e risposte, porzioni del testo estratto vengono inviate ai fornitori AI configurati dal titolare. Ai fornitori arriva solo il testo necessario all’operazione richiesta, senza credenziali dell’account; i contratti con i fornitori devono escludere l’uso dei contenuti per addestrare modelli, salvo consenso separato. L’elenco aggiornato dei fornitori attivi è disponibile su richiesta al contatto privacy e verrà pubblicato in questa pagina prima del lancio commerciale.',
        ],
      },
      {
        title: 'Perimetro di accesso',
        items: [
          'Le funzioni RAG interrogano soltanto i documenti che puoi già consultare: i tuoi caricamenti e i materiali acquistati.',
          'Nessuna risposta AI può includere contenuto di documenti a cui non hai accesso.',
          'Embedding e derivati vengono eliminati quando il documento viene cancellato in modo definitivo.',
        ],
      },
      {
        title: 'Limiti delle risposte generate',
        paragraphs: [
          'Le risposte generate automaticamente possono contenere errori, omissioni o interpretazioni sbagliate anche quando includono citazioni. Non costituiscono consulenza professionale né materiale d’esame verificato: usa le citazioni per ricontrollare sempre il documento di origine prima di studiare o prendere decisioni sulla base della risposta.',
        ],
      },
      {
        title: 'Diritti sull’elaborazione',
        paragraphs: [
          'L’elaborazione automatica serve a erogare le funzioni richieste (base contrattuale). Puoi chiedere informazioni sui trattamenti, la cancellazione dei derivati insieme al documento e, per i trattamenti facoltativi futuri, verrà richiesto un consenso separato prima dell’attivazione.',
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
