# Importazione dal vecchio Mastercook (Fase 7)

Porta i dati di una famiglia dal vecchio Mastercook (repo `tqpsy/Mastercook`, che non si modifica) al nuovo.
Codice: `src/dati/migrazione.ts` (conversione pura), `src/ui/Ripristino.tsx` (schermata), test in
`src/dati/migrazione.test.ts`, `tests/db/ripristino.test.ts` e `tests/e2e/famiglia.spec.ts`.

## Come si fa

1. Nel **vecchio** Mastercook: Impostazioni → I tuoi dati → **Scarica i dati (JSON)**. Tieni il file come copia di sicurezza.
2. Nel **nuovo**: Impostazioni → I tuoi dati → **Ripristina da un file** (oppure, alla prima apertura,
   «Hai un file di esportazione, anche del vecchio Mastercook? Caricalo») e scegli quel file.
3. **Prova a secco**: l'app mostra il rapporto senza scrivere nulla: cosa entra, cosa va ricontrollato,
   cosa resta fuori e perché. Chiede anche «Tu chi sei nel vecchio Mastercook?», così il tuo profilo resta il tuo.
4. **Importa in una famiglia nuova**: la conversione diventa un'esportazione `mastercook-2` e passa dal ripristino
   normale, con tutti i controlli del database. Se un solo dato non è valido non si scrive nulla.
5. **Verifica**: confronta persone, allergie, ricette e casa con il vecchio.
6. **Ritorno indietro**: se qualcosa non torna, Impostazioni → **Elimina questa famiglia** (solo chi amministra,
   riscrivendo il nome). Il vecchio è intatto: si continua a usarlo e si riprova quando serve.
7. **Periodo parallelo**: il vecchio resta disponibile finché non decidi di non averne più bisogno.

## Cosa entra

| Vecchio | Nuovo |
|---|---|
| Profili (nome, fattore porzione, attivo) | Persone (porzione, archiviata se non attiva) |
| Allergie (14 UE), «escludi tracce» | Allergie `all:…`, con «anche tracce» |
| Intolleranze | Intolleranze note (`ing:lattosio`…) o a testo libero (`txt:…`) |
| Restrizioni (vegetariano, vegano, senza maiale, senza alcol) | Esigenze `cls:…` |
| Graditi / sgraditi | «Piace» / «Non piace» per persona e ingrediente |
| Ricette personali con righe e passaggi | Ricette della famiglia |
| Inventario | Un lotto per articolo con la quantità attuale (somma dei movimenti) e un carico |
| Menu da oggi in poi | Portate (ricetta o testo), con porzioni scritte a mano; spuntino e merenda accesi se usati |

Regole:

- **Nessuna quantità inventata.** Una riga di ricetta senza quantità, o con un'unità diversa da quella del nuovo
  (per esempio «200 g di uova» dove le uova si contano a pezzi), diventa «q.b.» con la quantità vecchia scritta
  accanto, da ricopiare. Un articolo in casa con un'unità incompatibile resta fuori e compare nel rapporto.
- **Date**: vale quella che conta davvero. Se il vecchio aveva calcolato un limite dopo l'apertura o la cottura che
  arriva prima della scadenza, entra quello come data stimata; «entro» diventa scadenza, «preferibilmente» TMC,
  senza data resta «sconosciuta».
- **Ingredienti sconosciuti** al nuovo catalogo (cercati per id e poi per nome) si creano nella famiglia con
  allergeni «non noti»: le ricette che li usano restano «da verificare» finché qualcuno non li completa.
- Gli avanzi cotti contati a porzioni diventano «Avanzo» con il loro nome.
- Gli id vengono rigenerati dal ripristino; lo stesso file dà sempre la stessa conversione.

## Cosa resta nel vecchio

Anno di nascita, sesso e condizioni (il nuovo non li usa), diete del dietista, lista e spesa in corso, scorte minime,
ospiti, foto delle ricette, preferiti e voti (nel nuovo i gusti sono per persona), pasti passati, storico di acquisti
e consumi. Il rapporto elenca quelli presenti nel file.

## Limiti noti

- Chi mangiava ogni piatto del menu non si porta: nel nuovo un piatto è di tutti, con le eccezioni da segnare.
  Il rapporto dice quanti piatti erano solo per alcune persone.
- Gli altri membri della famiglia vecchia entrano come profili senza accesso: si ricollegano con un invito.
