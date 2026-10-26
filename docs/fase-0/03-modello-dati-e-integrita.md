# 03 · Schema concettuale dei dati e regole d'integrità

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Sono entità concettuali: in Fase 1 diventano tabelle Postgres con i vincoli indicati.

---

## 1. Principi

1. **Tre livelli separati.** Intenzioni (menu, lista), fatti (acquisti, conferme dei pasti, movimenti), stato (lotti in casa, derivato dai fatti).
2. **Ogni cosa che due persone possono modificare insieme è una riga a sé**, mai un elemento di un elenco salvato in un campo.
3. **Ogni effetto sulla casa nasce da un comando con id univoco**, e il database impedisce di applicarlo due volte.
4. **Le quantità sono numeri con unità**; quando mancano sono `NULL` e lo si dice, mai un valore predefinito.
5. **Ciò che si calcola non si copia**: il fabbisogno e la quantità di un lotto sono calcolati.

### Campi comuni

Ogni entità condivisa ha: `id` (UUID generato dal dispositivo), `famiglia_id`, `versione` (intero che cresce a ogni modifica), `creato_il`, `creato_da`, `modificato_il`, `modificato_da`, `eliminato_il` (cancellazione logica), `seq` (numero progressivo del server per la sincronizzazione).

---

## 2. Entità

### Famiglia e persone

- **famiglia**: nome, impostazioni condivise (categorie di pasto attive, orizzonte della spesa in giorni, ripetizioni massime di una ricetta a settimana).
- **utente_famiglia**: account Google ↔ famiglia, ruolo (`amministratore`, `membro`). Unico per (utente, famiglia).
- **membro**: nome, emoji, porzione abituale (moltiplicatore, es. 0,6), note, utente collegato (facoltativo).
- **vincolo_alimentare**: membro, tipo (`allergia`, `intolleranza`, `esigenza`, `indicazione_medica`), oggetto (allergene UE, ingrediente o classe come «carne»), severità (`evitare`, `evitare_anche_tracce`), fonte (`dichiarato`, `medico`, `dietista`), testo originale.
- **gusto**: membro, ingrediente o ricetta, valore (`gradito`, `non_gradito`). Unico per (membro, oggetto).
- **invito**: codice, scadenza, usi massimi, usi, creato da, revocato.

### Ingredienti, prodotti, unità

- **ingrediente**: nome, reparto, dimensione (`massa`, `volume`, `pezzi`), allergeni, classi, genitore, regola di conservazione indicativa, `di_sistema`.
- **conversione**: ingrediente, da unità, a unità, fattore, fonte, `stima` sì/no. Senza conversione le quantità non si sommano.
- **prodotto**: nome, marca, codice a barre, formato (quantità + unità), ingrediente, allergeni da etichetta.
- **Unità ammesse:** g, kg, ml, l, pz. Salvate in unità base (g, ml, pz). Vincolo: unità compatibile con la dimensione dell'ingrediente.

### Ricette

- **ricetta**: titolo, descrizione, categoria (`antipasto`, `primo`, `secondo`, `contorno`, `piatto_unico`, `dolce`, `colazione`), cucina, porzioni base (> 0), minuti preparazione, minuti cottura, difficoltà (1–3, facoltativa), origine (`sistema`, `famiglia`), derivata da, foto principale, regola di conservazione dei cotti, archiviata.
- **ricetta_ingrediente**: ricetta, ingrediente, quantità (> 0 o `NULL` con `qb = true`), unità, opzionale, testo, ordine.
- **ricetta_passo**: ricetta, ordine, testo.
- **ricetta_tag**, **nota_ricetta**, **valutazione** (membro, ricetta, 1–5; unica per coppia).
- **foto**: percorso nel deposito, miniatura, larghezza, altezza, byte, appartiene a (ricetta o conferma_pasto), stato (`in_caricamento`, `pronta`).

### Pianificazione

- **categoria_pasto**: nome, ordine, attiva. Id fissi per colazione, spuntino, pranzo, merenda, cena.
- **pasto**: data, categoria. Unico per (famiglia, data, categoria).
- **portata**: pasto, ricetta oppure testo libero, porzioni previste (> 0), origine (`manuale`, `automatica`, `ripetuta`), bloccata, ordine.
- **eccezione_membro**: portata, membro, tipo (`non_mangia`, `alternativa`), ricetta alternativa, porzioni. Unica per (portata, membro).
- **commensale_pasto** (facoltativa): chi mangia a quel pasto, se diverso da tutta la famiglia.

### Spesa

