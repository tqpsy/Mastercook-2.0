/**
 * Dallo scontrino letto a ciò che entra nell'app: le righe proposte per la revisione (cosa fare di ognuna, quale
 * ingrediente, quanto, dove) e il comando `importa_scontrino` costruito da ciò che la persona ha confermato.
 * È la parte della schermata «Scontrino» che decide, senza React: la valutazione (`valutazione.ts`) la usa così com'è,
 * perché ciò che si misura è ciò che l'app propone davvero.
 */
import { confezioneDa } from './confezioni';
import type { ControlloLettura } from './doppiaLettura';
import type { Indice, Ingrediente } from './ricette';
import { eFresco, type Luogo, stima } from './scadenze';
import { abbinaRighe, quantitaProposta, type RigaDaAbbinare, type RigaLetta, type ScontrinoLetto, suggerisciIngrediente, unisciDescrizioni, unisciRipetute } from './scontrini';
import { leggiNumero, quantitaDa, type Unita, UNITA_BASE } from './unita';

/** Cosa fare di una riga: dare il prezzo a una riga già confermata, metterla in casa, solo spesa, o niente. */
export type Azione = `abbina:${string}` | 'casa' | 'altro' | 'ignora';

/** Una riga dello scontrino in revisione: ciò che la persona vede e può correggere prima di importare. */
export interface RigaInRevisione {
  id: string;
  descrizione: string;
  euro: string;
  azione: Azione;
  ing: Ingrediente | null;
  numero: string;
  unita: Unita;
  /** Quante confezioni (3 vasetti di yogurt): vuoto o «1» per una sola. */
  quante?: string;
  luogo: Luogo;
  cerca: boolean;
  /** Scelta dall'app e non toccata: se cambia la data si riabbina con la spesa di quel giorno. */
  auto?: boolean;
  /** Perché la riga è «da controllare»: le due letture della foto non coincidono, o il prezzo è stato ricavato dal conto. Va confermata prima di importare. */
  dubbia?: string;
  controllata?: boolean;
}

/** Un prezzo come si scrive nei campi: «1,29», vuoto se non c'è. */
export const testoEuro = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));

/** Una riga nuova, vuota, per chi aggiunge a mano una riga mancante. */
export const rigaVuota = (id: string): RigaInRevisione => ({ id, descrizione: '', euro: '', azione: 'altro', ing: null, numero: '', unita: 'g', luogo: 'dispensa', cerca: false });

export const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

/** Cosa entrerebbe in casa per una riga letta: l'ingrediente più probabile, quanto, in che unità e dove. */
export interface ProdottoProposto {
  ing: Ingrediente | null;
  /** La quantità che lo scontrino dice (nell'unità base), `null` se non si sa: allora si scrive dopo. */
  carico: ReturnType<typeof quantitaProposta>;
  numero: string;
  unita: Unita;
  luogo: Luogo;
}

export function proponiProdotto(riga: RigaLetta, indice: Indice): ProdottoProposto {
  const ing = suggerisciIngrediente(riga.descrizione, indice) ?? null;
  const q = ing ? quantitaProposta(riga, ing) : null;
  return {
    ing,
    carico: q,
    numero: q ? String(q.quantita).replace('.', ',') : '',
    // Senza quantità sullo scontrino, ciò che si conta (zucchine, mele) si propone a pezzi.
    unita: q?.unita ?? (ing ? (ing.dimensione !== 'pezzi' && ing.peso_pz ? 'pz' : UNITA_BASE[ing.dimensione]) : 'g'),
    luogo: ing?.luogo ?? 'dispensa',
  };
}

export interface RigaDaProporre {
  id: string;
  riga: RigaLetta;
  dubbia?: string;
}

/** Per ogni riga: il prezzo a una riga già spuntata o confermata (niente doppioni in casa), oppure in casa. */
export function proponiRighe(lette: RigaDaProporre[], carrello: RigaDaAbbinare[], indice: Indice): RigaInRevisione[] {
  const abbinate = abbinaRighe(
    lette.map((x) => x.riga),
    carrello,
    indice,
  );
  return lette.map(({ id, riga, dubbia }, i) => {
    const p = proponiProdotto(riga, indice);
    return {
      id,
      descrizione: riga.descrizione,
      euro: riga.senzaPrezzo ? '' : testoEuro(riga.prezzo),
      azione: abbinate[i] ? `abbina:${abbinate[i]}` : p.ing ? 'casa' : 'altro',
      ing: p.ing,
      numero: p.numero,
      unita: p.unita,
      luogo: p.luogo,
      cerca: false,
      auto: true,
      dubbia,
    };
  });
}

