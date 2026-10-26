/**
 * Scaricare le modifiche: ordine, pagine, cancellazioni, nessuna riga saltata con scritture in corso.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, comando, creaFamiglia, nuovoBanco, type RigaScaricata, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

async function scaricaTutto(u: Utente, famiglia: string, dopo = 0, limite = 500) {
  const righe: RigaScaricata[] = [];
  let cursore = dopo;
  for (;;) {
    const p = await u.scarica(famiglia, cursore, limite);
    righe.push(...p.righe);
    if (p.righe.length) cursore = p.righe[p.righe.length - 1].seq;
    if (!p.altre) return { righe, cursore };
  }
}

describe('scarica_modifiche', () => {
  it('restituisce tutto in ordine di seq, a pagine', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    for (let i = 0; i < 7; i++) await u.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: `M${i}` }));
    const { righe } = await scaricaTutto(u, famiglia, 0, 3);
    const seq = righe.map((r) => r.seq);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    expect(new Set(seq).size).toBe(seq.length);
    expect(righe.filter((r) => r.tabella === 'membro')).toHaveLength(8);
    expect(righe.filter((r) => r.tabella === 'comando').length).toBeGreaterThanOrEqual(8);
  });

  it('dopo un cursore arrivano solo le righe nuove, comprese le cancellazioni logiche', async () => {
    const u = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(u);
    const id = randomUUID();
    await u.applica(comando('aggiungi_vincolo', famiglia, { id, membro_id: membro, tipo: 'allergia', oggetto: 'all:uova' }));
    const { cursore } = await scaricaTutto(u, famiglia);
    await u.applica(comando('rimuovi_vincolo', famiglia, { id }));
    const { righe } = await scaricaTutto(u, famiglia, cursore);
    const vincolo = righe.find((r) => r.tabella === 'vincolo_alimentare');
    expect(vincolo?.riga.id).toBe(id);
    expect(vincolo?.riga.eliminato_il).not.toBeNull();
    expect(righe.every((r) => r.seq > cursore)).toBe(true);
  });

  it('con scritture in corso, scaricando più volte non si salta nessuna riga', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const ids = Array.from({ length: 60 }, () => randomUUID());
    let cursore = 0;
    const visti = new Set<string>();
    let finito = false;
    const scrittori = Promise.all(
      [0, 1, 2].map(async (k) => {
        for (let i = k; i < ids.length; i += 3) await u.applica(comando('aggiungi_membro', famiglia, { id: ids[i], nome: `N${i}` }));
      }),
    ).then(() => {
      finito = true;
    });
    // Il lettore scarica mentre i tre scrittori lavorano, poi un'ultima volta alla fine.
    while (!finito) {
      const p = await scaricaTutto(u, famiglia, cursore, 5);
      p.righe.filter((r) => r.tabella === 'membro').forEach((r) => visti.add(r.riga.id));
      cursore = p.cursore;
    }
    await scrittori;
    const fine = await scaricaTutto(u, famiglia, cursore, 5);
    fine.righe.filter((r) => r.tabella === 'membro').forEach((r) => visti.add(r.riga.id));
    for (const id of ids) expect(visti.has(id)).toBe(true);
  });
});
