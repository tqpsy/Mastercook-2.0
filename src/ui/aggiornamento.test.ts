import { afterEach, describe, expect, it, vi } from 'vitest';

const VERSIONE_PAGINA = '2026-11-20T10:00:00.000Z';

/** Un service worker finto che passa da «installing» ad «activated» quando gli si chiede. */
function swFinto(stato: ServiceWorkerState) {
  const ascoltatori: (() => void)[] = [];
  const sw = {
    state: stato,
    postMessage: vi.fn(),
    addEventListener: (_: string, f: () => void) => ascoltatori.push(f),
    attiva() {
      sw.state = 'activated';
      ascoltatori.forEach((f) => f());
    },
  };
  return sw;
}

/**
 * Prepara il telefono finto e carica il modulo da capo (la versione della pagina e l'ascolto del cambio
 * di service worker si leggono quando il modulo si carica).
 * `pubblicata` è la versione che il server dichiara in versione.json (null: il file non risponde).
 */
async function conRegistrazione(registrazione: unknown, { onLine = true, pubblicata = VERSIONE_PAGINA as string | null } = {}) {
  const ascoltatori: (() => void)[] = [];
  vi.stubGlobal('__COSTRUITA_IL__', VERSIONE_PAGINA);
  vi.stubGlobal('navigator', {
    onLine,
    serviceWorker: {
      controller: {},
      getRegistration: async () => registrazione,
      addEventListener: (tipo: string, f: () => void) => tipo === 'controllerchange' && ascoltatori.push(f),
    },
  });
  const fetchFinto = vi.fn(async () =>
    pubblicata === null ? new Response('', { status: 404 }) : Response.json({ costruita_il: pubblicata }),
  );
  vi.stubGlobal('fetch', fetchFinto);
  vi.resetModules();
  const modulo = await import('./aggiornamento');
  return { ...modulo, fetchFinto, cambiaController: () => ascoltatori.forEach((f) => f()) };
}

afterEach(() => vi.unstubAllGlobals());

describe('Aggiorna l’app', () => {
  it('senza versione nuova non ricarica e dice che è già l’ultima', async () => {
    const { cercaAggiornamento, fetchFinto } = await conRegistrazione({ update: async () => undefined, installing: null, waiting: null, active: null });
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('gia_ultima');
    expect(ricarica).not.toHaveBeenCalled();
    expect(fetchFinto).toHaveBeenCalledWith(expect.stringContaining('versione.json'), { cache: 'no-store' });
  });

  it('con una versione nuova aspetta che si attivi e poi ricarica', async () => {
    const sw = swFinto('installing');
    const reg = { installing: null as unknown, waiting: null, update: async () => void (reg.installing = sw) };
    const { cercaAggiornamento } = await conRegistrazione(reg);
    const ricarica = vi.fn();
    const esito = cercaAggiornamento(ricarica);
    await new Promise((r) => setTimeout(r, 0));
    expect(ricarica).not.toHaveBeenCalled();
    sw.attiva();
    expect(await esito).toBe('aggiornata');
    expect(ricarica).toHaveBeenCalledOnce();
  });

  it('una versione rimasta in attesa viene fatta partire', async () => {
    const sw = swFinto('installed');
    sw.postMessage.mockImplementation(() => sw.attiva());
    const { cercaAggiornamento } = await conRegistrazione({ update: async () => undefined, installing: null, waiting: sw });
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('aggiornata');
    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(ricarica).toHaveBeenCalledOnce();
  });

  // Il caso più comune: all'apertura il service worker nuovo si è già installato e attivato da solo,
  // ma la pagina è ancora la vecchia. `update()` non trova niente, eppure bisogna ricaricare.
  it('se il nuovo si è già attivato da solo e la pagina è rimasta indietro, ricarica', async () => {
    const { cercaAggiornamento } = await conRegistrazione(
      { update: async () => undefined, installing: null, waiting: null, active: swFinto('activated') },
      { pubblicata: '2026-11-25T08:00:00.000Z' },
    );
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('aggiornata');
    expect(ricarica).toHaveBeenCalledOnce();
  });

  it('se un service worker nuovo ha preso il controllo dopo l’apertura, ricarica anche senza chiedere al server', async () => {
    const { cercaAggiornamento, cambiaController, fetchFinto } = await conRegistrazione(
      { update: async () => undefined, installing: null, waiting: null, active: swFinto('activated') },
      { pubblicata: null },
    );
    cambiaController();
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('aggiornata');
    expect(ricarica).toHaveBeenCalledOnce();
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('se il server non dice la sua versione e niente è cambiato, è già l’ultima', async () => {
    const { cercaAggiornamento } = await conRegistrazione(
      { update: async () => undefined, installing: null, waiting: null, active: swFinto('activated') },
      { pubblicata: null },
    );
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('gia_ultima');
    expect(ricarica).not.toHaveBeenCalled();
  });

  it('senza rete lo dice e non ricarica', async () => {
    const { cercaAggiornamento } = await conRegistrazione(
      { update: async () => Promise.reject(new Error('rete')), installing: null, waiting: null },
      { onLine: false },
    );
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('senza_rete');
    expect(ricarica).not.toHaveBeenCalled();
  });

  it('senza service worker (prima apertura, browser vecchio) ricarica e basta', async () => {
    const { cercaAggiornamento } = await conRegistrazione(undefined);
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('aggiornata');
    expect(ricarica).toHaveBeenCalledOnce();
  });
});
