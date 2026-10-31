/**
 * Il tasto Indietro del telefono (e del browser) dentro l'app.
 *
 * Ogni passo della navigazione (cambio di scheda, pannello aperto) si mette in una pila e ha una voce
 * nella cronologia del browser: Indietro toglie l'ultimo passo, cioè chiude il pannello in cima o torna
 * alla scheda di prima. Sotto a tutti c'è una «guardia»: quando non resta altro da chiudere, il primo
 * Indietro mostra «Premi di nuovo Indietro per uscire» e il secondo, entro poco, esce dall'app.
 *
 * Le voci nella cronologia portano solo la loro profondità ({ mc: n }): la pila in memoria è la verità
 * e la cronologia viene riallineata (aggiunte o tolte voci) in un momento solo, dopo ogni cambiamento.
 * Così i pannelli chiusi col loro bottone tolgono la loro voce, e il doppio montaggio di React in prova
 * non lascia voci in più.
 */

type Passo = { id: number; torna: () => void };

const pila: Passo[] = [];
let prossimoId = 1;
/** Passi indietro chiesti dall'app (per togliere voci): il loro popstate non è un tasto premuto. */
let daIgnorare = 0;
let inCoda = false;
let installato = false;

const ID_GUARDIA = 0;
const DURATA_AVVISO = 2000;

function profondita(): number {
  const s: unknown = history.state;
  return s && typeof s === 'object' && 'mc' in s && typeof s.mc === 'number' ? s.mc : 0;
}

function riallinea() {
  if (daIgnorare > 0) return; // si riprova quando arriva il popstate atteso
  const voluta = pila.length;
  const ora = profondita();
  if (voluta > ora) {
    for (let n = ora + 1; n <= voluta; n++) history.pushState({ ...(history.state ?? {}), mc: n }, '');
  } else if (voluta < ora) {
    daIgnorare++;
    history.go(voluta - ora);
  }
}

function programma() {
  if (inCoda) return;
  inCoda = true;
  queueMicrotask(() => {
    inCoda = false;
    riallinea();
  });
}

function suPopstate() {
  if (daIgnorare > 0) {
    daIgnorare--;
    programma();
    return;
  }
  const ora = profondita();
  // Di solito si toglie un passo solo; con voci rimaste indietro si torna ancora finché la pila combacia.
  while (pila.length > ora) pila.pop()!.torna();
  programma();
}

function mettiGuardia() {
  if (pila[0]?.id === ID_GUARDIA) return;
  pila.unshift({ id: ID_GUARDIA, torna: avvisaUscita });
  programma();
}

let avviso: HTMLDivElement | null = null;
let timerAvviso: ReturnType<typeof setTimeout> | undefined;

function avvisaUscita() {
  if (!avviso) {
    avviso = document.createElement('div');
    avviso.className = 'avviso-uscita';
    avviso.setAttribute('role', 'status');
    document.body.appendChild(avviso);
  }
  avviso.textContent = 'Premi di nuovo Indietro per uscire';
  avviso.classList.add('visibile');
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => {
    avviso?.classList.remove('visibile');
  }, DURATA_AVVISO);
}

/**
 * La guardia si mette (e si rimette dopo l'avviso) al tocco, non con un timer o all'apertura: Chrome
 * salta le voci aggiunte da una pagina senza un tocco dell'utente, e Indietro uscirebbe subito.
 * `pointerup` è il momento in cui il tocco conta come gesto dell'utente.
 */
function installa() {
  if (installato || typeof window === 'undefined') return;
  installato = true;
  window.addEventListener('popstate', suPopstate);
  window.addEventListener('pointerup', mettiGuardia, true);
  window.addEventListener('keydown', mettiGuardia, true);
}

/** Aggiunge un passo: Indietro chiamerà `torna`. Restituisce l'id per toglierlo se si chiude in altro modo. */
export function aggiungiPasso(torna: () => void): number {
  installa();
  const id = prossimoId++;
  pila.push({ id, torna });
  programma();
  return id;
}

/** Toglie un passo chiuso dall'app (bottone Chiudi, salvataggio…): sparisce anche la sua voce. */
export function togliPasso(id: number) {
  const i = pila.findIndex((p) => p.id === id);
  if (i < 0) return;
  pila.splice(i, 1);
  programma();
}

installa();

/** Solo per le prove. */
export const _perProve = { pila, avvisaUscita };
