/** I lotti in casa letti dalla vista, con le quantità da mostrare: servono a Casa, Oggi, Spesa, Ricette, Scontrino. */
import { useMemo } from 'react';
import type { RigaInVista } from './anteprima';
import { useVista } from './contesto';
import type { Indice, Ingrediente } from '../dominio/ricette';
import type { Luogo, TipoData } from '../dominio/scadenze';
import { formatta, leggiNumero, type Scritta, totaleScritta, type UnitaBase } from '../dominio/unita';
import { descriviGruppo, type Gruppo } from '../dominio/confezioni';
import { descriviLivello, eLivello, type Livello, type ScortaAOcchio, scorteAOcchio } from '../dominio/livello';

export interface Lotto {
  id: string;
  ingrediente_id: string;
  nome: string | null;
  quantita: number;
  unita: UnitaBase;
  luogo: Luogo;
  data_limite: string | null;
  tipo_data: TipoData;
  fonte_data: string | null;
  chiuso_il: string | null;
  note: string | null;
  /** Il piatto del menu cucinato in anticipo, se il lotto è un piatto pronto. */
  portata_id?: string | null;
  /** Dove sta nel frigo o nel freezer (Impostazioni › Il mio frigorifero). */
  posto?: string | null;
  /** A occhio (formaggio, olio…): la quantità è il numero di pezzi e questo dice quanto resta di quello in uso. */
  livello?: Livello | null;
  /** Quanto contiene una confezione (500 g di pasta × 2): la quantità resta il totale. */
  confezione?: number | null;
  versione: number;
  in_attesa?: boolean;
}

const aLotto = (r: RigaInVista): Lotto => ({
  id: r.id,
  ingrediente_id: String(r.ingrediente_id),
  nome: (r.nome as string | null) ?? null,
  quantita: Number(r.quantita ?? 0),
  unita: r.unita as UnitaBase,
  luogo: r.luogo as Luogo,
  data_limite: r.data_limite ? String(r.data_limite).slice(0, 10) : null,
  tipo_data: r.tipo_data as TipoData,
  fonte_data: (r.fonte_data as string | null) ?? null,
  chiuso_il: (r.chiuso_il as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  portata_id: (r.portata_id as string | null) ?? null,
  posto: (r.posto as string | null) ?? null,
  livello: eLivello(r.livello) ? r.livello : null,
  confezione: r.confezione == null ? null : Number(r.confezione),
  versione: Number(r.versione ?? 1),
  in_attesa: r.in_attesa,
});

/** Come stanno i prodotti a occhio, per ingrediente (e per i suoi antenati): per gli avvisi nelle ricette. */
export function useScorteAOcchio(indice: Indice | null): Map<string, ScortaAOcchio> {
  const lotti = useLotti();
  return useMemo(() => (indice ? scorteAOcchio(lotti, (id) => indice.antenati(id)) : new Map()), [lotti, indice]);
}

/** I lotti aperti della famiglia. */
export function useLotti(): Lotto[] {
  const vista = useVista();
  const righe = vista.righe.lotto;
  return useMemo(() => (righe ?? []).filter((r) => !r.eliminato_il).map(aLotto).filter((l) => !l.chiuso_il && l.quantita > 0), [righe]);
}

/** «300 g», o a occhio «Metà», «2 pezzi · poco». */
export const quantitaLotto = (l: Pick<Lotto, 'quantita' | 'unita' | 'livello'>) => (l.livello ? descriviLivello(l.quantita, l.livello) : formatta({ valore: l.quantita, unita: l.unita }));

/** La riga di più confezioni uguali: «500 g × 2», «500 g + 300 g aperta»; a occhio «2 pezzi · poco». */
export const quantitaRiga = (g: Gruppo<Lotto>) => (g.primo.livello ? quantitaLotto(g.primo) : descriviGruppo(g));

/** Legge «1,5» + «kg» × quante confezioni per l'ingrediente e lo porta in unità base, o dice cosa non va. */
export function quantitaDa(scritta: Scritta, ing: Ingrediente | undefined): { valore: number; unita: UnitaBase } | string {
  if (leggiNumero(scritta.numero) === null) return 'Scrivi una quantità, per esempio 500 o 1,5.';
  const e = totaleScritta(scritta, ing?.dimensione ?? 'massa', ing?.peso_pz);
  if (e.ok) return e.quantita;
  if (e.motivo === 'confezioni_non_valide') return 'Scrivi quante confezioni, per esempio 1 o 3.';
  return e.motivo === 'unita_incompatibile' ? 'Unità non adatta a questo ingrediente.' : 'La quantità deve essere più di zero.';
}
