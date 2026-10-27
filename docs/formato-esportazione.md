# Formato di esportazione `mastercook-2`

File JSON scaricato da **Impostazioni → I tuoi dati → Scarica un'esportazione**. Si prepara dal server,
così è sempre completo anche se il dispositivo non ha ancora scaricato tutto.

```json
{
  "formato": "mastercook-2",
  "versione_schema": 3,
  "esportato_il": "2026-10-27T10:00:00.000Z",
  "conteggi": { "famiglia": 1, "membro": 3, "vincolo_alimentare": 4 },
  "tabelle": {
    "famiglia": [{ "id": "…", "nome": "Casa Rossi", "impostazioni": {}, "…": "…" }],
    "membro": [{ "id": "…", "famiglia_id": "…", "nome": "Sara", "emoji": "👧", "porzione": 0.6, "note": null, "archiviato": false, "utente_id": null, "…": "…" }],
    "vincolo_alimentare": [{ "id": "…", "membro_id": "…", "tipo": "allergia", "oggetto": "all:arachidi", "severita": "evitare_anche_tracce", "fonte": "dichiarato", "testo": null, "…": "…" }]
  }
}
```

- Tabelle della versione 2: `famiglia`, `membro`, `vincolo_alimentare`, `ingrediente` (solo quelli della famiglia),
  `ricetta`, `ricetta_ingrediente`, `ricetta_passo` (solo della famiglia), `lotto`, `movimento`.
- Dalla versione 3 (Fase 3) anche il menu: `categoria_pasto`, `portata`, `eccezione_membro`, `gusto`.
  Il catalogo di sistema non c'è: è uguale per tutti e gli id `ing:…`/`sys:…` restano validi.
- Le foto non sono nel file (sono immagini nel deposito): le ricette ripristinate restano senza foto.
- Ogni riga è com'è nel database (campi descritti in `docs/database.md` e nelle migrazioni).
- Le righe cancellate non ci sono. Accessi, inviti e cronologia dei comandi non si esportano.
- `conteggi` permette di accorgersi di un file troncato o modificato.
- Quando lo schema cambia, `versione_schema` sale e il ripristino converte i file delle versioni precedenti.

## Ripristino

**Impostazioni → I tuoi dati → Ripristina da un file**, oppure dalla prima schermata.

- Crea sempre una **famiglia nuova**, mai sopra una esistente: l'originale, se esiste ancora, resta intatta.
- Gli id vengono rigenerati; i riferimenti tra righe (per esempio il membro di un'allergia) seguono.
- Chi ripristina diventa amministratore; i profili degli altri restano, scollegati dai loro account,
  e si ricollegano con un nuovo invito.
- I file delle versioni 1 e 2 si ripristinano ancora; versioni sconosciute sono rifiutate.
- Le portate e le eccezioni che citano una ricetta non più presente nel file si saltano.
- I movimenti si rigiocano in ordine, così la quantità di ogni lotto torna uguale.
- Il server ricontrolla tutto con gli stessi vincoli dei comandi: un file non valido non scrive nulla.
- Il ripristino è verificato da un test: esporta → ripristina → riesporta dà lo stesso contenuto
  (`tests/db/ripristino.test.ts`).
