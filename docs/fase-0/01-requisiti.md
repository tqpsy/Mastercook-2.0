# 01 · Requisiti funzionali e criteri di accettazione

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Ogni requisito ha un codice (R-…) e uno o più criteri di accettazione (CA). I criteri marcati **[test]** diventano test automatici; quelli **[prova]** si verificano a mano su telefono e tablet reali.

---

## R-ACC · Accesso e famiglia

- R-ACC-1 Si entra solo con «Accedi con Google». Nessuna password, nessuna configurazione.
- R-ACC-2 Chi entra per primo crea la famiglia e ne è amministratore.
- R-ACC-3 L'amministratore invita con un link. Chi apre il link accede con Google ed entra nella famiglia senza altri passaggi.
- R-ACC-4 L'amministratore può togliere un accesso e annullare un invito.
- R-ACC-5 I dati di una famiglia non sono mai visibili a un'altra.
- CA: un utente di un'altra famiglia che conosce un id non legge né scrive nulla **[test]**; un invito scaduto o già usato al massimo non fa entrare **[test]**; un invitato è dentro in meno di 30 secondi dal tocco sul link **[prova]**.

## R-MEM · Membri, preferenze e vincoli

- R-MEM-1 Ogni membro ha nome, emoji, porzione abituale, note. Un membro può non avere un account.
- R-MEM-2 Gusti: alimenti e ricette gradite o non gradite, sempre modificabili, mai dedotti dai pasti.
- R-MEM-3 Vincoli: allergie (14 allergeni UE più ingredienti specifici), intolleranze, esigenze dichiarate (vegetariano, senza maiale…), indicazioni del medico o del dietista conservate con la loro fonte.
- R-MEM-4 Nessun dato non necessario: niente peso, altezza o data di nascita obbligatori.
- CA: una ricetta con un allergene vietato a un commensale non è mai proposta come adatta **[test]**; se un ingrediente non ha informazioni sugli allergeni, la ricetta è marcata «da verificare», non «sicura» **[test]**; due persone che aggiungono due vincoli diversi allo stesso membro nello stesso momento li trovano entrambi **[test]**.

## R-RIC · Ricette

- R-RIC-1 Consultare, cercare e filtrare per categoria culinaria (antipasto, primo, secondo, contorno, piatto unico, dolce, colazione), cucina, tempo, ingredienti disponibili, vincoli.
- R-RIC-2 Creare, modificare, duplicare, archiviare. Le ricette di sistema si duplicano per modificarle.
- R-RIC-3 Ingredienti con quantità numerica e unità esplicita, oppure «q.b.» dichiarato. Mai un numero inventato.
- R-RIC-4 Foto: scattare, scegliere dalla galleria, aggiungere, sostituire. Visibile nel calendario e nelle schede.
- R-RIC-5 Valutazioni 1–5 per membro, note di famiglia, tag.
- R-RIC-6 Informazioni nutrizionali solo da fonti attendibili dichiarate; altrimenti assenti.
- CA: salvare una ricetta con una quantità senza unità è impossibile **[test]**; una foto nuova non sostituisce quella esistente senza conferma **[test]**; una ricetta usata in pasti passati non si cancella, si archivia **[test]**.

## R-CAS · Casa: frigorifero, freezer, dispensa

- R-CAS-1 Ogni prodotto in casa è un lotto: nome, ingrediente, quantità e unità, luogo, data di acquisto, data limite e suo tipo, origine del dato, affidabilità, note.
- R-CAS-2 Origini: manuale, acquisto confermato, scontrino, foto, avanzo, stima dell'app.
- R-CAS-3 Lotti con date diverse restano separati.
- R-CAS-4 Correzioni di quantità, spreco, scaduto, eliminato: ognuna lascia un movimento nella cronologia.
- CA: due yogurt con date diverse restano due righe **[test]**; la quantità di un lotto è sempre la somma dei suoi movimenti **[test]**; nessun lotto nasce con una quantità non inserita da qualcuno **[test]**.

## R-SCA · Scadenze e anti-spreco