- **Fabbisogno:** non salvato. Funzione pura (sezione 4).
- **voce_spesa**: riga della lista con chiave stabile.
  - `tipo`: `derivata` (nata dal fabbisogno) o `manuale`.
  - per le derivate la chiave è (famiglia, ingrediente, unità base, periodo): unica, quindi un ricalcolo non può crearne una seconda.
  - quantità richiesta (per le derivate si aggiorna dal calcolo), quantità scelta dall'utente (facoltativa, prevale).
  - `stato`: `da_acquistare`, `nel_carrello`, `acquistata_da_confermare`, `confermata`, `rimossa`.
  - `non_piu_necessaria`: vero quando il fabbisogno è sceso a zero ma la voce era già nel carrello o oltre.
- **sessione_spesa**: negozio, iniziata da, iniziata il, chiusa il.
- **acquisto**: fonte (`carrello`, `scontrino`, `manuale`), data, negozio, totale, scontrino, stato (`confermato`, `annullato`), sostituito da (per le correzioni).
- **acquisto_riga**: acquisto, voce_spesa (facoltativa), ingrediente, prodotto, quantità + unità, prezzo totale, prezzo unitario, sconto, lotto creato.
- **scontrino**: foto, testo letto, negozio, data e ora, totale, impronta = hash(negozio, data, ora, totale). Unica per famiglia.
- **scontrino_riga**: descrizione letta, quantità, prezzi, sconto, abbinamento a `acquisto_riga` (al più uno per riga e viceversa).

### Prezzi

- **prezzo_osservato**: ingrediente, prodotto, negozio, data, prezzo per unità base, fonte (`scontrino`, `utente`). Ogni osservazione è una riga.
- Il tipo mostrato si calcola: **verificato** = osservato in questa spesa; **storico** = ultimo osservato, con data; **stimato** = mediana degli osservati dello stesso ingrediente negli ultimi 6 mesi, dichiarata come stima; **mancante** = nessuna osservazione.

### Casa

- **lotto**: ingrediente, prodotto, luogo (`frigo`, `freezer`, `dispensa`), data di acquisto, data limite, tipo di data (`scadenza`, `tmc`, `stimata`, `sconosciuta`), fonte della data (`confezione`, `app`, `utente`), calcolata il, affidabilità (`alta`, `media`, `bassa`), origine (`manuale`, `acquisto`, `scontrino`, `foto`, `avanzo`), acquisto_riga, note, chiuso.
- **movimento**: lotto, variazione (≠ 0, unità base del lotto), causale (`carico`, `consumo`, `spreco`, `scaduto`, `correzione`, `annullo`, `spostamento`), riferimento (acquisto_riga, consumo_riga, correzione), comando di origine, nota. Unico per (comando, lotto, causale). Mai modificato né cancellato.
- **Quantità di un lotto** = somma dei movimenti (vista materializzata o calcolo in lettura).

### Consumi

- **conferma_pasto**: pasto, revisione, esito (`come_previsto`, `quantita_diverse`, `altro_piatto`, `saltato`), ricetta effettiva (se diversa), confermata da, attiva. Una sola attiva per pasto.
- **consumo_riga**: conferma, ingrediente, quantità prevista, quantità usata, lotto scaricato.
- **avanzo**: è un lotto con origine `avanzo`, collegato alla conferma, con data limite dalla regola dei cotti.

### Proposte da foto

- **proposta_foto**: foto (temporanea), etichetta riconosciuta, affidabilità, quantità proposta (facoltativa), stato (`proposta`, `confermata`, `scartata`), lotto creato. Le proposte non toccano la casa.

### Storia e versioni

- **comando**: id (scelto dal dispositivo), famiglia, tipo, dati, autore, dispositivo, versione dell'app, ricevuto il, esito (`applicato`, `rifiutato`, `conflitto`), dettaglio. Chiave primaria = id. È anche la cronologia leggibile.
- **schema_migrazioni**: versione, applicata il, descrizione.
- **compatibilita**: versione minima dell'app che può scrivere.

---

## 3. Regole di cancellazione

- Ricetta usata in pasti passati o in conferme: si archivia, non si cancella.
- Pasto e portata: cancellazione logica, nessun effetto sulla casa.
- Lotto: non si cancella; si chiude con un movimento.
- Movimento: mai cancellato né modificato.
- Acquisto confermato: si annulla con movimenti `annullo`; una correzione crea un nuovo acquisto che sostituisce il precedente e genera solo le differenze.
- Membro: si archivia; la cancellazione definitiva è dell'amministratore, con conferma, e toglie anche vincoli, gusti ed eccezioni.
- Famiglia: cancellazione solo dall'amministratore, con esportazione proposta prima e conferma scritta.

---

## 4. Fabbisogno: come si calcola

Per l'orizzonte scelto (di default i prossimi 7 giorni):

