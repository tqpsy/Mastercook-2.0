# 07 · Recupero selettivo dal vecchio Mastercook

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Il repository `tqpsy/Mastercook` (commit `fc4e4dd` del 25 ottobre) è stato solo letto. Nessuna modifica, nessuna migrazione.

---

## 1. Cosa c'è di riutilizzabile [Fatto]

### Contenuti

- **209 ricette di sistema** in `src/rif/`: 35 classiche, 113 italiane regionali, 61 estere (cinese, giapponese, greca, indiana). Categorie: 55 secondi, 48 piatti unici, 40 primi, 23 contorni, 18 antipasti, 18 dolci, 7 colazioni. Ogni ricetta ha porzioni, minuti, difficoltà, ingredienti con quantità, passaggi, allergeni dichiarati, stagionalità, provenienza.
- **Tassonomia di circa 420 ingredienti** (`rif/ingredienti.ts`): reparto, unità (g, ml, pz), formato tipico, allergeni, classi per le restrizioni, genitore, durata indicativa.
- **14 reparti del supermercato** nell'ordine di un negozio.
- **Regole di conservazione dei cotti** (12 categorie più una prudente), con fonti: Ministero della Salute, USDA FoodKeeper, EFSA. Marcate nel vecchio progetto come «da validare».
- **Emoji** di ingredienti e membri.
- **Logo** (`masterfood/logo-masterfood-120.png`).

### Moduli puri, da rivedere prima di riprenderli

- Allergeni UE (`dominio/allergeni.ts`).
- Lettura del testo e del QR degli scontrini (`dominio/scontrino.ts`, `qrScontrino.ts`).
- Tesseract (`piattaforma/ocr.ts`), Gemini (`piattaforma/gemini.ts`), Open Food Facts (`piattaforma/openFoodFacts.ts`), fotocamera e compressione (`piattaforma/fotocamera.ts`).
- Lettura della dieta del dietista (`dominio/dieta.ts`, `menuDieta.ts`): utile in futuro per le indicazioni mediche, ma fuori dal perimetro iniziale.

### Da non riprendere

Modello dati, sincronizzazione (Yjs, Drive, Firebase), inventario, lista della spesa, conferme, cifratura del documento, account basati su Drive.

---

## 2. Verifiche prima di importare i contenuti (Fase 2)

Uno script di importazione, nel nuovo repository, legge i file del vecchio progetto e produce le righe di sistema solo se superano tutti i controlli. Ogni scarto è elencato in un rapporto.

1. Ogni ingrediente di ogni ricetta esiste nella tassonomia.
2. Ogni quantità è un numero > 0 con un'unità compatibile; i casi «q.b.» diventano `NULL` con `qb = true`, mai un numero.
3. Correzioni già note: capsule di caffè e ostriche contate in grammi invece che in pezzi.
4. Le categorie culinarie sono quelle sette; nessuna nuova inventata.
5. Allergeni della ricetta = dichiarati ∪ quelli degli ingredienti; differenze segnalate.
6. Slug unici e stabili: la ricetta `carbonara` resta `sys:carbonara` per sempre.
7. Le regole di conservazione restano marcate «da validare» nell'app finché nessun professionista le conferma.

Criterio: rapporto con 0 errori bloccanti, e tu rivedi l'elenco degli scarti.

---

## 3. Dati reali della famiglia (Fase 7, non ora)

I dati reali stanno nel documento Yjs cifrato sul Drive e nella copia su Firebase. Procedura proposta, da eseguire solo dopo i criteri di accettazione:

1. **Esportazione** dal vecchio Mastercook con la sua funzione «I miei dati» (JSON già esistente). Il vecchio progetto non si modifica: se l'esportazione non bastasse, scrivo uno strumento separato che legge il JSON, non il repository.
2. **Copia di sicurezza** del file esportato, conservata da te.
3. **Conversione** con uno script nel nuovo repository: ricette personali, membri, vincoli, gusti, lotti in casa con le loro date. Il menu passato e la cronologia diventano solo consultazione.
4. **Prova a secco:** la conversione produce un rapporto (quante ricette, quanti lotti, cosa è scartato e perché) senza scrivere nulla.
5. **Importazione** in una famiglia nuova, separata da quella di prova.
6. **Verifica:** conteggi e somme confrontati con il vecchio (numero di ricette, quantità per ingrediente, date di scadenza).
7. **Ritorno indietro:** se qualcosa non torna, si cancella la famiglia nuova; il vecchio Mastercook è intatto e si continua a usarlo.
8. **Periodo parallelo:** il vecchio resta disponibile finché tu non confermi di non averne più bisogno.

Regole: nessuna quantità inventata durante la conversione (le righe senza quantità entrano come «quantità da indicare»); le portate del vecchio menu, salvate come elenco, diventano righe con id deterministici.
