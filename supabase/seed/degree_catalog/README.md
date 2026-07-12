# Seed catalogo UniMi

Generato automaticamente da `tools/unimi-catalog/gen_sql.py`.
Fonte esclusiva: `unimi.it`; piano A.A. 2026/2027.
Programmi: 81; cataloghi strutturati: 76.
I file `02`-`05` caricano un batch riprendibile nelle tabelle private; soltanto
`06_finalize.sql` valida i conteggi e sostituisce atomicamente il catalogo live.
