import { describe, expect, it } from 'vitest';
import { binarizza, scalaPer, trovaScontrino } from './preparaScontrino';

/** Una foto finta in grigi: tavolo scuro, scontrino chiaro con righe di «testo», ombra da sinistra. */
function foto(w: number, h: number, carta: { x: number; y: number; w: number; h: number }) {
  const g = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ombra = 1 - 0.5 * (1 - x / w); // a sinistra metà della luce
      const dentro = x >= carta.x && x < carta.x + carta.w && y >= carta.y && y < carta.y + carta.h;
      const testo = dentro && (y - carta.y) % 20 >= 8 && (y - carta.y) % 20 < 12 && (x - carta.x) % 9 < 6 && x > carta.x + 10 && x < carta.x + carta.w - 10;
      g[y * w + x] = (testo ? 70 : dentro ? 225 : 90) * ombra;
    }
  }
  return g;
}

describe('preparazione della foto dello scontrino', () => {
  it('ritaglia lo scontrino dal tavolo, con un po’ di margine', () => {
    const r = trovaScontrino(foto(400, 600, { x: 120, y: 60, w: 160, h: 480 }), 400, 600);
    expect(r.x).toBeGreaterThan(90);
    expect(r.x).toBeLessThanOrEqual(120);
    expect(r.x + r.width).toBeGreaterThanOrEqual(280);
    expect(r.x + r.width).toBeLessThan(310);
    expect(r.y).toBeLessThanOrEqual(60);
    expect(r.y + r.height).toBeGreaterThanOrEqual(540);
  });

  it('se la carta riempie la foto (screenshot) non ritaglia', () => {
    expect(trovaScontrino(foto(300, 500, { x: 0, y: 0, w: 300, h: 500 }), 300, 500)).toEqual({ x: 0, y: 0, width: 300, height: 500 });
  });

  it('porta lo scontrino a una larghezza leggibile senza esagerare', () => {
    expect(scalaPer({ x: 0, y: 0, width: 700, height: 2000 })).toBe(2);
    expect(scalaPer({ x: 0, y: 0, width: 100, height: 300 })).toBe(3);
    const grande = scalaPer({ x: 0, y: 0, width: 3000, height: 9000 });
    expect(3000 * 9000 * grande * grande).toBeLessThanOrEqual(7_000_001);
  });

  it('nero sul testo e bianco sulla carta, anche nella parte in ombra', () => {
    const w = 200;
    const h = 200;
    const g = foto(w, h, { x: 0, y: 0, w, h });
    const bn = binarizza(g, w, h, 12);
    // Una lettera nella parte in ombra e una in quella illuminata; carta tra le righe.
    expect(bn[10 * w + 13]).toBe(0);
    expect(bn[10 * w + 175]).toBe(0);
    expect(bn[3 * w + 13]).toBe(255);
    expect(bn[3 * w + 175]).toBe(255);
    // In tutto, l'inchiostro è una parte piccola: le ombre non diventano macchie nere.
    const neri = bn.filter((v) => v === 0).length;
    expect(neri / bn.length).toBeLessThan(0.25);
  });
});
