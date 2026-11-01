/**
 * Piatto senza un ingrediente (portata.senza): tolto per tutti non si compra né si scala; tolto solo a qualcuno
 * si compra e si scala per le porzioni degli altri. Solo ingredienti della ricetta e persone della famiglia.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

const SETTIMANA = { dal: '2026-11-02', al: '2026-11-08' };

/** Luca e Sara (adulti), Marco (bambino, 0,5): 2,5 porzioni automatiche. */
async function famiglia(): Promise<{ u: Utente; famiglia: string; luca: string; sara: string; marco: string }> {
  const u = await banco.utente();
  const { famiglia, membro: luca } = await creaFamiglia(u);
  const sara = randomUUID();
  const marco = randomUUID();
  await u.applica(comando('aggiungi_membro', famiglia, { id: sara, nome: 'Sara' }));
  await u.applica(comando('aggiungi_membro', famiglia, { id: marco, nome: 'Marco', porzione: 0.5 }));
  return { u, famiglia, luca, sara, marco };
}

async function penne(u: Utente, famiglia: string, senza: unknown) {
  const id = randomUUID();
  const e = await u.applica(comando('aggiungi_portata', famiglia, { id, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:penne_salmone', senza }));
  return { id, e };
}

async function spesa(u: Utente, famiglia: string) {
  await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
  const righe = await banco.sql<{ cosa: string; q: number }>(
    `select ingrediente_id as cosa, quantita_richiesta::float as q from voce_spesa
      where famiglia_id = $1 and eliminato_il is null and stato = 'da_acquistare'`,
    [famiglia],
  );
  return Object.fromEntries(righe.map((r) => [r.cosa, r.q]));
}

async function previsto(portata: string) {
  const righe = await banco.sql<{ cosa: string; q: number }>(`select ingrediente_id as cosa, quantita::float as q from interno.previsto_portata($1)`, [portata]);
  return Object.fromEntries(righe.map((r) => [r.cosa, r.q]));
}

describe('piatto senza un ingrediente', () => {
  it('solo per Sara: la panna si compra e si scala per le porzioni degli altri; per tutti: non serve', async () => {
    const f = await famiglia();
    // Penne panna e salmone: 200 ml di panna per 4 porzioni. Si mangia per 2,5 porzioni: 125 ml.
    const { id, e } = await penne(f.u, f.famiglia, [{ ingrediente_id: 'ing:panna', membro_id: f.sara }]);
    expect(e.esito).toBe('applicato');
    // Senza la porzione di Sara: 1,5 porzioni su 2,5 → 75 ml. Il resto del piatto non cambia.
    expect((await spesa(f.u, f.famiglia))['ing:panna']).toBe(75);
    expect((await spesa(f.u, f.famiglia))['ing:penne']).toBe(200);
    expect((await previsto(id))['ing:panna']).toBe(75);

    // Sara quel giorno non mangia: la panna torna per tutti quelli che mangiano.
    const ecc = randomUUID();
    await f.u.applica(comando('imposta_eccezione', f.famiglia, { id: ecc, portata_id: id, membro_id: f.sara, tipo: 'non_mangia' }));
    expect((await previsto(id))['ing:panna']).toBe(75);
    expect((await previsto(id))['ing:penne']).toBe(120);
    await f.u.applica(comando('rimuovi_eccezione', f.famiglia, { id: ecc }));

    // Per tutti: la panna sparisce da spesa e previsto.
    const [p] = await banco.sql<{ versione: number }>(`select versione from portata where id = $1`, [id]);
    const m = await f.u.applica(
      comando('modifica_portata', f.famiglia, { id, versione_attesa: p.versione, campi: { senza: [{ ingrediente_id: 'ing:panna', membro_id: null }] } }),
    );
    expect(m.esito).toBe('applicato');
    expect((await spesa(f.u, f.famiglia))['ing:panna']).toBeUndefined();
    expect((await previsto(id))['ing:panna']).toBeUndefined();
    expect((await previsto(id))['ing:salmone']).toBe(125);
  });

  it('rifiuta un ingrediente che la ricetta non ha e una persona di un’altra famiglia', async () => {
    const f = await famiglia();
    expect((await penne(f.u, f.famiglia, [{ ingrediente_id: 'ing:funghi', membro_id: null }])).e.dettaglio.motivo).toBe('ingrediente_non_trovato');
    expect((await penne(f.u, f.famiglia, [{ ingrediente_id: 'ing:panna', membro_id: randomUUID() }])).e.dettaglio.motivo).toBe('membro_non_trovato');
    expect((await penne(f.u, f.famiglia, { panna: true })).e.esito).toBe('rifiutato');
  });

  it('cambiando ricetta ciò che era tolto non vale più; ripetendo la settimana resta', async () => {
    const f = await famiglia();
    const { id } = await penne(f.u, f.famiglia, [{ ingrediente_id: 'ing:panna', membro_id: f.sara }]);
    const copia = randomUUID();
    expect((await f.u.applica(comando('ripeti_portate', f.famiglia, { portate: [{ da: id, id: copia, data: '2026-11-10' }] }))).esito).toBe('applicato');
    const [c] = await banco.sql<{ senza: unknown }>(`select senza from portata where id = $1`, [copia]);
    expect(c.senza).toEqual([{ ingrediente_id: 'ing:panna', membro_id: f.sara }]);

    const [p] = await banco.sql<{ versione: number }>(`select versione from portata where id = $1`, [id]);
    await f.u.applica(comando('modifica_portata', f.famiglia, { id, versione_attesa: p.versione, campi: { ricetta_id: 'sys:carbonara' } }));
    const [d] = await banco.sql<{ senza: unknown }>(`select senza from portata where id = $1`, [id]);
    expect(d.senza).toEqual([]);
  });
});
