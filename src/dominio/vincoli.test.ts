import { describe, expect, it } from 'vitest';
import { ALLERGENI_UE, ESIGENZE, INTOLLERANZE, nomeOggetto, oggettoDaTesto } from './vincoli';

// Lo stesso formato accettato dal vincolo CHECK di vincolo_alimentare.oggetto nel database.
const FORMATO = /^(all|ing|cls|txt):[a-z0-9_]{1,60}$/;

describe('vincoli alimentari', () => {
  it('ci sono i 14 allergeni UE, senza doppioni', () => {
    expect(ALLERGENI_UE).toHaveLength(14);
    expect(new Set(ALLERGENI_UE.map((a) => a.oggetto)).size).toBe(14);
  });

  it('tutti i codici rispettano il formato del database', () => {
    for (const v of [...ALLERGENI_UE, ...INTOLLERANZE, ...ESIGENZE]) expect(v.oggetto).toMatch(FORMATO);
  });

  it('un testo libero diventa un codice valido e stabile', () => {
    expect(oggettoDaTesto('Kiwi ')).toBe('txt:kiwi');
    expect(oggettoDaTesto('Pesche e albicocche')).toBe('txt:pesche_e_albicocche');
    expect(oggettoDaTesto('Caffè')).toBe('txt:caffe');
    expect(oggettoDaTesto('  !!  ')).toBeNull();
    expect(oggettoDaTesto('x'.repeat(100))).toMatch(FORMATO);
  });

  it('i nomi leggibili', () => {
    expect(nomeOggetto('all:frutta_a_guscio')).toBe('Frutta a guscio');
    expect(nomeOggetto('txt:kiwi', 'Kiwi')).toBe('Kiwi');
    expect(nomeOggetto('txt:kiwi')).toBe('kiwi');
  });
});
