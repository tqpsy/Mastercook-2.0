import { describe, expect, it } from 'vitest';
import { leggiAlimenti, riconosci } from './nucleo';

const risposta = (stato: number, corpo: unknown) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status: stato });
const gemini = (testo: string) => risposta(200, { candidates: [{ content: { parts: [{ text: testo }] } }] });

describe('foto del frigo con Gemini', () => {
  it('tiene solo righe sensate: nomi in minuscolo, niente doppioni, quantità senza unità scartate', () => {
    expect(
      leggiAlimenti(
        JSON.stringify([
          { nome: ' Latte ', quantita: 1000, unita: 'ml' },
          { nome: 'latte', quantita: 1, unita: 'pz' },
          { nome: 'Uova', quantita: 6 },
          { nome: '', quantita: 1, unita: 'pz' },
          { nome: 'burro', quantita: -3, unita: 'g' },
          'niente',
        ]),
      ),
    ).toEqual([
      { nome: 'latte', quantita: 1000, unita: 'ml' },
      { nome: 'uova', quantita: null, unita: null },
      { nome: 'burro', quantita: null, unita: null },
    ]);
    expect(leggiAlimenti('non è json')).toEqual([]);
  });

  it('a quota finita passa al modello dopo; la chiave va solo nell’intestazione; quando finiscono tutti dice «quota»', async () => {
    const chiamate: { url: string; chiave: string | null }[] = [];
    const finte = [risposta(429, 'quota'), gemini('[{"nome":"uova","quantita":4,"unita":"pz"}]')];
    const chiama = (async (url: string, init: RequestInit) => {
      chiamate.push({ url, chiave: new Headers(init.headers).get('x-goog-api-key') });
      return finte.shift()!;
    }) as typeof fetch;
    expect(await riconosci('AAAA', 'segreta', chiama, ['a', 'b', 'c'])).toEqual({ alimenti: [{ nome: 'uova', quantita: 4, unita: 'pz' }], modello: 'b' });
    expect(chiamate.map((c) => c.url.match(/models\/(\w+):/)![1])).toEqual(['a', 'b']);
    expect(chiamate.every((c) => c.chiave === 'segreta' && !c.url.includes('segreta'))).toBe(true);

    const sempre429 = (async () => risposta(429, 'quota')) as typeof fetch;
    expect(await riconosci('AAAA', 'k', sempre429, ['a', 'b'])).toEqual({ errore: 'quota' });
    const chiaveSbagliata = (async () => risposta(400, '{"error":{"message":"API key not valid"}}')) as typeof fetch;
    expect(await riconosci('AAAA', 'k', chiaveSbagliata, ['a'])).toEqual({ errore: 'chiave' });
  });
});
