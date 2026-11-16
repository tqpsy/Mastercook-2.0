# Valutazione della lettura degli scontrini

Serve a rispondere con numeri, e non a occhio, a una domanda: **un intervento sulla lettura degli scontrini l'ha migliorata davvero?**
Si misura tutta la catena che porta lo scontrino in casa, riga per riga, confrontandola con la verità scritta a mano.

## Cosa si misura

Per ogni *lettura* (un testo, come quello che la schermata «Scontrino» riceve dalla foto) si confronta con la verità:

| Parte | Cosa si controlla | Dove si decide |
|---|---|---|
| Lettura | righe, prezzi, nomi, data, ora, totale | `leggiScontrino`, `ocr.ts`, `paddle.ts` |
| Campi della riga | pezzi e formato (peso, volume) letti dalla descrizione | `formatoDaDescrizione`, `PEZZI` |
| Prodotti | ingrediente suggerito e quantità che entrerebbe in casa | `suggerisciIngrediente`, `quantitaProposta` |
| Spunte | abbinamento alle righe già comprate | `abbinaRighe` |

I numeri principali (`riassumi` in `src/dominio/valutazione.ts`):

- **Letture perfette (al primo tentativo)**: tutte le righe giuste, nessuna in più, data, ora e totale giusti. È il numero che dice quanto l'import non richiede correzioni.
- **Letture sicure per la giacenza**: nessuna quantità sbagliata in casa, nessuna riga in più che entra in casa, nessun abbinamento sbagliato.
- **Righe giuste**, **data**, **ora**, **totale**, **pezzi**, **formato**, **ingrediente**, **quantità in casa**, **abbinamenti**: percentuali sulle righe (o sugli scontrini) in cui la verità prevede quel dato.
- **Stesso esito tra letture dello stesso scontrino**: stabilità. Ha senso nel livello «foto», dove lo stesso scontrino si legge più volte con piccole variazioni.
- **Errori**, dove meno è meglio: prezzi sbagliati *senza avviso*, righe perse, righe in più, quantità sbagliate in casa, abbinamenti sbagliati.
- **«Il conto torna» ma la lettura è sbagliata** (falso quadra): la lettura dichiara il totale in ordine, ma qualche riga è sbagliata, persa o in più (data e ora non contano: non fanno parte del conto). Oggi «quadra» fa vincere una lettura sull'altra (`punteggio` in `ocr.ts`): questo numero dice quanto è affidabile.

Un errore *segnalato* è meno grave di uno *silenzioso*: chi controlla vede il primo, il secondo arriva in casa. L'app segnala una riga quando non ha il prezzo, quando il prezzo è ricavato dal conto, oppure quando **le due letture della foto non coincidono** su di lei (`doppiaLettura.ts`).
- **Letture affidabili**: ogni errore che resta (riga sbagliata, riga persa, data, ora o totale) è segnalato. Non vuol dire che la lettura sia giusta, vuol dire che nessun errore passa inosservato: è il numero che misura la Fase 1.
- **Righe sbagliate non segnalate**, **righe perse non segnalate**, **data, ora o totale sbagliati non segnalati**: gli errori silenziosi, dove meno è meglio.
- **Righe giuste segnalate per prudenza** (falsi allarmi): ogni riga giusta segnalata costa un controllo inutile. Se i falsi allarmi crescono troppo la segnalazione non serve più.
Una quantità non letta è «mancata» (si scrive dopo, in «Da completare») e non è un errore di giacenza; una quantità diversa da quella vera lo è.

## Due livelli

