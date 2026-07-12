# Catalogo insegnamenti UniMi

Pipeline per rigenerare il catalogo materie+docenti di tutti i CdL triennali
(tabelle `degree_courses`, `professors`, `degree_course_teachers`).

1. `programs.json` — estratto dal seed di `degree_programs` (slug + unimi_path).
2. `python3 scraper.py` — scarica da unimi.it i piani didattici (offerta più
   recente) e i docenti (edizione attiva più recente dello stesso CdS, con
   probe dei suffissi Drupal sull'A.A. precedente). Output: `catalog.json`.
3. `python3 gen_sql.py` — genera schema + seed SQL in `./sql/`
   (mirror in `supabase/seed/degree_catalog/`).

Applicare i seed sul DB live con service role (i file superano il limite
pratico di apply_migration: usare psql o un importer temporaneo).
CdL senza piano su unimi.it (piano presso l'ateneo capofila o non pubblicato):
artificial-intelligence (UniPV), tecnologie-gestione-impresa-casearia (UniPR),
interpretariato-traduzione-lis-list (UniMiB), infermieristica, ostetricia.
