/**
 * Verifica fotografica dell'inventario: zone, conferme applicate in un colpo solo, cronologia e memoria.
 * Le foto non arrivano mai qui: solo ciò che la persona ha confermato.
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

async function famigliaCon(): Promise<{ u: Utente; famiglia: string }> {
  const u = await banco.utente();
  const { famiglia } = await creaFamiglia(u);
  return { u, famiglia };
}

async function nuovoLotto(u: Utente, famiglia: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  const e = await u.applica(
    comando('aggiungi_lotto', famiglia, { id, ingrediente_id: 'ing:uova', quantita: 6, unita: 'pz', luogo: 'frigo', tipo_data: 'sconosciuta', posto: 'r2', ...extra }),
  );
  expect(e.esito).toBe('applicato');
  return id;
}

const verifica = async (famiglia: string) =>
  (await banco.sql<{ v: Record<string, unknown> | null }>(`select impostazioni -> 'verifica' as v from famiglia where id = $1`, [famiglia]))[0].v;

describe('zone della verifica', () => {
  it('si salvano, si controllano e si tolgono con null', async () => {
    const { u, famiglia } = await famigliaCon();
    const zone = [
      { id: 'r1', nome: 'Ripiano 1', luogo: 'frigo', posti: ['r1'] },
      { id: 'porta', nome: 'Porta del frigo', luogo: 'frigo', posti: ['s1', 's2'] },
      { id: 'z-cantina', nome: 'Cantina', luogo: 'dispensa' },
    ];
    expect((await u.applica(comando('imposta_zone_verifica', famiglia, { zone }))).esito).toBe('applicato');
    expect((await verifica(famiglia))?.zone).toEqual(zone);
    // Id doppi, nomi vuoti, posti inventati, troppe zone: rifiutati.
    for (const sbagliate of [
      [zone[0], zone[0]],
      [{ ...zone[0], nome: ' ' }],
      [{ ...zone[0], posti: ['sul tavolo'] }],
      [{ ...zone[0], luogo: 'cantina' }],
      Array.from({ length: 21 }, (_, i) => ({ id: `z${i}`, nome: `Zona ${i}`, luogo: 'frigo' })),
      [],
    ]) {
      expect((await u.applica(comando('imposta_zone_verifica', famiglia, { zone: sbagliate }))).esito).toBe('rifiutato');
    }
    expect((await u.applica(comando('imposta_zone_verifica', famiglia, { zone: null }))).esito).toBe('applicato');
    expect((await verifica(famiglia))?.zone).toBeUndefined();
  });
});

describe('verifica_inventario', () => {
  it('applica solo ciò che è confermato e scrive in cronologia com’era e com’è', async () => {
    const { u, famiglia } = await famigliaCon();
    const uova = await nuovoLotto(u, famiglia);
    const latte = await nuovoLotto(u, famiglia, { ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', posto: 's1' });
    const burro = await nuovoLotto(u, famiglia, { ingrediente_id: 'ing:burro', quantita: 250, unita: 'g', posto: 'r1' });
    const nuovo = randomUUID();
    const e = await u.applica(
      comando('verifica_inventario', famiglia, {
        data: '2026-11-07',
        zone: ['r2', 'porta'],
        operazioni: [
          { azione: 'quantita', lotto_id: uova, quantita: 2.5 },
          { azione: 'quantita', lotto_id: latte, quantita: 0 },
          { azione: 'non_verificabile', lotto_id: burro },
          { azione: 'aggiungi', id: nuovo, ingrediente_id: 'ing:zucchina', quantita: 600, unita: 'g', luogo: 'frigo', posto: 'c1' },
        ],
        impara: { alias: { 'zucchine verdi': 'ing:zucchina' }, errori: ['mozzarella'], posizioni: { 'ing:zucchina': 'cassetto' } },
      }),
    );
    expect(e.esito).toBe('applicato');
    expect(e.dettaglio).toMatchObject({ modifiche: 3 });

    const lotti = await banco.sql<{ id: string; quantita: string; chiuso: boolean; origine: string; posto: string | null }>(
      `select id, quantita, chiuso_il is not null as chiuso, origine, posto from lotto where famiglia_id = $1`,
      [famiglia],
    );
    const per = Object.fromEntries(lotti.map((l) => [l.id, l]));
    expect(Number(per[uova].quantita)).toBe(2.5);
    expect(per[latte].chiuso).toBe(true);
    expect(Number(per[burro].quantita)).toBe(250);
    expect(per[nuovo]).toMatchObject({ origine: 'foto', posto: 'c1' });
    expect(Number(per[nuovo].quantita)).toBe(600);

    const note = await banco.sql<{ lotto_id: string; nota: string; causale: string }>(
      `select lotto_id, nota, causale from movimento where comando_id = $1 order by nota`,
      [e.id],
    );
    expect(note).toEqual(
      expect.arrayContaining([
        { lotto_id: uova, nota: 'Verifica con foto: da 6 pz a 2,5 pz', causale: 'correzione' },
        { lotto_id: latte, nota: 'Verifica con foto: da 1000 ml a 0 ml', causale: 'correzione' },
        { lotto_id: nuovo, nota: 'Verifica con foto: aggiunto', causale: 'carico' },
      ]),
    );

    const v = (await verifica(famiglia)) as { memoria: Record<string, Record<string, unknown>>; ultime: Record<string, string> };
    expect(v.memoria.alias['zucchine verdi']).toEqual({ i: 'ing:zucchina', d: '2026-11-07' });
    expect(v.memoria.errori.mozzarella).toEqual({ n: 1, d: '2026-11-07' });
    expect(v.memoria.posizioni['ing:zucchina']).toEqual({ z: 'cassetto', n: 1, d: '2026-11-07' });
    expect(v.ultime).toEqual({ r2: '2026-11-07', porta: '2026-11-07' });

    // Lo stesso comando ripetuto non fa doppi effetti.
    const di_nuovo = await u.applica({ ...comando('verifica_inventario', famiglia, {}), id: e.id! });
    expect(di_nuovo.ripetuto).toBe(true);
    const [{ n }] = await banco.sql<{ n: string }>(`select count(*) as n from movimento where comando_id = $1`, [e.id]);
    expect(Number(n)).toBe(3);
  });

  it('la memoria cresce: la stessa posizione due volte conta 2, un alias corretto toglie l’errore', async () => {
    const { u, famiglia } = await famigliaCon();
    const impara = (i: Record<string, unknown>, data: string) => u.applica(comando('verifica_inventario', famiglia, { data, operazioni: [], impara: i }));
    await impara({ posizioni: { 'ing:latte': 'porta' }, errori: ['ricotta'] }, '2026-11-01');
    await impara({ posizioni: { 'ing:latte': 'porta' }, errori: ['ricotta'] }, '2026-11-02');
    let v = (await verifica(famiglia)) as { memoria: Record<string, Record<string, Record<string, unknown>>> };
    expect(v.memoria.posizioni['ing:latte']).toMatchObject({ z: 'porta', n: 2 });
    expect(v.memoria.errori.ricotta).toMatchObject({ n: 2 });
    await impara({ posizioni: { 'ing:latte': 'r3' }, alias: { ricotta: 'ing:ricotta' } }, '2026-11-03');
    v = (await verifica(famiglia)) as typeof v;
    expect(v.memoria.posizioni['ing:latte']).toMatchObject({ z: 'r3', n: 1 });
    expect(v.memoria.errori.ricotta).toBeUndefined();
  });

  it('le zone restano quando si impara e viceversa', async () => {
    const { u, famiglia } = await famigliaCon();
    const zone = [{ id: 'r1', nome: 'Ripiano 1', luogo: 'frigo', posti: ['r1'] }];
    await u.applica(comando('imposta_zone_verifica', famiglia, { zone }));
    await u.applica(comando('verifica_inventario', famiglia, { zone: ['r1'], operazioni: [], impara: { errori: ['kiwi'] } }));
    await u.applica(comando('imposta_zone_verifica', famiglia, { zone: [...zone, { id: 'c1', nome: 'Cassetto', luogo: 'frigo' }] }));
    const v = (await verifica(famiglia)) as { zone: unknown[]; memoria: { errori: Record<string, unknown> } };
    expect(v.zone).toHaveLength(2);
    expect(v.memoria.errori.kiwi).toBeDefined();
  });

  it('rifiuta lotti di altre famiglie, lo stesso lotto due volte e azioni sconosciute, senza toccare niente', async () => {
    const { u, famiglia } = await famigliaCon();
    const altra = await famigliaCon();
    const loro = await nuovoLotto(altra.u, altra.famiglia);
    const mio = await nuovoLotto(u, famiglia);
    for (const operazioni of [
      [{ azione: 'quantita', lotto_id: loro, quantita: 1 }],
      [
        { azione: 'quantita', lotto_id: mio, quantita: 1 },
        { azione: 'presente', lotto_id: mio },
      ],
      [{ azione: 'butta_tutto', lotto_id: mio }],
      [
        { azione: 'quantita', lotto_id: mio, quantita: 1 },
        { azione: 'aggiungi', id: randomUUID(), ingrediente_id: 'ing:non-esiste', quantita: 1, unita: 'pz', luogo: 'frigo' },
      ],
    ]) {
      expect((await u.applica(comando('verifica_inventario', famiglia, { operazioni }))).esito).toBe('rifiutato');
    }
    const [{ q }] = await banco.sql<{ q: string }>(`select quantita as q from lotto where id = $1`, [mio]);
    expect(Number(q)).toBe(6);
    expect(await verifica(famiglia)).toBeNull();
  });

  it('spostato nel posto giusto: cambia il posto del lotto (anche insieme alla quantità), mai in dispensa', async () => {
    const { u, famiglia } = await famigliaCon();
    const pollo = await nuovoLotto(u, famiglia, { ingrediente_id: 'ing:petto_pollo', quantita: 500, unita: 'g', posto: 'r1' });
    const latte = await nuovoLotto(u, famiglia, { ingrediente_id: 'ing:latte', quantita: 1000, unita: 'ml', posto: 's1' });
    const pasta = await nuovoLotto(u, famiglia, { ingrediente_id: 'ing:latte', quantita: 500, unita: 'ml', luogo: 'dispensa', posto: null });
    const e = await u.applica(
      comando('verifica_inventario', famiglia, {
        operazioni: [
          { azione: 'presente', lotto_id: pollo, posto: 'r4' },
          { azione: 'quantita', lotto_id: latte, quantita: 500, posto: 'r2' },
          { azione: 'presente', lotto_id: pasta, posto: 'r2' },
        ],
      }),
    );
    expect(e.esito).toBe('applicato');
    expect(e.dettaglio).toMatchObject({ modifiche: 3 });
    const righe = await banco.sql<{ id: string; posto: string | null; q: string }>(`select id, posto, quantita as q from lotto where famiglia_id = $1`, [famiglia]);
    const per = Object.fromEntries(righe.map((r) => [r.id, r]));
    expect(per[pollo]).toMatchObject({ posto: 'r4' });
    expect(Number(per[pollo].q)).toBe(500);
    expect(per[latte]).toMatchObject({ posto: 'r2' });
    expect(Number(per[latte].q)).toBe(500);
    expect(per[pasta].posto).toBeNull();
    const sbagliato = await u.applica(comando('verifica_inventario', famiglia, { operazioni: [{ azione: 'presente', lotto_id: pollo, posto: 'sul tavolo' }] }));
    expect(sbagliato.esito).toBe('rifiutato');
  });
});
