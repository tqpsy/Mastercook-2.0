/**
 * Privacy: consenso registrato e cancellazione del proprio account.
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

async function invita(admin: Utente, famiglia: string, chi: Utente, nome: string) {
  const inv = await admin.applica(comando('crea_invito', famiglia, { id: randomUUID() }));
  const membro = randomUUID();
  const e = await chi.entra(comando('entra_con_invito', randomUUID(), { codice: inv.dettaglio.codice, membro: { id: membro, nome } }));
  expect(e.esito).toBe('applicato');
  return membro;
}

const uno = async <T>(u: Utente, testo: string, valori: unknown[] = []) => ((await u.sql<{ r: T }>(testo, valori))[0] as { r: T }).r;

describe('consenso', () => {
  it('si registra la versione accettata; si legge solo la propria', async () => {
    const u = await banco.utente();
    expect(await uno(u, 'select public.mio_consenso() as r')).toBeNull();
    await u.sql('select public.registra_consenso(1)');
    expect(await uno(u, 'select public.mio_consenso() as r')).toBe(1);
    await u.sql('select public.registra_consenso(2)');
    expect(await uno(u, 'select public.mio_consenso() as r')).toBe(2);
    const altro = await banco.utente();
    expect(await uno(altro, 'select public.mio_consenso() as r')).toBeNull();
    await expect(u.sql('select * from interno.consenso')).rejects.toThrow(/permission denied/);
  });
});

describe('eliminare il proprio account', () => {
  it('serve scrivere ELIMINA', async () => {
    const u = await banco.utente();
    const r = await uno<{ esito: string }>(u, `select public.elimina_mio_account('elimina') as r`);
    expect(r.esito).toBe('rifiutato');
    expect(await banco.sql('select 1 from auth.users where id = $1', [u.id])).toHaveLength(1);
  });

  it('la famiglia dove si è soli sparisce; da quella condivisa si esce e l’amministrazione passa a chi resta', async () => {
    const luca = await banco.utente();
    const sara = await banco.utente();
    const { famiglia: sola } = await creaFamiglia(luca, 'Casa sola');
    const { famiglia: condivisa, membro: schedaLuca } = await creaFamiglia(luca, 'Casa condivisa');
    await invita(luca, condivisa, sara, 'Sara');
    await luca.applica(comando('aggiungi_vincolo', condivisa, { id: randomUUID(), membro_id: schedaLuca, tipo: 'allergia', oggetto: 'all:uova' }));
    await luca.sql('select public.registra_consenso(1)');

    const anteprima = await uno<{ cancellate: { nome: string }[]; lasciate: { nome: string }[] }>(luca, 'select public.anteprima_eliminazione_account() as r');
    expect(anteprima.cancellate.map((f) => f.nome)).toEqual(['Casa sola']);
    expect(anteprima.lasciate.map((f) => f.nome)).toEqual(['Casa condivisa']);

    const prima = (await sara.scarica(condivisa, 0)).righe.reduce((m, r) => Math.max(m, r.seq), 0);
    const r = await uno<{ esito: string; dettaglio: Record<string, number> }>(luca, `select public.elimina_mio_account('ELIMINA') as r`);
    expect(r).toEqual({ esito: 'applicato', dettaglio: { cancellate: 1, lasciate: 1 } });

    expect(await banco.sql('select 1 from auth.users where id = $1', [luca.id])).toEqual([]);
    expect(await banco.sql('select 1 from interno.consenso where utente_id = $1', [luca.id])).toEqual([]);
    expect(await banco.sql('select 1 from famiglia where id = $1', [sola])).toEqual([]);
    expect(await banco.sql('select 1 from membro where famiglia_id = $1', [sola])).toEqual([]);

    // Sara resta, ed è amministratrice; la scheda di Luca resta alla famiglia, scollegata.
    expect(await sara.sql('select ruolo from utente_famiglia where famiglia_id = $1 and eliminato_il is null', [condivisa])).toEqual([{ ruolo: 'amministratore' }]);
    expect(await sara.sql('select utente_id from membro where id = $1', [schedaLuca])).toEqual([{ utente_id: null }]);
    // Il suo dispositivo scarica l'uscita di Luca.
    const dopo = await sara.scarica(condivisa, prima);
    const uscite = dopo.righe.filter((x) => x.tabella === 'utente_famiglia' && x.riga.eliminato_il);
    expect(uscite).toHaveLength(1);
    expect(uscite[0].riga.utente_id).toBeNull();
    expect((await sara.applica(comando('crea_invito', condivisa, { id: randomUUID() }))).esito).toBe('applicato');
  });

  it('con un altro amministratore nessuno viene promosso', async () => {
    const a = await banco.utente();
    const b = await banco.utente();
    const c = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    await invita(a, famiglia, b, 'B');
    await invita(a, famiglia, c, 'C');
    await banco.sql(`update utente_famiglia set ruolo = 'amministratore' where utente_id = $1`, [c.id]);
    await uno(a, `select public.elimina_mio_account('ELIMINA') as r`);
    const ruoli = await banco.sql<{ utente_id: string; ruolo: string }>('select utente_id, ruolo from utente_famiglia where famiglia_id = $1 and eliminato_il is null order by ruolo', [famiglia]);
    expect(ruoli).toEqual([
      { utente_id: c.id, ruolo: 'amministratore' },
      { utente_id: b.id, ruolo: 'membro' },
    ]);
  });
});
