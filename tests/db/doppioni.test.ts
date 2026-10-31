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

async function invitoPer() {
  const admin = await banco.utente();
  const { famiglia, membro } = await creaFamiglia(admin);
  const e = await admin.applica(comando('crea_invito', famiglia, { id: randomUUID() }));
  return { admin, famiglia, mio: membro, codice: e.dettaglio.codice as string };
}
const entra = (codice: string, nome: string) => comando('entra_con_invito', randomUUID(), { codice, membro: { id: randomUUID(), nome } });

async function persone(famiglia: string) {
  return banco.sql<{ id: string; nome: string; utente_id: string | null }>(
    'select id, nome, utente_id from membro where famiglia_id = $1 and eliminato_il is null and not archiviato order by creato_il',
    [famiglia],
  );
}

describe('la stessa persona una volta sola', () => {
  it("chi entra con l'invito ritrova la scheda aggiunta a mano con lo stesso nome, con le sue allergie", async () => {
    const { admin, famiglia, codice } = await invitoPer();
    const raffaella = randomUUID();
    await admin.applica(comando('aggiungi_membro', famiglia, { id: raffaella, nome: 'Raffaella' }));
    await admin.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: raffaella, tipo: 'allergia', oggetto: 'all:glutine' }));

    const lei = await banco.utente();
    expect((await lei.entra(entra(codice, ' raffaella '))).esito).toBe('applicato');
    const elenco = await persone(famiglia);
    expect(elenco.filter((p) => p.nome === 'Raffaella')).toEqual([{ id: raffaella, nome: 'Raffaella', utente_id: lei.id }]);
  });

  it('chi esce e rientra ritrova la propria scheda', async () => {
    const { admin, famiglia, codice } = await invitoPer();
    const lei = await banco.utente();
    await lei.entra(entra(codice, 'Raffaella'));
    const [accesso] = await banco.sql('select id from utente_famiglia where famiglia_id = $1 and utente_id = $2', [famiglia, lei.id]);
    expect((await admin.applica(comando('rimuovi_accesso', famiglia, { id: accesso.id }))).esito).toBe('applicato');
    const e = await admin.applica(comando('crea_invito', famiglia, { id: randomUUID() }));
    await lei.entra(entra(e.dettaglio.codice as string, 'Raffaella'));
    expect((await persone(famiglia)).filter((p) => p.nome === 'Raffaella')).toHaveLength(1);
  });

  it('i doppioni già presenti si uniscono senza perdere allergie, gusti e chi mangia', async () => {
    const { admin, famiglia } = await invitoPer();
    const prima = randomUUID();
    const seconda = randomUUID();
    await admin.applica(comando('aggiungi_membro', famiglia, { id: prima, nome: 'Raffaella' }));
    await admin.applica(comando('aggiungi_membro', famiglia, { id: seconda, nome: 'Raffaella' }));
    // Una terza copia, collegata all'account, come la creava prima l'ingresso con l'invito.
    const lei = await banco.utente();
    const terza = { id: randomUUID() };
    await banco.sql("insert into utente_famiglia (id, famiglia_id, utente_id, ruolo) values (gen_random_uuid(), $1, $2, 'membro')", [famiglia, lei.id]);
    await banco.sql("insert into membro (id, famiglia_id, nome, utente_id) values ($1, $2, 'Raffaella', $3)", [terza.id, famiglia, lei.id]);

    await admin.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: seconda, tipo: 'intolleranza', oggetto: 'ing:lattosio' }));
    await admin.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: prima, tipo: 'allergia', oggetto: 'all:glutine' }));
    await admin.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: terza.id, tipo: 'allergia', oggetto: 'all:glutine', severita: 'evitare_anche_tracce' }));
    await admin.applica(comando('imposta_gusto', famiglia, { id: randomUUID(), membro_id: terza.id, ingrediente_id: 'ing:uova', valore: 'piace' }));

    // Il piatto: le prime due tolte da «chi mangia», la terza (quella vera) spuntata.
    const p = { id: randomUUID(), data: '2099-11-01', categoria: 'cena', ricetta_id: 'sys:carbonara' };
    expect((await admin.applica(comando('aggiungi_portata', famiglia, p))).esito).toBe('applicato');
    for (const m of [prima, seconda]) {
      await admin.applica(comando('imposta_eccezione', famiglia, { id: randomUUID(), portata_id: p.id, membro_id: m, tipo: 'non_mangia' }));
    }

    const [r] = await banco.sql<{ n: number }>('select interno.unisci_doppioni() as n');
    expect(r.n).toBe(2);

    const rimaste = (await persone(famiglia)).filter((x) => x.nome === 'Raffaella');
    expect(rimaste).toEqual([{ id: prima, nome: 'Raffaella', utente_id: lei.id }]);
    const vincoli = await banco.sql('select oggetto, severita from vincolo_alimentare where membro_id = $1 and eliminato_il is null order by oggetto', [prima]);
    expect(vincoli).toEqual([
      { oggetto: 'all:glutine', severita: 'evitare_anche_tracce' },
      { oggetto: 'ing:lattosio', severita: 'evitare' },
    ]);
    const gusti = await banco.sql('select ingrediente_id from gusto where membro_id = $1 and eliminato_il is null', [prima]);
    expect(gusti).toEqual([{ ingrediente_id: 'ing:uova' }]);
    const eccezioni = await banco.sql('select tipo from eccezione_membro where portata_id = $1 and eliminato_il is null', [p.id]);
    expect(eccezioni).toEqual([]);
    // Il telefono riceve la copia tolta e la persona aggiornata.
    const righe = (await admin.scarica(famiglia, 0)).righe.filter((x) => x.tabella === 'membro');
    expect(righe.find((x) => x.riga.id === seconda)?.riga.eliminato_il).toBeTruthy();
  });

  it('due persone diverse con lo stesso nome (adulto e bambino) restano due', async () => {
    const { admin, famiglia } = await invitoPer();
    await admin.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Anna' }));
    await admin.applica(comando('aggiungi_membro', famiglia, { id: randomUUID(), nome: 'Anna', porzione: 0.6 }));
    await banco.sql('select interno.unisci_doppioni()');
    expect((await persone(famiglia)).filter((x) => x.nome === 'Anna')).toHaveLength(2);
  });

  it("unire a mano: solo chi amministra, e non due account diversi", async () => {
    const { admin, famiglia, mio, codice } = await invitoPer();
    const lei = await banco.utente();
    await lei.entra(entra(codice, 'Sara'));
    const [sua] = await banco.sql('select id from membro where utente_id = $1', [lei.id]);
    const copia = randomUUID();
    await admin.applica(comando('aggiungi_membro', famiglia, { id: copia, nome: 'Sara', porzione: 0.8 }));

    expect((await lei.applica(comando('unisci_membri', famiglia, { tiene: sua.id, toglie: copia }))).dettaglio.motivo).toBe('solo_amministratore');
    expect((await admin.applica(comando('unisci_membri', famiglia, { tiene: mio, toglie: sua.id }))).dettaglio.motivo).toBe('due_account');
    expect((await admin.applica(comando('unisci_membri', famiglia, { tiene: sua.id, toglie: copia }))).esito).toBe('applicato');
    expect((await persone(famiglia)).filter((x) => x.nome === 'Sara')).toEqual([{ id: sua.id, nome: 'Sara', utente_id: lei.id }]);
  });
});
