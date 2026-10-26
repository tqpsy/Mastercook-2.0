# 06 · Piano di sviluppo, stime e costi

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Regole per ogni fase (dalla sezione 25 del prompt): definisco perimetro, file e criteri; implemento solo quello; eseguo i test; verifico nell'app pubblicata; documento i limiti; apro una PR; **mi fermo per la tua revisione**. Una fase non parte perché la precedente compila, ma perché tu l'hai approvata.

Lavoro nel repository `tqpsy/Mastercook-2.0`, su branch dedicati, con PR piccole. Nessuna unione senza il tuo via esplicito.

---

## Fase 0 · Analisi e progettazione (questa)

Consegna: i documenti 00–08 di questa cartella. Nessun codice, nessuna migrazione, vecchio repository intatto.

## Fase 1 · Fondamenta affidabili

- **Cosa:** progetto Vite + React + TS; CI (lint, tipi, test, build, Postgres); Supabase collegato; schema di base (famiglia, utenti, membri, vincoli, comando, compatibilità); `applica_comando` con idempotenza e versioni; copia locale e coda dei comandi; simulatore di sincronizzazione; accesso con Google; creazione della famiglia e inviti; esportazione e ripristino di base; PWA installabile con schermata vuota onesta.
- **File principali:** `supabase/migrations/0001_*.sql`, `src/dati/coda.ts`, `src/dati/copiaLocale.ts`, `src/dati/sincronizza.ts`, `src/comandi/*`, `src/pagine/Accesso.tsx`, `src/pagine/Famiglia.tsx`, `tests/sync/*`, `.github/workflows/ci.yml`, `docs/`.
- **Uscita:** l'app si avvia, accedi, crei la famiglia, inviti un secondo account, i membri e i vincoli si salvano e si vedono sull'altro dispositivo; T-SYN-2…5, T-ACC, T-DAT-1 verdi.
- **Ti servirà:** creare un account Supabase e un progetto (passaggi scritti da me, circa 10 minuti), aggiungere due segreti su GitHub.

## Fase 2 · Ricette e inventario

- **Cosa:** ingredienti, conversioni e unità; importazione verificata delle ricette di sistema; schede, ricerca, crea/modifica/duplica/archivia; foto delle ricette; lotti, movimenti, luoghi, correzioni, spreco; tipi di data e stime documentate.
- **Uscita:** inventario senza duplicazioni e senza quantità arbitrarie; T-UNI, T-CAS, T-SCA, T-ACQ-1 (solo la parte manuale) verdi.

## Fase 3 · Menu familiare

- **Cosa:** categorie di pasto, calendario con tre viste salvate per dispositivo, portate, porzioni, eccezioni dei membri, gusti, spostamenti, ripetizione della settimana, vincoli segnalati nel calendario; vista tablet.
- **Uscita:** la pianificazione non tocca la casa; T-PIA, T-SYN-1, T-SYN-6/7, T-VIN verdi; prova con telefono e tablet.

## Fase 4 · Lista della spesa e acquisti

- **Cosa:** fabbisogno calcolato; voci derivate e manuali; carrello; conferma acquisti; annullo e correzione; scontrini (Tesseract, revisione, abbinamento, impronta); prezzi e stima del costo.
- **Uscita:** gli acquisti caricano una volta sola; cambiare il menu non cancella nulla di già fatto; T-SPE, T-ACQ, T-PRE verdi; una spesa vera.

## Fase 5 · Consumi e riduzione degli sprechi

- **Cosa:** conferma del pasto con le sei domande; scarico dai lotti più urgenti; correzioni; avanzi; schermata Oggi; avvisi di scadenza; ricette per gli alimenti urgenti; foto facoltativa del piatto.
- **Uscita:** previsto e consumato distinti; T-CON verdi; **prima versione per l'uso quotidiano in famiglia.**

## Fase 6 · Automazione intelligente

- **Cosa:** pianificazione automatica e mista; alternative per un pasto; foto del frigo con Gemini (Edge Function); suggerimenti; spesa più economica quando i dati ci sono.
- **Uscita:** nessuna proposta viola un vincolo; nessuna proposta entra senza conferma; costi e privacy di Gemini documentati in app.

## Fase 7 · Verifica e migrazione

- **Cosa:** prove approfondite su dispositivi reali; test di sincronizzazione con più dispositivi veri; prova di ripristino; importazione controllata dal vecchio progetto (file 07).
- **Uscita:** criteri di tutte le fasi superati; il vecchio Mastercook resta disponibile fino alla tua conferma.

---

## Stime di tempo

Ipotesi: lavoro svolto da sessioni di Claude Code come questa, con te che approvi ogni fase e fai le prove sui dispositivi. Unità: giornate di lavoro di sviluppo (gp) più il tempo di calendario per le tue prove. Intervalli larghi perché dipendono dalle revisioni e dai problemi trovati sui dispositivi.

- Fase 1: 5–8 gp, più 2–3 giorni di prove (accesso, inviti, tablet).
- Fase 2: 6–9 gp.
- Fase 3: 5–8 gp, più circa una settimana d'uso del calendario.
- Fase 4: 7–11 gp, più due spese reali.
- Fase 5: 5–8 gp, più circa due settimane d'uso.
- Fase 6: 6–10 gp.
- Fase 7: 3–5 gp, più circa una settimana.

**Totale fino alla versione quotidiana (Fase 5): 28–44 gp**, cioè realisticamente **6–10 settimane di calendario** con revisioni e prove. **Tutto, Fasi 1–7: 37–59 gp**, circa 9–14 settimane.

Confronto con l'audit precedente: la stima della «nuova base» era 30–55 gp; questa è coerente, un po' più precisa perché ora l'architettura è definita.

**Complessità:** la parte più difficile non è l'interfaccia ma la Fase 1 (comandi, coda, cursore, test di concorrenza) e la Fase 4 (fabbisogno con carrello, scontrini e correzioni). Le ho stimate con più margine.

---

## Costi operativi

- **Previsto: 0 € al mese.**
  - Supabase piano gratuito: 500 MB di database, 1 GB di foto, 2 progetti (uno per l'app, eventualmente uno di prova).
  - GitHub Pages e GitHub Actions: gratuiti per repository pubblici.
  - Gemini: chiave gratuita della famiglia, con i limiti giornalieri del piano gratuito.
  - Tesseract: sul dispositivo, gratuito.
- **Uso stimato di una famiglia di 4** [Stima]: 2–10 MB di dati l'anno senza foto; 150–250 KB per foto; poche centinaia di comandi al giorno. Ampiamente dentro i limiti.
- **Se servisse pagare:** Supabase Pro 25 $ al mese (8 GB di database, 100 GB di file). L'app avvisa all'80% dello spazio.
- **Nessuna nuova dipendenza a pagamento.** Ogni nuova libreria sarà indicata nella PR con il motivo.

### Dipendenze previste (da approvare con la Fase 1)

- Runtime: `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `dexie`, `tesseract.js` (Fase 4), `vite-plugin-pwa`.
- Sviluppo: `typescript`, `vite`, `vitest`, `fake-indexeddb`, `@playwright/test`, `eslint`, CLI di `supabase`.
