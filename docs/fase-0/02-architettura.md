# 02 · Architettura e scelte tecnologiche

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Etichette: **[Fatto]** verificato nel codice o nella documentazione; **[Scelta]** mia, reversibile; **[Da approvare]** spetta a te.

---

## 1. In breve

- **Una sola fonte autorevole:** database Postgres su Supabase, piano gratuito, regione UE.
- **Ogni modifica è un comando con un identificativo univoco**, applicato dal server in una sola transazione. Ripeterlo non produce un secondo effetto.
- **Offline esplicito:** copia locale per leggere, coda di comandi per scrivere, stato sempre visibile.
- **Regole di conflitto dichiarate**, non «vince l'ultima scrittura».
- **Pianificato e reale in tabelle diverse:** la casa cambia solo con movimenti nati da acquisti confermati, consumi confermati o correzioni.
- **App:** PWA React + TypeScript + Vite, per telefono e tablet.

---

## 2. Perché non riuso l'architettura di Mastercook 1

[Fatto, dagli audit del 26 ottobre]

- Tutti i dati della famiglia sono un unico documento Yjs (CRDT) cifrato, copiato tra Drive e Firebase. Un CRDT unisce sempre, ma non fa rispettare vincoli: «una conferma per pasto», «nessun doppio carico», «nessuna quantità inventata» dipendono dal buon comportamento di ogni dispositivo.
- Gli elenchi salvati in un solo campo (portate, origini della spesa) si perdono con due modifiche contemporanee: riprodotto.
- Due trasporti (Drive e Firebase) possono bloccarsi a vicenda: riprodotto l'errore `firebase_in_scrittura`.
- Il permesso Google del tablet si rinnova in silenzio una sola volta per sessione.

Non riprendo quindi Yjs, Drive come archivio dei dati, né la copia su Firebase.

---

## 3. Alternative valutate per i dati condivisi

### A. Supabase (Postgres) come fonte unica · consigliata

- **Pro:** vincoli veri (chiavi uniche, chiavi esterne, controlli sulle quantità), transazioni, funzioni lato server che applicano le regole di integrità per tutti; accesso con Google incluso; spazio file per le foto; avvisi in tempo reale per il tablet; nei test si usa un vero Postgres, quindi i test di concorrenza sono reali.
- **Contro:**
  - l'offline va costruito da noi (coda di comandi, sezione 04);
  - il piano gratuito mette in pausa un progetto dopo 7 giorni senza accessi: rischio basso con uso quotidiano, mitigato da un controllo automatico settimanale;
  - i dati non sono cifrati end-to-end (sezione 7).
