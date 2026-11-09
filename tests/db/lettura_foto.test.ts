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

const leggi = (u: Awaited<ReturnType<Banco['utente']>>, id: string) => u.sql(`select public.leggi_lettura_foto($1) as r`, [id]).then((x) => x[0].r);

describe('lettura della foto del frigo sul server', () => {
  it('si apre una volta sola, si chiude con gli alimenti e il membro li ritrova', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const id = randomUUID();
    expect((await banco.sql(`select public.nuova_lettura_foto($1, $2) as r`, [id, famiglia]))[0].r).toBe(true);
    // Ripetere la richiesta (telefono che riprova) non fa doppi effetti.
    expect((await banco.sql(`select public.nuova_lettura_foto($1, $2) as r`, [id, famiglia]))[0].r).toBe(false);
    expect(await leggi(a, id)).toEqual({ stato: 'in_corso', risultato: null });

    const risultato = { alimenti: [{ nome: 'latte', quantita: 1000, unita: 'ml' }], modello: 'm' };
    await banco.sql(`select public.chiudi_lettura_foto($1, 'pronta', $2::jsonb)`, [id, JSON.stringify(risultato)]);
    expect(await leggi(a, id)).toEqual({ stato: 'pronta', risultato });
    // Una lettura chiusa non cambia più.
    await banco.sql(`select public.chiudi_lettura_foto($1, 'errore', '{}'::jsonb)`, [id]);
    expect((await leggi(a, id)).stato).toBe('pronta');
  });

  it('chi non è della famiglia non la vede; i telefoni non scrivono né leggono la tabella', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const id = randomUUID();
    await banco.sql(`select public.nuova_lettura_foto($1, $2)`, [id, famiglia]);
    const estraneo = await banco.utente();
    await creaFamiglia(estraneo);
    expect(await leggi(estraneo, id)).toBeNull();
    expect(await leggi(a, randomUUID())).toBeNull();
    await expect(a.sql(`select * from interno.lettura_foto`)).rejects.toThrow();
    await expect(a.sql(`select public.nuova_lettura_foto($1, $2)`, [randomUUID(), famiglia])).rejects.toThrow();
    await expect(a.sql(`select public.chiudi_lettura_foto($1, 'pronta', '{}'::jsonb)`, [id])).rejects.toThrow();
  });

  it('una lettura rimasta in corso troppo a lungo risulta errore; le vecchie si cancellano', async () => {
    const a = await banco.utente();
    const { famiglia } = await creaFamiglia(a);
    const id = randomUUID();
    await banco.sql(`select public.nuova_lettura_foto($1, $2)`, [id, famiglia]);
    await banco.sql(`update interno.lettura_foto set creata_il = now() - interval '5 minutes' where id = $1`, [id]);
    expect(await leggi(a, id)).toMatchObject({ stato: 'errore', risultato: { errore: 'gemini' } });
    await banco.sql(`update interno.lettura_foto set creata_il = now() - interval '3 days' where id = $1`, [id]);
    await banco.sql(`select public.nuova_lettura_foto($1, $2)`, [randomUUID(), famiglia]);
    expect(await banco.sql(`select 1 from interno.lettura_foto where id = $1`, [id])).toEqual([]);
  });
});