1. Per ogni portata non cancellata: ingredienti della ricetta × (porzioni previste ÷ porzioni base), con le eccezioni dei membri applicate.
2. Si escludono gli ingredienti `opzionale` e `q.b.` dal calcolo delle quantità (compaiono come promemoria).
3. Si sommano per (ingrediente, unità base). Unità diverse senza conversione restano righe distinte.
4. Si sottrae la disponibilità: somma dei lotti aperti dello stesso ingrediente (o figli, es. spaghetti per pasta), già impegnata dalle portate precedenti nel tempo.
5. Si sottrae ciò che è `nel_carrello` o `acquistata_da_confermare`, perché è già in arrivo, ma non conta come disponibile per altri calcoli (per esempio il menu automatico).
6. Il risultato aggiorna la quantità richiesta delle voci derivate; non crea mai una seconda voce con la stessa chiave.

---

## 5. Regole d'integrità e come sono garantite

Ogni regola ha il meccanismo che la fa rispettare e il test che la verifica (codici nel piano di test, file 05).

### Pianificazione

- I1 Aggiungere un pasto non modifica la casa. *Meccanismo:* i comandi di pianificazione non hanno permesso di scrivere movimenti. *Test:* T-PIA-1.
- I2 Modificare una ricetta programmata non modifica la casa. *Test:* T-PIA-2.
- I3 Cambiare le porzioni non provoca consumi. *Test:* T-PIA-3.
- I4 Rimuovere un pasto non genera movimenti. *Test:* T-PIA-4.

### Lista della spesa

- I5 In lista non significa acquistato. *Meccanismo:* `voce_spesa` non ha collegamenti a lotti. *Test:* T-SPE-1.
- I6 Nel carrello non aumenta la casa. *Test:* T-SPE-2.
- I7 Cambiare il menu aggiorna il fabbisogno senza toccare gli acquisti confermati. *Meccanismo:* il ricalcolo scrive solo la quantità richiesta delle voci derivate; le voci nel carrello o oltre si marcano `non_piu_necessaria`. *Test:* T-SPE-3, T-SPE-4.
- I8 Le voci manuali sono indipendenti dal menu. *Test:* T-SPE-5.
- I9 Nessun doppione al ricalcolo. *Meccanismo:* chiave unica sulle voci derivate. *Test:* T-SPE-6.

### Acquisti

- I10 Solo la conferma crea lotti. *Meccanismo:* l'unico comando che inserisce lotti con origine `acquisto` è `conferma_acquisto`. *Test:* T-ACQ-1.
- I11 Fonte e scontrino registrati. *Test:* T-ACQ-2.
- I12 Nessun doppio carico. *Meccanismo:* id del comando unico; movimento unico per (comando, lotto, causale); scontrino unico per impronta; una riga di scontrino abbinata a una riga già confermata aggiunge solo il prezzo. *Test:* T-ACQ-3, T-ACQ-4, T-ACQ-5.
- I13 Correzioni e annulli espliciti con cronologia. *Test:* T-ACQ-6.

### Consumi

- I14 Solo una conferma sottrae. *Test:* T-CON-1.
- I15 Una conferma non genera due consumi. *Meccanismo:* una sola conferma attiva per pasto (indice unico parziale); comando idempotente. *Test:* T-CON-2, T-CON-3.
- I16 Correzione senza duplicati. *Meccanismo:* la revisione nuova genera solo i movimenti di differenza rispetto alla precedente. *Test:* T-CON-4.
- I17 Usato distinto da previsto. *Meccanismo:* `consumo_riga` tiene entrambe le quantità. *Test:* T-CON-5.

### Sincronizzazione

- I18 Inserimenti distinti non si cancellano. *Test:* T-SYN-1, T-SYN-2.
- I19 Nessuna doppia esecuzione per ritentativi. *Test:* T-SYN-3.
- I20 Sincronizzazione interrotta senza stati illeggibili. *Meccanismo:* un comando è una transazione; la copia locale si aggiorna a blocchi. *Test:* T-SYN-4.
- I21 Conflitti con regole esplicite. *Test:* T-SYN-6, T-SYN-7.
- I22 Errori visibili e recuperabili. *Test:* T-SYN-8.

### Dati

- I23 Quantità sempre numero + unità compatibile, o `NULL` dichiarato. *Meccanismo:* vincoli CHECK. *Test:* T-UNI-1…4.
- I24 Lotti con date diverse mai fusi. *Test:* T-CAS-2.
- I25 Una data dalla confezione non è mai sostituita da una stima. *Test:* T-SCA-1.
- I26 Un'app non aggiornata non scrive. *Meccanismo:* ogni comando porta la versione dell'app; il server rifiuta sotto la minima. *Test:* T-SYN-5.
