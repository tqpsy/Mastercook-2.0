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

describe('applica_comando: un comando ripetuto non ha un secondo effetto', () => {
  it('lo stesso aggiungi_membro inviato tre volte crea un solo membro e risponde «ripetuto»', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const c = comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Sara' });
    const e1 = await u.applica(c);
    const e2 = await u.applica(c);
    const e3 = await u.applica(c);
    expect(e1.esito).toBe('applicato');
    expect(e2).toMatchObject({ esito: 'applicato', ripetuto: true });
    expect(e3).toMatchObject({ esito: 'applicato', ripetuto: true });
    const righe = await banco.sql('select count(*)::int as n from membro where famiglia_id = $1', [famiglia]);
    expect(righe[0].n).toBe(2);
    const comandi = await banco.sql('select count(*)::int as n from comando where id = $1', [c.id]);
    expect(comandi[0].n).toBe(1);
  });

  it('crea_famiglia ripetuto non crea una seconda famiglia', async () => {
    const u = await banco.utente();
    const c = comando('crea_famiglia', randomUUID(), { nome: 'Casa', membro: { id: randomUUID(), nome: 'Io' } });
    expect((await u.applica(c)).esito).toBe('applicato');
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', ripetuto: true });
    const n = await banco.sql('select count(*)::int as n from utente_famiglia where famiglia_id = $1', [c.famiglia_id]);
    expect(n[0].n).toBe(1);
  });

  it('lo stesso id usato da un altro utente è rifiutato', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const c = comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Sara' });
    await a.applica(c);
    const b = await banco.utente();
    expect((await b.applica(c)).dettaglio.motivo).toBe('id_gia_usato');
  });
});

describe('applica_comando: rifiuti', () => {
  it("un'app sotto la versione minima non scrive nulla e il comando non è registrato", async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    await banco.sql('update compatibilita set versione_minima_app = 2');
    try {
      const c = comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Sara' });
      const e = await u.applica(c);
      expect(e).toMatchObject({ esito: 'rifiutato', transitorio: true, dettaglio: { motivo: 'app_da_aggiornare', versione_minima: 2 } });
      expect((await banco.sql('select count(*)::int as n from comando where id = $1', [c.id]))[0].n).toBe(0);
      expect((await banco.sql('select count(*)::int as n from membro where famiglia_id = $1', [famiglia]))[0].n).toBe(1);
      // Dopo l'aggiornamento lo stesso comando passa.
      expect((await u.applica({ ...c, versione_app: 2 })).esito).toBe('applicato');
    } finally {
      await banco.sql('update compatibilita set versione_minima_app = 1');
    }
  });

  it('dati non validi: rifiutato, registrato, nessuna riga scritta', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    const c = comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Gigante', porzione: 5 });
    const e = await u.applica(c);
    expect(e).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'dati_non_validi' } });
    expect((await banco.sql('select count(*)::int as n from membro where id = $1', [c.dati.id]))[0].n).toBe(0);
    expect((await banco.sql('select esito from comando where id = $1', [c.id]))[0].esito).toBe('rifiutato');
    // Ripeterlo dà lo stesso esito, senza rieseguirlo.
    expect(await u.applica(c)).toMatchObject({ esito: 'rifiutato', ripetuto: true });
  });

  it('nome vuoto, tipo sconosciuto e comando malformato sono rifiutati', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    expect((await u.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: '  ' }))).esito).toBe('rifiutato');
    expect((await u.applica(comando('cancella_tutto', famiglia))).dettaglio.motivo).toBe('tipo_sconosciuto');
    expect((await u.applica({ ...comando('aggiungi_membro', famiglia), id: 'non-un-uuid' })).dettaglio.motivo).toBe('comando_malformato');
  });

  it('un rifiuto a metà comando annulla anche le scritture già fatte', async () => {
    const u = await banco.utente();
    const { famiglia } = await creaFamiglia(u);
    // Il vincolo punta a un membro di un'altra famiglia: rifiutato prima di scrivere.
    const altra = await creaFamiglia(await banco.utente());
    const e = await u.applica(
      comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: altra.membro, tipo: 'allergia', oggetto: 'all:glutine' }),
    );
    expect(e.dettaglio.motivo).toBe('membro_non_trovato');
    expect((await banco.sql('select count(*)::int as n from vincolo_alimentare'))[0].n).toBe(0);
  });
});

