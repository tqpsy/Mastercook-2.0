import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  manda: vi.fn(),
  chiedi: vi.fn(),
  locale: vi.fn(),
  zonaLocale: vi.fn(),
}));
vi.mock('./fotoFrigo', () => ({
  mandaAlServer: server.manda,
  chiediLettura: server.chiedi,
  riconosciFotoLocale: server.locale,
  riconosciZonaLocale: server.zonaLocale,
  corpoFotoFrigo: async () => ({ immagine: 'x' }),
  corpoZona: async (_f: Blob[], contesto: string, ritardo: number) => ({ tipo: 'verifica', contesto, ritardo }),
}));

const memoria = new Map<string, string>();
beforeEach(() => {
  vi.useFakeTimers();
  memoria.clear();
  server.manda.mockReset();
  server.chiedi.mockReset();
  server.locale.mockReset();
  server.zonaLocale.mockReset();
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

    const { lettureCorrenti } = await import('./letturaFoto');
    expect(lettureCorrenti()[0]).toMatchObject({ fase: 'pronta', alimenti: [{ nome: 'latte' }] });
    expect(JSON.parse(memoria.get('mc-lettura-foto')!)[0]).toMatchObject({ famiglia: 'f1', luogoCasa: 'frigo' });
  });

  it('un errore del server chiude la lettura e la foto si può riprovare senza rifarla', async () => {
    const m = await import('./letturaFoto');
    server.manda.mockResolvedValue('ok');
    server.chiedi.mockResolvedValue({ stato: 'errore', errore: 'quota' });
    m.avviaLettura(base);
    await passa(3000);
    expect(m.siPuoRiprovare()).toBe(true);
    expect(m.lettureCorrenti()[0]).toMatchObject({ fase: 'errore', errore: 'quota' });
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
    memoria.set('mc-lettura-foto', JSON.stringify([{ id: 'abc', tipo: 'frigo', famiglia: 'altra', sede: { dove: 'server', utenteId: 'u' }, luogoCasa: 'frigo', parte: null, inizio: Date.now() }]));
    m.riprendiLettura('f1');
    expect(memoria.has('mc-lettura-foto')).toBe(false);
    memoria.set('mc-lettura-foto', JSON.stringify([{ id: 'abc', tipo: 'frigo', famiglia: 'f1', sede: { dove: 'server', utenteId: 'u' }, luogoCasa: 'freezer', parte: null, inizio: Date.now() }]));
    server.chiedi.mockResolvedValue({ stato: 'pronta', alimenti: [] });
    m.riprendiLettura('f1');
    await passa(0);
    expect(server.chiedi).toHaveBeenCalledWith('abc');
    expect(m.lettureCorrenti()[0]).toMatchObject({ id: 'abc', fase: 'pronta', luogoCasa: 'freezer' });
  });

  it('verifica sul server: una lettura per zona, tutte partono subito e le zone oltre la seconda con un ritardo', async () => {
    const m = await import('./letturaFoto');
    server.manda.mockImplementation(async (_f: string, _id: string, corpo: () => Promise<{ ritardo?: number }>) => {
      ritardi.push((await corpo()).ritardo ?? 0);
      return 'ok';
    });
    const ritardi: number[] = [];
    server.chiedi.mockResolvedValue({ stato: 'in_corso' });
    m.avviaVerifica({ famiglia: 'f1', sede: base.sede, zone: ['a', 'b', 'c', 'd', 'e'].map((z) => ({ zonaId: z, foto: [new Blob(['x'])], contesto: z })) });
    await passa(0);
    expect(server.manda).toHaveBeenCalledTimes(5);
    expect(ritardi.sort((x, y) => x - y)).toEqual([0, 0, 20, 20, 40]);
    expect(m.fotoDellaZona('c')).toHaveLength(1);
    expect(JSON.parse(memoria.get('mc-lettura-foto')!)).toHaveLength(5);

    server.chiedi.mockImplementation(async (id: string) => {
      const z = m.lettureCorrenti().find((l) => l.id === id)!.zonaId;
      return z === 'b' ? { stato: 'errore', errore: 'quota' } : { stato: 'pronta', alimenti: [], visti: [{ nome: z, codice: null, quantita: null, unita: null, certezza: 'sicuro' }] };
    });
    await passa(3000);
    const z = m.lettureCorrenti();
    expect(z.filter((l) => l.fase === 'pronta').map((l) => l.visti![0].nome).sort()).toEqual(['a', 'c', 'd', 'e']);
    expect(z.find((l) => l.zonaId === 'b')).toMatchObject({ fase: 'errore', errore: 'quota' });
    expect(m.siPuoRiprovare('zona')).toBe(true);
    m.scartaVerifica();
    expect(m.lettureCorrenti()).toEqual([]);
    expect(memoria.has('mc-lettura-foto')).toBe(false);
  });

  it('verifica in locale: due zone alla volta, le altre aspettano il loro turno', async () => {
    const m = await import('./letturaFoto');
    const finiture: (() => void)[] = [];
    server.zonaLocale.mockImplementation(() => new Promise((ok) => finiture.push(() => ok({ visti: [] }))));
    m.avviaVerifica({ famiglia: 'f1', sede: { dove: 'locale', utenteId: 'u' } as never, zone: ['a', 'b', 'c'].map((z) => ({ zonaId: z, foto: [new Blob(['x'])], contesto: z })) });
    await passa(0);
    expect(server.zonaLocale).toHaveBeenCalledTimes(2);
    expect(m.lettureCorrenti().map((l) => l.fase)).toEqual(['invio', 'invio', 'coda']);
    finiture[0]();
    await passa(0);
    expect(server.zonaLocale).toHaveBeenCalledTimes(3);
    expect(server.manda).not.toHaveBeenCalled();
  });
});
