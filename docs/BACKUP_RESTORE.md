# Backup e ripristino — stato verificato al 2026-07-15

## Cosa offre il piano Supabase attuale

Verificare nel dashboard (`Database > Backups`) il piano attivo:

- **Free**: nessun backup automatico gestito. Servono export logici propri.
- **Pro**: backup giornalieri con retention 7 giorni; PITR come add-on.

Finché il progetto resta su Free, **l'unico backup affidabile è l'export
logico periodico** descritto sotto. Le migrazioni versionate nel repo
(`supabase/migrations/`) ricostruiscono lo schema da zero (verificato con
`supabase db reset`), ma non i dati.

## Export logico periodico (procedura)

Con un access token con privilegi database (l'attuale token CLI dell'account
non li ha — generarne uno da Owner) oppure con la connection string diretta:

```bash
# Schema + dati degli schemi applicativi
pg_dump "$SUPABASE_DB_URL" \
  -n public -n app_private -n billing -n private \
  --no-owner --no-privileges > backup_$(date +%Y%m%d).sql

# Storage: gli oggetti (PDF originali/derivati) NON sono nel dump SQL.
# Vanno esportati a parte (rclone/s3 sync sul bucket S3-compatibile di
# Supabase Storage, credenziali in Storage > Settings).
```

Raccomandazione: job settimanale (GitHub Actions cron con secret
`SUPABASE_DB_URL`) che carica il dump cifrato su uno storage esterno.
Conservazione: 4 settimanali + 3 mensili.

## Test di ripristino eseguito (2026-07-15)

Procedura provata end-to-end su ambiente separato:

1. dump logico degli schemi `public, app_private, billing, private` dallo
   stack Postgres 17.6 (immagine `supabase/postgres:17.6.1.141`);
2. restore in un container **separato** della stessa immagine (estensioni
   `vector` e `pg_trgm` create prima del restore);
3. verifica: 85 tabelle ripristinate, conteggi campione identici
   (`degree_programs`: 81/81). Unico messaggio ignorabile:
   `schema "public" already exists`.

Esito: **procedura di restore verificata**. Ripetere il test dopo modifiche
strutturali importanti e almeno una volta a trimestre sul dump di produzione.

## Responsabilità operative

| Attività | Frequenza | Owner |
| --- | --- | --- |
| Export logico DB | settimanale | titolare / job automatico |
| Sync bucket Storage | settimanale | titolare / job automatico |
| Test di restore | trimestrale | titolare |
| Verifica advisor + alert (`app_private.ops_alerts`) | settimanale | titolare |

## Limiti noti

- Il token CLI attualmente configurato su questa macchina non ha i privilegi
  per `supabase db dump --linked` (403): serve un token generato dall'Owner
  del progetto o la connection string dal dashboard.
- I backup del bucket Storage non sono ancora automatizzati.
- Con l'eventuale passaggio al piano Pro, attivare PITR prima del lancio
  commerciale e aggiornare questo documento.
