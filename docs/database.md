# Database

Fonte unica dei dati condivisi: Postgres su Supabase. Progetto completo in `docs/fase-0/`.

## Regole

- Le tabelle si **leggono** con le regole per riga: ognuno vede solo le famiglie di cui fa parte.
- Le tabelle **non si scrivono** mai direttamente. Ogni modifica è un comando applicato da
  `public.applica_comando(comando)` (o `public.entra_con_invito(comando)` per entrare con un invito).
- Ogni riga condivisa ha `versione`, `versioni_campi` (versione in cui ogni campo è cambiato l'ultima volta),
  `creato_il/da`, `modificato_il/da`, `eliminato_il` (cancellazione logica) e `seq` (ordine delle modifiche).

## Forma di un comando

```json
{
  "id": "uuid scelto dal dispositivo, uguale in ogni ritentativo",
  "famiglia_id": "uuid",
  "tipo": "aggiungi_membro",
  "dati": { "id": "uuid", "nome": "Sara" },
  "versione_app": 1,
  "dispositivo": "tablet-cucina"
}
```

## Esiti

- `applicato`: scritto. Con `ripetuto: true` se lo stesso id era già stato applicato: nessun nuovo effetto.
- `conflitto`: qualcun altro ha cambiato la stessa cosa; `dettaglio` dice cosa e il valore attuale. Nulla è scritto.
- `rifiutato`: dati o stato non validi (`dettaglio.motivo`). Nulla è scritto.
  Con `transitorio: true` (`non_autenticato`, `app_da_aggiornare`) il comando non è registrato
  e si può ripresentare con lo stesso id quando la causa è risolta.

Conflitti e rifiuti non transitori sono registrati: ripresentare lo stesso id restituisce lo stesso esito.

## Modifiche per campi

I comandi `modifica_*` portano `versione_attesa` (la versione della riga vista dal dispositivo) e `campi`.
Per ogni campo: se il valore è già quello, niente; se nessuno l'ha cambiato dopo `versione_attesa`, si scrive;
altrimenti è un conflitto e non si scrive nulla. Campi diversi cambiati da due dispositivi si uniscono.

## Comandi della Fase 1

| Tipo | Dati | Chi |
|---|---|---|
| `crea_famiglia` | `nome`, `membro: {id, nome, emoji}` | chiunque abbia fatto l'accesso |
| `modifica_famiglia` | `versione_attesa`, `campi: {nome, impostazioni}` | amministratore |
| `aggiungi_membro` | `id`, `nome`, `emoji`, `porzione`, `note` | membro |
| `modifica_membro` | `id`, `versione_attesa`, `campi: {nome, emoji, porzione, note, archiviato}` | membro |
| `aggiungi_vincolo` | `id`, `membro_id`, `tipo`, `oggetto`, `severita`, `fonte`, `testo` | membro |
| `rimuovi_vincolo` | `id` | membro |
| `crea_invito` | `id`, `giorni` (1–30), `usi_massimi` (1–20) → `codice` | amministratore |
| `revoca_invito` | `id` | amministratore |
| `rimuovi_accesso` | `id` di `utente_famiglia` | amministratore (non l'ultimo) |
| `entra_con_invito` | `codice`, `membro: {id, nome, emoji}` (via `entra_con_invito`) | chi ha il codice |

## Comandi della Fase 2: ricette e casa

I comandi sono registrati in `interno.tipo_comando` (tipo → funzione); tutti richiedono di essere membri.

| Tipo | Dati |
|---|---|
| `crea_ingrediente` | `id`, `nome`, `dimensione` (massa/volume/pezzi), `reparto`, `allergeni`, `allergeni_noti`, `emoji` |
| `modifica_ingrediente` | `id`, `versione_attesa`, `campi` |
| `salva_ricetta` | `id`, `nuova?`, `versione_attesa?`, `campi`, `ingredienti` e `passi` come `{aggiungi, modifica: [{id, versione_attesa, campi}], rimuovi}` |
| `elimina_ricetta` | `id` |
| `aggiungi_lotto` | `id`, `ingrediente_id`, `quantita`, `unita`, `luogo`, date (vedi sotto), `nome`, `note` |
| `scarica_lotto` | `lotto_id`, `quantita`, `causale` (consumo/spreco/scaduto) |
| `correggi_lotto` | `lotto_id`, `quantita_vista`, `quantita_nuova` (conflitto `quantita_cambiata` se nel frattempo è cambiata) |
| `sposta_lotto` | `lotto_id`, `luogo`, `quantita?` + `nuovo_id?` (spostamento parziale), `stima?` |
| `modifica_lotto` | `id`, `versione_attesa`, `campi` (nome, note, date) |

Regole principali, tutte nel database e coperte da test (`tests/db/ricette.test.ts`, `tests/db/casa.test.ts`):

- **Catalogo di sistema** (id `ing:…`, `sys:…`, `famiglia_id` nullo): uguale a `src/catalogo/catalogo.json`,
  leggibile da tutti, non modificabile dall'app (`ricetta_di_sistema`). Per cambiarlo si crea «la mia versione».
- **Quantità** sempre in unità base (g, ml, pz) e coerenti con la dimensione dell'ingrediente
  (`unita_incompatibile`: «10 g di uova» non si salva). «q.b.» è `quantita` nulla con `qb = true`, mai un numero inventato.
- **Ricette per righe**: ingredienti e passaggi hanno ciascuno la loro versione; due persone che cambiano righe diverse
  non vanno in conflitto. Una ricetta ha sempre almeno un ingrediente e un passaggio.
- **Lotti e movimenti**: la quantità di un lotto è la somma dei suoi movimenti, aggiornata dal database; i movimenti
  non si modificano (`movimento_immutabile`) e hanno un id derivato dal comando, quindi un comando ripetuto non scala
  due volte. Sotto zero non si va (`quantita_insufficiente`); a zero il lotto si chiude.
- **Date** (`data_coerente`): `scadenza` e `tmc` vengono dalla confezione o dall'utente; `stimata` solo dall'app,
  con `calcolata_il`; `sconosciuta` senza data. Una data della confezione non viene mai sostituita da una stima
  (`data_confezione_protetta`). Le regole di stima sono indicative: vedi `src/dominio/scadenze.ts`.
- Un lotto si aggiunge solo a mano (`origine = manuale`) in questa fase: acquisti, scontrini e foto arrivano dopo.

## Comandi della Fase 3: menu della settimana

Migrazione `20261029000000_menu.sql`. Tabelle `categoria_pasto`, `portata`, `eccezione_membro`, `gusto`.
Il menu è un'**intenzione**: nessun comando del menu scrive lotti o movimenti (T-PIA, `tests/db/menu.test.ts`).

| Tipo | Dati |
|---|---|
| `imposta_categoria` | `chiave` (colazione/spuntino/pranzo/merenda/cena), `attiva` |
| `crea_categoria` | `id`, `nome`, `emoji`, `ordine` |
| `modifica_categoria` | `id`, `versione_attesa`, `campi` (nome, emoji, ordine, attiva); non per le standard (`categoria_standard`) |
| `aggiungi_portata` | `id`, `data`, `categoria` (chiave o id di una categoria della famiglia), `ricetta_id` **oppure** `testo`, `porzioni?`, `ordine?`, `note?` |
| `modifica_portata` | `id`, `versione_attesa`, `campi` (data, categoria, ricetta_id, testo, porzioni, bloccata, ordine, note) |
| `rimuovi_portata` | `id` (toglie anche le sue eccezioni) |
| `ripeti_portate` | `portate: [{da, id, data, categoria?}]`, `eccezioni: [{da, id, portata_id}]` → `{copiate, saltate}` |
| `imposta_eccezione` | `id`, `portata_id`, `membro_id`, `tipo` (non_mangia/alternativa), `ricetta_id?`, `testo?`, `porzioni?`, `versione_attesa?` |
| `rimuovi_eccezione` | `id` |
| `imposta_gusto` | `id`, `membro_id`, `ingrediente_id` **oppure** `ricetta_id`, `valore` (piace/non_piace), `versione_attesa?` |
| `rimuovi_gusto` | `id` |

- **Pasti senza tabella propria**: una portata sta in un pasto identificato da (`data`, `categoria`); più portate
  nello stesso pasto convivono, anche aggiunte nello stesso momento da due telefoni (T-SYN-1).
- **Porzioni** nulle = automatiche: le calcola l'app sommando la porzione di chi mangia il piatto
  (`src/dominio/menu.ts`). Un numero scritto a mano resta quello.
- **Eccezioni e gusti** sono uno per persona e portata (o per persona e alimento). Rimandare la stessa scelta è
  «già presente»; cambiarla senza aver visto quella di un altro è un conflitto (`eccezione_cambiata`, `gusto_cambiato`).
- `origine`: dall'app arrivano solo `manuale` e `ripetuta`; `automatica` è riservata alle proposte della Fase 6.
  `bloccata` dice alle proposte automatiche di non toccare quel piatto.
- Una ricetta usata nel menu non si elimina (`ricetta_nel_menu`): si archivia. Una persona tolta perde eccezioni e gusti.
- Riferimenti controllati dal database: ricetta di sistema o della famiglia, persona e ingrediente della famiglia,
  categoria esistente.

## Comandi della Fase 4: spesa e acquisti

Migrazione `20261030000000_spesa.sql`. Tabelle `voce_spesa`, `acquisto`, `acquisto_riga`.
La lista è un'intenzione, l'acquisto confermato è un fatto, la casa è lo stato che ne deriva.

| Tipo | Dati |
|---|---|
| `ricalcola_spesa` | `dal`, `al` (al massimo 31 giorni) → `{nuove, aggiornate, non_piu_necessarie}` |
| `aggiungi_voce` | `id`, `ingrediente_id` **oppure** `testo`, `quantita?`, `unita?`, `nota?` (voce manuale) |
| `modifica_voce` | `id`, `versione_attesa`, `campi` (quantita_scelta, quantita_richiesta solo per le manuali, unita, testo, nota) |
| `imposta_stato_voce` | `id`, `stato` (da_acquistare, nel_carrello, rimossa) |
| `conferma_acquisto` | `id`, `fonte` (carrello/manuale), `data`, `negozio?`, `righe: [{id, voce_id?, ingrediente_id?, nome?, quantita?, unita?, prezzo?, lotto_id, luogo, date…}]` |
| `annulla_acquisto` | `id` → `{gia_usati}` |
| `correggi_riga_acquisto` | `id`, `quantita_vista` + `quantita_nuova` e/o `prezzo` |

- **Fabbisogno** (`interno.fabbisogno_menu`, calcolato dal database e mai salvato): ingredienti delle portate del
  periodo × porzioni (automatiche come nell'app) ÷ porzioni della ricetta, comprese le alternative di chi mangia altro;
  esclusi «q.b.», facoltativi e ingredienti di base (sale, olio, pepe, aceto, acqua).
- **Da comprare** = fabbisogno − casa − ciò che è nel carrello o già in lista a mano. La casa copre prima gli ingredienti
  più specifici: gli spaghetti valgono come «pasta», non il contrario (T-SPE-9).
- Le voci derivate hanno chiave unica (ingrediente, unità) finché sono da comprare: dieci ricalcoli non creano doppioni
  (T-SPE-6). Le manuali non le tocca nessun ricalcolo (T-SPE-5).
- Se il menu cambia, una derivata non più utile sparisce solo se nessuno l'ha toccata; altrimenti, e sempre se è nel
  carrello, resta segnata `non_piu_necessaria` e decide la persona (T-SPE-3).
- **Stati**: da comprare → nel carrello (preso in negozio, da confermare) → acquistata; oppure rimossa. Il carrello
  è lo stato «acquistato da confermare» di Fase 0: nessuno dei due tocca la casa.
- **Solo `conferma_acquisto` crea lotti con origine `acquisto`** (T-ACQ-1). Lo stesso acquisto confermato due volte,
  anche con un comando diverso, carica una volta (T-ACQ-3). Una riga senza ingrediente (detersivo) non va in casa.
- **Annullare** scrive movimenti `annullo` opposti; se una parte è già stata usata si toglie solo quel che resta e lo
  si dice (`gia_usati`, T-ACQ-6/8). **Correggere** scrive un solo movimento di differenza (T-ACQ-7).
- **Prezzi**: nessuna tabella, sono le righe d'acquisto con un prezzo. L'app stima il costo di una voce con la mediana
  dei prezzi per unità degli ultimi 6 mesi e dice su quante voci manca il prezzo (`src/dominio/spesa.ts`, T-PRE).

## Comandi della Fase 4: scontrini e codici a barre

Migrazione `20261031000000_scontrini.sql`. Tabelle `scontrino`, `scontrino_riga`, `prodotto`; `acquisto.scontrino_id`.

| Tipo | Dati |
|---|---|
| `importa_scontrino` | `id`, `acquisto_id`, `data`, `negozio?`, `ora?`, `totale?`, `qr?`, `testo?`, `righe: [{id, descrizione, prezzo?, abbina?: acquisto_riga_id, nuova?: {id, ingrediente_id?, quantita?, unita?, lotto_id?, luogo?, date…}}]` → `{abbinate, nuove}` oppure `{gia_importato}` |
| `salva_prodotto` | `id`, `codice` (8–14 cifre), `ingrediente_id`, `nome?`, `quantita?`, `unita?` → `{}` oppure `{aggiornato: id}` |

- Lo scontrino si legge sul telefono (foto con Tesseract, o testo incollato: `src/dominio/scontrini.ts`) e una
  persona rivede ogni riga prima di importare. Il server non legge immagini.
- **Impronta** (`interno.impronta_scontrino`): il contenuto del QR se c'è, altrimenti negozio (solo lettere e cifre),
  data, ora e totale. È unica per famiglia: lo stesso scontrino importato di nuovo, anche da un altro telefono,
  risponde `gia_importato` e non cambia niente (T-ACQ-5).
- Una riga **abbinata** a una riga d'acquisto già confermata dal carrello le dà solo il prezzo: niente secondo carico
  (T-ACQ-4). Ogni riga d'acquisto ha al più una riga di scontrino (`riga_gia_abbinata`).
- Le righe **nuove** formano un acquisto con fonte `scontrino`; quelle con un ingrediente creano un lotto con origine
  `scontrino` e un movimento di carico (T-ACQ-2). Annullare quell'acquisto funziona come per gli altri.
- Le righe né abbinate né nuove (sacchetti, righe sbagliate) restano solo sullo scontrino.
- **Prodotti**: un codice a barre per famiglia, associato a un ingrediente con nome e formato della confezione;
  salvarlo di nuovo lo aggiorna. Per un codice nuovo l'app chiede a Open Food Facts nome e formato (parte solo il
  numero del codice) e la persona sceglie l'ingrediente.

## Comandi della Fase 5: conferma dei pasti e consumi

Migrazione `20261101000000_consumi.sql`. Tabelle `conferma_pasto`, `consumo_riga`, `consumo_lotto`; `lotto.conferma_id`;
ingrediente di sistema `ing:avanzo` (in porzioni).

| Tipo | Dati |
|---|---|
| `conferma_pasto` | `id`, `portata_id`, `esito` (come_previsto, quantita_diverse, altro_piatto, saltato), `revisione_attesa?` (per correggere), `ricetta_id?` + `porzioni?` o `testo?` (altro piatto), `righe?: [{ingrediente_id, unita, quantita}]`, `avanzi?: [{lotto_id, nome, quantita, luogo, date…}]`, `nota?` → `{revisione, movimenti, mancanti}` |
| `foto_pasto` | `id` (della conferma), `foto` (percorso nel deposito, o `null` per toglierla). Migrazione `20261102000000_foto_pasto.sql`; conferma sconosciuta → `conferma_non_trovata` |

- **Solo la conferma toglie dalla casa** (T-CON-1); il menu da solo non tocca niente. La portata non cambia mai per
  somigliare a ciò che è successo (T-CON-6).
- **Una sola conferma attiva per portata** (indice unico parziale e blocco della portata): la stessa conferma ripetuta
  non toglie due volte (T-CON-2); due dispositivi insieme → uno applica, l'altro riceve `gia_confermato` (T-CON-3).
- **Correggere** = una revisione nuova con `revisione_attesa`. Il database confronta ciò che è già stato preso per la
  portata (`consumo_lotto`) con il nuovo usato e sposta solo la differenza, un movimento per lotto (T-CON-4).
  «Saltato» come correzione restituisce tutto.
- **Previsto** (`interno.previsto_portata`): come la lista della spesa, piatto per porzioni (indicate o automatiche) più
  le alternative; senza «q.b.», facoltativi e ingredienti di base. `consumo_riga` tiene previsto e usato (T-CON-5).
- **Scarico**: dai lotti aperti che valgono come l'ingrediente (gli spaghetti valgono come pasta), prima quelli che
  scadono prima (T-CON-8). Ciò che in casa non c'era torna in `mancanti`, senza inventare quantità.
- **Avanzi**: lotti `ing:avanzo` in porzioni, origine `avanzo`, legati alla conferma; in frigo la data è stimata dalla
  regola dei cotti della ricetta (giorni consigliati), altrimenti resta sconosciuta.
- **Foto del piatto**: facoltativa, dopo la conferma; stesso deposito e stesse regole delle foto delle ricette, e solo
  foto della propria famiglia. Non tocca la casa. Come le foto delle ricette, non è nell'esportazione.
- **Ricette per ciò che scade** (R-SCA-5, nell'app, `ricettePerUrgenti`): in Oggi, sotto «Da usare presto», fino a tre
  ricette che usano quei prodotti, prima chi ne usa di più e poi chi ha più ingredienti in casa; escluse quelle non
  adatte a qualcuno della famiglia. «Stasera» le mette a cena con `aggiungi_portata`.
- **Avvisi**: dentro l'app, come numeri sulle schede (Casa: prodotti scaduti o da usare oggi; Oggi: pasti dei tre giorni
  prima da confermare). Le notifiche push del telefono non ci sono: servirebbero un servizio di invio e il consenso a
  ogni dispositivo, e restano per una fase successiva.

## Icone delle ricette

Migrazione `20261103000000_icone.sql`. Tabella `icona_ricetta`: al più un'icona per ricetta e famiglia, anche per le
ricette di Mastercook. Senza, l'app usa l'icona dell'ingrediente principale (`iconaRicetta`; per dolci e colazioni
quella della categoria).

| Tipo | Dati |
|---|---|
| `scegli_icona` | `id`, `ricetta_id`, `emoji` (un'emoji; `null` torna all'automatica). Ripetuto non scrive di nuovo; ricetta di un'altra famiglia → `ricetta_non_trovata` |

## Esigenze sui crudi

Solo nell'app (`src/dominio/crudi.ts`), nessuna tabella nuova: le esigenze `cls:no_salumi_crudi`, `cls:no_pesce_crudo`,
`cls:no_carne_cruda`, `cls:no_latte_crudo`, `cls:no_uova_crude` guardano **come la ricetta usa l'ingrediente**. Le
ricette di Mastercook sono state lette una per una: è segnato quali ingredienti restano crudi (il formaggio grattugiato
sopra o mantecato a fuoco spento conta come crudo; il guanciale rosolato no). Crudo e obbligatorio → non adatta;
facoltativo, o un prodotto che può essere sia a latte crudo sia pastorizzato (feta, pesto, asiago…) → da verificare.
Nelle ricette della famiglia l'app non sa se si cuoce: da verificare. Scritti a parole, i vincoli restano da verificare
su tutte le ricette; l'app lo spiega e propone queste esigenze.

## Foto delle ricette

Deposito privato `foto` di Supabase Storage (migrazione `20261028000300_foto.sql`): percorso `<famiglia>/<uuid>.jpg`,
massimo 2 MB, JPEG o WebP. Leggono e scrivono solo i membri della famiglia (`tests/db/foto.test.ts`).
L'app riduce la foto a 1280 px, la tiene sul dispositivo e la carica **prima** del comando che la cita,
anche più tardi se manca la rete (`tests/sync/sincronizzazione.test.ts`). Una foto non si sostituisce senza conferma.

## Scaricare le modifiche

`public.scarica_modifiche(famiglia, dopo, limite)` restituisce `{ righe: [{tabella, seq, riga}], altre }`
con tutte le righe della famiglia con `seq > dopo`, in ordine. Il dispositivo salva le righe e poi avanza
il cursore all'ultimo `seq` ricevuto. Le scritture di una famiglia sono serializzate da un lock, quindi
una riga con `seq` più basso non può comparire dopo: nessuna riga viene saltata (test in `tests/db/scarico.test.ts`).
