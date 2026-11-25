import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type PaginaPdf, testoDaPagine, type VocePdf } from './pdf';
import { leggiScontrino } from './scontrini';

const IPER = JSON.parse(readFileSync(new URL('./pdf-esempi/iper-seriate.voci.json', import.meta.url), 'utf8')) as PaginaPdf[];
const v = (t: string, x: number, y: number, w = t.length * 6): VocePdf => ({ t, x, y, w });

describe('testo da un PDF', () => {
  it('ricompone le righe: stessa altezza, da sinistra a destra, con gli spazi della colonna', () => {
    // Caratteri larghi 6 punti: «DESCRIZIONE» occupa le colonne 2-12, «PREZZO» parte dalla colonna 33.
    const t = testoDaPagine([{ voci: [v('PREZZO', 200, 700), v('DESCRIZIONE', 12, 700), v('LATTE', 12, 688), v('1,29', 200, 688), v(' ', 42, 688, 6), v('A', 230, 688)] }]);
    expect(t.split('\n')).toEqual(['DESCRIZIONE' + ' '.repeat(33 - 2 - 11) + 'PREZZO', 'LATTE' + ' '.repeat(33 - 2 - 5) + '1,29' + ' A']);
  });

  it('tiene l’ordine dall’alto in basso e di pagina in pagina, e ignora le righe vuote', () => {
    const t = testoDaPagine([{ voci: [v('SECONDA', 10, 600), v('PRIMA', 10, 700), v('  ', 10, 650)] }, { voci: [v('TERZA', 10, 700)] }]);
    expect(t.split('\n')).toEqual(['PRIMA', 'SECONDA', 'TERZA']);
  });

  it('pezzi sulla stessa riga con un po’ di scarto in altezza (i caratteri grandi) sono una riga sola', () => {
    expect(testoDaPagine([{ voci: [v('TOTALE', 10, 500), v('118,81', 200, 501.5)] }]).split('\n')).toHaveLength(1);
  });

  it('senza testo (una scansione) dà un testo vuoto', () => {
    expect(testoDaPagine([{ voci: [] }])).toBe('');
  });
});

describe('scontrino digitale Iper (Seriate, PDF salvato da Chrome)', () => {
  const testo = testoDaPagine(IPER);
  const s = leggiScontrino(testo);

  it('le righe sono come stampate: nome a sinistra, prezzo a destra, peso e quantità sulla riga sotto il nome', () => {
    const righe = testo.split('\n');
    expect(righe.find((r) => /^DESCRIZIONE\s+PREZZO IVA$/.test(r))).toBeDefined();
    expect(righe.find((r) => /^ECOQUA A4 PAG\.BIANCA\s+2,69 D$/.test(r))).toBeDefined();
    expect(righe.find((r) => /^\s*0,218\s+\*\s+29,91Kg\s+6,52 B$/.test(r))).toBeDefined();
    expect(righe.find((r) => /^TOTALE COMPLESSIVO\s+118,81$/.test(r))).toBeDefined();
  });

  it('si legge tutto: 33 righe, 118,81 € che tornano da soli, negozio, data e ora', () => {
    expect(s.righe).toHaveLength(33);
    expect(s).toMatchObject({ negozio: 'Iper Montebello S.P.A.', data: '2026-11-24', ora: '17:51', totale: 118.81, quadra: true, quadraDaSola: true, corretti: 0 });
  });

  it('gli sconti sono tolti dalle righe, i pesi e le quantità sono letti', () => {
    const per = (d: RegExp) => s.righe.find((r) => d.test(r.descrizione))!;
    expect(per(/CREMA SPALMABILE/)).toMatchObject({ prezzo: 2.24, sconto: 0.75 });
    expect(per(/SPAGHETTI/)).toMatchObject({ prezzo: 1.58, pezzi: 2, sconto: 1.6 });
    expect(per(/OLIO EX/)).toMatchObject({ prezzo: 9.99, sconto: 3 });
    expect(per(/MAZZANCOLLA/)).toMatchObject({ prezzo: 10.85, grammi: 574 });
    expect(per(/SHOPPER/)).toMatchObject({ prezzo: 0.3, pezzi: 3 });
  });
});
