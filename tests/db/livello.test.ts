/**
 * Prodotti «a occhio»: pezzi e livello a parole (tanto, metà, poco, sta per finire) al posto dei grammi.
 * Le ricette non ne tolgono grammi; la spesa li considera presenti, salvo l'ultimo pezzo che sta per finire.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { componiFile } from '../../src/dati/esportazione';
import type { RigaScaricata } from '../../src/dati/tipi';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

const SETTIMANA = { dal: '2026-11-02', al: '2026-11-08' };

async function famigliaCon(): Promise<{ u: Utente; famiglia: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  return { u, famiglia };
}

async function aOcchio(u: Utente, famiglia: string, pezzi: number, livello: string, ingrediente_id = 'ing:parmigiano') {
  const id = randomUUID();
  const e = await u.applica(comando('aggiungi_lotto', famiglia, { id, ingrediente_id, quantita: pezzi, unita: 'pz', livello, luogo: 'frigo', tipo_data: 'sconosciuta' }));
  return { id, e };
}

const lotto = async (id: string) =>
  (await banco.sql<{ quantita: string; unita: string; livello: string | null; chiuso: boolean }>('select quantita, unita, livello, chiuso_il is not null as chiuso from lotto where id = $1', [id]))[0];

const vociParmigiano = async (famiglia: string) =>
  (await banco.sql<{ q: number }>("select quantita_richiesta::float as q from voce_spesa where famiglia_id = $1 and ingrediente_id = 'ing:parmigiano' and eliminato_il is null", [famiglia])).map((v) => v.q);

describe('prodotti a occhio', () => {
  it('si aggiungono con pezzi e livello; il livello e i pezzi si cambiano, a zero pezzi il lotto si chiude', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id, e } = await aOcchio(u, famiglia, 2, 'tanto');
    expect(e.esito).toBe('applicato');
    expect(await lotto(id)).toMatchObject({ quantita: '2', unita: 'pz', livello: 'tanto', chiuso: false });

    expect((await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'meta' }))).esito).toBe('applicato');
    expect(await lotto(id)).toMatchObject({ quantita: '2', livello: 'meta' });
    // Un pezzo finito: ne resta uno, nuovo.
    await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'tanto', pezzi: 1 }));
    expect(await lotto(id)).toMatchObject({ quantita: '1', livello: 'tanto' });
    await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'finendo', pezzi: 0 }));
    expect(await lotto(id)).toMatchObject({ quantita: '0', chiuso: true });
  });

  it('rifiuta pezzi non interi, livelli sconosciuti e le cose che si contano già (uova)', async () => {
    const { u, famiglia } = await famigliaCon();
    expect((await aOcchio(u, famiglia, 1.5, 'tanto')).e.esito).toBe('rifiutato');
    expect((await aOcchio(u, famiglia, 1, 'pieno')).e.esito).toBe('rifiutato');
    expect((await aOcchio(u, famiglia, 6, 'tanto', 'ing:uova')).e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'livello_non_ammesso' } });
    // Senza livello, «pz» resta vietato per un ingrediente che si pesa.
    const e = await u.applica(comando('aggiungi_lotto', famiglia, { id: randomUUID(), ingrediente_id: 'ing:parmigiano', quantita: 1, unita: 'pz', luogo: 'frigo', tipo_data: 'sconosciuta' }));
    expect(e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'unita_incompatibile' } });
  });

  it('un lotto misurato passa a occhio e torna misurato, con le stesse date e la cronologia in grammi chiusa', async () => {
    const { u, famiglia } = await famigliaCon();
    const grammi = randomUUID();
    await u.applica(comando('aggiungi_lotto', famiglia, { id: grammi, ingrediente_id: 'ing:parmigiano', quantita: 300, unita: 'g', luogo: 'frigo', data_limite: '2026-12-20', tipo_data: 'scadenza', fonte_data: 'confezione' }));
    const occhio = randomUUID();
    const c = comando('cambia_livello', famiglia, { lotto_id: grammi, livello: 'meta', pezzi: 1, nuovo_id: occhio });
    expect((await u.applica(c)).esito).toBe('applicato');
    await u.applica(c); // ripetuto: niente di nuovo
    expect(await lotto(grammi)).toMatchObject({ quantita: '0', chiuso: true });
    expect(await lotto(occhio)).toMatchObject({ quantita: '1', unita: 'pz', livello: 'meta', chiuso: false });
    const [d] = await banco.sql<{ d: string }>('select data_limite::text as d from lotto where id = $1', [occhio]);
    expect(d.d).toBe('2026-12-20');

    const di_nuovo = randomUUID();
    await u.applica(comando('cambia_livello', famiglia, { lotto_id: occhio, livello: null, quantita: 150, unita: 'g', nuovo_id: di_nuovo }));
    expect(await lotto(di_nuovo)).toMatchObject({ quantita: '150', unita: 'g', livello: null });
    expect(await lotto(occhio)).toMatchObject({ chiuso: true });
  });

  it('cucinando non si tolgono grammi da un prodotto a occhio', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id } = await aOcchio(u, famiglia, 1, 'meta');
    const e = await u.applica(comando('usa_ricetta', famiglia, { id: randomUUID(), ricetta_id: 'sys:risotto_parmigiano', porzioni: 4 }));
    expect(e.esito).toBe('applicato');
    expect(await lotto(id)).toMatchObject({ quantita: '1', livello: 'meta', chiuso: false });
  });

  it('spesa: a occhio basta, salvo l’ultimo pezzo che sta per finire', async () => {
    const { u, famiglia } = await famigliaCon();
    await u.applica(comando('aggiungi_portata', famiglia, { id: randomUUID(), data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:risotto_parmigiano', porzioni: 4 }));
    await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
    expect(await vociParmigiano(famiglia)).toEqual([60]);

    const { id } = await aOcchio(u, famiglia, 1, 'poco');
    await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
    expect(await vociParmigiano(famiglia)).toEqual([]);

    await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'finendo' }));
    await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
    expect(await vociParmigiano(famiglia)).toEqual([60]);

    // Con un secondo pezzo intero basta di nuovo.
    await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'finendo', pezzi: 2 }));
    await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
    expect(await vociParmigiano(famiglia)).toEqual([]);
  });

  it('esporta e ripristina un prodotto a occhio con pezzi e livello', async () => {
    const { u, famiglia } = await famigliaCon();
    const { id } = await aOcchio(u, famiglia, 3, 'poco');
    await u.applica(comando('cambia_livello', famiglia, { lotto_id: id, livello: 'poco', pezzi: 2 }));
    const righe: RigaScaricata[] = [];
    let dopo = 0;
    for (;;) {
      const p = await u.scarica(famiglia, dopo, 200);
      righe.push(...(p.righe as RigaScaricata[]));
      if (p.righe.length) dopo = p.righe[p.righe.length - 1].seq;
      if (!p.altre) break;
    }
    const file = componiFile(righe, new Date());
    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }));
    expect(e.esito).toBe('applicato');
    const r = await banco.sql<{ quantita: string; unita: string; livello: string }>('select quantita, unita, livello from lotto where famiglia_id = $1', [nuova]);
    expect(r).toEqual([{ quantita: '2', unita: 'pz', livello: 'poco' }]);
  });
});
