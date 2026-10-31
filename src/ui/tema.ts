/**
 * Tema dell'app, scelto da Impostazioni e salvato su questo dispositivo.
 * «automatico» segue il telefono; «chiaro» e «scuro» lo fissano (attributo data-tema su <html>).
 */
export type Tema = 'automatico' | 'chiaro' | 'scuro';

const CHIAVE = 'mc-tema';

export function leggiTema(): Tema {
  try {
    const v = localStorage.getItem(CHIAVE);
    return v === 'chiaro' || v === 'scuro' ? v : 'automatico';
  } catch {
    return 'automatico';
  }
}

export function applicaTema(tema: Tema) {
  const radice = document.documentElement;
  if (tema === 'automatico') radice.removeAttribute('data-tema');
  else radice.setAttribute('data-tema', tema);
}

export function scegliTema(tema: Tema) {
  try {
    if (tema === 'automatico') localStorage.removeItem(CHIAVE);
    else localStorage.setItem(CHIAVE, tema);
  } catch {
    // Senza memoria del browser la scelta vale solo finché l'app resta aperta.
  }
  applicaTema(tema);
}
