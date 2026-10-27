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
