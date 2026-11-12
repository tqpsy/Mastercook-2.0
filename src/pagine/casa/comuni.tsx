/** Casa: pezzi usati da più fogli (data in breve, posto consigliato, scheda del codice a barre). */
import type { ProdottoScansionato } from '../../ui/CodiceProdotto';
import { chiediAOpenFoodFacts } from '../../ui/openFoodFacts';
import { type SchedaProdotto, schedaVuota } from '../../dominio/schedaProdotto';
import { useCatalogo } from '../../dati/indice';
import { type Consiglio, postoIngrediente } from '../../dominio/frigo';
import { useFrigo } from '../MioFrigo';
import type { Ingrediente } from '../../dominio/ricette';
import { descriviData, type Luogo, statoData } from '../../dominio/scadenze';
import type { Lotto } from '../../dati/lotti';

export function EtichettaData({ lotto, giorno }: { lotto: Pick<Lotto, 'data_limite' | 'tipo_data'>; giorno: string }) {
  const s = statoData(lotto, giorno);
  const classe = s === 'scaduto' ? 'scaduto' : s === 'ok' ? '' : 'avviso-data';
  return <span className={`etichetta ${classe}`}>{descriviData(lotto, giorno)}</span>;
}

/** Dove mettere un ingrediente nel frigo della famiglia (null senza frigo configurato o in dispensa). */
export function useConsiglioPosto(ing: Ingrediente | null, luogo: Luogo): Consiglio | null {
  const frigo = useFrigo();
  const catalogo = useCatalogo();
  if (!frigo || !ing || luogo === 'dispensa') return null;
  const sottocategoria = catalogo?.ingredienti.find((x) => x.id === ing.id)?.sottocategoria ?? null;
  return postoIngrediente(frigo, { id: ing.id, reparto: ing.reparto, sottocategoria }, luogo);
}

// Formati creati una volta: crearli a ogni riga dell'elenco costava molto sul telefono.
const DATA_BREVE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' });
const DATA_CON_ANNO = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
/** «5 novembre», con l'anno se non è quest'anno. */
export function dataBreve(data: string): string {
  const d = new Date(`${data}T12:00:00`);
  return (d.getFullYear() !== new Date().getFullYear() ? DATA_CON_ANNO : DATA_BREVE).format(d);
}

/** La scheda del codice scansionato: quella appena letta, quella ricordata o, per qualche istante, quella in arrivo da Open Food Facts. */
export async function schedaDelCodice(c: ProdottoScansionato): Promise<SchedaProdotto | undefined> {
  const pronta = c.scheda ?? c.prodotto?.scheda ?? undefined;
  if (pronta) return pronta;
  const attesa = new Promise<undefined>((r) => setTimeout(r, 2500));
  const scheda = (await Promise.race([chiediAOpenFoodFacts(c.codice), attesa]))?.scheda;
  return scheda && !schedaVuota(scheda) ? scheda : undefined;
}