- R-SCA-1 Tipo di data: «da consumarsi entro» (scadenza), «preferibilmente entro» (TMC), stimata, sconosciuta.
- R-SCA-2 Una data letta dalla confezione non è mai sostituita da una stima.
- R-SCA-3 Stime solo per alimenti con regola documentata (verdura fresca, sfuso, cotti), marcate come stima, con data del calcolo, modificabili, dipendenti dal luogo.
- R-SCA-4 Senza regola: «scadenza sconosciuta» e invito a inserirla.
- R-SCA-5 Vista «Da usare presto»: urgenti, data vicina, senza data verificata, scaduti secondo la data registrata, ricette che li usano.
- R-SCA-6 Nessuna dichiarazione di sicurezza oltre la data.
- CA: un prodotto confezionato senza data resta «sconosciuta», non stimato **[test]**; la stima della stessa insalata è più breve in dispensa che in frigo **[test]**; un TMC superato è mostrato «oltre il preferibilmente», una scadenza superata «scaduto» **[test]**.

## R-MEN · Menu settimanale

- R-MEN-1 Categorie: colazione, pranzo, cena attive all'inizio; spuntino, merenda e personalizzate attivabili.
- R-MEN-2 Tre viste: griglia settimanale, schede giornaliere, panoramica con dettaglio del giorno. Si cambia dal calendario; la scelta è salvata per dispositivo.
- R-MEN-3 Più portate per pasto; porzioni modificabili; eccezioni per membro («non mangia», «alternativa»).
- R-MEN-4 Spostare un pasto o una portata, ripetere la settimana precedente, alternative per un singolo pasto.
- R-MEN-5 Pianificazione manuale, automatica, mista: le scelte manuali non sono mai sovrascritte.
- CA: aggiungere, cambiare, spostare o togliere portate non crea movimenti **[test]**; A e B aggiungono due portate diverse alla stessa cena: dopo la sincronizzazione ci sono entrambe **[test, obbligatorio]**; rigenerare la settimana non tocca le portate manuali o bloccate **[test]**.

## R-GEN · Generazione del menu

- R-GEN-1 Ordine dei criteri: vincoli, esigenze, disponibilità, scadenze, preferenze, varietà, tempo, costo, mancanti, equilibrio.
- R-GEN-2 Niente combinazioni poco plausibili solo per smaltire.
- R-GEN-3 Mai presentato come dieta clinica.
- CA: nessuna proposta viola un vincolo **[test]**; a parità di criteri precedenti, preferisce la ricetta che usa un lotto in scadenza **[test]**; la stessa ricetta non compare più di N volte in una settimana (N in impostazioni) **[test]**.

## R-SPE · Fabbisogno e lista della spesa

- R-SPE-1 Fabbisogno = ingredienti delle portate nell'orizzonte × porzioni effettive − scorte in casa − acquisti nel carrello o acquistati e non ancora confermati.
- R-SPE-2 Aggregazione solo tra unità compatibili; unità incompatibili restano righe separate.
- R-SPE-3 Ciò che è solo previsto per un acquisto futuro non conta come disponibile.
- R-SPE-4 Stati visibili: da acquistare, nel carrello, acquistato da confermare, acquisto confermato; etichetta «aggiunta a mano».
- R-SPE-5 Voci diventate inutili dopo un cambio del menu: restano visibili come «non più necessaria», soprattutto se nel carrello. L'utente decide.
- R-SPE-6 Aggiungere a mano, modificare quantità, eliminare, spuntare in negozio, confermare, annullare o correggere un acquisto, cronologia.
- CA: ricalcolare 10 volte non crea righe nuove **[test]**; 2 ricette con 200 g + 300 g di pasta danno 500 g **[test]**; 2 uova + 100 g di uova restano due righe se non c'è conversione **[test]**; spostare nel carrello non cambia la casa **[test]**; togliere dal menu una portata il cui ingrediente è nel carrello mostra «non più necessaria» **[test]**.

## R-ACQ · Acquisti e scontrini

- R-ACQ-1 Solo la conferma di un acquisto crea lotti.
- R-ACQ-2 Un acquisto ha una fonte (carrello, scontrino, manuale) e, se c'è, lo scontrino.
- R-ACQ-3 Scontrino: foto, lettura (descrizione, quantità, prezzi, sconti, data), schermata di revisione, abbinamento delle righe ai prodotti, conferma.
- R-ACQ-4 Lo scontrino non porta date di scadenza: si chiedono dopo, facoltative.
- R-ACQ-5 Annullare o correggere un acquisto produce movimenti opposti o di differenza, mai una cancellazione.
- CA: confermare due volte lo stesso acquisto carica una volta **[test]**; carrello confermato + scontrino della stessa spesa: lo scontrino aggiunge i prezzi alle righe già confermate e non carica di nuovo **[test]**; lo stesso scontrino importato due volte è riconosciuto **[test]**; annullare un acquisto riporta le scorte e lascia carico e annullo nella cronologia **[test]**.

