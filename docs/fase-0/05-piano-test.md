# 05 · Piano di test

Mastercook 2.0, Fase 0, 26 ottobre 2026.

---

## 1. Livelli

1. **Dominio** (Vitest, millisecondi): funzioni pure di unità, fabbisogno, scadenze, prezzi, generatore, vincoli alimentari, abbinamento scontrini.
2. **Database** (Postgres reale avviato nella CI di GitHub con la CLI di Supabase; test in SQL con pgTAP e in TypeScript): comandi, vincoli, regole di accesso, idempotenza, concorrenza vera con più connessioni.
3. **Sincronizzazione** (Vitest + Postgres reale): un simulatore di 2–3 dispositivi, ognuno con la sua copia locale (fake-indexeddb) e la sua coda, collegati al server da una rete finta che può perdere, ritardare, duplicare e interrompere le risposte.
4. **Interfaccia** (Playwright, Chromium già disponibile): due contesti del browser, uno a misura di telefono e uno di tablet, sullo stesso account di prova.
5. **Prove su dispositivi reali** (a mano, da te o dalla famiglia, con una lista di controllo per fase).

La CI esegue i livelli 1–4 a ogni PR e blocca l'unione se qualcosa fallisce. I dati dei test sono creati dai test stessi e cancellati alla fine; non sono mai dati della famiglia.

---

## 2. Casi di test

### Unità e quantità (T-UNI)

- T-UNI-1 1,5 kg diventa 1.500 g; 0,75 l diventa 750 ml.
- T-UNI-2 g + ml dello stesso ingrediente senza conversione: righe separate.
- T-UNI-3 Unità incompatibile con la dimensione dell'ingrediente: rifiutata (es. «10 g di uova» se uova è a pezzi senza conversione).
- T-UNI-4 Quantità mancante resta `NULL`, mai 500 g.
- T-UNI-5 Formato italiano: «1,5 kg», «1.250 g», «2,30 €», «lun 27 ott».

### Pianificazione (T-PIA)

- T-PIA-1…4 Aggiungere, cambiare ricetta, cambiare porzioni, togliere pasti e portate: zero movimenti, casa identica.
- T-PIA-5 Ripetere la settimana precedente copia le portate con nuovi id e origine `ripetuta`.
- T-PIA-6 Rigenerare tocca solo le portate automatiche non bloccate.
- T-PIA-7 Spostare una portata da martedì a giovedì mantiene id e eccezioni.

### Spesa (T-SPE)

- T-SPE-1 Aggiungere una voce: casa identica.
- T-SPE-2 Mettere nel carrello: casa identica.
- T-SPE-3 Togliere una portata: le voci derivate da acquistare scendono; quelle nel carrello restano con `non_piu_necessaria`.
- T-SPE-4 Cambiare il menu dopo un acquisto confermato: l'acquisto e i lotti restano.
- T-SPE-5 Una voce manuale resta dopo qualsiasi ricalcolo.
- T-SPE-6 Dieci ricalcoli di fila: stesso numero di voci.
- T-SPE-7 200 g + 300 g di pasta da due ricette = 500 g; meno 400 g in casa = 100 g da comprare.
- T-SPE-8 Un ingrediente nel carrello non conta come disponibile per il menu automatico.
- T-SPE-9 Spaghetti in casa coprono «pasta» di una ricetta (genitore), non il contrario.

### Acquisti (T-ACQ)

- T-ACQ-1 Solo `conferma_acquisto` crea lotti con origine acquisto.
- T-ACQ-2 L'acquisto ha fonte e, se presente, scontrino.
- T-ACQ-3 Lo stesso comando di conferma inviato due volte: un lotto, un movimento.
- T-ACQ-4 Carrello confermato + scontrino della stessa spesa: le righe abbinate ricevono i prezzi, nessun nuovo carico.
- T-ACQ-5 Lo stesso scontrino importato due volte: riconosciuto per impronta.
- T-ACQ-6 Annullare un acquisto: movimenti `annullo` opposti, quantità di nuovo come prima, cronologia con entrambi.
- T-ACQ-7 Correggere 2 l in 1 l: un movimento −1 l, non −2 l +1 l.
- T-ACQ-8 Annullare un acquisto i cui prodotti sono già stati in parte consumati: il lotto va sotto zero solo se davvero, e viene segnalato.

### Casa e scadenze (T-CAS, T-SCA)

- T-CAS-1 La quantità di un lotto è la somma dei movimenti.
- T-CAS-2 Due yogurt con date diverse: due lotti.
- T-CAS-3 Spreco e scaduto: movimenti con la causale giusta, statistiche di spreco corrette.
- T-SCA-1 Una data inserita dalla confezione non è mai sostituita.
- T-SCA-2 Prodotto confezionato senza data: «sconosciuta».
- T-SCA-3 Insalata sfusa: stima più breve in dispensa che in frigo; marcata stima con data del calcolo.
- T-SCA-4 TMC superato vs scadenza superata: etichette diverse.
- T-SCA-5 Avanzo di riso: limite dalla regola dei cotti (1–2 giorni).
- T-SCA-6 Ordinamento «Da usare presto».

### Consumi (T-CON)

