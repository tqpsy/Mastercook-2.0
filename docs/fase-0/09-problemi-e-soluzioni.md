# 09 · Ogni problema e ogni dubbio, con la sua soluzione

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Tre parti: i problemi trovati nel vecchio Mastercook, i dubbi rimasti aperti negli audit, i dubbi nati da questo progetto. Per ognuno: com'è risolto nella 2.0 e dove si verifica.

---

## A. I 15 problemi verificati nel vecchio Mastercook

1. **Modifiche simultanee perse sulle portate** (due portate aggiunte insieme, ne resta una).
   Soluzione: ogni portata è una riga con il suo id; aggiungere è un inserimento, mai la riscrittura di un elenco. Test T-SYN-1.

2. **Origini delle righe della spesa perse** con due modifiche insieme.
   Soluzione: le voci derivate sono calcolate dal menu, non salvano elenchi di origini; le voci manuali sono righe separate. Test T-SPE-5, T-SYN-2.

3. **Doppio carico** (spunta del latte + scontrino = 2 l).
   Soluzione: spuntare mette solo nel carrello; carica solo la conferma d'acquisto; lo scontrino si abbina alle righe già confermate e aggiunge i prezzi. Test T-ACQ-4.

4. **Annullo incoerente** (l'articolo sparisce ma il carico resta nello storico).
   Soluzione: l'annullo genera movimenti opposti; la quantità torna e lo storico mostra carico e annullo. Test T-ACQ-6.

5. **«Ho cucinato» eseguito due volte scarica due volte.**
   Soluzione: conferma del pasto con id di comando e una sola conferma attiva per pasto. Test T-CON-2, T-CON-3.

6. **Manca la conferma del pasto consumato.**
   Soluzione: entità `conferma_pasto` con le sei domande del prompt e le correzioni a differenza. Test T-CON-4…7.

7. **Lista con fabbisogno vecchio** (la portata tolta lascia i suoi ingredienti in lista).
   Soluzione: fabbisogno ricalcolato a ogni modifica; le voci già nel carrello diventano «non più necessaria» e decide l'utente. Test T-SPE-3.

8. **Lotti fusi** (due yogurt con date diverse diventano uno).
   Soluzione: un lotto per data; nessuna fusione automatica. Test T-CAS-2.

9. **Unità confuse** (10 capsule di caffè contate come 10 g).
   Soluzione: dimensione per ingrediente e vincolo sulle unità; conversioni solo esplicite; correzione delle due voci all'importazione. Test T-UNI-2, T-UNI-3.

10. **Quantità inventate** (una spunta senza quantità carica 500 g).
    Soluzione: quantità `NULL` dichiarata come «da indicare», vincoli nel database. Test T-UNI-4.

11. **Versione dello schema scritta ma mai letta.**
    Soluzione: versione minima dell'app controllata dal server a ogni comando; sola lettura per le app vecchie. Test T-SYN-5.

12. **Tablet in pausa dopo circa due ore** (rinnovo del permesso Google una volta sola).
    Soluzione: sessione Supabase con rinnovo automatico, indipendente dal permesso di Google Drive, che non serve più. Prova di 8 ore in Fase 1.

13. **Copia su Firebase bloccata da due scritture incrociate.**
    Soluzione: non c'è più una copia: il database applica ogni comando in una transazione e non può restare a metà. Test T-SYN-4.

14. **Caricamenti su Drive senza controllo di versione.**
    Soluzione: Drive non è più usato per i dati; le modifiche alla stessa riga portano la versione attesa. Test T-SYN-6, T-SYN-7.

15. **Intolleranze salvate ma ignorate.**
    Soluzione: un'unica tabella di vincoli con allergie, intolleranze ed esigenze, tutte lette dal filtro delle ricette e dal generatore. Test T-VIN-3.

---

## B. Altri difetti di struttura segnalati negli audit

- **«Preso» voleva dire insieme «nel carrello» e «in casa».** Soluzione: quattro stati distinti per la spesa e un acquisto separato.
- **Il fabbisogno veniva copiato nella lista.** Soluzione: calcolato, mai copiato.
- **Azioni sulle portate per posizione nell'elenco.** Soluzione: azioni per id.
- **PWA che si aggiorna solo con un tocco**, due versioni diverse insieme. Soluzione: controllo all'apertura e ogni ora, aggiornamento automatico sul tablet, blocco in sola lettura per le versioni vecchie.
- **Il tipo di data riscritto in «entro» da una schermata.** Soluzione: tipo di data salvato con la sua fonte; una data della confezione non si cambia senza un'azione esplicita. Test T-SCA-1.
- **Nessun test d'interfaccia, del ciclo di sincronizzazione completo, delle migrazioni.** Soluzione: Playwright, simulatore di dispositivi, test per ogni migrazione (file 05).
- **Il primo avvio prometteva ricette «sempre sicure per le allergie».** Soluzione: nessuna promessa di sicurezza; «adatta» solo con dati completi, altrimenti «da verificare».

---

## C. Dubbi rimasti aperti negli audit precedenti

1. **Dimensione e forma dei dati reali della famiglia.**
   Soluzione: non incidono sull'architettura nuova. Si misurano in Fase 7 con la prova a secco della migrazione, che produce un rapporto prima di scrivere.

2. **Rinnovo silenzioso del permesso Google su Android e iPad.**
   Soluzione: non serve più, l'accesso Google si usa solo per entrare; poi vale la sessione di Supabase. Resta una prova di 8 ore.

3. **Quote gratuite di Firebase con l'uso reale e con le foto.**
   Soluzione: Firebase non si usa. Le quote di Supabase sono ampie per una famiglia; l'app mostra lo spazio usato e avvisa all'80%.

4. **Dispositivi non aggiornati in giro.**
   Soluzione: sola lettura automatica con invito ad aggiornare; i comandi in coda non si perdono.

5. **Chi svilupperà e quanto tempo serve a te.**
   Soluzione: sviluppo in sessioni di Claude Code; a te spettano revisione delle PR e prove sui dispositivi, indicate fase per fase nel file 06 con il tempo previsto.

6. **Comportamento dell'interfaccia su dispositivi reali**, visto finora solo nel browser.
   Soluzione: test Playwright a misura di telefono e tablet a ogni PR, più lista di prove reali per fase.

7. **Abitudine della famiglia a confermare acquisti e pasti.**
   Soluzione: conferma con un tocco dalla schermata Oggi; promemoria dopo i pasti; carrello confermabile in blocco; correzioni facili. Si misura quante conferme mancano e lo si mostra.

---

## D. Dubbi nati da questo progetto

1. **Privacy: Supabase non è cifrato end-to-end.**
   Soluzione proposta: accettarlo (D2), con regione UE, dati minimi, separazione per famiglia verificata dai test, chiave di servizio mai nel codice. Se non lo accetti, l'alternativa è cifrare solo i campi più sensibili (note mediche, testo delle indicazioni del dietista) sul dispositivo, che il server non deve leggere: costa circa 2–3 giornate in più e lascia intatte le regole d'integrità.

2. **Pausa del progetto Supabase dopo 7 giorni senza accessi** (per esempio durante le vacanze).
   Soluzione: un'azione della CI che ogni 3 giorni fa una richiesta leggera; i dati non si perdono comunque in pausa, il progetto si riattiva dalla console.

3. **Supabase potrebbe cambiare le condizioni gratuite.**
   Soluzione: schema e funzioni sono Postgres standard; l'esportazione JSON documentata permette di spostarsi; avviso con almeno 30 giorni di margine dalle comunicazioni del fornitore.

4. **Conflitti offline scoperti solo dopo.**
   Soluzione: dichiarato prima (file 04); compaiono in «Da sistemare» con una domanda; le scorte non hanno conflitti perché sono somme.

5. **Fabbisogno offline non aggiornato.**
   Soluzione: la lista mostra l'ora dell'ultimo aggiornamento; al ritorno della rete si ricalcola.

6. **Scontrini con descrizioni abbreviate.**
   Soluzione: schermata di revisione; abbinamenti imparati per negozio e descrizione; Gemini facoltativo.

7. **Prezzi stimati scambiati per certi.**
   Soluzione: quattro etichette (verificato, storico, stimato, mancante) e il totale con il numero di voci senza prezzo.

8. **Regole di conservazione non validate da un professionista.**
   Soluzione: etichetta «indicativa»; valori prudenti; possibilità futura di farle validare (D8).

9. **Riconoscimento da foto inaffidabile.**
   Soluzione: solo proposte con affidabilità, nulla entra senza conferma, alternativa manuale; arriva in Fase 6, dopo che il resto è solido.

10. **Le stime di tempo possono saltare.**
    Soluzione: fasi piccole con criteri d'uscita; la versione per l'uso quotidiano arriva prima delle funzioni intelligenti; ogni fase ha una stima rivista alla fine della precedente.

11. **Repository vuoto: serve un ramo principale per le PR.**
    Soluzione: primo commit con soli documenti e README su `main` (D9).

12. **Doppio uso del vecchio e del nuovo durante la transizione.**
    Soluzione: dati separati; nessuna sincronizzazione tra i due; migrazione unica in Fase 7 con ritorno indietro.