1. **Testo** (`npm run valuta:scontrini`, fa parte di `npm test`): ogni testo già letto e *congelato* nel corpus passa dal parser e dalla conversione in prodotti. Deterministico, senza browser, pochi secondi. Misura parser, validazione, abbinamenti, quantità. È anche un **freno**: confronta con `tests/scontrini/base.json` e fallisce se una metrica peggiora o se una lettura prima perfetta non lo è più.
2. **Foto** (`npm run valuta:scontrini:foto`, a mano): legge le foto con il lettore vero dell'app (PaddleOCR, poi Tesseract) in Chromium, anche con piccole variazioni (JPEG più compresso, spostata, più piccola, storta, ombra). Misura anche la stabilità. Il rapporto va in `tests/scontrini/rapporti/`.

Le due misure sono complementari. Un cambiamento al parser o all'abbinamento si vede nel livello testo; un cambiamento a `ocr.ts`, alla preparazione della foto o al passaggio a un altro lettore si vede solo nel livello foto.

## Il corpus (`tests/scontrini/`)

```
tests/scontrini/
  casi/<id>/verita.json       la verità, scritta a mano (si committa)
  casi/<id>/letture/*.txt     testi già letti, congelati (si committano)
  casi/<id>/letture/<nome>-controllo.txt   la seconda lettura della stessa foto, accanto a <nome>.txt
  casi/<id>/letture/*-scatole.json   pezzi di testo di PaddleOCR, ricomposti come fa l'app
  casi/<id>/foto.jpg          la foto vera dello scontrino (si committa, vedi «Foto e dati personali»)
  base.json                   i numeri di adesso del livello testo (il freno)
  rapporti/<fase>.json        rapporti del livello foto, uno per fase, per confrontarli
  carica.ts                   caricamento e controlli di coerenza
```

Tre origini, dichiarate in ogni `verita.json`:

- `scontrino-reale` con `verita: "carta"`: uno scontrino vero della famiglia, con la verità scritta **guardando lo scontrino** (e controllata con le somme), mai l'uscita del lettore.
- `esempio-reale` con `verita: "ricavata"`: esempi veri già nel repo (Conad, Iper) la cui verità è ricavata dai testi e dal conto, non dalla carta. Valgono meno: i nomi potrebbero essere sbagliati in modo coerente con il lettore.
- `sintetico` con `verita: "costruzione"`: scontrini costruiti con trabocchetti noti (PROMO nel nome, date che non sono lo scontrino, formati, abbinamenti). La verità è esatta per costruzione. Servono a isolare un difetto; **non misurano la qualità su foto vere**: per quella servono scontrini veri.

### Foto e dati personali

Le foto degli scontrini veri stanno nel repository, così ogni sessione di lavoro le ritrova e le prove sono ripetibili. Sono state preparate così: orientamento applicato, **metadati EXIF (posizione GPS compresa) non copiati**, JPEG qualità 85 con le stesse dimensioni dell'originale. Uno scontrino può contenere il nome del negozio, la città, i numeri di carta fedeltà (di solito mascherati: `0420*******21`), il numero del documento e la firma elettronica: prima di aggiungerne uno guarda che non ci sia altro (nome del cliente, carta di pagamento in chiaro). Se il repository è pubblico queste informazioni sono pubbliche.

### Aggiungere uno scontrino vero

1. Crea `tests/scontrini/casi/<id>/` (un nome breve: `esselunga-2026-11-03`).
2. Metti la foto come `foto.jpg` nella cartella. Preparala come sopra (senza EXIF, JPEG ~85), e se vedi dati che non vuoi nel repository ritagliali o coprili.
   Un solo scontrino fotografato più volte (ritaglio diverso, sfondo diverso) è un caso per ogni foto: se in una foto manca il totale o la data, nel `verita.json` di quel caso ometti `totale` e `data` e il metro non li misura.
