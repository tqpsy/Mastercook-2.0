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
