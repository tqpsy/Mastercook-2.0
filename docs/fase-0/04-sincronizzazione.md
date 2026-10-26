# 04 · Strategia di sincronizzazione multi-dispositivo

Mastercook 2.0, Fase 0, 26 ottobre 2026.

---

## 1. Modello

- **Fonte autorevole:** il database Postgres su Supabase. Ciò che è lì è la verità.
- **Dispositivo:** copia locale (per leggere) + coda di comandi (per scrivere).
- **Scrivere = inviare un comando.** Il server decide se applicarlo, con regole uguali per tutti i dispositivi.
- **Leggere = scaricare le righe cambiate** dopo l'ultimo punto noto.

Non è un sistema «offline-first con unione automatica» come il vecchio Yjs. È un sistema **con fonte unica e offline gestito**: offline si legge tutto e si mettono in coda le modifiche; l'esito definitivo arriva quando il server le applica.

---

## 2. Il comando

Ogni comando contiene:

- `id`: UUID generato sul dispositivo al momento del tocco. Non cambia mai, neppure nei ritentativi.
- `tipo`: per esempio `aggiungi_portata`, `sposta_in_carrello`, `conferma_acquisto`, `conferma_pasto`.
- `dati`: i valori scelti dall'utente.
- `attese`: per ogni riga che modifica, la `versione` che il dispositivo aveva visto e i campi che cambia.
- `versione_app`, `dispositivo`, `creato_il`.

Il server lo applica con `applica_comando(comando)`:

1. Se `id` esiste già nella tabella `comando`, restituisce l'esito salvato. **Fine: nessun effetto ripetuto.**
2. Se `versione_app` è sotto la minima, rifiuta con `app_da_aggiornare`.
3. Controlla i permessi (famiglia, ruolo).
4. Controlla le `attese` e applica le regole di conflitto (sezione 3).
5. Scrive tutte le righe e i movimenti, e il comando con il suo esito, **in una sola transazione**. Se qualcosa fallisce, non resta nulla.
6. Restituisce l'esito e le righe toccate.

Due richieste identiche che arrivano nello stesso istante: la chiave primaria su `comando.id` fa vincere la prima; la seconda attende la fine della prima e trova l'esito già registrato.

---

## 3. Regole di conflitto

1. **Inserimenti distinti:** mai in conflitto. Due portate, due voci di spesa, due vincoli sono righe diverse con id diversi.
2. **Stessa riga, campi diversi:** si uniscono campo per campo. Esempio: A cambia le porzioni, B cambia la ricetta della stessa portata → la portata ha la ricetta di B e le porzioni di A.
3. **Stessa riga, stesso campo:** il primo arrivato vince; il secondo comando torna con esito `conflitto`, il valore attuale e chi l'ha scritto. L'app chiede: «Martina ha già messo 4 porzioni. Tieni 4 o metti 3?». Nulla è scartato senza che l'utente lo veda.
4. **Scorte:** sono movimenti che si sommano, quindi due consumi contemporanei dello stesso lotto si applicano entrambi. Se la somma va sotto zero il lotto è marcato «quantità da verificare» e compare tra le cose da sistemare.
5. **Stati della spesa** (`da_acquistare` → `nel_carrello` → `acquistata_da_confermare` → `confermata`): un comando che riporterebbe una voce a uno stato precedente rispetto a quello che il server ha, scritto da un altro dispositivo, torna come conflitto. Chi l'ha messa nel carrello può comunque toglierla.
6. **Conferme uniche:** una sola conferma attiva per pasto e un solo acquisto per impronta di scontrino. Una seconda conferma dello stesso pasto da un altro dispositivo torna come `gia_confermato`, con l'invito a correggere se serve.
7. **Modifica di qualcosa cancellato:** conflitto, con la proposta di ripristinarlo.
8. **Pianificazione automatica:** il generatore manda comandi che toccano solo portate `automatica` non bloccate, con le versioni attese. Se nel frattempo una persona le ha cambiate, quelle portate diventano manuali e il generatore le salta.

---

## 4. Ricevere le modifiche

