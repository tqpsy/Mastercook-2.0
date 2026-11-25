# Scontrini, passo 3: un formato intermedio con le coordinate

Appunti per chi riprende il lavoro (una chat nuova, un'altra persona). Il contesto, le misure e come provare sono in
[valutazione-scontrini.md](valutazione-scontrini.md); qui c'è solo il piano del passo 3 e ciò che si è imparato.

## Perché

Oggi la lettura di uno scontrino fa questa strada:

```
foto ──► PaddleOCR (riquadri con posizione e fiducia) ──► impagina (paddle.ts) ──► unisciColonne (colonne.ts) ──► testo
PDF  ──► pdf.js (voci con posizione)                  ──► testoDaPagine (pdf.ts) ───────────────────────────────► testo
incollato ────────────────────────────────────────────────────────────────────────────────────────────────────► testo
                                                              testo ──► leggiScontrino (scontrini-righe.ts) ──► righe
```

Tutto passa da un **testo piatto** e `leggiScontrino` lo rilegge con le sue regole. Si perdono posizione e fiducia, e ci sono due logiche
parallele per le stesse righe (`impagina` e `unisciColonne` da una parte, `leggiScontrino` dall'altra: `DA_SALTARE`, `PEZZI`, `eFineRighe`
e i confronti sulle righe di totale si ripetono). I difetti più gravi trovati finora sono nati in quel passaggio:

- i prezzi sfasati di una riga (un nome senza prezzo rubava il prezzo della riga sotto): `impagina` assegnava i prezzi alle righe e non
  le righe ai prezzi;
- lo screenshot tagliato a sinistra (`OTALE COMPLESSIVO`): il totale non si riconosceva e non finivano mai le righe;
- il segno per letto come carattere cinese, le parole attaccate («GRANAROLOLT.1»), la tessera fedeltà in testa (`BENNET CLUB`).

Quasi ogni correzione è stata una regex in più dentro `leggiScontrino`.

## Dove si vuole arrivare

Un **formato intermedio di righe con le coordinate e la fiducia**, prodotto da tutte le sorgenti, e **un solo parser** che lavora su quelle:

- riquadri di PaddleOCR → righe (posizione e fiducia vere);
- voci del PDF (`pdf.ts`) → righe (posizione vera, fiducia piena);
- testo incollato → righe con coordinate sintetiche (una riga per linea, colonne dagli spazi).

Il testo resta come ingresso compatibile (`leggiScontrino(testo)`) finché il nuovo parser non dà gli stessi risultati.

## Come procedere: una PR per sotto-passo

1. **Tipi e adattatori**, senza cambiare il comportamento. Riquadri, PDF e testo diventano righe; il parser attuale riceve ancora il testo che ne
   ricava. Si vede che i numeri della misura non cambiano.
2. **Abbinamento nomi-prezzi nel parser geometrico.** Un prezzo appartiene alla riga di sinistra più vicina a lui; le colonne (prezzo unitario,
   totale di riga, IVA) si riconoscono dalla posizione, non dagli spazi; si tolgono le euristiche duplicate in `impagina` e `colonne`.
3. **La fiducia segnala le righe dubbie** (oggi la calcola il lettore e nessuno la usa). Va misurata: conta quante righe sbagliate in più si
   scoprono e quanti falsi allarmi aggiunge.

Ogni sotto-passo si ferma se un numero della misura peggiora. Non si riscrive tutto insieme: molte regole del codice attuale hanno un test e un
caso del corpus che le giustifica, e vanno spostate, non perse.

## Criteri per unire

- `npm run valuta:scontrini` (dentro `npm test`) non peggiora, e lint, tipi, build ed e2e dello scontrino (telefono e tablet) sono verdi.
- Per ogni sotto-passo che tocca il lettore: rifare la misura sulle foto (`npm run valuta:scontrini:foto -- --etichetta <nome> --varianti base
  --tesseract-locale <cartella>`, circa un'ora) e confrontarla con `tests/scontrini/rapporti/fase-3.json` con
  `node scripts/valuta-scontrini/confronta.mjs`. Punto di partenza: letture perfette 81%, righe giuste 96%, prezzi sbagliati senza avviso 24.
- Confrontare anche i casi arrivati dopo la fase 3: `iper-seriate-screenshot` (screenshot tagliato) e `iper-seriate-pdf`.

## Cosa si è imparato (da non rifare)

- **La misura va sul corpus intero, non su pochi scontrini.** Un «tutto a posto» dato su 16 scontrini non reggeva su uno screenshot: ogni
  scontrino che sbaglia deve entrare nel corpus, con la verità scritta guardando la carta (e controllata con la somma).
- **La scelta della lettura migliore per «punteggio» premiava la più completa, non la più giusta**: una lettura sbagliata con più righe e un
  totale batteva quella giusta. Non fidarsi di un conto che torna: prezzi scalati di una riga danno la stessa somma. Provata e scartata:
  scegliere per concordanza tra le candidate (peggio del punteggio sui dati veri).
- **Il ripiego Tesseract** sostituisce Paddle solo con prove forti (lettura povera, o conto che torna da solo quando quello di Paddle no).
- **La doppia lettura** (la stessa foto spostata di qualche punto) dà un segnale forte: le righe su cui le due letture concordano sono giuste
  nel 96%, quelle su cui divergono nel 17-23%. Non coglie gli errori sistematici uguali in entrambe (il carattere con lo zero barrato letto 8).
- **Gli scontrini digitali** (screenshot, PDF) hanno forme diverse da quelle di carta: il prezzo sulla riga del peso, la prima lettera tagliata, il
  segno per letto 大. I riquadri congelati di `tests/scontrini/casi/*/letture/*-scatole.json` permettono di provare l'impaginazione in secondi, senza
  browser.

## Per lavorare in questo ambiente

- `npm ci`; i test del dominio girano in pochi secondi; gli e2e hanno bisogno di Postgres (vedi `sviluppo.md`).
- La misura sulle foto serve Tesseract da `cdn.jsdelivr.net`, che qui è bloccato: si serve da `node_modules` e dal pacchetto npm
  `@tesseract.js-data/ita` (`npm pack`, `tar xzf`), come spiega il commento in testa a `scripts/valuta-scontrini/foto.mjs`.
- Mentre una misura sulle foto gira, **non modificare `src/` nella stessa cartella**: il server di sviluppo ricarica la pagina e la misura si
  rompe. Usare una cartella a parte (`git worktree add --detach`, con `node_modules` collegata) e due porte diverse.
- Le foto e i PDF veri non vanno nel repository se contengono dati che si possono usare (numeri di buoni, tessere, carte): si tengono solo le
  parole ripulite, come per `src/dominio/pdf-esempi`.