- **Piano gratuito** [Fatto ad oggi, da riverificare all'attivazione]: 500 MB di database, 1 GB di file, 2 progetti attivi, nessuna carta di credito.

### B. Firestore come fonte unica

- **Pro:** offline già pronto; progetto Firebase già esistente.
- **Contro:** senza piano a pagamento niente funzioni lato server, quindi le regole d'integrità si scriverebbero solo come regole di accesso, molto limitate; niente transazioni offline; per le foto Cloud Storage richiede ormai il piano Blaze con carta di credito [Fatto, annuncio Firebase di settembre 2024].

### C. Drive + Yjs (come oggi)

Scartata per i motivi della sezione 2.

### D. Server proprio (PocketBase, Node)

Scartata: va ospitato e mantenuto, con costi o lavoro continuo.

---

## 4. Componenti

1. **App PWA** React 18 + TypeScript + Vite, `vite-plugin-pwa`. Rivalutata e confermata: matura, testabile, installabile su telefono e tablet. Pubblicata su GitHub Pages (gratuito).
2. **Copia locale** in IndexedDB con Dexie: lettura offline e apertura immediata. È una copia, mai la fonte di verità.
3. **Coda dei comandi** in IndexedDB: ogni azione dell'utente diventa un comando con id generato sul dispositivo.
4. **Supabase:**
   - Postgres con schema e migrazioni nel repository (`supabase/migrations`);
   - funzione `applica_comando` che applica ogni comando in una transazione;
   - regole di accesso per riga (RLS): ogni utente vede solo la propria famiglia;
   - Storage per le foto, con regole per famiglia;
   - Edge Function `gemini` che usa la chiave della famiglia senza mostrarla ai membri.
5. **Dominio puro** (TypeScript senza React né rete): fabbisogno, unità, scadenze, prezzi, generatore del menu, abbinamento scontrini. È la parte più testata.
6. **Lettura scontrini:** Tesseract.js sul dispositivo (gratuito, offline), Gemini facoltativo per migliorare l'abbinamento.

### Struttura del repository proposta

```
Mastercook-2.0/
  docs/                 i documenti di questa Fase 0, aggiornati
  supabase/
    migrations/         SQL versionato, una cartella per versione
    functions/gemini/   Edge Function
    tests/              test SQL (pgTAP) e di concorrenza
  src/
    dominio/            logica pura: unita, fabbisogno, scadenze, prezzi, menu
    dati/               copia locale (Dexie), coda comandi, sincronizzazione
    comandi/            definizione e validazione dei comandi
    ui/                 componenti
    pagine/             Oggi, Menu, Spesa, Casa, Ricette, Famiglia, Impostazioni
    rif/                ricette e ingredienti di sistema importati
  tests/
    sync/               simulatore di più dispositivi
    e2e/                Playwright, telefono e tablet
  .github/workflows/    CI
```

### Flusso di una modifica

1. L'utente tocca «Conferma acquisti».
2. L'app crea il comando `conferma_acquisto` con id `c-7f3…`, lo mette in coda e mostra l'effetto previsto con «in invio».
3. Con la rete, il comando va a `applica_comando`.
4. Il server, in una transazione: verifica che `c-7f3…` non sia già applicato; verifica le versioni attese; scrive acquisto, lotti, movimenti; registra comando ed esito.
5. Il dispositivo riceve l'esito e le righe vere.
6. Se lo stesso comando arriva di nuovo, il server restituisce l'esito registrato senza rifare nulla.

---

## 5. Account e famiglia

- Solo «Accedi con Google», tramite Supabase Auth. La sessione si rinnova da sola: nessun rinnovo del permesso Google da gestire sul tablet.
- Chi crea la famiglia è amministratore. Inviti con link e codice a uso limitato.
- Un membro può non avere un account.
- Configurazione una tantum lato sviluppo: progetto Supabase e ID client Google. Gli utenti non configurano nulla.

---

## 6. Foto

- Ridimensionate e compresse sul dispositivo: lato lungo 1600 px, WebP, circa 150–250 KB, più miniatura da 400 px.
- Caricate in coda; il collegamento alla ricetta si fa solo dopo che il file è arrivato.
- Con 1 GB gratuito ci stanno circa 4.000 foto [Stima]. Le foto del frigo usate solo per il riconoscimento non si conservano, salvo scelta dell'utente.

---

## 7. Sicurezza e privacy

- Accesso con Google; regole per riga che separano le famiglie, verificate da test.
- Dati in Supabase regione UE, cifrati dal fornitore su disco e in transito (HTTPS).
- **Non cifrati end-to-end.** Chi amministra il progetto Supabase, cioè tu e chi sviluppa con il tuo accesso, potrebbe leggerli. Nel vecchio progetto la regola era che lo sviluppatore ospitasse solo dati cifrati. Una cifratura end-to-end impedirebbe al server di far rispettare le regole d'integrità, che sono il requisito più importante. **[Da approvare, decisione D2]**
- Chiave Gemini: inserita una volta dall'amministratore, salvata sul server, usata solo dalla Edge Function. I familiari non la vedono.
- Gemini nel piano gratuito può usare i contenuti inviati per migliorare i modelli di Google: lo dirà la schermata prima dell'invio.
- Segreti mai nel repository: la chiave pubblica di Supabase (anon) è pensata per stare nell'app; la chiave di servizio resta solo nei segreti di GitHub e di Supabase.
- Dati minimi sui membri.

---

## 8. Costi operativi

- **Previsti: 0 € al mese** con: Supabase gratuito, GitHub Pages, GitHub Actions (repository pubblico), Gemini con chiave gratuita, Tesseract sul dispositivo.
- **Quando si pagherebbe:** oltre 500 MB di dati (improbabile per una famiglia, stima: pochi MB l'anno senza foto) o oltre 1 GB di foto. Il passo successivo è Supabase Pro a 25 $ al mese. L'app avvisa sopra l'80% dello spazio.
- **Dipendenze esterne:** Supabase, Google (accesso e Gemini), GitHub. Se Supabase cambiasse le condizioni gratuite, schema e dati sono Postgres standard e si possono spostare su un altro Postgres.
