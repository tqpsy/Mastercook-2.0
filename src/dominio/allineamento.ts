/**
 * Confronto tra due elenchi di righe di scontrino letti dallo stesso scontrino (o dalla verità e da una lettura):
 * quali righe sono «la stessa». Serve alla misura della lettura (`valutazione.ts`) e al confronto tra due letture
 * della stessa foto (`doppiaLettura.ts`).
 */

/** Il nome senza maiuscole, accenti, spazi e punteggiatura: gli spazi persi dalla lettura non sono il problema qui. */
export const compatto = (s: string) =>
  s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');

function distanza(a: string, b: string): number {
  let prec = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let x = 1; x <= a.length; x++) {
    const riga = [x];
    for (let y = 1; y <= b.length; y++) riga[y] = Math.min(prec[y] + 1, riga[y - 1] + 1, prec[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    prec = riga;
  }
  return prec[b.length];
}

/** Quanto due nomi si somigliano, da 0 a 1. */
export function somiglianza(a: string, b: string): number {
  const [x, y] = [compatto(a), compatto(b)];
  if (!x && !y) return 1;
  return 1 - distanza(x, y) / Math.max(x.length, y.length);
}

/** Da questa somiglianza in su il nome si considera letto bene (una lettera ogni sette). */
export const SOGLIA_NOME = 0.85;
export const stessoPrezzo = (a: number, b: number) => Math.abs(a - b) < 0.005;

export interface RigaConfrontabile {
  descrizione: string;
  prezzo: number;
}

/**
 * Abbina le righe del primo elenco a quelle del secondo, nell'ordine dello scontrino: una riga è «la stessa» se il nome si
 * somiglia, oppure se il prezzo è uguale e il nome non è del tutto diverso (nome rovinato, prezzo giusto).
 * Massimizza la somiglianza totale; le righe senza coppia restano `null` (nel primo elenco) o non compaiono (nel secondo).
 */
export function allinea(prime: RigaConfrontabile[], seconde: RigaConfrontabile[]): (number | null)[] {
  const punti = (t: RigaConfrontabile, r: RigaConfrontabile) => {
    const nome = somiglianza(t.descrizione, r.descrizione);
    const p = stessoPrezzo(t.prezzo, r.prezzo);
    const s = nome * 0.7 + (p ? 0.3 : 0);
    return nome >= 0.5 || (p && nome >= 0.25) ? s : -Infinity;
  };
  const n = prime.length;
  const m = seconde.length;
  const tab = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const coppia = punti(prime[i], seconde[j]);
      tab[i][j] = Math.max(tab[i + 1][j], tab[i][j + 1], coppia === -Infinity ? -Infinity : coppia + tab[i + 1][j + 1]);
    }
  }
  const out: (number | null)[] = prime.map(() => null);
  for (let i = 0, j = 0; i < n && j < m; ) {
    const coppia = punti(prime[i], seconde[j]);
    if (coppia !== -Infinity && Math.abs(tab[i][j] - (coppia + tab[i + 1][j + 1])) < 1e-9) {
      out[i] = j;
      i++;
      j++;
    } else if (tab[i][j] === tab[i + 1][j]) i++;
    else j++;
  }
  return out;
}
