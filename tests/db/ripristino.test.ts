/**
 * T-DAT-1/3: esporta → ripristina in una famiglia nuova → riesporta: stesso contenuto.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { componiFile, type FileEsportazione } from '../../src/dati/esportazione';
import type { RigaScaricata } from '../../src/dati/tipi';
import { type Banco, comando, creaFamiglia, nuovoBanco, type Utente } from './banco';

let banco: Banco;
beforeAll(async () => {
  banco = await nuovoBanco();
});
afterAll(async () => {
  await banco.chiudi();
});

async function esporta(u: Utente, famiglia: string): Promise<FileEsportazione> {
  const righe: RigaScaricata[] = [];
  let dopo = 0;
  for (;;) {
    const p = await u.scarica(famiglia, dopo, 3);
    righe.push(...(p.righe as RigaScaricata[]));
    if (p.righe.length) dopo = p.righe[p.righe.length - 1].seq;
    if (!p.altre) break;
  }
  return componiFile(righe, new Date());
}

/** Contenuto confrontabile: senza id, tempi, versioni e autori, con i riferimenti tradotti in nomi. */
function contenuto(f: FileEsportazione) {
  const nomi = new Map(f.tabelle.membro.map((m) => [m.id, m.nome]));
  return {
    famiglia: f.tabelle.famiglia.map((x) => ({ nome: x.nome, impostazioni: x.impostazioni })),
    membri: f.tabelle.membro
      .map((m) => ({ nome: m.nome, emoji: m.emoji, porzione: m.porzione, note: m.note, archiviato: m.archiviato, collegato: m.utente_id !== null }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome))),
    vincoli: f.tabelle.vincolo_alimentare
      .map((v) => ({ membro: nomi.get(String(v.membro_id)), tipo: v.tipo, oggetto: v.oggetto, severita: v.severita, fonte: v.fonte, testo: v.testo }))
      .sort((a, b) => `${a.membro}${a.oggetto}`.localeCompare(`${b.membro}${b.oggetto}`)),
  };
}

async function famigliaCompleta() {
  const u = await banco.utente();
  const { famiglia, membro } = await creaFamiglia(u, 'Casa Originale');
  const sara = randomUUID();
  await u.applica(comando('aggiungi_membro', famiglia, { id: sara, nome: 'Sara', emoji: '👧', porzione: 0.6, note: 'Mangia poco la sera' }));
  await u.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: sara, tipo: 'allergia', oggetto: 'all:arachidi', severita: 'evitare_anche_tracce' }));
  await u.applica(comando('aggiungi_vincolo', famiglia, { id: randomUUID(), membro_id: membro, tipo: 'indicazione_medica', oggetto: 'txt:poco_sale', fonte: 'medico', testo: 'Poco sale' }));
  const tolto = randomUUID();
  await u.applica(comando('aggiungi_vincolo', famiglia, { id: tolto, membro_id: membro, tipo: 'esigenza', oggetto: 'cls:vegetariano' }));
  await u.applica(comando('rimuovi_vincolo', famiglia, { id: tolto }));
  return { u, famiglia };
}

describe('esportazione e ripristino', () => {
  it('esporta → ripristina in una famiglia nuova → riesporta: il contenuto coincide', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    expect(file.conteggi).toEqual({ famiglia: 1, membro: 2, vincolo_alimentare: 2 });

    const nuova = randomUUID();
    const e = await u.applica(comando('ripristina_famiglia', nuova, { file: JSON.parse(JSON.stringify(file)) }));
    expect(e).toMatchObject({ esito: 'applicato', dettaglio: { membri: 2, vincoli: 2 } });

    const ripristinato = await esporta(u, nuova);
    expect(contenuto(ripristinato)).toEqual(contenuto(file));
    // Gli id sono nuovi: l'originale resta intatto e indipendente.
    const vecchi = new Set(file.tabelle.membro.map((m) => m.id));
    expect(ripristinato.tabelle.membro.some((m) => vecchi.has(m.id))).toBe(false);
    expect(contenuto(await esporta(u, famiglia))).toEqual(contenuto(file));
  });

  it('chi ripristina un file di un’altra persona diventa amministratore e ha il suo profilo', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const altro = await banco.utente();
    const nuova = randomUUID();
    const e = await altro.applica(comando('ripristina_famiglia', nuova, { file, nome_utente: 'Marco' }));
    expect(e.esito).toBe('applicato');
    const [ruolo] = await altro.sql('select ruolo from utente_famiglia where famiglia_id = $1 and utente_id = $2', [nuova, altro.id]);
    expect(ruolo.ruolo).toBe('amministratore');
    const membri = await altro.sql('select nome, utente_id from membro where famiglia_id = $1 order by nome', [nuova]);
    expect(membri.map((m) => [m.nome, m.utente_id === altro.id])).toEqual([
      ['Luca', false],
      ['Marco', true],
      ['Sara', false],
    ]);
  });

  it('un file non valido o manomesso non scrive nulla', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const casi: [unknown, string][] = [
      [{ ...file, formato: 'altro' }, 'file_non_riconosciuto'],
      [{ ...file, versione_schema: 2 }, 'versione_file_non_supportata'],
      [{ ...file, tabelle: { ...file.tabelle, membro: undefined } }, 'file_incompleto'],
      [{ ...file, tabelle: { ...file.tabelle, membro: [{ ...file.tabelle.membro[0], porzione: 9 }] } }, 'dati_non_validi'],
      [{ ...file, tabelle: { ...file.tabelle, membro: [{ ...file.tabelle.membro[0], famiglia_id: randomUUID() }] } }, 'file_incoerente'],
    ];
    for (const [f, motivo] of casi) {
      const nuova = randomUUID();
      const e = await u.applica(comando('ripristina_famiglia', nuova, { file: f }));
      expect(e.dettaglio.motivo).toBe(motivo);
      expect((await banco.sql('select count(*)::int as n from famiglia where id = $1', [nuova]))[0].n).toBe(0);
    }
  });

  it('ripetere lo stesso ripristino non crea una seconda famiglia', async () => {
    const { u, famiglia } = await famigliaCompleta();
    const file = await esporta(u, famiglia);
    const c = comando('ripristina_famiglia', randomUUID(), { file });
    await u.applica(c);
    expect(await u.applica(c)).toMatchObject({ esito: 'applicato', ripetuto: true });
    expect((await banco.sql('select count(*)::int as n from membro where famiglia_id = $1', [c.famiglia_id]))[0].n).toBe(2);
  });
});
