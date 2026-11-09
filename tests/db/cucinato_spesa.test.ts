/**
 * Un piatto cucinato in anticipo ha già tolto gli ingredienti dalla casa: la lista della spesa non deve
 * chiederli di nuovo per quel pasto, finché non è confermato.
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

describe('spesa dopo «Cucinato»', () => {
  it('non ricompra gli ingredienti di un piatto già cucinato', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    await u.applica(comando('aggiungi_lotto', famiglia, { id: randomUUID(), ingrediente_id: 'ing:spaghetti', quantita: 500, unita: 'g', luogo: 'dispensa', tipo_data: 'sconosciuta' }));
    const portata = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: portata, data: '2026-11-03', categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 4 }));
    const voci = () => banco.sql<{ cosa: string }>(`select ingrediente_id as cosa from voce_spesa where famiglia_id = $1 and eliminato_il is null and stato = 'da_acquistare'`, [famiglia]);

    await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
    const prima = (await voci()).length;

    const e = await u.applica(
      comando('cucina_portata', famiglia, { id: randomUUID(), portata_id: portata, nome: 'Carbonara', porzioni: 4, luogo: 'frigo', data_limite: '2026-11-03', tipo_data: 'scadenza', fonte_data: 'utente' }),
    );
    expect(e.esito).toBe('applicato');
    await u.applica(comando('ricalcola_spesa', famiglia, SETTIMANA));
    // Prima si compravano solo i 300 g di pasta che mancavano; ora gli ingredienti sono nel piatto pronto.
    expect(await voci()).toEqual([]);
    expect(prima).toBeGreaterThan(0);
  });
});
