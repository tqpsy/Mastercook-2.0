import { afterEach, describe, expect, it, vi } from 'vitest';
import { cercaAggiornamento } from './aggiornamento';

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

function conRegistrazione(registrazione: unknown, onLine = true) {
  vi.stubGlobal('navigator', { onLine, serviceWorker: { getRegistration: async () => registrazione } });
}

afterEach(() => vi.unstubAllGlobals());

describe('Aggiorna l’app', () => {
  it('senza versione nuova non ricarica e dice che è già l’ultima', async () => {
    conRegistrazione({ update: async () => undefined, installing: null, waiting: null });
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('gia_ultima');
    expect(ricarica).not.toHaveBeenCalled();
  });

  it('con una versione nuova aspetta che si attivi e poi ricarica', async () => {
    const sw = swFinto('installing');
    const reg = { installing: null as unknown, waiting: null, update: async () => void (reg.installing = sw) };
    conRegistrazione(reg);
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
    conRegistrazione({ update: async () => undefined, installing: null, waiting: sw });
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('aggiornata');
    expect(sw.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(ricarica).toHaveBeenCalledOnce();
  });

  it('senza rete lo dice e non ricarica', async () => {
    conRegistrazione({ update: async () => Promise.reject(new Error('rete')), installing: null, waiting: null }, false);
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('senza_rete');
    expect(ricarica).not.toHaveBeenCalled();
  });

  it('senza service worker (prima apertura, browser vecchio) ricarica e basta', async () => {
    conRegistrazione(undefined);
    const ricarica = vi.fn();
    expect(await cercaAggiornamento(ricarica)).toBe('aggiornata');
    expect(ricarica).toHaveBeenCalledOnce();
  });
});