/**
 * Sotto questa fiducia la lettura del prezzo di una riga della foto è incerta (`fiduciaRiga`): la riga è «da controllare».
 * Scelta con la misura sulle foto (docs/valutazione-scontrini.md): tra 0,66 e 0,70 scopre 6 righe sbagliate che passavano
 * inosservate con 2 falsi allarmi in più su 119 letture; più in alto i falsi allarmi crescono in fretta (0,78: 126 in più).
 */
export const SOGLIA_FIDUCIA = 0.68;
/** La lettura della riga è incerta: PaddleOCR non era sicuro del prezzo (solo per le righe lette da una foto). */
export const rigaIncerta = (r: RigaLetta): boolean => r.fiducia !== undefined && r.fiducia < SOGLIA_FIDUCIA;
/**
 * Da questa fiducia il prezzo è letto con sicurezza: se le due letture della foto non coincidono su una riga così, a sbagliare è
 * l'altra lettura, e la riga non si segnala. Misurata sulle foto: da 0,94 a 0,95 nessun errore in più passa inosservato e i falsi
 * allarmi calano (da 61 a 57 su 119 letture); a 0,93 una riga sbagliata non sarebbe più segnalata.
 */
export const SOGLIA_PREZZO_SICURO = 0.95;
/** Le due letture della foto non coincidono sulla riga (`concorde` falso) e il prezzo non è letto con sicurezza: la riga è da controllare. */
export const letturaDiscorde = (r: RigaLetta, concorde: boolean): boolean => !concorde && !(r.fiducia !== undefined && r.fiducia >= SOGLIA_PREZZO_SICURO);

/**
 * Le righe che la schermata mostra dopo la lettura: le righe lette (con il motivo del dubbio dove le due letture della
 * foto non coincidono, la lettura è incerta o il prezzo è ricavato dal conto), proposte e con le ripetute unite («× 2»).
 * `nuovoId` dà un id a ogni riga; `controllo` è il confronto con la seconda lettura (`confrontaLetture`).
 */
export function righeDaLettura(s: ScontrinoLetto, controllo: ControlloLettura, carrello: RigaDaAbbinare[], indice: Indice, nuovoId: () => string): RigaInRevisione[] {
  const dubbia = (r: RigaLetta, i: number) =>
    r.corretta ? 'il prezzo è ricavato dal totale, non letto' : controllo.disponibile && letturaDiscorde(r, controllo.righe[i].concorde) ? 'le due letture della foto non coincidono' : rigaIncerta(r) ? 'la foto non si legge bene su questa riga' : undefined;
  return unisciRipetute(proponiRighe(s.righe.map((riga, i) => ({ id: nuovoId(), riga, dubbia: dubbia(riga, i) })), carrello, indice));
}

/**
 * Cambiata la data, le righe non toccate (`auto`) si riabbinano con la spesa confermata in quei giorni. Quantità, unità e
 * posto restano quelli già proposti o scritti; cambia solo dove va la riga.
 */
export function riabbina(righe: RigaInRevisione[], carrello: RigaDaAbbinare[], indice: Indice): RigaInRevisione[] {
  const auto = righe.filter((r) => r.auto);
  if (!auto.length) return righe;
  const nuove = new Map(proponiRighe(auto.map((r) => ({ id: r.id, riga: { descrizione: r.descrizione, prezzo: leggiNumero(r.euro) ?? 0 } })), carrello, indice).map((r) => [r.id, r]));
  return righe.map((r) => {
    const n = nuove.get(r.id);
    return n ? { ...r, azione: n.azione, ing: r.ing ?? n.ing } : r;
  });
}

/** Ciò che la persona ha confermato nella revisione, come sta nei campi della schermata. */
export interface BozzaImportazione {
  negozio: string;
  data: string;
  ora: string;
  totale: string;
  qr: string | null;
  testo: string;
  righe: RigaInRevisione[];
}