3. Scrivi `verita.json` **guardando lo scontrino**: negozio, data, ora, totale e ogni riga come è stampata (anche se si ripete), con il prezzo dopo gli sconti. Con `ingrediente` (id del catalogo) e `carico` (quanto dovrebbe entrare in casa; `null` se non si può sapere) si misura anche la conversione in prodotti; con `carrello` e `abbina` anche l'abbinamento alle spunte. Chiavi che mancano non si misurano. Il controllo `npm run valuta:scontrini` rifiuta una verità incoerente (righe che non fanno il totale, ingredienti inesistenti, unità sbagliate).
4. `npm run valuta:scontrini:foto -- --casi <id> --congela` legge la foto, la misura e salva i testi in `letture/`. Controlla i testi congelati prima di committarli: la lettura può contenere numeri di carta, di tessera o il nome del cliente.
5. `MC_AGGIORNA_BASE=1 npm run valuta:scontrini` per rifare la base, perché il corpus è cambiato.

## Confrontare le fasi

Ogni fase del lavoro sulla lettura:

1. prima di cominciare, il rapporto di partenza esiste già (`tests/scontrini/rapporti/fase-0-base.json` per le foto, `tests/scontrini/base.json` per il testo);
2. a fine fase `npm run valuta:scontrini:foto -- --etichetta fase-N` e `node scripts/valuta-scontrini/confronta.mjs tests/scontrini/rapporti/fase-0-base.json tests/scontrini/rapporti/fase-N.json` (esce con errore se una metrica peggiora);
3. `MC_AGGIORNA_BASE=1 npm run valuta:scontrini` per bloccare il miglioramento ottenuto nel livello testo, e si committano base e rapporto nello stesso PR.

Per confrontare davvero, i rapporti devono venire dalla stessa macchina e dallo stesso insieme di foto e di varianti: le foto sintetiche dipendono dai caratteri del computer e dal browser, e il rapporto lo registra in `ambiente`.

## Limiti da conoscere

- La conversione in prodotti si misura con `suggerisciIngrediente` e `quantitaProposta`; le scelte che la schermata fa in più (per esempio l'unità a pezzi per ciò che si conta) stanno dentro `Scontrino.tsx` e non sono ancora coperte. Estrarle in `src/dominio/` è un lavoro per la fase dei prodotti.
- Le righe ripetute non si uniscono («× 2», `unisciRipetute`): ogni riga stampata è una riga della verità.
- Con pochi scontrini veri i numeri sono un'indicazione, non una statistica. Più scontrini veri ci sono nel corpus, più si può fidare del risultato.

## Come è andata finora (misura sulle foto, 112 letture, 16 scontrini)

| | Fase 0 (partenza) | Dopo parser, prodotti, doppioni e lettore |
|---|---|---|
| Letture perfette al primo tentativo | 17% | **80%** |
| Righe giuste (nome e prezzo) | 78% | **96%** |
| Data e ora giuste | 32% e 29% | **91%** |
| Formato letto | 39% | **86%** |
| Ingrediente giusto | 67% | **88%** |
| Quantità in casa giusta | 39% | **75%** |
| Abbinamenti alle spunte giusti | 33% | **98%** |
| Prezzi sbagliati senza avviso | 384 | **24** |
| Quantità sbagliate che entrerebbero in casa | 32 | **3** |

I rapporti sono `tests/scontrini/rapporti/fase-0-base.json` e `fase-2.json`; `node scripts/valuta-scontrini/confronta.mjs` li confronta.
Cosa ha pesato di più: l'abbinamento dei nomi ai prezzi per ordine (regge le foto storte e ora ignora la tessera fedeltà in testa), il
formato letto con l'unità prima del numero e con gli zeri letti O, la data incollata all'ora, `PROMO` nel nome che non è uno sconto,
l'abbinamento alle spunte per parola intera (LATTE non è Lattuga), i non-alimenti che non diventano cibo, la doppia lettura che segnala
le righe dubbie e il ripiego Tesseract che non sostituisce più una lettura buona di Paddle.

I limiti noti: il carattere con lo zero barrato (Lidl) letto come 8, e le scatole di prezzi molto chiare che la rilevazione non vede
(Bennet su sfondo blu): in questi casi la lettura resta sbagliata ma segnalata, e si controlla riga per riga.
