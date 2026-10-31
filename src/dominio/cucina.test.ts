import { describe, expect, it } from 'vitest';
import { ingredientiNelTesto, minutiNelTesto } from './cucina';

describe('modalità cucina', () => {
  it('trova i minuti per il timer', () => {
    expect(minutiNelTesto('Cuoci la pasta per 8 minuti in acqua salata.')).toBe(8);
    expect(minutiNelTesto('Inforna per 10-12 min.')).toBe(10);
    expect(minutiNelTesto('Rosola il guanciale finché è croccante.')).toBeNull();
    expect(minutiNelTesto('Aggiungi 2 uova')).toBeNull();
  });
  it('mostra solo gli ingredienti nominati nel passaggio', () => {
    const ingredienti = [
      { nome: 'Guanciale', parole: ['guanciale'], quantita: '150 g' },
      { nome: 'Uova', parole: ['uova', 'uovo', 'tuorli'], quantita: '4 pz' },
      { nome: 'Sale', parole: ['sale'], quantita: 'q.b.' },
    ];
    expect(ingredientiNelTesto('Rosola il Guanciale a fuoco medio.', ingredienti).map((i) => i.nome)).toEqual(['Guanciale']);
    expect(ingredientiNelTesto('Sbatti i tuorli con il pecorino.', ingredienti).map((i) => i.nome)).toEqual(['Uova']);
  });
});

describe('ingredienti nel passaggio: parole intere', () => {
  const ingredienti = [
    { nome: 'Sale', parole: ['sale'], quantita: 'q.b.' },
    { nome: 'Pomodori', parole: ['pomodori', 'pomodoro'], quantita: '400 g' },
  ];
  it('«sale» non è «salata», «pomodoro» trova «pomodori»', () => {
    expect(ingredientiNelTesto('Cuoci in acqua salata.', ingredienti)).toEqual([]);
    expect(ingredientiNelTesto('Aggiungi il sale e i pomodori.', ingredienti).map((i) => i.nome)).toEqual(['Sale', 'Pomodori']);
  });
});
