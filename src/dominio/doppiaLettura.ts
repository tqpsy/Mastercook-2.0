/**
 * Doppia lettura di una foto di scontrino. Il lettore sbaglia in modo diverso da una lettura all'altra della stessa
 * foto (basta spostarla di qualche punto), e il conto «che torna» non basta a scoprirlo: prezzi scalati di una riga
 * danno comunque la stessa somma. Quindi si legge la foto due volte, in modo indipendente, e si confrontano:
 * una riga su cui le due letture concordano (stesso nome, stesso prezzo) è quasi sempre giusta; una su cui divergono
 * è quasi sempre sbagliata in una delle due. Sul corpus di prova (tests/scontrini) le righe concordi sono giuste nel 96%,
 * le discordi solo nel 17-23%: le discordi si mettono «da controllare», una persona le conferma prima dell'import.
 */
import { allinea, SOGLIA_NOME, somiglianza, stessoPrezzo } from './allineamento';
import type { RigaLetta, ScontrinoLetto } from './scontrini';

export interface ControlloLettura {
  /** C'era una seconda lettura con cui confrontare. Se no, nessuna riga è segnalata (non si sa). */
  disponibile: boolean;
  /** Per ogni riga della prima lettura: la seconda dice lo stesso (stesso nome, stesso prezzo)? */
  righe: { concorde: boolean }[];
  /** Righe che la seconda lettura ha e la prima no: forse la prima le ha perse. */
  mancanti: Pick<RigaLetta, 'descrizione' | 'prezzo'>[];
  /** Campi su cui le due letture non concordano (`true` = dubbio). */
  campi: { data: boolean; ora: boolean; totale: boolean };
}

/** Senza seconda lettura: niente da dire (non si segnala niente). */
export const senzaControllo = (righe: number): ControlloLettura => ({
  disponibile: false,
  righe: Array.from({ length: righe }, () => ({ concorde: true })),
  mancanti: [],
  campi: { data: false, ora: false, totale: false },
});

/** Confronta la lettura scelta (`prima`) con un'altra lettura indipendente della stessa foto (`seconda`). */
export function confrontaLetture(prima: ScontrinoLetto, seconda: ScontrinoLetto | null): ControlloLettura {
  if (!seconda) return senzaControllo(prima.righe.length);
  const coppie = allinea(prima.righe, seconda.righe);
  const usate = new Set(coppie.filter((j): j is number => j !== null));
  const righe = prima.righe.map((r, i) => {
    const j = coppie[i];
    if (j === null) return { concorde: false };
    const s = seconda.righe[j];
    return { concorde: stessoPrezzo(r.prezzo, s.prezzo) && somiglianza(r.descrizione, s.descrizione) >= SOGLIA_NOME };
  });
  return {
    disponibile: true,
    righe,
    mancanti: seconda.righe.filter((_, j) => !usate.has(j)).map(({ descrizione, prezzo }) => ({ descrizione, prezzo })),
    campi: {
      data: prima.data !== seconda.data,
      ora: prima.ora !== seconda.ora,
      totale: (prima.totale === null) !== (seconda.totale === null) || (prima.totale !== null && seconda.totale !== null && !stessoPrezzo(prima.totale, seconda.totale)),
    },
  };
}

/** Quante righe della prima lettura sono da controllare (le due letture divergono). */
export const righeDubbie = (c: ControlloLettura) => c.righe.filter((r) => !r.concorde).length;
