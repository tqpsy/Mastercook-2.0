/**
 * Ospiti a un pasto: solo numeri e codici, porzioni che crescono, esigenze dimenticate a pasto passato.
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

const domani = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const ieri = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function porzioni(portata: string) {
  const [r] = await banco.sql<{ p: string }>('select interno.porzioni_portata($1)::text as p', [portata]);
  return Number(r.p);
}

describe('ospiti al pasto', () => {
  it('le porzioni automatiche contano adulti (1) e bambini (0,6); quelle scritte a mano restano', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const data = domani();
    const auto = randomUUID();
    const fissa = randomUUID();
    await u.applica(comando('aggiungi_portata', famiglia, { id: auto, data, categoria: 'cena', ricetta_id: 'sys:carbonara' }));
    await u.applica(comando('aggiungi_portata', famiglia, { id: fissa, data, categoria: 'cena', ricetta_id: 'sys:carbonara', porzioni: 2 }));
    expect(await porzioni(auto)).toBe(1);

    const e = await u.applica(comando('imposta_ospiti', famiglia, { data, categoria: 'cena', adulti: 2, bambini: 1, oggetti: ['all:arachidi', 'cls:vegetariano'] }));
    expect(e.esito).toBe('applicato');
    // 1 + 2 + 0,6 = 3,6 → al mezzo: 3,5
    expect(await porzioni(auto)).toBe(3.5);
    expect(await porzioni(fissa)).toBe(2);

    // Un ospite per pasto: lo stesso giorno e pasto aggiorna la stessa riga.
    await u.applica(comando('imposta_ospiti', famiglia, { data, categoria: 'cena', adulti: 4, bambini: 0, oggetti: [] }));
    const righe = await banco.sql('select adulti, bambini, oggetti from ospiti_pasto where famiglia_id = $1 and eliminato_il is null', [famiglia]);
    expect(righe).toEqual([{ adulti: 4, bambini: 0, oggetti: [] }]);
    expect(await porzioni(auto)).toBe(5);

    // Zero e zero: niente ospiti.
    await u.applica(comando('imposta_ospiti', famiglia, { data, categoria: 'cena', adulti: 0, bambini: 0 }));
    expect(await porzioni(auto)).toBe(1);
  });

  it('niente nomi: solo codici noti, e il pasto deve esistere', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const e1 = await u.applica(comando('imposta_ospiti', famiglia, { data: domani(), categoria: 'cena', adulti: 1, oggetti: ['Mario Rossi'] }));
    expect(e1.esito).toBe('rifiutato');
    const e2 = await u.applica(comando('imposta_ospiti', famiglia, { data: domani(), categoria: 'brunch', adulti: 1 }));
    expect(e2.dettaglio.motivo).toBe('categoria_non_trovata');
    const e3 = await u.applica(comando('imposta_ospiti', famiglia, { data: domani(), categoria: 'cena', adulti: 99 }));
    expect(e3.esito).toBe('rifiutato');
  });

  it('due persone che cambiano gli ospiti insieme: la seconda riceve un conflitto', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const data = domani();
    await u.applica(comando('imposta_ospiti', famiglia, { data, categoria: 'pranzo', adulti: 2 }));
    expect((await u.applica(comando('imposta_ospiti', famiglia, { data, categoria: 'pranzo', adulti: 3, versione_attesa: 1 }))).esito).toBe('applicato');
    const e = await u.applica(comando('imposta_ospiti', famiglia, { data, categoria: 'pranzo', adulti: 5, versione_attesa: 1 }));
    expect(e.esito).toBe('conflitto');
    expect(e.dettaglio.motivo).toBe('ospiti_cambiati');
  });

  it('a pasto passato le esigenze si dimenticano (i numeri restano) e lo scarico porta la riga pulita', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    // Un pasto di ieri con le esigenze ancora scritte (come se fosse stato segnato prima di mezzanotte).
    await banco.sql(
      `insert into ospiti_pasto (id, famiglia_id, data, categoria, adulti, bambini, oggetti) values ($1, $2, $3, 'cena', 2, 0, '{all:latte}')`,
      [randomUUID(), famiglia, ieri()],
    );
    await u.applica(comando('imposta_ospiti', famiglia, { data: domani(), categoria: 'cena', adulti: 1, oggetti: ['ing:lattosio'] }));
    const pagina = await u.scarica(famiglia, 0);
    const ospiti = pagina.righe.filter((r) => r.tabella === 'ospiti_pasto').map((r) => [r.riga.data, r.riga.adulti, r.riga.oggetti]);
    expect(ospiti).toEqual(
      expect.arrayContaining([
        [ieri(), 2, []],
        [domani(), 1, ['ing:lattosio']],
      ]),
    );
    // Segnati per un giorno già passato: entrano solo i numeri.
    await u.applica(comando('imposta_ospiti', famiglia, { data: ieri(), categoria: 'pranzo', adulti: 1, oggetti: ['all:uova'] }));
    expect(await banco.sql(`select oggetti from ospiti_pasto where famiglia_id = $1 and categoria = 'pranzo'`, [famiglia])).toEqual([{ oggetti: [] }]);
  });

  it('chi non è della famiglia non vede gli ospiti', async () => {
    const u = await banco.utente();
    const altro = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    await u.applica(comando('imposta_ospiti', famiglia, { data: domani(), categoria: 'cena', adulti: 1 }));
    expect(await altro.sql('select * from ospiti_pasto')).toEqual([]);
    expect((await u.sql('select adulti from ospiti_pasto')).length).toBe(1);
  });
});
