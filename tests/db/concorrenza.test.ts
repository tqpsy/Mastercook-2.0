/**
 * Scenari con più dispositivi nello stesso istante, su connessioni Postgres diverse.
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

describe('concorrenza', () => {
  it('lo stesso comando inviato da 8 connessioni insieme ha un solo effetto', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const c = comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Sara' });
    const esiti = await Promise.all(Array.from({ length: 8 }, () => u.applica(c)));
    expect(esiti.every((e) => e.esito === 'applicato')).toBe(true);
    expect(esiti.filter((e) => !e.ripetuto)).toHaveLength(1);
    expect((await banco.sql('select count(*)::int as n from membro where id = $1', [c.dati.id]))[0].n).toBe(1);
  });

  it('due dispositivi aggiungono membri diversi nello stesso istante: restano entrambi', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const [e1, e2] = await Promise.all([
      a.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Sara' })),
      a.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Marco' })),
    ]);
    expect([e1.esito, e2.esito]).toEqual(['applicato', 'applicato']);
    const nomi = await banco.sql('select nome from membro where famiglia_id = $1 order by nome', [famiglia]);
    expect(nomi.map((r) => r.nome)).toEqual(['Luca', 'Marco', 'Sara']);
  });

  it('due dispositivi cambiano lo stesso campo nello stesso istante: uno applica, l\'altro riceve un conflitto', async () => {
    const a = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(a);
    const esiti = await Promise.all(
      ['Luca A', 'Luca B'].map((nome) => a.applica(comando('modifica_membro', famiglia, { id: membro, versione_attesa: 1, campi: { nome } }))),
    );
    expect(esiti.map((e) => e.esito).sort()).toEqual(['applicato', 'conflitto']);
    const vincitore = esiti.findIndex((e) => e.esito === 'applicato');
    const [r] = await banco.sql('select nome from membro where id = $1', [membro]);
    expect(r.nome).toBe(['Luca A', 'Luca B'][vincitore]);
  });

  it('20 vincoli diversi aggiunti in parallelo da 4 dispositivi: tutti presenti', async () => {
    const a = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(a);
    const oggetti = Array.from({ length: 20 }, (_, i) => `ing:prova_${i}`);
    await Promise.all(
      oggetti.map((oggetto) => a.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: membro, tipo: 'esigenza', oggetto }))),
    );
    expect((await banco.sql('select count(*)::int as n from vincolo_alimentare where membro_id = $1', [membro]))[0].n).toBe(20);
  });

  it("l'ultimo uso di un invito conteso da due persone va a una sola", async () => {
    const admin = await banco.utente();
    const { famiglia } = await creaFamiglia(admin);
    const inv = await admin.applica(comando('crea_invito', famiglia, { id: randomUUID(), usi_massimi: 1 }));
    const persone = [await banco.utente(), await banco.utente()];
    const esiti = await Promise.all(
      persone.map((p) => p.entra(comando('entra_con_invito', randomUUID(), { codice: inv.dettaglio.codice, membro: { id: randomUUID(), nome: 'X' } }))),
    );
    expect(esiti.map((e) => e.esito).sort()).toEqual(['applicato', 'rifiutato']);
  });
});
