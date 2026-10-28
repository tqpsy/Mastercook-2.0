# Dove stanno i dati di una famiglia

Quando crea la famiglia, ognuno sceglie:

| Scelta | Dove | Chi la usa | Inviti |
|---|---|---|---|
| ☁️ Sul server di Mastercook | Supabase, Europa | tutti i telefoni della famiglia | sì |
| 📱 Solo su questo telefono | database nel browser (PGlite in IndexedDB) | un account, da questo dispositivo | no |

## Come funziona «solo su questo telefono»

- `src/piattaforma/locale/` apre in un worker un Postgres (PGlite) per utente (`idb://mastercook-locale-<utente>`).
- Applica una volta sola, in ordine, `supabase/tests/supabase-finto.sql` e tutte le migrazioni di `supabase/migrations`
  (tabella `locale.migrazione`): le regole, i comandi e i controlli sono gli stessi del server. La prima volta
  servono alcuni secondi; con un aggiornamento dell'app si applicano solo le migrazioni nuove.
- `trasportoLocale` risponde come il server a `applica_comando` e `scarica_modifiche`: archivio Dexie, coda e
  sincronizzatore restano quelli di sempre.
- Le foto restano nell'archivio del dispositivo. La foto del frigo va da qui a Gemini con la chiave della famiglia,
  che resta nel database del telefono.
- `tests/db/locale.test.ts` applica tutte le migrazioni in PGlite: se una migrazione nuova usa qualcosa che PGlite
  non ha, il test lo segnala prima della pubblicazione.
- Il service worker non scarica in anticipo PGlite: lo mette in cache al primo uso, poi funziona senza rete.

## Limiti

- Un solo account; niente inviti.
- Se il telefono si perde o si cancellano i dati del browser, la famiglia si perde: serve un'esportazione
  (Impostazioni → I tuoi dati). La copia automatica sul proprio Drive arriva con la parte successiva.
