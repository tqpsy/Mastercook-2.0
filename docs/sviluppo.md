# Sviluppo

## Requisiti

- Node.js 22
- PostgreSQL 16 per i test del database (in CI è un servizio del workflow)

## Comandi

```sh
npm ci                 # installa le dipendenze
npm run lint           # controllo dello stile
npm run typecheck      # controllo dei tipi
npm test               # test del dominio (funzioni pure)
npm run test:db        # test del database su un Postgres vero
```

`npm run test:db` crea un database nuovo per ogni file di test, applica
`supabase/tests/supabase-finto.sql` (ruoli, `auth.users` e `auth.uid()` come su Supabase)
e poi tutte le migrazioni in `supabase/migrations/`, e alla fine lo cancella.

L'indirizzo del Postgres si imposta con `MC_DATABASE_URL`
(predefinito: `postgres://postgres@localhost:54329/postgres?host=/tmp/pg`). Per avviarne uno locale:

```sh
initdb -D /tmp/pg/data -U postgres --auth=trust
pg_ctl -D /tmp/pg/data -l /tmp/pg/log -o "-p 54329 -k /tmp/pg" start
```

## Migrazioni

- Un file SQL per migrazione in `supabase/migrations/`, con nome `AAAAMMGGhhmmss_descrizione.sql`.
- Una migrazione già unita a `main` non si modifica: se serve un cambiamento se ne aggiunge una nuova.
- Ogni migrazione ha test in `tests/db/` che la applicano da zero.
- Se una migrazione cambia il significato dei comandi, alza `compatibilita.versione_minima_app`.
