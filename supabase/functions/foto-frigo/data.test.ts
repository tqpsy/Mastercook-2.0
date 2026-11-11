import { describe, expect, it } from 'vitest';
import { leggiDataDocumento, leggiDataGemini } from './data';

const gemini = (testo: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: testo }] } }] }), { status: 200 });

describe('data di scadenza con Gemini', () => {
  it('accetta solo date vere', () => {
    expect(leggiDataGemini('{"data":"2027-02-14","tipo":"tmc"}')).toEqual({ data: '2027-02-14', tipo: 'tmc' });
    expect(leggiDataGemini('{"data":"2030-05-31","tipo":"altro"}')).toEqual({ data: '2030-05-31', tipo: null });
    expect(leggiDataGemini('{"data":"2027-02-30"}')).toBeNull();
    expect(leggiDataGemini('{"data":"1999-01-01"}')).toBeNull();
    expect(leggiDataGemini('{"data":"14/02/2027"}')).toBeNull();
    expect(leggiDataGemini('{"data":null}')).toBeNull();
    expect(leggiDataGemini('non json')).toBeNull();
  });
  it('manda la foto e rende la data', async () => {
    let corpo = '';
    const chiama = (async (_u: unknown, o?: RequestInit) => {
      corpo = String(o?.body);
      return gemini('{"data":"2027-12-31","tipo":null}');
    }) as typeof fetch;
    const r = await leggiDataDocumento('QUJD', 'chiave', chiama);
    expect(r).toMatchObject({ data: { data: '2027-12-31', tipo: null } });
    expect(corpo).toContain('QUJD');
  });
  it('data null se non si legge, errore se Gemini non risponde', async () => {
    expect(await leggiDataDocumento('QUJD', 'k', (async () => gemini('{"data":null}')) as typeof fetch)).toMatchObject({ data: null });
    expect(await leggiDataDocumento('QUJD', 'k', (async () => new Response('{}', { status: 429 })) as typeof fetch, ['m'])).toMatchObject({ errore: 'quota' });
  });
});
