import { describe, expect, it } from 'vitest';
import { leggiVisti, riconosciZona, testoContesto } from './nucleo';

const gemini = (testo: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: testo }] } }] }), { status: 200 });

describe('verifica dell’inventario con Gemini', () => {
  it('legge codice e certezza; certezza sconosciuta = incerto; codici strani scartati', () => {
    expect(
      leggiVisti(
        JSON.stringify([
          { nome: 'Uova', codice: 'p2', quantita: 4, unita: 'pz', certezza: 'sicuro' },
          { nome: 'latte', codice: 'latte!', certezza: 'probabile' },
          { nome: 'cosa', certezza: 'boh' },
        ]),
      ),
    ).toEqual([
      { nome: 'uova', codice: 'p2', quantita: 4, unita: 'pz', certezza: 'sicuro' },
      { nome: 'latte', codice: null, quantita: null, unita: null, certezza: 'probabile' },
      { nome: 'cosa', codice: null, quantita: null, unita: null, certezza: 'incerto' },
    ]);
    expect(leggiVisti('rotto')).toEqual([]);
  });

  it('manda tutte le foto della zona (al più 4) e il contesto della famiglia', async () => {
    let corpo: { contents: { parts: Record<string, unknown>[] }[] } | null = null;
    const chiama = (async (_: string, init: RequestInit) => {
      corpo = JSON.parse(String(init.body));
      return gemini('[{"nome":"burro","codice":"p1","certezza":"sicuro"}]');
    }) as typeof fetch;
    const r = await riconosciZona(['a', 'b', 'c', 'd', 'e'], 'k', 'Zona «Ripiano 2»', chiama, ['m']);
    expect(r).toEqual({ visti: [{ nome: 'burro', codice: 'p1', quantita: null, unita: null, certezza: 'sicuro' }], modello: 'm' });
    const parti = corpo!.contents[0].parts;
    expect(parti.filter((p) => 'inline_data' in p)).toHaveLength(4);
    expect(String(parti.at(-1)!.text)).toContain('Zona «Ripiano 2»');
    expect(testoContesto('x'.repeat(7000))).toHaveLength(6000);
    expect(testoContesto(3)).toBeNull();
  });
});
