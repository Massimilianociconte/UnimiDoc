# Catalogo insegnamenti UniMi

Pipeline per rigenerare il catalogo materie+docenti di tutti i CdL triennali e
magistrali a ciclo unico (tabelle `degree_courses`, `professors`,
`degree_course_teachers`).

1. `programs.json` — elenco dei corsi (slug, name, unimi_path, degree_type,
   cds_match per i ciclo unico). Rigenerabile dal registro `degree_programs` /
   `src/degreePrograms.ts`.
2. `python3 scraper.py` — scarica da unimi.it i piani didattici (offerta più
   recente, layout tabellare a 5 o 6 colonne, incluse le attività a scelta nei
   blocchi `ugov-of-pd-rules`) e i docenti (edizione attiva più recente dello
   stesso CdS, usando soltanto i piani storici ufficiali collegati dalla pagina
   del corso e senza indovinare varianti di URL). Conserva le associazioni
   docente-insegnamento per l'offerta corrente e i tre A.A. precedenti. Output:
   `catalog.json`. La cache HTML sta in `./cache/`; un checkpoint locale
   `teachers.partial.json` permette di riprendere un run interrotto senza
   duplicare le richieste già concluse.
3. `python3 gen_sql.py` — genera schema + seed SQL in `./sql/` e il mirror
   versionato in `supabase/seed/degree_catalog/`. Il generatore accetta solo il
   `catalog.json` proveniente da `unimi.it`: non esistono hook per fonti esterne.

Applicare i seed sul DB live con service role (i file superano il limite
pratico di apply_migration: usare `execute_sql` per chunk, psql, o un importer
temporaneo).

CdL senza piano strutturato su unimi.it (piano presso l'ateneo capofila o non
pubblicato in HTML): artificial-intelligence (Pavia),
tecnologie-gestione-impresa-casearia (Parma),
interpretariato-traduzione-lis-list (Milano-Bicocca), infermieristica e
ostetricia. Restano tutti a inserimento libero: non importiamo piani o docenti
dagli atenei capofila.
