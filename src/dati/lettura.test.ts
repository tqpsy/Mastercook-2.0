import 'fake-indexeddb/auto';
import { liveQuery } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { Archivio, type VoceCoda } from './archivio';
import { type Letta, lettoreVista } from './lettura';
import type { Riga, Tabella } from './tipi';

const F = 'fam';
const TABELLE: Tabella[] = ['membro', 'lotto', 'portata'];
let n = 0;
const aperti: Archivio[] = [];

function nuovo() {
  const a = new Archivio(`prova-lettura-${n++}`);
  aperti.push(a);
  return a;
}
afterEach(async () => {
  for (const a of aperti.splice(0)) await a.delete();
});

/** Come uno scarico del sincronizzatore: righe e cursore nella stessa transazione. */
async function scarica(a: Archivio, righe: { tabella: Tabella; riga: Riga }[], famiglia = F) {
  await a.transaction('rw', a.righe, a.cursori, async () => {
    await a.righe.bulkPut(righe.map((r) => ({ tabella: r.tabella, id: r.riga.id, famiglia_id: famiglia, seq: r.riga.seq, riga: r.riga })));
    const seq = Math.max(...righe.map((r) => r.riga.seq), await a.cursore(famiglia));
    await a.cursori.put({ famiglia_id: famiglia, seq, aggiornato_il: '2026-11-05T10:00:00Z' });
  });
}

const voce = (tipo: string, dati: Record<string, unknown>): VoceCoda => ({
  id: crypto.randomUUID(),
  famiglia_id: F,
  comando: { id: crypto.randomUUID(), famiglia_id: F, tipo, dati, versione_app: 1 },
  stato: 'in_attesa',
  tentativi: 0,
  creato_il: '2026-11-05T10:00:00Z',
});

const membro = (id: string, seq: number, nome: string): Riga => ({ id, famiglia_id: F, seq, nome, porzione: 1 });
const lotto = (id: string, seq: number, quantita: number): Riga => ({ id, famiglia_id: F, seq, ingrediente_id: 'ing:pasta', quantita, unita: 'g' });

describe('lettura della vista', () => {
  it('legge solo le righe della famiglia, in ordine, con sopra la coda', async () => {
    const a = nuovo();
    await scarica(a, [
      { tabella: 'membro', riga: membro('m2', 2, 'Sara') },
      { tabella: 'membro', riga: membro('m1', 1, 'Luca') },
    ]);
    await scarica(a, [{ tabella: 'membro', riga: { ...membro('x', 3, 'Altra'), famiglia_id: 'altra' } }], 'altra');
    await a.coda.add(voce('modifica_membro', { id: 'm1', versione_attesa: 1, campi: { porzione: 0.5 } }));
    const v = await lettoreVista(a, F, TABELLE)();
    expect(v.righe.membro?.map((m) => [m.id, m.porzione, !!m.in_attesa])).toEqual([
      ['m1', 0.5, true],
      ['m2', 1, false],
    ]);
    expect(v.righe.lotto).toEqual([]);
    expect(v.coda).toHaveLength(1);
  });

  it('un comando in coda non rilegge le righe: le tabelle che non tocca restano gli stessi array', async () => {
    const a = nuovo();
    await scarica(a, [
      { tabella: 'membro', riga: membro('m1', 1, 'Luca') },
      { tabella: 'lotto', riga: lotto('l1', 2, 500) },
    ]);
    const leggi = lettoreVista(a, F, TABELLE);
    const prima = await leggi();
    await a.coda.add(voce('modifica_membro', { id: 'm1', versione_attesa: 1, campi: { nome: 'Luca T.' } }));
    const dopo = await leggi();
    expect(dopo.righe.membro?.[0]).toMatchObject({ nome: 'Luca T.', in_attesa: true });
    expect(dopo.righe.lotto).toBe(prima.righe.lotto);
    expect(dopo.righe.portata).toBe(prima.righe.portata);
    // La stessa coda di nuovo (per esempio il comando segnato «inviato»): la stessa vista, niente da rifare.
    await a.coda.where('famiglia_id').equals(F).modify({ stato: 'inviata' });
    const ancora = await leggi();
    expect(ancora.righe).toBe(dopo.righe);
    expect(ancora.coda[0].stato).toBe('inviata');
  });

  it('dopo uno scarico cambia solo la tabella che ha righe nuove', async () => {
    const a = nuovo();
    await scarica(a, [
      { tabella: 'membro', riga: membro('m1', 1, 'Luca') },
      { tabella: 'lotto', riga: lotto('l1', 2, 500) },
    ]);
    const leggi = lettoreVista(a, F, TABELLE);
    const prima = await leggi();
    await scarica(a, [{ tabella: 'lotto', riga: lotto('l1', 3, 200) }]);
    const dopo = await leggi();
    expect(dopo.righe.lotto?.[0].quantita).toBe(200);
    expect(dopo.righe.lotto).not.toBe(prima.righe.lotto);
    expect(dopo.righe.membro).toBe(prima.righe.membro);
  });

  it('una famiglia eliminata dal dispositivo (righe e cursore tolti) si vede vuota', async () => {
    const a = nuovo();
    await scarica(a, [{ tabella: 'membro', riga: membro('m1', 1, 'Luca') }]);
    const leggi = lettoreVista(a, F, TABELLE);
    expect((await leggi()).righe.membro).toHaveLength(1);
    await a.transaction('rw', a.righe, a.cursori, async () => {
      await a.righe.where('famiglia_id').equals(F).delete();
      await a.cursori.delete(F);
    });
    expect((await leggi()).righe.membro).toEqual([]);
  });

  it('osservata con liveQuery: si aggiorna dopo un comando in coda e dopo uno scarico', async () => {
    const a = nuovo();
    await scarica(a, [{ tabella: 'membro', riga: membro('m1', 1, 'Luca') }]);
    const viste: Letta[] = [];
    const s = liveQuery(lettoreVista(a, F, TABELLE)).subscribe((v) => viste.push(v));
    const attendi = async (quante: number) => {
      for (let i = 0; i < 200 && viste.length < quante; i++) await new Promise((r) => setTimeout(r, 5));
      expect(viste.length).toBeGreaterThanOrEqual(quante);
    };
    await attendi(1);
    await a.coda.add(voce('aggiungi_membro', { id: 'm2', nome: 'Sara' }));
    await attendi(2);
    expect(viste.at(-1)!.righe.membro?.map((m) => m.nome)).toEqual(['Luca', 'Sara']);
    // Lo scarico porta la riga vera e toglie il comando dalla coda, insieme.
    await a.transaction('rw', a.righe, a.cursori, a.coda, async () => {
      await a.righe.put({ tabella: 'membro', id: 'm2', famiglia_id: F, seq: 5, riga: membro('m2', 5, 'Sara') });
      await a.cursori.put({ famiglia_id: F, seq: 5, aggiornato_il: '2026-11-05T10:01:00Z' });
      await a.coda.clear();
    });
    await attendi(3);
    expect(viste.at(-1)!.righe.membro?.map((m) => [m.nome, !!m.in_attesa])).toEqual([
      ['Luca', false],
      ['Sara', false],
    ]);
    s.unsubscribe();
  });
});
