import { describe, expect, it } from 'vitest';
import { leggiVisti, oggettiCompleti, riconosciZona, testoContesto } from './nucleo';

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

  it('trova gli oggetti già completi di una risposta a metà, anche con graffe nelle stringhe', () => {
    expect(oggettiCompleti('[{"nome":"uova {fresche}","riquadro":[1,2,3,4]}, {"nome":"lat')).toEqual([{ nome: 'uova {fresche}', riquadro: [1, 2, 3, 4] }]);
    expect(oggettiCompleti('[{"a":"x\\"}"},{"b":1}]')).toEqual([{ a: 'x"}' }, { b: 1 }]);
    expect(oggettiCompleti('')).toEqual([]);
  });

  it('tiene foto e riquadro solo se sensati', () => {
    expect(
      leggiVisti(
        JSON.stringify([
          { nome: 'uova', certezza: 'sicuro', foto: 2, riquadro: [10, 20, 300, 400] },
          { nome: 'burro', certezza: 'sicuro', foto: 9, riquadro: [10, 20, 300, 400] },
          { nome: 'latte', certezza: 'sicuro', riquadro: [300, 20, 10, 400] },
        ]),
      ).map((v) => [v.nome, v.foto, v.riquadro]),
    ).toEqual([
      ['uova', 1, [10, 20, 300, 400]],
      ['burro', 0, [10, 20, 300, 400]],
      ['latte', undefined, undefined],
    ]);
  });

  it('con suVisti chiede la risposta in streaming e passa gli alimenti man mano', async () => {
    let indirizzo = '';
    let corpo: { generationConfig: { mediaResolution?: unknown } } | null = null;
    const pezzi = ['[{"nome":"uova","certezza":"sicuro"},', '{"nome":"burro","cer', 'tezza":"probabile"}]'];
    const sse = pezzi.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`).join('');
    const chiama = (async (url: string, init: RequestInit) => {
      indirizzo = url;
      corpo = JSON.parse(String(init.body));
      return new Response(sse, { status: 200 });
    }) as typeof fetch;
    const man: string[][] = [];
    const r = await riconosciZona(['a'], 'k', null, chiama, ['gemini-3.8-flash'], (v) => man.push(v.map((x) => x.nome)));
    expect(indirizzo).toContain(':streamGenerateContent?alt=sse');
    expect(corpo!.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
    expect(man).toEqual([['uova'], ['uova', 'burro']]);
    expect(r).toMatchObject({ modello: 'gemini-3.8-flash', visti: [{ nome: 'uova' }, { nome: 'burro', certezza: 'probabile' }] });
  });

  it('chiede la risoluzione massima; se il modello non la accetta si riprova senza', async () => {
    const corpi: { generationConfig: { mediaResolution?: unknown } }[] = [];
    const chiama = (async (_: string, init: RequestInit) => {
      const c = JSON.parse(String(init.body));
      corpi.push(c);
      if (c.generationConfig.mediaResolution) return new Response('{"error":{"message":"mediaResolution is not supported"}}', { status: 400 });
      return gemini('[]');
    }) as typeof fetch;
    const r = await riconosciZona(['a'], 'k', null, chiama, ['gemini-2.5-flash']);
    expect(corpi.map((c) => c.generationConfig.mediaResolution)).toEqual(['MEDIA_RESOLUTION_HIGH', undefined]);
    expect(r).toEqual({ visti: [], modello: 'gemini-2.5-flash' });
  });
});
