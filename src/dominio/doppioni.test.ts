import { describe, expect, it } from 'vitest';
import { type ScontrinoNoto, type ScontrinoNuovo, trovaDoppione } from './doppioni';

const RIGHE = ['LATTE PARZ.SCREM. 1L', 'PASTA SEMOLA 500G', 'PETTO POLLO FETTE', 'BANANE'];
const noto: ScontrinoNoto = { data: '2026-11-02', ora: '18:41', totale: 24.33, negozio: 'Iperal Supermercati Spa', descrizioni: RIGHE };
const nuovo = (x: Partial<ScontrinoNuovo> = {}): ScontrinoNuovo => ({ data: '2026-11-02', ora: '18:41', totale: 24.33, negozio: 'Iperal Supermercati Spa', descrizioni: RIGHE, ...x });

describe('scontrino già importato', () => {
  it('gli stessi dati: è lo stesso, esatto (il database lo riconosce da solo)', () => {
    expect(trovaDoppione(nuovo(), [noto])).toMatchObject({ esatto: true });
    expect(trovaDoppione(nuovo({ negozio: 'IPERAL  supermercati spa' }), [noto])).toMatchObject({ esatto: true });
  });

  it('un’altra foto dello stesso scontrino, letta un po’ diversa, è lo stesso ma non esatto', () => {
    expect(trovaDoppione(nuovo({ ora: '18:14' }), [noto])).toMatchObject({ esatto: false });
    expect(trovaDoppione(nuovo({ negozio: 'Iperal Supermercati', ora: '' }), [noto])).toMatchObject({ esatto: false });
    expect(trovaDoppione(nuovo({ negozio: '', ora: '', descrizioni: ['LATTE PARZ SCREM 1L', 'PASTA SEMOLA 5OOG', 'PETTO POLLO FETTE', 'BANANE'] }), [noto])).toMatchObject({ esatto: false });
    // La data letta con un giorno di differenza (la sera tardi, o una cifra sbagliata) conta ancora.
    expect(trovaDoppione(nuovo({ data: '2026-11-03' }), [noto])).toMatchObject({ esatto: false });
  });

  it('un altro scontrino: totale diverso, o giorni lontani, o stesso totale ma tutto il resto diverso', () => {
    expect(trovaDoppione(nuovo({ totale: 24.34, ora: '18:14' }), [noto])).toBeNull();
    expect(trovaDoppione(nuovo({ data: '2026-11-09' }), [noto])).toBeNull();
    expect(trovaDoppione(nuovo({ ora: '09:00', negozio: 'Lidl', descrizioni: ['FETTE DORATE', 'UVA'] }), [noto])).toBeNull();
    expect(trovaDoppione(nuovo(), [])).toBeNull();
  });

  it('senza totale servono la stessa data e quasi tutte le righe uguali', () => {
    const senza: ScontrinoNoto = { ...noto, totale: null, ora: null };
    expect(trovaDoppione(nuovo({ totale: null, ora: '', negozio: '' }), [senza])).toMatchObject({ esatto: false });
    expect(trovaDoppione(nuovo({ totale: null, ora: '' }), [senza])).toMatchObject({ esatto: true });
    expect(trovaDoppione(nuovo({ totale: null, ora: '', negozio: '', descrizioni: ['FETTE DORATE', 'UVA'] }), [senza])).toBeNull();
    expect(trovaDoppione(nuovo({ totale: null, ora: '', negozio: '', data: '2026-11-03' }), [senza])).toBeNull();
  });
});