describe('modifiche per campi', () => {
  async function membro() {
    const u = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(u);
    return { u, famiglia, membro };
  }

  it('campi diversi cambiati partendo dalla stessa versione si uniscono', async () => {
    const { u, famiglia, membro: id } = await membro();
    const a = await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { porzione: 0.6 } }));
    const b = await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { emoji: '👧' } }));
    expect(a.esito).toBe('applicato');
    expect(b.esito).toBe('applicato');
    const [r] = await banco.sql('select porzione::float as porzione, emoji, versione from membro where id = $1', [id]);
    expect(r).toEqual({ porzione: 0.6, emoji: '👧', versione: 3 });
  });

  it('lo stesso campo cambiato da due dispositivi: il secondo riceve un conflitto con il valore attuale', async () => {
    const { u, famiglia, membro: id } = await membro();
    await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { nome: 'Luca R.' } }));
    const e = await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { nome: 'Lucas' } }));
    expect(e.esito).toBe('conflitto');
    expect(e.dettaglio).toMatchObject({ motivo: 'stesso_campo', campi: [{ campo: 'nome', valore_attuale: 'Luca R.' }] });
    const [r] = await banco.sql('select nome from membro where id = $1', [id]);
    expect(r.nome).toBe('Luca R.');
  });

  it('se il valore nuovo è già quello attuale non è un conflitto', async () => {
    const { u, famiglia, membro: id } = await membro();
    await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { nome: 'Luca R.' } }));
    const e = await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { nome: 'Luca R.' } }));
    expect(e.esito).toBe('applicato');
  });

  it('in un conflitto parziale non si applica nemmeno il campo libero', async () => {
    const { u, famiglia, membro: id } = await membro();
    await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { nome: 'A' } }));
    const e = await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { nome: 'B', note: 'x' } }));
    expect(e.esito).toBe('conflitto');
    const [r] = await banco.sql('select nome, note from membro where id = $1', [id]);
    expect(r).toEqual({ nome: 'A', note: null });
  });

  it('campi non ammessi sono rifiutati', async () => {
    const { u, famiglia, membro: id } = await membro();
    const e = await u.applica(comando('modifica_membro', famiglia, { id, versione_attesa: 1, campi: { famiglia_id: randomUUID() } }));
    expect(e.dettaglio).toMatchObject({ motivo: 'campo_non_ammesso', campo: 'famiglia_id' });
  });
});

describe('vincoli alimentari', () => {
  it('due vincoli diversi aggiunti allo stesso membro restano entrambi; lo stesso vincolo due volte resta uno', async () => {
    const u = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(u);
    const v = (oggetto: string) => comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: membro, tipo: 'allergia', oggetto });
    await u.applica(v('all:glutine'));
    await u.applica(v('all:arachidi'));
    const doppio = await u.applica(v('all:glutine'));
    expect(doppio.dettaglio.gia_presente).toBeTruthy();
    const righe = await banco.sql('select oggetto from vincolo_alimentare where membro_id = $1 order by oggetto', [membro]);
    expect(righe.map((r) => r.oggetto)).toEqual(['all:arachidi', 'all:glutine']);
  });

  it('rimuovere un vincolo è una cancellazione logica, ripetibile', async () => {
    const u = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(u);
    const id = randomUUID();
    await u.applica(comando('aggiungi_vincolo', famiglia, { id, membro_id: membro, tipo: 'intolleranza', oggetto: 'ing:lattosio' }));
    expect((await u.applica(comando('rimuovi_vincolo', famiglia, { id }))).esito).toBe('applicato');
    expect((await u.applica(comando('rimuovi_vincolo', famiglia, { id }))).esito).toBe('applicato');
    const [r] = await banco.sql('select eliminato_il is not null as eliminato from vincolo_alimentare where id = $1', [id]);
    expect(r.eliminato).toBe(true);
  });

  it('codici di oggetto non validi sono rifiutati', async () => {
    const u = await banco.utente();
    const { famiglia, membro } = await creaFamiglia(u);
    const e = await u.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: membro, tipo: 'allergia', oggetto: 'glutine' }));
    expect(e.dettaglio.motivo).toBe('dati_non_validi');
  });
});
