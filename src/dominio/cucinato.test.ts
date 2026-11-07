import { describe, expect, it } from 'vitest';
import { consiglioCucinato, piattoCucinato } from './cucinato';

describe('piatto cucinato in anticipo', () => {
  it('entro 2 giorni resta in frigo, con il ripiano consigliato', () => {
    const c = consiglioCucinato({ id: 'carne_cotta', consigliati: 2 }, '2026-11-01', '2026-11-03');
    expect(c).toMatchObject({ giorniAlPasto: 2, limiteFrigo: 2, congela: false, entroFrigo: '2026-11-03', entroFreezer: '2027-01-30' });
    expect(c.ripiano).toMatchObject({ posto: 'alto', nome: 'Ripiano in alto' });
  });

  it('oltre 2 giorni va congelato, anche se la regola darebbe di più', () => {
    expect(consiglioCucinato({ id: 'dolci_forno', consigliati: 3 }, '2026-11-01', '2026-11-04').congela).toBe(true);
  });

  it('i piatti delicati hanno il limite della loro regola e il ripiano centrale', () => {
    const c = consiglioCucinato({ id: 'pesce_cotto', consigliati: 1 }, '2026-11-01', '2026-11-03');
    expect(c).toMatchObject({ limiteFrigo: 1, congela: true });
    expect(c.ripiano).toMatchObject({ posto: 'centrale', nome: 'Ripiano centrale, in fondo' });
  });

  it('senza regola: 2 giorni', () => {
    expect(consiglioCucinato(undefined, '2026-11-01', '2026-11-01')).toMatchObject({ giorniAlPasto: 0, congela: false, entroFrigo: '2026-11-03' });
  });
});

describe('piatto appena cucinato con «Cucina passo passo»', () => {
  const portate = [
    { id: 'ieri', data: '2026-11-06', ricetta_id: 'r:lasagna' },
    { id: 'domani', data: '2026-11-08', ricetta_id: 'r:lasagna' },
    { id: 'oggi', data: '2026-11-07', ricetta_id: 'r:lasagna' },
    { id: 'avanzo', data: '2026-11-07', ricetta_id: 'r:lasagna', avanzo_di: 'oggi' },
    { id: 'pasta', data: '2026-11-07', ricetta_id: 'r:pasta' },
    { id: 'lontano', data: '2026-11-12', ricetta_id: 'r:zuppa' },
  ];
  const nessuno = () => false;

  it('sceglie il piatto del menu più vicino da oggi in poi, non gli avanzi né i giorni passati', () => {
    expect(piattoCucinato('r:lasagna', portate, [], nessuno, '2026-11-07')?.id).toBe('oggi');
  });

  it('salta i piatti già segnati e vale anche per le alternative di qualcuno', () => {
    expect(piattoCucinato('r:lasagna', portate, [], (id) => id === 'oggi', '2026-11-07')?.id).toBe('domani');
    expect(piattoCucinato('r:minestra', portate, [{ portata_id: 'pasta', ricetta_id: 'r:minestra' }], nessuno, '2026-11-07')?.id).toBe('pasta');
  });

  it('fuori dal menu (o troppo in là) non trova niente', () => {
    expect(piattoCucinato('r:risotto', portate, [], nessuno, '2026-11-07')).toBeUndefined();
    expect(piattoCucinato('r:zuppa', portate, [], nessuno, '2026-11-07')).toBeUndefined();
  });
});
