/**
 * Le sigle della famiglia: un cerchietto colorato con l'iniziale del nome, usato al posto dei nomi dove lo
 * spazio è poco (i riquadri di Oggi). Se due nomi iniziano con la stessa lettera, si usano le prime due
 * («L» e «Le» per Luca e Leo). La legenda, sigla accanto al nome, sta in Impostazioni › Famiglia.
 */
export interface SiglaPersona {
  sigla: string;
  colore: number;
  /** Posizione nell'ordine delle sigle: i cerchietti di un piatto si mettono in quest'ordine. */
  ordine: number;
}

/** Quanti colori ci sono per le sigle (classi .sigla.c0 … .c5 in stile.css). */
const COLORI = 6;

const lettere = (nome: string) => Array.from(nome.trim().replace(/^[^\p{L}\p{N}]+/u, ''));

/**
 * Le sigle in un ordine fisso, uguale in Oggi e in Famiglia: prima gli adulti (porzione più grande), poi per nome.
 * Così con l'iniziale in comune la lettera sola va all'adulto («L» Luca, «Le» Leo).
 */
export function sigleDi(tutte: { id: string; nome: string; porzione?: number }[]): Map<string, SiglaPersona> {
  const persone = [...tutte].sort((a, b) => (b.porzione ?? 1) - (a.porzione ?? 1) || a.nome.localeCompare(b.nome, 'it'));
  const prima = (n: string) => (lettere(n)[0] ?? '?').toLocaleUpperCase('it-IT');
  const conta = new Map<string, number>();
  for (const p of persone) conta.set(prima(p.nome), (conta.get(prima(p.nome)) ?? 0) + 1);
  const usate = new Set<string>();
  const sigle = new Map<string, SiglaPersona>();
  persone.forEach((p, i) => {
    const l = lettere(p.nome);
    let sigla = prima(p.nome);
    // Con l'iniziale in comune: la prima persona tiene la lettera sola, le altre aggiungono la seconda.
    if ((conta.get(sigla) ?? 0) > 1 && usate.has(sigla)) sigla = sigla + (l[1] ?? '').toLocaleLowerCase('it-IT');
    for (let n = 2; usate.has(sigla); n++) sigla = `${prima(p.nome)}${n}`;
    usate.add(sigla);
    sigle.set(p.id, { sigla, colore: i % COLORI, ordine: i });
  });
  return sigle;
}

/** Solo da vedere: chi legge con la sintesi vocale trova il nome scritto accanto. */
export function Sigla({ s, nome, grande }: { s: SiglaPersona | undefined; nome?: string; grande?: boolean }) {
  if (!s) return null;
  return (
    <span className={`sigla c${s.colore}${grande ? ' grande' : ''}`} title={nome} aria-hidden>
      {s.sigla}
    </span>
  );
}
