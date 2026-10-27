import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Banco, creaFamiglia, nuovoBanco } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

const carica = (u: Awaited<ReturnType<Banco['utente']>>, nome: string) =>
  u.sql(`insert into storage.objects (bucket_id, name) values ('foto', $1) returning name`, [nome]);

describe('foto delle ricette nel deposito', () => {
  it('il deposito è privato e accetta solo immagini piccole', async () => {
    const [b] = await banco.sql(`select public, file_size_limit::int as limite, allowed_mime_types as tipi from storage.buckets where id = 'foto'`);
    expect(b).toEqual({ public: false, limite: 2097152, tipi: ['image/jpeg', 'image/webp'] });
  });

  it('un membro carica e legge nella cartella della sua famiglia', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const nome = `${famiglia}/${randomUUID()}.jpg`;
    expect(await carica(a, nome)).toEqual([{ name: nome }]);
    expect(await a.sql(`select name from storage.objects where name = $1`, [nome])).toEqual([{ name: nome }]);
  });

  it('chi non è della famiglia non legge, non carica e non cancella', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const nome = `${famiglia}/${randomUUID()}.jpg`;
    await carica(a, nome);
    const estraneo = await banco.utente();
    await creaFamiglia(estraneo);
    expect(await estraneo.sql(`select name from storage.objects where name = $1`, [nome])).toEqual([]);
    await expect(carica(estraneo, `${famiglia}/${randomUUID()}.jpg`)).rejects.toThrow(/row-level security/);
    expect(await estraneo.sql(`delete from storage.objects where name = $1 returning name`, [nome])).toEqual([]);
    expect(await banco.sql(`select count(*)::int as n from storage.objects where name = $1`, [nome])).toEqual([{ n: 1 }]);
  });

  it('percorsi diversi da «famiglia/uuid.jpg» sono rifiutati', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    for (const nome of [`${famiglia}/foto.png`, `${famiglia}/../x.jpg`, `non-uuid/${randomUUID()}.jpg`, `${randomUUID()}.jpg`]) {
      await expect(carica(a, nome)).rejects.toThrow(/row-level security/);
    }
  });
});

describe('chiave Gemini della famiglia', () => {
  it('chi amministra la scrive; nessuno dai telefoni la rilegge; la funzione del server sì', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const chiave = 'AIzaProva_chiave-della-famiglia-9876';
    const imposta = (u: typeof a, c: string | null) => u.sql(`select public.imposta_chiave_gemini($1, $2) as r`, [famiglia, c]).then((x) => x[0].r);

    expect(await imposta(a, 'non è una chiave')).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'chiave_non_valida' } });
    expect(await imposta(a, chiave)).toEqual({ esito: 'applicato', dettaglio: { propria: true, finale: '9876', condivisa: false } });

    // Dal telefono: niente lettura diretta, niente funzione del server.
    await expect(a.sql(`select chiave from interno.chiave_gemini`)).rejects.toThrow();
    await expect(a.sql(`select public.chiave_gemini_per_foto($1)`, [famiglia])).rejects.toThrow();
    expect((await banco.sql(`select public.chiave_gemini_per_foto($1) as r`, [famiglia]))[0].r).toEqual({ chiave, condivisa: false });

    // Un membro vede lo stato ma non può cambiarla; chi non è della famiglia non vede nulla.
    const c = await a.applica({ ...comandoInvito(famiglia) });
    const sara = await banco.utente();
    await sara.entra({ id: randomUUID(), famiglia_id: randomUUID(), tipo: 'entra_con_invito', dati: { codice: c.dettaglio.codice, membro: { id: randomUUID(), nome: 'Sara' } }, versione_app: 1 });
    expect(await imposta(sara, null)).toMatchObject({ esito: 'rifiutato', dettaglio: { motivo: 'solo_amministratore' } });
    expect((await sara.sql(`select public.stato_chiave_gemini($1) as r`, [famiglia]))[0].r).toEqual({ propria: true, finale: '9876', condivisa: false });
    const estraneo = await banco.utente();
    expect((await estraneo.sql(`select public.stato_chiave_gemini($1) as r`, [famiglia]))[0].r).toBeNull();

    expect(await imposta(a, '')).toEqual({ esito: 'applicato', dettaglio: { propria: false, finale: null, condivisa: false } });
  });

  it('la chiave del progetto vale per le famiglie di chi amministrava già, anche quelle create dopo', async () => {
    const luca = await banco.utente();
    await banco.sql(`insert into interno.gemini_condivisa (utente_id) values ($1)`, [luca.id]);
    const { famiglia } = await creaFamiglia(luca, 'Casa nuova di Luca');
    expect((await banco.sql(`select public.chiave_gemini_per_foto($1) as r`, [famiglia]))[0].r).toEqual({ chiave: null, condivisa: true });
    const amico = await banco.utente();
    const { famiglia: altra } = await creaFamiglia(amico, 'Casa amici');
    expect((await banco.sql(`select public.chiave_gemini_per_foto($1) as r`, [altra]))[0].r).toEqual({ chiave: null, condivisa: false });
  });
});

function comandoInvito(famiglia: string) {
  return { id: randomUUID(), famiglia_id: famiglia, tipo: 'crea_invito', dati: { id: randomUUID(), giorni: 1, usi_massimi: 1 }, versione_app: 1 };
}
