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

describe('separazione tra famiglie', () => {
  it("chi non è della famiglia non legge nulla, nemmeno conoscendo gli id", async () => {
    const a = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(a);
    const estraneo = await banco.utente();
    for (const t of ['famiglia', 'utente_famiglia', 'membro', 'vincolo_alimentare', 'invito', 'comando']) {
      expect(await estraneo.sql(`select * from ${t} where famiglia_id = $1`, [famiglia])).toEqual([]);
    }
    expect(await estraneo.sql('select * from membro where id = $1', [membro])).toEqual([]);
    expect((await estraneo.scarica(famiglia, 0)).errore).toBe('non_autorizzato');
  });

  it('chi non è della famiglia non può applicarle comandi', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const estraneo = await banco.utente();
    const e = await estraneo.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Intruso' }));
    expect(e.dettaglio.motivo).toBe('non_autorizzato');
  });

  it('nessuno scrive direttamente nelle tabelle, nemmeno nella propria famiglia', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    await expect(a.sql('insert into membro (id, famiglia_id, nome) values ($1, $2, $3)', [randomUUID(), famiglia, 'X'])).rejects.toThrow(
      /permission denied/,
    );
    await expect(a.sql('update famiglia set nome = $2 where id = $1', [famiglia, 'X'])).rejects.toThrow(/permission denied/);
    await expect(a.sql('delete from comando where famiglia_id = $1', [famiglia])).rejects.toThrow(/permission denied/);
  });

  it('le funzioni interne non si possono chiamare dal di fuori', async () => {
    const a = await banco.utente();
    await expect(
      a.sql(`select interno.cmd_crea_famiglia($1, '{}'::jsonb, $2)`, [randomUUID(), a.id]),
    ).rejects.toThrow(/permission denied/);
  });

  it('senza accesso non si applica nulla', async () => {
    const [r] = await banco.sql(`select public.applica_comando($1) as e`, [comando('crea_famiglia', randomUUID())]);
    expect(r.e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'non_autenticato' } });
  });
});

describe('inviti', () => {
  async function invito(opzioni: Record<string, unknown> = {}) {
    const admin = await banco.utente();
    const { famiglia } = await creaFamiglia(admin);
    const e = await admin.applica(comando('crea_invito', famiglia, { id: randomUUID(), ...opzioni }));
    expect(e.esito).toBe('applicato');
    return { admin, famiglia, codice: e.dettaglio.codice as string };
  }
  const entra = (codice: string) => ({ ...comando('entra_con_invito', randomUUID(), { codice, membro: { id: randomUUID(), nome: 'Sara' } }) });

  it("chi apre l'invito entra come membro e vede la famiglia", async () => {
    const { famiglia, codice } = await invito();
    const sara = await banco.utente();
    const e = await sara.entra(entra(codice));
    expect(e).toMatchObject({ esito: 'applicato', famiglia_id: famiglia });
    const [m] = await sara.sql('select ruolo from utente_famiglia where utente_id = $1', [sara.id]);
    expect(m.ruolo).toBe('membro');
    expect((await sara.sql('select nome from membro where utente_id = $1', [sara.id]))[0].nome).toBe('Sara');
  });

  it('ripetere lo stesso ingresso non consuma un secondo uso', async () => {
    const { codice } = await invito({ usi_massimi: 2 });
    const sara = await banco.utente();
    const c = entra(codice);
    await sara.entra(c);
    expect(await sara.entra(c)).toMatchObject({ esito: 'applicato', ripetuto: true });
    const [r] = await banco.sql('select usi from invito where codice = $1', [codice]);
    expect(r.usi).toBe(1);
  });

  it('chi è già dentro non consuma usi', async () => {
    const { admin, codice } = await invito();
    expect((await admin.entra(entra(codice))).dettaglio.gia_membro).toBe(true);
    const [r] = await banco.sql('select usi from invito where codice = $1', [codice]);
    expect(r.usi).toBe(0);
  });

  it('invito esaurito, scaduto, revocato o sconosciuto: nessun ingresso', async () => {
    const esaurito = await invito({ usi_massimi: 1 });
    await (await banco.utente()).entra(entra(esaurito.codice));
    expect((await (await banco.utente()).entra(entra(esaurito.codice))).dettaglio.motivo).toBe('invito_esaurito');

    const scaduto = await invito();
    await banco.sql(`update invito set scade_il = now() - interval '1 minute' where codice = $1`, [scaduto.codice]);
    expect((await (await banco.utente()).entra(entra(scaduto.codice))).dettaglio.motivo).toBe('invito_scaduto');

    const revocato = await invito();
    const [{ id }] = await banco.sql('select id from invito where codice = $1', [revocato.codice]);
    await revocato.admin.applica(comando('revoca_invito', revocato.famiglia, { id }));
    expect((await (await banco.utente()).entra(entra(revocato.codice))).dettaglio.motivo).toBe('invito_revocato');

    expect((await (await banco.utente()).entra(entra('nessuno'))).dettaglio.motivo).toBe('invito_sconosciuto');
  });

  it('solo un amministratore crea inviti e vede i codici', async () => {
    const { famiglia, codice } = await invito();
    const sara = await banco.utente();
    await sara.entra(entra(codice));
    const e = await sara.applica(comando('crea_invito', famiglia, { id: randomUUID() }));
    expect(e.dettaglio.motivo).toBe('solo_amministratore');
    expect(await sara.sql('select codice from invito')).toEqual([]);
    const scaricati = await sara.scarica(famiglia, 0);
    const inviti = scaricati.righe.filter((r) => r.tabella === 'invito');
    expect(inviti.length).toBeGreaterThan(0);
    expect(inviti.every((r) => !('codice' in r.riga))).toBe(true);
  });
});

describe('accessi', () => {
  it("l'ultimo amministratore non si può togliere; un membro sì, e poi non legge più", async () => {
    const admin = await banco.utente();
    const { famiglia } = await creaFamiglia(admin);
    const inv = await admin.applica(comando('crea_invito', famiglia, { id: randomUUID() }));
    const sara = await banco.utente();
    await sara.entra({ ...comando('entra_con_invito', randomUUID(), { codice: inv.dettaglio.codice, membro: { id: randomUUID(), nome: 'Sara' } }) });

    const [mio] = await banco.sql('select id from utente_famiglia where utente_id = $1', [admin.id]);
    expect((await admin.applica(comando('rimuovi_accesso', famiglia, { id: mio.id }))).dettaglio.motivo).toBe('ultimo_amministratore');

    const [suo] = await banco.sql('select id from utente_famiglia where utente_id = $1', [sara.id]);
    expect((await admin.applica(comando('rimuovi_accesso', famiglia, { id: suo.id }))).esito).toBe('applicato');
    expect(await sara.sql('select * from membro')).toEqual([]);
    // Il profilo resta, scollegato dall'account.
    const [m] = await banco.sql('select utente_id from membro where famiglia_id = $1 and nome = $2', [famiglia, 'Sara']);
    expect(m.utente_id).toBeNull();
  });
});