- T-CON-1 Solo `conferma_pasto` sottrae.
- T-CON-2 La stessa conferma inviata due volte: uno scarico.
- T-CON-3 Due dispositivi confermano lo stesso pasto insieme (due connessioni Postgres in parallelo): una conferma attiva, uno scarico, l'altro riceve `gia_confermato`.
- T-CON-4 Correzione da 320 g a 200 g: un movimento +120 g.
- T-CON-5 Quantità previste e usate distinte e leggibili.
- T-CON-6 «Altro piatto»: la portata prevista resta identica.
- T-CON-7 «Saltato»: nessuno scarico.
- T-CON-8 Scarico prima dai lotti che scadono prima.

### Vincoli alimentari (T-VIN)

- T-VIN-1 Ricetta con allergene vietato a un commensale: esclusa dal generatore e segnalata nel calendario.
- T-VIN-2 Ingrediente senza dati sugli allergeni: «da verificare», mai «adatta».
- T-VIN-3 Le intolleranze sono applicate (difetto del vecchio progetto).
- T-VIN-4 Eccezione con alternativa: il membro è escluso dalla portata e incluso nell'alternativa, anche nel fabbisogno.

### Prezzi (T-PRE)

- T-PRE-1 Ingrediente mai acquistato: «prezzo mancante».
- T-PRE-2 Totale stimato con il conteggio delle voci senza prezzo.
- T-PRE-3 Stima marcata come tale con la data dei dati usati.

### Sincronizzazione (T-SYN)

- T-SYN-1 **Obbligatorio:** A e B aggiungono portate diverse alla cena di martedì → entrambe ovunque.
- T-SYN-2 A e B aggiungono voci diverse alla lista → entrambe.
- T-SYN-3 La rete perde la risposta e il dispositivo ritenta 5 volte → un effetto.
- T-SYN-4 Interruzione a metà scrittura (transazione annullata sul server; interruzione durante il salvataggio locale) → nessuno stato parziale, nessuna riga persa al riscaricamento.
- T-SYN-5 App con versione sotto la minima → `app_da_aggiornare`, nessuna scrittura.
- T-SYN-6 Stesso campo modificato da due dispositivi → conflitto visibile, nessuna perdita silenziosa.
- T-SYN-7 Campi diversi della stessa riga → unione.
- T-SYN-8 Comando rifiutato → in «Da sistemare» con riprova, modifica, scarta.
- T-SYN-9 Dispositivo offline per 3 giorni con 40 comandi in coda → applicati in ordine, conflitti segnalati, stato finale uguale al server.
- T-SYN-10 Transazione lenta con `seq` più basso → nessuna riga saltata dal cursore.
- T-SYN-11 Prova casuale: 3 dispositivi, 500 operazioni casuali, rete instabile; alla fine tutte le copie uguali al server e ogni comando con un esito.

### Accesso (T-ACC)

- T-ACC-1 Utente di un'altra famiglia: nessuna lettura né scrittura, neanche conoscendo gli id.
- T-ACC-2 Invito scaduto o esaurito: rifiutato.
- T-ACC-3 Membro senza ruolo amministratore: non può cancellare la famiglia né cambiare la chiave Gemini.

### Backup e migrazioni (T-DAT)

- T-DAT-1 Esporta → ripristina in una famiglia nuova → riesporta: contenuto identico.
- T-DAT-2 File di esportazione di una versione precedente: importato dopo la migrazione.
- T-DAT-3 File manomesso o incompleto: rifiutato con il motivo, nulla scritto.
- T-DAT-4 Ogni migrazione applicata a un database della versione precedente con dati di prova; discesa testata quando prevista.

### Errori (T-ERR)

- T-ERR-1 Server non raggiungibile: messaggio in italiano, dati in coda, nessuna perdita.
- T-ERR-2 Sessione scaduta: rinnovo automatico; se impossibile, invito ad accedere senza perdere la coda.
- T-ERR-3 Spazio foto pieno: avviso, la ricetta resta salvata senza foto.

### Interfaccia (T-E2E, Playwright)

- T-E2E-1 Telefono pianifica la cena, il tablet la mostra entro 5 secondi.
- T-E2E-2 Flusso completo: menu → lista → carrello → conferma acquisti → conferma pasto → casa aggiornata.
- T-E2E-3 Offline: spuntare 3 voci, tornare online, tutto salvato.
- T-E2E-4 Conferma di un pasto con un tocco dalla schermata Oggi.
- T-E2E-5 Viste del calendario: la scelta resta sul dispositivo.

---

## 3. Prove su dispositivi reali (per fase)

- Installazione della PWA su Android e iPad/iPhone.
- Tablet acceso per 8 ore in cucina: riceve le modifiche senza tocchi.
- Spesa vera con due persone che spuntano insieme.
- Modalità aereo durante la spesa, poi ritorno della rete.
- Foto con la fotocamera del telefono: dimensione e qualità.

---

## 4. Quando una funzione è completa

Una funzione è completa solo se: il flusso reale funziona nell'app pubblicata, i dati restano dopo la chiusura e su un altro dispositivo, gli errori sono gestiti, i suoi test passano nella CI, e la prova su dispositivo reale della fase è superata.
