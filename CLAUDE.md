# CLAUDE.md · Mastercook 2.0

## A cosa serve
PWA in italiano per organizzare i pasti di famiglia attorno al **menu della settimana**: ricette, casa (frigo, freezer, dispensa con lotti e scadenze), lista della spesa calcolata dal menu, scontrini, codici a barre, avanzi e consigli («Antonino»). Online su https://tqpsy.github.io/Mastercook-2.0/. Il vecchio repo `tqpsy/Mastercook` è **solo lettura**: non modificarlo mai.

Stack: TypeScript, React 19 + Vite (nessun router), CSS a mano, Dexie (copia locale + coda comandi), PGlite (famiglia «solo su questo telefono»), Supabase gratuito UE (Postgres, login solo Google), tesseract.js (scontrini), Gemini con chiave gratuita della famiglia (foto del frigo).

## Cartelle e file principali
- `src/App.tsx`: guscio con le schede Oggi, Menu, Spesa, Casa, Ricette e Impostazioni. `src/config.ts`: solo chiavi pubbliche. `src/stile.css`: tutto lo stile, con le variabili del design «La cucina di Luca».
- `src/dati/`: motore dei dati. `sincronizzatore.ts` (coda comandi ed esiti), `archivio.ts` (Dexie), `anteprima.ts` (vista locale con i comandi in attesa), `lettura.ts` (legge la copia locale solo dopo uno scarico, tabelle invariate restano gli stessi array), `contesto.tsx` (`useFamiglia`, `useVista`), `indice.ts` (catalogo), `esportazione.ts`, `migrazione.ts` (import dal vecchio), `tipi.ts`.
- `src/dominio/`: logica pura, test accanto a ogni file. Per esempio `menu.ts`, `proposte.ts`, `antonino.ts`, `piano.ts` (file del piano del nutrizionista), `spesa.ts`, `speso.ts` (quanto si è speso), `scontrini.ts`, `vincoli.ts`/`interpreta.ts`/`crudi.ts` (sicurezza alimentare), `iconeCibo.ts`.
- `src/pagine/`: un file per schermata (`Oggi`, `Menu`, `Spesa` (con `Speso`), `Casa`, `Ricette`, `Antonino`, `Impostazioni`…).
- `src/ui/`: componenti riusabili (`Icona`, `IconaCibo` + `disegniCibo.ts`, `Foglio`, `Scanner`, `ocr.ts`…).
- `src/piattaforma/`: `supabase.ts`, `drive.ts` (solo `drive.file`), `fotoFrigo.ts`, `locale/` (PGlite in un worker).
- `src/catalogo/`: `catalogo.json` (ricette e ingredienti di sistema), `ricette-nuove.json`.
- `supabase/migrations/`: tutta la logica che vale per ogni dispositivo. `supabase/functions/foto-frigo/`: unica Edge Function (foto del frigo e lettura del piano del nutrizionista con Gemini, `piano.ts`).
- `tests/db/` (SQL su Postgres vero), `tests/e2e/` (Playwright telefono + tablet), `tests/sync/`. `docs/`: sviluppo, database, formati.

## Convenzioni
- **Italiano ovunque**: nomi di file, funzioni, variabili, testi, commit e PR.
- Le tabelle non si scrivono mai direttamente: solo `public.applica_comando(comando)` con id, così ripetere un comando non fa doppi effetti. Si legge con `scarica_modifiche`. Menu e spesa sono intenzioni, la casa è la somma dei movimenti.
- **Migrazioni**: `AAAAMMGGhhmmss_descrizione.sql` con **versione unica** e successiva all'ultima su `origin/main` (ricontrollare prima di unire: più persone lavorano in parallelo). `src/dati/migrazioni.test.ts` blocca le versioni doppie. Mai modificare o rinominare una migrazione già unita; ogni migrazione ha test in `tests/db/`; se cambia il significato dei comandi alzare `compatibilita.versione_minima_app`.
- **Costo zero**: solo piani gratuiti, niente servizi a pagamento, nessun segreto nel codice (stanno nei segreti di GitHub).
- Dati di funzioni nuove in `famiglia.impostazioni` quando non serve una tabella. Regole di Antonino solo in `REGOLE_BASE`.
- Ricette di sistema nuove: `ricette-nuove.json` → `catalogo.json` → migrazione con `interno.carica_catalogo`; aggiornare il totale in `catalogo.test.ts`.
- CSS: usare le variabili del design; `stile.test.ts` controlla le graffe. Niente prettier (il repo non lo usa).
- Niente dati finti nell'app; ogni nuova dipendenza va documentata in `docs/sviluppo.md`.

## Come si testa
```sh
npm ci
npm run lint && npm run typecheck
npm test            # dominio (funzioni pure)
npm run test:db     # migrazioni + SQL su Postgres 16 (MC_DATABASE_URL, vedi docs/sviluppo.md)
npm run test:e2e    # Playwright, server di prova sulla porta 14400
npm run build
```
La CI (`.github/workflows/ci.yml`) esegue gli stessi passi. A ogni push su `main`, `pubblica.yml` applica le migrazioni (Supabase CLI fissata a 2.122.1) e pubblica su GitHub Pages.
