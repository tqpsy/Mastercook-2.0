/**
 * Un lotto con la scadenza vera passata non conta come disponibile (spesa e scarico) finché non lo si scarica.
 * «Preferibilmente entro» e le date stimate restano come prima; un lotto che scade oggi si può ancora usare.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, comando, creaFamiglia, nuovoBanco } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

const SETTIMANA = { dal: '2026-11-02', al: '2026-11-08' };

/** Il giorno di Roma spostato di `n` giorni, come lo calcola il database. */
const giorno = async (n: number) =>
  (await banco.sql<{ g: string }>(`select to_char((now() at time zone 'Europe/Rome')::date + $1::int, 'YYYY-MM-DD') as g`, [n]))[0].g;

async function pronti() {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  const portata = randomUUID();
  await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
  const spaghetti = async (quantita: number, tipo_data: string, giorni: number | null) => {
    const id = randomUUID();
    await u.applica(
      comando('aggiungi_lotto', famiglia, {
        id, ingrediente_id: 'ing:spaghetti', quantita, unita: 'g', luogo: 'dispensa', tipo_data, data_limite: giorni === null ? null : await giorno(giorni),
        fonte_data: giorni === null ? null : tipo_data === 'stimata' ? 'app' : 'confezione',
        ...(tipo_data === 'stimata' ? { calcolata_il: new Date().toISOString(), affidabilita: 'bassa' } : {}),
      }),
    );
    return id;
  };
  return { u, famiglia, portata, spaghetti };
}

const quantita = async (id: string) => Number((await banco.sql<{ q: string }>('select quantita as q from lotto where id = $1', [id]))[0].q);
async function daComprare(famiglia: string) {
  return banco.sql<{ q: number }>(
    `select quantita_richiesta::float as q from voce_spesa where famiglia_id = $1 and ingrediente_id = 'ing:spaghetti' and eliminato_il is null and stato = 'da_acquistare'`,
    [famiglia],
  );
}

describe('lotti scaduti fuori dai conti', () => {
  it('la spesa non conta una scadenza passata; tmc, stima e «scade oggi» sì', async () => {
    for (const [tipo, giorni, conta] of [
      ['scadenza', -1, false],
      ['scadenza', 0, true],
      ['tmc', -30, true],
      ['stimata', -3, true],
      ['sconosciuta', null, true],
    ] as const) {
      const { u, famiglia, spaghetti } = await pronti();
      await spaghetti(500, tipo, giorni);
      await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
      const voci = await daComprare(famiglia);
      // Se il lotto conta, i 320 g di spaghetti sono coperti; altrimenti vanno comprati.
      expect(voci.length === 0, `${tipo} ${giorni}`).toBe(conta);
      if (!conta) expect(voci[0].q).toBe(320);
    }
  });

  it('«Mangiato» non scala il lotto scaduto: prende da quello buono', async () => {
    const { u, famiglia, portata, spaghetti } = await pronti();
    const scaduto = await spaghetti(500, 'scadenza', -2);
    const buono = await spaghetti(500, 'scadenza', 10);
    const e = await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto' }));
    expect(e.esito).toBe('applicato');
    expect(await quantita(scaduto)).toBe(500);
    expect(await quantita(buono)).toBe(180);
  });

  it('se c’è solo il lotto scaduto non si tocca e il resto risulta mancante', async () => {
    const { u, famiglia, portata, spaghetti } = await pronti();
    const scaduto = await spaghetti(500, 'scadenza', -2);
    const e = await u.applica(comando('conferma_pasto', famiglia, { id: randomUUID(), portata_id: portata, esito: 'come_previsto' }));
    expect(e.esito).toBe('applicato');
    expect(await quantita(scaduto)).toBe(500);
    expect((e.dettaglio.mancanti as { ingrediente_id: string; quantita: number }[]).find((m) => m.ingrediente_id === 'ing:spaghetti')?.quantita).toBe(320);
  });

  it('scaricarlo a mano come «scaduto» funziona sempre', async () => {
    const { u, famiglia, spaghetti } = await pronti();
    const scaduto = await spaghetti(500, 'scadenza', -2);
    expect((await u.applica(comando('scarica_lotto', famiglia, { lotto_id: scaduto, quantita: 500, causale: 'scaduto' }))).esito).toBe('applicato');
    expect(await quantita(scaduto)).toBe(0);
  });
});