- Ogni riga, quando cambia, riceve un `seq` dal server.
- Il dispositivo chiede «tutte le righe della mia famiglia con `seq` maggiore di N», in pagine da 500.
- **Problema noto dei contatori:** una transazione lenta può salvare un `seq` più basso dopo che il dispositivo ha già letto numeri più alti, e quella riga verrebbe saltata. Soluzione: il server restituisce, oltre alle righe, il punto sicuro fino a cui tutte le transazioni sono concluse (calcolato con l'istantanea delle transazioni di Postgres, `pg_snapshot_xmin`); il dispositivo avanza N solo fino a lì.
- Le righe ricevute e il nuovo N si salvano in IndexedDB **in una sola transazione**: un'interruzione lascia la copia locale com'era prima, mai a metà.
- Le cancellazioni arrivano come righe con `eliminato_il`.
- **Quando si scarica:** all'apertura, al ritorno della rete, dopo ogni comando, ogni 60 secondi in primo piano e subito quando arriva un avviso in tempo reale (Supabase Realtime). Se l'avviso si perde, il controllo periodico recupera.

---

## 5. Offline

### Cosa funziona offline (in modo affidabile)

- Consultare menu, ricette, casa, lista, cronologia scaricata.
- Pianificare, aggiungere e togliere portate, spostare pasti.
- Lista: aggiungere voci, spuntare in negozio (carrello), confermare gli acquisti.
- Casa: aggiungere lotti, correggere, segnare spreco.
- Confermare i pasti.
- Leggere uno scontrino con Tesseract.

Tutto ciò che si modifica offline si vede subito con il segno «in attesa» e diventa definitivo quando il server lo applica.

### Cosa non prometto offline

- **Il risultato definitivo dei conflitti:** se due persone modificano la stessa cosa mentre una è offline, il conflitto si scopre solo al ritorno della rete. Lo segnalo, non lo nascondo.
- **Il fabbisogno esatto:** offline si calcola sulla copia locale, che può non avere le modifiche degli altri. La lista mostra «aggiornata alle 18:40».
- **Creare la famiglia, accettare un invito, accedere la prima volta:** richiedono rete.
- **Generazione del menu con l'AI, foto del frigo, lettura avanzata degli scontrini con Gemini:** richiedono rete.
- **Caricare le foto:** restano in coda sul dispositivo fino alla rete.

### Coda dei comandi

- Si invia in ordine, uno alla volta per dispositivo, così i comandi dipendenti (crea la ricetta, poi aggiungila al pasto) arrivano nell'ordine giusto.
- Errore di rete o risposta persa: si ritenta con attesa crescente, **con lo stesso id**.
- Esito `conflitto` o `rifiutato`: il comando esce dalla coda ed entra in «Da sistemare», con il motivo in italiano e tre scelte: riprova con il valore nuovo, modifica, scarta. I comandi successivi che dipendono da lui attendono.
- La coda sopravvive alla chiusura dell'app e al riavvio del telefono (IndexedDB).
- Indicatore sempre visibile: «Tutto salvato», «3 modifiche in attesa», «1 da sistemare».

---

## 6. Versioni dello schema e dell'app

- Le migrazioni del database sono file SQL numerati nel repository, applicate dalla CI in ordine; ognuna ha un test.
- La tabella `compatibilita` indica la versione minima dell'app che può scrivere.
- Una migrazione che cambia il significato dei comandi alza la minima. Un'app più vecchia riceve `app_da_aggiornare`: passa in sola lettura e mostra «Aggiorna Mastercook» con un pulsante. I suoi comandi in coda restano salvati e vengono riproposti dopo l'aggiornamento, se ancora validi.
- La PWA controlla gli aggiornamenti all'apertura e ogni ora, e sul tablet si aggiorna da sola quando non c'è nulla in coda.
- La copia locale ha la sua versione: se cambia, si riscarica da zero (i comandi in coda restano).

---

## 7. Backup e ripristino

- **Esportazione:** un file JSON con `formato: "mastercook-2"`, `versione_schema`, data, e tutte le entità della famiglia. Formato documentato in `docs/formato-esportazione.md`. Le foto in un archivio ZIP accanto, facoltativo.
- **Ripristino:** solo in una famiglia nuova e vuota, mai sopra una esistente. Prima di confermare l'app mostra il riepilogo (ricette, lotti, pasti…). Dopo il ripristino l'app riesporta e confronta.
- **Promemoria:** l'amministratore riceve ogni mese un invito a scaricare l'esportazione.
- **Backup automatici di Supabase:** nel piano gratuito esistono ma non sono scaricabili; non li conto come garanzia.

---

## 8. Scenari obbligatori e risultato atteso

1. **A e B aggiungono due portate diverse alla cena di martedì.** Due comandi `aggiungi_portata` con id diversi → due righe → entrambe presenti ovunque.
2. **A e B aggiungono prodotti diversi alla lista.** Due voci manuali → entrambe presenti.
3. **A e B confermano la stessa operazione.**
   - Stesso comando ritentato: un solo effetto (id unico).
   - Due comandi diversi che confermano lo stesso pasto: il primo applica, il secondo riceve `gia_confermato`; un solo scarico.
4. **Sincronizzazione interrotta durante una scrittura.** Sul server: transazione annullata, nulla di scritto; il dispositivo ritenta con lo stesso id. In locale: blocco di righe non salvato, N non avanzato; si riscarica.
5. **Riconnessione dopo un periodo offline.** Il dispositivo invia la coda in ordine, scarica tutto dopo N, mostra i conflitti in «Da sistemare».
6. **Client non aggiornato.** Rifiuto `app_da_aggiornare`, sola lettura, nessuna scrittura parziale.
