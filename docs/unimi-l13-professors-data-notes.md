# Dati corsi e professori L-13 UniMi

Data estrazione: 2026-07-03.

## Fonte primaria usata per il seed

- Pagina ufficiale docenti del corso di Scienze Biologiche: https://scienzebiologiche.cdl.unimi.it/it/il-corso/docenti
- Piano didattico ufficiale: https://scienzebiologiche.cdl.unimi.it/it/insegnamenti/piano-didattico

La pagina docenti espone due blocchi distinti:

- `FAI`: immatricolati nell'anno accademico 2025/2026.
- `F62`: immatricolati dall'a.a. 2019/2020 al 2024/25.

Il seed Supabase è in `supabase/migrations/202607030002_l13_course_professors.sql` e contiene:

- 93 professori;
- 30 offerte formative distinte per coorte;
- 110 associazioni corso-docente, incluse linee `A-L`, `M-Z` e `Tutti`.

## Scelte di modellazione

- I nomi dei corsi sono salvati come appaiono nella fonte ufficiale.
- Gli URL delle schede insegnamento U-GOV e delle rubriche docente vengono conservati quando presenti.
- I corsi a scelta e il tirocinio sono marcati con `is_elective = true`.
- Le linee alfabetiche sono normalizzate in `A-L`, `M-Z`, `Tutti`.
- La lettura pubblica è consentita via RLS perché questi dati non sono personali degli utenti della piattaforma.
- Scrittura e aggiornamento restano riservati a migration/service role.

## Nota sulle fonti non ufficiali

Per i dati canonici del database non ho usato fonti non ufficiali come verità primaria: possono essere utili per individuare discrepanze, ma non sono affidabili per assegnazioni docente/corso aggiornate. La pipeline consigliata è: fonte ufficiale Docenti + schede U-GOV + eventuale controllo manuale su calendario/orari e pagine docente prima del rilascio annuale.