## R-PRE · Prezzi e costi

- R-PRE-1 Prezzo verificato (da scontrino o inserito dall'utente per un acquisto), storico (verificati passati), stimato (calcolato da storici dichiarati), mancante.
- R-PRE-2 Stima del costo della spesa del menu solo con le voci che hanno un prezzo; le mancanti sono contate e mostrate.
- R-PRE-3 Nessun budget imposto; indicazione di alternative più economiche solo con dati.
- CA: il totale stimato riporta «su 12 voci, 4 senza prezzo» **[test]**; nessun prezzo mostrato per un ingrediente mai acquistato né inserito **[test]**.

## R-CON · Consumi e avanzi

- R-CON-1 Dopo un pasto l'app chiede: preparato? come previsto? ricetta diversa? quantità diverse? avanzi? saltato?
- R-CON-2 La conferma è legata al pasto; il piano non cambia per somigliare al reale.
- R-CON-3 Correzioni e annullo senza doppie sottrazioni.
- R-CON-4 Avanzi come lotti con regola di conservazione dei cotti.
- R-CON-5 Dopo la conferma, proposta facoltativa di foto del piatto.
- CA: confermare due volte lo stesso pasto, anche da due dispositivi, sottrae una volta **[test]**; correggere da 320 g a 200 g di pasta produce un movimento di +120 g, non un nuovo −200 g **[test]**; confermare «altro piatto» lascia la portata prevista intatta **[test]**.

## R-FOT · Foto del frigo e della dispensa

- R-FOT-1 Foto → proposte con affidabilità → conferma, correzione o scarto per ognuna → solo i confermati entrano.
- R-FOT-2 Mai sostituire l'inventario; segnalare i probabili doppioni con lotti esistenti.
- R-FOT-3 Quantità e date non visibili si chiedono.
- R-FOT-4 Alternativa manuale completa.
- CA: una foto con 5 proposte, 3 confermate, crea 3 lotti **[test]**; nessuna proposta entra senza conferma **[test]**.

## R-SYN · Sincronizzazione e offline

- R-SYN-1 Menu, ricette, casa e spesa condivisi tra i dispositivi della famiglia.
- R-SYN-2 Offline: consultare tutto; modificare con coda visibile.
- R-SYN-3 Nessuna perdita e nessuna duplicazione silenziosa; errori visibili e recuperabili.
- R-SYN-4 Un'app non aggiornata non scrive su dati di uno schema più nuovo.
- CA: i sei scenari della sezione 19 del prompt, più quelli del piano di test **[test]**; tablet acceso 8 ore riceve le modifiche del telefono senza interventi **[prova]**.

## R-DAT · Backup, ripristino, privacy

- R-DAT-1 Esportazione completa in formato documentato (JSON con versione dello schema).
- R-DAT-2 Ripristino in una famiglia vuota, verificato confrontando il contenuto.
- R-DAT-3 Migrazioni versionate, con discesa quando possibile.
- R-DAT-4 Nessun segreto nel codice pubblico.
- CA: esporta → ripristina in una famiglia nuova → esporta di nuovo: i due file coincidono, a parte gli id della famiglia **[test]**; ogni migrazione ha un test che la applica a dati della versione precedente **[test]**.

## R-UX · Esperienza d'uso

- R-UX-1 Schermata «Oggi»: cosa si mangia oggi, cosa usare presto, cosa manca, cosa comprare, cosa è da confermare.
- R-UX-2 Italiano, date e prezzi in formato italiano (lun 27 ott, 1,50 €), pulsanti grandi, pochi passaggi.
- R-UX-3 Conferma visibile per le azioni importanti, conferma esplicita per quelle irreversibili, errori con una strada per recuperare.
- R-UX-4 Nessun dato finto nell'app finale.
- CA: confermare la spesa dal carrello richiede al massimo 2 tocchi **[test Playwright]**; confermare un pasto «come previsto» richiede 1 tocco dalla schermata Oggi **[test Playwright]**.
