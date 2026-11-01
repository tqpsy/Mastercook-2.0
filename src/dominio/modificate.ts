/**
 * Ricette di Mastercook modificate dalla famiglia: quando una versione modificata prende il posto
 * dell'originale (o lo restituisce), i piatti ancora da mangiare passano alla ricetta giusta.
 * I pasti già confermati e i piatti già cucinati restano com'erano: sono storia.
 */

interface Riga {
  id: string;
  [campo: string]: unknown;
}

/** Le portate da oggi in poi con la ricetta `da`, non confermate e non ancora cucinate. */
export function portateDaSpostare(portate: Riga[], conferme: Riga[], lotti: Riga[], da: string, oggi: string): { id: string; versione: number }[] {
  const confermati = new Set(conferme.map((c) => `${String(c.data)}|${String(c.categoria)}`));
  const cucinate = new Set(lotti.map((l) => l.portata_id).filter(Boolean));
  return portate
    .filter((p) => p.ricetta_id === da && String(p.data) >= oggi && !confermati.has(`${String(p.data)}|${String(p.categoria)}`) && !cucinate.has(p.id))
    .map((p) => ({ id: p.id, versione: Number(p.versione ?? 1) }));
}
