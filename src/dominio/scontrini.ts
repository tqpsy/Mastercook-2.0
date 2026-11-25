/**
 * Scontrini: lettura del testo (dalla foto, sul telefono, o incollato), abbinamento alle righe già
 * confermate dal carrello e proposta dell'ingrediente. Tutto è una proposta: una persona rivede
 * ogni riga prima di importare, e il database riconosce lo stesso scontrino importato due volte.
 *
 * Il formato è quello del «documento commerciale» italiano: intestazione del negozio, righe con
 * descrizione, aliquota IVA e prezzo, eventuali sconti sotto la riga, poi totale, pagamento, data e ora.
 * La lettura dalla foto sbaglia: qui si accettano virgole o punti, simboli dell'euro, lettere dell'IVA
 * dopo il prezzo e righe spezzate su due linee. Una riga di cui si legge il nome ma non il prezzo non
 * sparisce: resta senza prezzo, e il conto con il totale dice quanto manca.
 *
 * Questo file è l'interfaccia pubblica: la lettura (`leggiScontrino`) e, qui sotto, i pezzi per responsabilità:
 * - `scontrini-tipi.ts`: i tipi di uno scontrino letto;
 * - `scontrini-righe.ts`: le righe (importi, pezzi, peso, formato) e il totale che le chiude;
 * - `scontrini-testata.ts`: negozio, data e ora;
 * - `scontrini-prodotti.ts`: ingrediente e quantità da caricare in casa, Open Food Facts;
 * - `scontrini-abbinamenti.ts`: abbinamento alle righe già comprate e unione delle ripetute.
 */
import { correggiPrezzi } from './quadratura';
import { centesimi, leggiRighe, pulisciLinea } from './scontrini-righe';
import { leggiTestata } from './scontrini-testata';
import type { ScontrinoLetto } from './scontrini-tipi';

export { abbinaRighe, type RigaDaAbbinare, type RigaRipetibile, unisciDescrizioni, unisciRipetute } from './scontrini-abbinamenti';
export { daOpenFoodFacts, type ProdottoEsterno, quantitaProposta, suggerisciIngrediente } from './scontrini-prodotti';
export { centesimi, DA_SALTARE, eFineRighe, eIntestazione, FINE_RIGHE, fineRighe, formatoDaDescrizione, IMPORTO, INTESTAZIONE_RIGHE, numero, PEZZI, pulisciLinea, SCONTO } from './scontrini-righe';
export type { RigaLetta, ScontrinoLetto } from './scontrini-tipi';

/** Legge il testo di uno scontrino. Non inventa: quello che non trova resta null o fuori dalle righe. */
export function leggiScontrino(testo: string): ScontrinoLetto {
  const linee = testo.split(/\r?\n/).map(pulisciLinea).filter(Boolean);
  const { righe, totale: totaleLetto, pagato, altriTotali, aliquote, ivaTotale } = leggiRighe(linee);
  let totale = totaleLetto;
  if (totale === null && righe.length) totale = pagato;
  let somma = centesimi(righe.reduce((s, r) => s + r.prezzo, 0));
  // Il totale letto non torna ma il subtotale o l'importo pagato sì: era il totale a essere letto male.
  if (righe.length && (totale === null || Math.abs(somma - totale) >= 0.011) && altriTotali.some((x) => Math.abs(x - somma) < 0.011)) totale = somma;
  let corretti = 0;
  if (righe.length && totale !== null && Math.abs(somma - totale) >= 0.011) {
    const senza = righe.filter((r) => r.senzaPrezzo);
    if (senza.length === 1 && totale - somma > 0) {
      // Una sola riga senza prezzo: vale quanto manca per arrivare al totale.
      Object.assign(senza[0], { prezzo: centesimi(totale - somma), corretta: true });
      delete senza[0].senzaPrezzo;
      corretti = 1;
    } else if (!senza.length && !(pagato !== null && Math.abs(pagato - totale) >= 0.011)) {
      // (Se il pagamento dice un'altra cifra, è il totale a essere letto male: i prezzi non si toccano.)
      const nuovi = correggiPrezzi(
        righe.map((r) => ({ cent: Math.round(r.prezzo * 100), nome: r.descrizione, iva: r.iva, modificabile: r.sconto === undefined })),
        { totale: Math.round(totale * 100), ...(ivaTotale !== null ? { ivaTotale: Math.round(ivaTotale * 100) } : {}), aliquote },
      );
      for (const [i, c] of (nuovi ?? []).entries()) {
        if (c === Math.round(righe[i].prezzo * 100)) continue;
        righe[i].prezzo = c / 100;
        righe[i].corretta = true;
        corretti++;
      }
    }
    somma = centesimi(righe.reduce((s, r) => s + r.prezzo, 0));
  }
  const quadra = totale !== null && righe.length > 0 && Math.abs(somma - totale) < 0.011;
  return {
    ...leggiTestata(linee),
    totale,
    righe,
    corretti,
    quadra,
    quadraDaSola: quadra && corretti === 0,
  };
}
