import type { RigaInVista } from '../dati/anteprima';
import type { CategoriaPasto, PortataMenu } from './menu';
import type { Indice, Ricetta } from './ricette';
import type { Luogo } from './scadenze';

export interface AvanzoInCasa {
  chiave: string;
  titolo: string;
  /** Il piatto del menu da cui viene, se si può legare il pasto a lui (ricetta nota, giorno o pasto prima). */
  origine: PortataMenu | null;
  ricetta: Ricetta | null;
  porzioni: number;
  luogo: Luogo;
  entro: string | null;
}

/** Gli avanzi aperti in casa che si possono mangiare a un pasto, i più urgenti prima. */
export function avanziInCasa(
  indice: Indice,
  dati: { portate: PortataMenu[]; categorie: CategoriaPasto[] },
  conferme: { id: string; portata_id: string }[],
  lotti: RigaInVista[],
  data: string,
  categoria: string,
): AvanzoInCasa[] {
  const portataDi = new Map(conferme.map((c) => [c.id, c.portata_id]));
  const posto = (c: string) => dati.categorie.find((x) => x.valore === c)?.ordine ?? 0;
  const visti = new Set<string>();
  const out: AvanzoInCasa[] = [];
  for (const l of lotti) {
    if (l.eliminato_il || l.chiuso_il || l.ingrediente_id !== 'ing:avanzo' || Number(l.quantita) <= 0) continue;
    const pid = (l.portata_id as string | null) ?? portataDi.get(String(l.conferma_id));
    let origine = pid ? dati.portate.find((p) => p.id === pid) : undefined;
    // L'avanzo di un avanzo: il piatto è sempre quello cucinato la prima volta.
    if (origine?.avanzo_di) origine = dati.portate.find((p) => p.id === origine!.avanzo_di) ?? origine;
    // Cucinato in anticipo per questo pasto o per uno dopo: è già nel suo pasto.
    if (origine && (origine.data > data || (origine.data === data && posto(origine.categoria) >= posto(categoria)))) continue;
    const ricetta = origine?.ricetta_id ? (indice.perId.get(origine.ricetta_id) ?? null) : null;
    const legato = origine && ricetta && !origine.avanzo_di ? origine : null;
    const chiave = legato ? legato.id : `lotto:${String(l.id)}`;
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    const nome = String(l.nome ?? '').trim();
    out.push({
      chiave,
      titolo: ricetta?.titolo ?? origine?.testo ?? (nome && nome !== 'Avanzo' ? nome : 'Avanzo'),
      origine: legato,
      ricetta,
      porzioni: Number(l.quantita),
      luogo: (['frigo', 'freezer', 'dispensa'].includes(String(l.luogo)) ? l.luogo : 'frigo') as Luogo,
      entro: (l.data_limite as string | null) ?? null,
    });
  }
  return out.sort((a, b) => (a.entro ?? '9999').localeCompare(b.entro ?? '9999'));
}
