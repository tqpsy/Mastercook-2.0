import { describe, expect, it } from 'vitest';
import { leggiRaccoltaDocumento, leggiRaccoltaGemini } from './raccolta';

const gemini = (testo: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: testo }] } }] }), { status: 200 });

describe('calendario della raccolta differenziata con Gemini', () => {
  it('tiene solo tipi conosciuti e giorni validi, una volta per tipo', () => {
    expect(leggiRaccoltaGemini('{"raccolta":[{"tipo":"organico","giorni":[1,4,4]},{"tipo":"carta","giorni":[2]}]}')).toEqual([
      { tipo: 'organico', giorni: [1, 4] },
      { tipo: 'carta', giorni: [2] },
    ]);
    // Tipo sconosciuto, giorno fuori range, giorno non intero e doppione dello stesso tipo si scartano.
    expect(leggiRaccoltaGemini('{"raccolta":[{"tipo":"umido","giorni":[1]},{"tipo":"vetro","giorni":[7,2.5]},{"tipo":"vetro","giorni":[5]}]}')).toEqual([{ tipo: 'vetro', giorni: [5] }]);
    // Nessuno schema fisso trovato: elenco vuoto, non un errore.
    expect(leggiRaccoltaGemini('{"raccolta":[]}')).toEqual([]);
    expect(leggiRaccoltaGemini('{"raccolta":[{"tipo":"organico","giorni":[]}]}')).toEqual([]);
    expect(leggiRaccoltaGemini('non json')).toBeNull();
    expect(leggiRaccoltaGemini('{}')).toBeNull();
  });

  it('manda il documento e rende i giorni letti', async () => {
    let corpo = '';
    const chiama = (async (_u: unknown, o?: RequestInit) => {
      corpo = String(o?.body);
      return gemini('{"raccolta":[{"tipo":"organico","giorni":[1,4]},{"tipo":"plastica","giorni":[3,6]}]}');
    }) as typeof fetch;
    const r = await leggiRaccoltaDocumento('QUJD', 'application/pdf', 'chiave', chiama);
    expect(r).toMatchObject({
      raccolta: [
        { tipo: 'organico', giorni: [1, 4] },
        { tipo: 'plastica', giorni: [3, 6] },
      ],
    });
    expect(corpo).toContain('QUJD');
  });

  it('illeggibile se la risposta non si capisce, errore se Gemini non risponde', async () => {
    expect(await leggiRaccoltaDocumento('QUJD', 'application/pdf', 'k', (async () => gemini('non json')) as typeof fetch)).toEqual({ errore: 'illeggibile' });
    expect(await leggiRaccoltaDocumento('QUJD', 'application/pdf', 'k', (async () => new Response('{}', { status: 429 })) as typeof fetch, ['m'])).toMatchObject({ errore: 'quota' });
  });
});
