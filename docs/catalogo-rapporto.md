# Rapporto d'importazione del catalogo

Generato da `scripts/importa-catalogo.mjs` leggendo `tqpsy/Mastercook@fc4e4dd` (solo lettura).
Catalogo versione 1.

## Esito

**0 errori bloccanti** · 2 avvisi da guardare.

## Conteggi

- Ingredienti: 419 (5 di dispensa di base), in 14 reparti.
- Ricette: 209. Per categoria: secondo 55, piatto_unico 48, primo 40, contorno 23, antipasto 18, dolce 18, colazione 7. Per cucina: italiana 148, cinese 15, giapponese 15, greca 15, indiana 16.
- Righe d'ingrediente: 1536, di cui q.b. 0.
- Regole di conservazione dei cotti: 12, **indicative, da validare** con un professionista.
- Ricette i cui allergeni dagli ingredienti aggiungono qualcosa ai dichiarati: 186. Nell'app valgono sempre dichiarati ∪ ingredienti.

## Correzioni applicate

- nessuna: le voci segnalate in Fase 0 (capsule di caffè, ostriche) sono già a pezzi nel vecchio catalogo e nessuna ricetta le usa in grammi.

## Errori bloccanti

- nessuno

## Avvisi

- `ing:ostriche`: misurato in pz, il genitore ing:frutti_mare in g: le quantità non si sommano
- `ing:caffe_capsule`: misurato in pz, il genitore ing:caffe in g: le quantità non si sommano

## Cosa non è stato importato

- Prodotti del vecchio catalogo (marche, formati, codici a barre): servono alla spesa, Fase 4.
- Gruppi alimentari della dieta e sinonimi Open Food Facts: fuori dal perimetro della Fase 2.
