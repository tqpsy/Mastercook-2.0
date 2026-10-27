import { describe, expect, it } from 'vitest';
import { componiFile, controllaFile } from './esportazione';
import type { RigaScaricata } from './tipi';

const F = 'f1';
const r = (tabella: RigaScaricata['tabella'], seq: number, riga: Record<string, unknown>): RigaScaricata => ({
  tabella,
  seq,
  riga: { famiglia_id: F, seq, ...riga } as RigaScaricata['riga'],
});

describe('esportazione', () => {
  const righe = [
    r('famiglia', 1, { id: F, nome: 'Casa' }),
    r('membro', 2, { id: 'm1', nome: 'Luca' }),
    r('membro', 3, { id: 'm2', nome: 'Sara' }),
    r('membro', 5, { id: 'm2', nome: 'Sara R.' }),
    r('vincolo_alimentare', 4, { id: 'v1', membro_id: 'm1', eliminato_il: null }),
    r('vincolo_alimentare', 6, { id: 'v1', membro_id: 'm1', eliminato_il: '2026-10-27' }),
    r('comando', 7, { id: 'c1' }),
    r('invito', 8, { id: 'i1' }),
  ];

  it('tiene solo l’ultima versione di ogni riga, senza cancellate, cronologia e inviti', () => {
    const f = componiFile(righe, new Date('2026-10-27T10:00:00Z'));
    expect(f.tabelle.membro.map((m) => m.nome)).toEqual(['Luca', 'Sara R.']);
    expect(f.tabelle.vincolo_alimentare).toEqual([]);
    expect(f.conteggi).toMatchObject({ famiglia: 1, membro: 2, vincolo_alimentare: 0, lotto: 0, movimento: 0 });
    expect(Object.keys(f.tabelle)).not.toContain('comando');
    expect(Object.keys(f.tabelle)).not.toContain('invito');
  });

  it('il controllo accetta il file prodotto e rifiuta file estranei, di altre versioni o manomessi', () => {
    const f = componiFile(righe, new Date());
    expect(controllaFile(JSON.stringify(f)).valido).toBe(true);
    expect(controllaFile('non json').valido).toBe(false);
    expect(controllaFile(JSON.stringify({ ...f, formato: 'altro' })).valido).toBe(false);
    expect(controllaFile(JSON.stringify({ ...f, versione_schema: 99 })).valido).toBe(false);
    const manomesso = { ...f, tabelle: { ...f.tabelle, membro: f.tabelle.membro.slice(1) } };
    expect(controllaFile(JSON.stringify(manomesso))).toMatchObject({ valido: false, motivo: 'Il file è stato modificato o è incompleto.' });
  });

  it('un file della versione 1 (senza ricette e casa) si può ancora ripristinare', () => {
    const f = componiFile(righe, new Date());
    const v1 = {
      ...f,
      versione_schema: 1,
      tabelle: { famiglia: f.tabelle.famiglia, membro: f.tabelle.membro, vincolo_alimentare: f.tabelle.vincolo_alimentare },
      conteggi: { famiglia: 1, membro: 2, vincolo_alimentare: 0 },
    };
    expect(controllaFile(JSON.stringify(v1)).valido).toBe(true);
    const v2Incompleto = { ...v1, versione_schema: 2 };
    expect(controllaFile(JSON.stringify(v2Incompleto)).valido).toBe(false);
  });
});
