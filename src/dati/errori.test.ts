import { describe, expect, it } from 'vitest';
import { eRifiutoDelServer } from './errori';

describe('errori del server', () => {
  it('un no del server non è un problema di rete', () => {
    for (const s of [400, 403, 409, 413, 422]) expect(eRifiutoDelServer(s)).toBe(true);
  });
  it('rete assente, 5xx, troppe richieste e 404 si ritentano', () => {
    for (const s of [undefined, 0, 404, 408, 429, 500, 502, 503, 504]) expect(eRifiutoDelServer(s)).toBe(false);
  });
});
