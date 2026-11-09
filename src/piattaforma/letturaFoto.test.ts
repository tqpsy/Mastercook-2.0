import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  manda: vi.fn(),
  chiedi: vi.fn(),
  locale: vi.fn(),
}));
vi.mock('./fotoFrigo', () => ({
  mandaFotoAlServer: server.manda,
  chiediLettura: server.chiedi,
  riconosciFotoLocale: server.locale,
}));

const memoria = new Map<string, string>();
beforeEach(() => {
  vi.useFakeTimers();
  memoria.clear();
  server.manda.mockReset();
  server.chiedi.mockReset();
  server.locale.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => void memoria.set(k, v),
    removeItem: (k: string) => void memoria.delete(k),
  });
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', { addEventListener: () => {} });
});
afterEach(async () => {
  const { scartaLettura } = await import('./letturaFoto');
  scartaLettura();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const base = { famiglia: 'f1', sede: { dove: 'server', utenteId: 'u' } as never, luogoCasa: 'frigo', parte: null, descrizione: null, foto: new Blob(['x']) };
const passa = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('lettura della foto del frigo fuori dalla schermata', () => {
  it('se la foto non è arrivata (app in tasca durante l’invio) la rimanda con lo stesso id e poi trova il risultato', async () => {
    const { avviaLettura } = await import('./letturaFoto');
    server.manda.mockResolvedValueOnce('rete').mockResolvedValue('ok');
    server.chiedi.mockResolvedValueOnce({ stato: 'assente' }).mockResolvedValueOnce({ stato: 'assente' }).mockResolvedValueOnce({ stato: 'in_corso' });
    server.chiedi.mockResolvedValue({ stato: 'pronta', alimenti: [{ nome: 'latte', quantita: null, unita: null }] });

    avviaLettura(base);
    await passa(0);
    expect(server.manda).toHaveBeenCalledTimes(1);
    await passa(20_000);
    expect(server.manda).toHaveBeenCalledTimes(2);
    // Stesso id: ripetere non fa doppi effetti sul server.
    expect(server.manda.mock.calls[1][1]).toBe(server.manda.mock.calls[0][1]);

    const { letturaCorrente } = await import('./letturaFoto');
    expect(letturaCorrente()).toMatchObject({ fase: 'pronta', alimenti: [{ nome: 'latte' }] });
    expect(JSON.parse(memoria.get('mc-lettura-foto')!)).toMatchObject({ famiglia: 'f1', luogoCasa: 'frigo' });
  });

  it('un errore del server chiude la lettura e la foto si può riprovare senza rifarla', async () => {
    const m = await import('./letturaFoto');
    server.manda.mockResolvedValue('ok');
    server.chiedi.mockResolvedValue({ stato: 'errore', errore: 'quota' });
    m.avviaLettura(base);
    await passa(3000);
    expect(m.siPuoRiprovare()).toBe(true);
    expect(m.letturaCorrente()).toMatchObject({ fase: 'errore', errore: 'quota' });
    server.chiedi.mockResolvedValue({ stato: 'in_corso' });
    m.riprovaLettura();
    await passa(0);
    expect(server.manda).toHaveBeenCalledTimes(2);
    expect(server.manda.mock.calls[1][1]).not.toBe(server.manda.mock.calls[0][1]);
  });

  it('famiglia solo sul telefono: legge in locale e la foto si tiene finché non è pronta', async () => {
    const m = await import('./letturaFoto');
    server.locale.mockResolvedValue({ errore: 'rete' });
    m.avviaLettura({ ...base, sede: { dove: 'locale', utenteId: 'u' } as never });
    await passa(0);
    expect(server.manda).not.toHaveBeenCalled();
    expect(m.siPuoRiprovare()).toBe(true);
    server.locale.mockResolvedValue({ alimenti: [{ nome: 'uova', quantita: 6, unita: 'pz' }] });
    m.riprovaLettura();
    await passa(0);
    expect(m.siPuoRiprovare()).toBe(false);
  });

  it('riprendendo l’app ritrova una lettura del server già in corso, e scarta quelle di un’altra famiglia', async () => {
    const m = await import('./letturaFoto');
    memoria.set('mc-lettura-foto', JSON.stringify({ id: 'abc', famiglia: 'altra', sede: { dove: 'server', utenteId: 'u' }, luogoCasa: 'frigo', parte: null, inizio: Date.now() }));
    m.riprendiLettura('f1');
    expect(memoria.has('mc-lettura-foto')).toBe(false);
    memoria.set('mc-lettura-foto', JSON.stringify({ id: 'abc', famiglia: 'f1', sede: { dove: 'server', utenteId: 'u' }, luogoCasa: 'freezer', parte: null, inizio: Date.now() }));
    server.chiedi.mockResolvedValue({ stato: 'pronta', alimenti: [] });
    m.riprendiLettura('f1');
    await passa(0);
    expect(server.chiedi).toHaveBeenCalledWith('abc');
    expect(m.letturaCorrente()).toMatchObject({ id: 'abc', fase: 'pronta', luogoCasa: 'freezer' });
  });
});