/** Il comando `importa_scontrino`: stessi campi che il database si aspetta. */
export type ComandoImporta = {
  id: string;
  acquisto_id: string;
  negozio: string | null;
  data: string;
  ora: string | null;
  totale: number | null;
  qr: string | null;
  testo: string | null;
  righe: Record<string, unknown>[];
};

export type EsitoImportazione =
  | { errore: string }
  /** `mancanti`: i prodotti che entrano in casa senza quantità (si scrive dopo, in «Da completare»). */
  | { errore?: undefined; comando: ComandoImporta; mancanti: string[] };

/**
 * Costruisce il comando di importazione dalla bozza, o dice cosa non va (con la frase da mostrare). `nuovoId` dà gli id
 * delle cose nuove; con lo stesso comando ripetuto il database non fa doppi effetti.
 */
export function costruisciImportazione(b: BozzaImportazione, nuovoId: () => string): EsitoImportazione {
  if (!DATA_VALIDA.test(b.data)) return { errore: 'Scrivi la data dello scontrino.' };
  if (b.ora && !/^[0-2]\d:[0-5]\d$/.test(b.ora)) return { errore: 'L’ora si scrive come 18:30.' };
  const totale = b.totale.trim() ? leggiNumero(b.totale) : null;
  if (b.totale.trim() && totale === null) return { errore: 'Il totale non è un numero.' };
  const mancanti: string[] = [];
  const pronte: Record<string, unknown>[] = [];
  for (const r of b.righe) {
    const prezzo = r.euro.trim() ? leggiNumero(r.euro) : null;
    if (r.euro.trim() && prezzo === null) return { errore: `Il prezzo di «${r.descrizione}» non è un numero.` };
    const base = { id: r.id, descrizione: r.descrizione.trim() || 'Riga', prezzo };
    if (r.azione.startsWith('abbina:')) {
      // Due righe sulla stessa riga già comprata (due confezioni passate una alla volta): una sola, con i prezzi sommati.
      const stessa = pronte.find((p) => p.abbina === r.azione.slice(7));
      if (stessa) {
        stessa.prezzo = prezzo == null ? stessa.prezzo : Math.round(((stessa.prezzo as number | null) ?? 0) * 100 + prezzo * 100) / 100;
        stessa.descrizione = unisciDescrizioni(String(stessa.descrizione), base.descrizione);
      } else pronte.push({ ...base, abbina: r.azione.slice(7) });
    } else if (r.azione === 'altro') pronte.push({ ...base, nuova: { id: nuovoId() } });
    else if (r.azione === 'ignora') pronte.push(base);
    else {
      if (!r.ing) return { errore: `Scegli cos’è «${r.descrizione}», oppure segnalo come «solo spesa».` };
      if (!r.numero.trim()) {
        // Senza quantità la riga entra nello scontrino «da completare»: in casa arriva quando si scrive quanto (Casa).
        mancanti.push(r.ing.nome);
        pronte.push({ ...base, nuova: { id: nuovoId(), ingrediente_id: r.ing.id, luogo: r.luogo } });
        continue;
      }
      const scritta = { numero: r.numero, unita: r.unita, quante: r.quante ?? '1' };
      const q = quantitaDa(scritta, r.ing);
      if (typeof q === 'string') return { errore: `${r.ing.nome}: ${q}` };
      const confezione = confezioneDa(scritta, r.ing.dimensione, r.ing.peso_pz);
      const s = eFresco(r.ing) ? stima(r.ing, r.luogo, b.data) : null;
      pronte.push({
        ...base,
        nuova: {
          id: nuovoId(),
          lotto_id: nuovoId(),
          ingrediente_id: r.ing.id,
          quantita: q.valore,
          unita: q.unita,
          ...(confezione ? { confezione } : {}),
          luogo: r.luogo,
          ...(s ? { data_limite: s.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: s.calcolata_il, affidabilita: 'bassa' } : { tipo_data: 'sconosciuta' }),
        },
      });
    }
  }
  if (!pronte.length) return { errore: 'Non ci sono righe da importare.' };
  return {
    mancanti,
    comando: {
      id: nuovoId(),
      acquisto_id: nuovoId(),
      negozio: b.negozio.trim() || null,
      data: b.data,
      ora: b.ora || null,
      totale,
      qr: b.qr,
      testo: b.testo.slice(0, 20000) || null,
      righe: pronte,
    },
  };
}
