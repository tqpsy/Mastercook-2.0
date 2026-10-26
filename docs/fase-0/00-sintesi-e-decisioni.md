# Mastercook 2.0 · Fase 0: sintesi e decisioni da approvare

26 ottobre 2026. Nessun codice applicativo scritto, nessuna migrazione, vecchio repository solo letto.

## Documenti

- `01-requisiti.md` requisiti funzionali e criteri di accettazione
- `02-architettura.md` architettura e scelte tecnologiche, sicurezza, costi
- `03-modello-dati-e-integrita.md` schema concettuale e regole d'integrità
- `04-sincronizzazione.md` strategia multi-dispositivo, offline, backup
- `05-piano-test.md` piano di test
- `06-piano-sviluppo-e-stime.md` fasi, tempi, complessità, costi
- `07-recupero-dal-vecchio-progetto.md` cosa recuperare e come migrare in futuro
- `08-rischi.md` analisi dei rischi
- `09-problemi-e-soluzioni.md` ogni problema e dubbio trovato, con la sua soluzione

---

## Sintesi

**Cosa cambia rispetto a Mastercook 1.** Il vecchio teneva tutto in un documento Yjs cifrato copiato tra Drive e Firebase: unisce sempre, ma non può impedire doppi carichi, doppi consumi o perdite di portate. La 2.0 ha **una sola fonte autorevole**, un database Postgres su Supabase (gratuito, UE), che fa rispettare le regole per tutti i dispositivi.

**Come si scrive.** Ogni azione diventa un comando con un id univoco, applicato in una transazione. Ripeterlo (rete che ritenta, doppio tocco, due dispositivi) non produce un secondo effetto.

**Come si lavora offline.** Si legge tutto dalla copia locale; le modifiche vanno in coda e si vedono «in attesa». Se al ritorno della rete c'è un conflitto, compare in «Da sistemare» con una domanda chiara. Non prometto offline: primo accesso, inviti, funzioni AI, e il risultato definitivo dei conflitti.

**Come si evitano i conflitti.** Ogni portata, voce di spesa, vincolo è una riga a sé: due aggiunte contemporanee restano entrambe. Le scorte sono movimenti che si sommano. Lo stesso campo cambiato da due persone produce una domanda, non una sovrascrittura.

**Pianificato e reale.** Menu e lista sono intenzioni; acquisti e conferme dei pasti sono fatti; la casa è la somma dei movimenti nati dai fatti. Il fabbisogno si calcola ogni volta, non si copia, quindi non si duplica e non invecchia. Lotti con date diverse non si fondono. Nessuna quantità inventata.

**Tempi.** Versione per l'uso quotidiano (fine Fase 5): 28–44 giornate di sviluppo, circa 6–10 settimane di calendario con le tue prove. Tutto (Fasi 1–7): 37–59 giornate, circa 9–14 settimane.

**Costi.** 0 € al mese con i piani gratuiti. Se un giorno servisse: Supabase Pro, 25 $ al mese.

**Recupero.** 209 ricette, circa 420 ingredienti, reparti, regole di conservazione e alcuni moduli puri, dopo verifiche automatiche. I dati reali della famiglia solo in Fase 7, con prova a secco e ritorno indietro.

**Rischi principali.** Condizioni del piano gratuito di Supabase; complessità della coda offline (la affronto per prima); abitudine della famiglia a confermare acquisti e pasti; dati non cifrati end-to-end.

---

## Decisioni da approvare prima della Fase 1

**D1 · Fonte dei dati: Supabase (Postgres), piano gratuito, regione UE.**
Alternativa: Firestore, che ha l'offline già pronto ma non permette funzioni lato server né foto senza carta di credito. Consiglio Supabase.

**D2 · Privacy: dati non cifrati end-to-end.**
I dati sono protetti da accesso Google, separazione per famiglia, cifratura del fornitore e regione UE, ma chi amministra il progetto Supabase potrebbe leggerli. Nel vecchio progetto avevi chiesto che lo sviluppatore ospitasse solo dati cifrati. La cifratura end-to-end impedirebbe al server di far rispettare le regole d'integrità. Consiglio di accettare.

**D3 · Account Supabase a tuo nome.**
Lo crei tu con il tuo Google, una volta, seguendo i passaggi che ti scrivo in Fase 1. Gli utenti non configurano nulla.

**D4 · Limiti dell'offline** come descritti in `04-sincronizzazione.md`, sezione 5.

**D5 · Repository pubblico.**
`tqpsy/Mastercook-2.0` è pubblico, come il vecchio: GitHub Pages e Actions restano gratuiti. Nessun segreto nel codice. Se lo vuoi privato, la pubblicazione su Pages richiede un piano GitHub a pagamento.

**D6 · Dipendenze** elencate in `06-piano-sviluppo-e-stime.md`: React, Supabase, Dexie, Tesseract (Fase 4), Vite PWA; per lo sviluppo Vitest, Playwright, CLI di Supabase.

**D7 · Gemini solo per funzioni facoltative** (foto del frigo, aiuto sugli scontrini, generazione del menu), con la chiave gratuita della famiglia custodita sul server e un avviso privacy prima di ogni invio. Tutto ha un'alternativa manuale.

**D8 · Regole di conservazione dei cotti** riprese dal vecchio progetto e mostrate come «indicative, da validare» finché un professionista non le conferma.

**D9 · Primo commit sul nuovo repository.**
Il repository è vuoto: per aprire PR serve un ramo `main`. Ti propongo un primo commit su `main` con soli `README.md` e la cartella `docs/` con questi documenti. Intanto li ho messi sul ramo `claude/project-thread-2ap0yh`.
