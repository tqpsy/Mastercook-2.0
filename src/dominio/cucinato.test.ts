import { describe, expect, it } from 'vitest';
import { consiglioCucinato } from './cucinato';

describe('piatto cucinato in anticipo', () => {
  it('entro 2 giorni resta in frigo, con il ripiano consigliato', () => {
    const c = consiglioCucinato({ id: 'carne_cotta', consigliati: 2 }, '2026-11-01', '2026-11-03');
    expect(c).toMatchObject({ giorniAlPasto: 2, limiteFrigo: 2, congela: false, entroFrigo: '2026-11-03', entroFreezer: '2027-01-30' });
    expect(c.ripiano).toMatch(/^Ripiano alto o centrale/);
  });

  it('oltre 2 giorni va congelato, anche se la regola darebbe di più', () => {
    expect(consiglioCucinato({ id: 'dolci_forno', consigliati: 3 }, '2026-11-01', '2026-11-04').congela).toBe(true);
  });

  it('i piatti delicati hanno il limite della loro regola e il ripiano centrale', () => {
    const c = consiglioCucinato({ id: 'pesce_cotto', consigliati: 1 }, '2026-11-01', '2026-11-03');
    expect(c).toMatchObject({ limiteFrigo: 1, congela: true });
    expect(c.ripiano).toMatch(/^Ripiano centrale/);
  });

  it('senza regola: 2 giorni', () => {
    expect(consiglioCucinato(undefined, '2026-11-01', '2026-11-01')).toMatchObject({ giorniAlPasto: 0, congela: false, entroFrigo: '2026-11-03' });
  });
});
