# Dove stanno i dati di una famiglia

Quando crea la famiglia, ognuno sceglie:

| Scelta | Dove | Chi la usa | Inviti |
|---|---|---|---|
| ☁️ Sul server di Mastercook | Supabase, Europa | tutti i telefoni della famiglia | sì |
| 📱 Solo su questo telefono | database nel browser (PGlite in IndexedDB) | un account, da questo dispositivo | no |
| 🗂️ Sul mio Google Drive | come «solo su questo telefono», più una copia automatica nel proprio Drive | un account, da più dispositivi | no |

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
- Se il telefono si perde o si cancellano i dati del browser, la famiglia si perde, a meno di avere la copia sul
  Drive o una copia salvata (Impostazioni → «Salva una copia», che su iPhone si può mettere in iCloud Drive).

## Come funziona «sul mio Google Drive»

- Prima del permesso l'app mostra una spiegazione semplice (`SpiegazioneDrive` in `src/ui/Drive.tsx`): cartella
  «Mastercook», solo i file creati dall'app, niente server in mezzo, scollegabile quando si vuole.
- Permesso chiesto a Google: solo `drive.file` (i file creati dall'app). Google impedisce all'app di vedere gli
  altri file. Token di Google Identity Services, circa un'ora, solo in memoria; nessun segreto nell'app.
- `src/piattaforma/drive.ts` crea la cartella «Mastercook» e un file JSON per famiglia (l'esportazione normale),
  segnato con `appProperties` per ritrovarlo da un telefono nuovo.
- `src/dati/copiaDrive.ts` + `src/ui/CopiaAutomatica.tsx`: salvataggio 15 secondi dopo una modifica, uno alla
  volta, saltato se i dati non sono cambiati. Se sul Drive c'è una versione più recente (salvata da un altro
  dispositivo) non sovrascrive: chiede «Usa quella del Drive» o «Tieni questa».
- Scaduto il token, l'app chiede un tocco su «Aggiorna la copia».
- Configurazione Google: lo stesso ID client OAuth dell'accesso (`src/config.ts`), con `drive.file` nella
  schermata di consenso. Nessun costo.
- Prova: `tests/e2e/drive.spec.ts`, con Google e Drive finti (`tests/e2e/google-finto.ts`).
