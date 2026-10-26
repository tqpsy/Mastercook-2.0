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

## Comandi disponibili (migrazione 1)

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

## Scaricare le modifiche

`public.scarica_modifiche(famiglia, dopo, limite)` restituisce `{ righe: [{tabella, seq, riga}], altre }`
con tutte le righe della famiglia con `seq > dopo`, in ordine. Il dispositivo salva le righe e poi avanza
il cursore all'ultimo `seq` ricevuto. Le scritture di una famiglia sono serializzate da un lock, quindi
una riga con `seq` più basso non può comparire dopo: nessuna riga viene saltata (test in `tests/db/scarico.test.ts`).
