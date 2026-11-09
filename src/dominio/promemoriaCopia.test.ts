import { describe, expect, it } from 'vitest';
import { GIORNI_PROMEMORIA, serveRicordareCopia, type StatoCopia } from './promemoriaCopia';

const base: StatoCopia = { dove: 'locale', conDrive: false, ultimaCopia: null, primaVolta: '2026-11-01', rinviataFino: null };

describe('promemoria della copia di sicurezza', () => {
  it('non disturba subito: si parte a contare dal primo giorno visto', () => {
    expect(serveRicordareCopia(base, '2026-11-01')).toBe(false);
    expect(serveRicordareCopia(base, '2026-11-14')).toBe(false);
    expect(serveRicordareCopia(base, '2026-11-15')).toBe(true);
  });

  it('conta dall’ultima copia, se c’è', () => {
    const s = { ...base, ultimaCopia: '2026-11-10' };
    expect(serveRicordareCopia(s, '2026-11-15')).toBe(false);
    expect(serveRicordareCopia(s, '2026-11-24')).toBe(true);
    expect(GIORNI_PROMEMORIA).toBe(14);
  });

  it('serve solo alle famiglie solo sul telefono e senza Drive', () => {
    expect(serveRicordareCopia({ ...base, dove: 'server' }, '2027-01-01')).toBe(false);
    expect(serveRicordareCopia({ ...base, conDrive: true }, '2027-01-01')).toBe(false);
  });

  it('tace fino al giorno scelto con «Più tardi»', () => {
    const s = { ...base, rinviataFino: '2026-11-25' };
    expect(serveRicordareCopia(s, '2026-11-24')).toBe(false);
    expect(serveRicordareCopia(s, '2026-11-25')).toBe(true);
  });

  it('senza nessuna data di partenza non dice niente', () => {
    expect(serveRicordareCopia({ ...base, primaVolta: null }, '2027-01-01')).toBe(false);
  });
});
