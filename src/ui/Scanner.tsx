import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Foglio } from './Foglio';

type Formato = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'qr_code';

interface Rilevatore {
  detect(sorgente: HTMLVideoElement): Promise<{ rawValue: string; format: string }[]>;
}

/**
 * Il lettore di codici: quello del browser se c'è (Chrome su Android), altrimenti ZXing in WebAssembly
 * (Safari su iPhone), caricato solo quando serve. L'immagine della fotocamera resta sul telefono.
 */
async function rilevatore(formati: Formato[]): Promise<Rilevatore> {
  const nativo = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Rilevatore; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (nativo) {
    const supportati = (await nativo.getSupportedFormats?.()) ?? formati;
    if (formati.every((f) => supportati.includes(f))) return new nativo({ formats: formati });
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill');
  return new BarcodeDetector({ formats: formati }) as unknown as Rilevatore;
}

const PRODOTTI: Formato[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/**
 * Inquadra un codice con la fotocamera. Si può sempre scrivere il codice a mano: serve quando la
 * fotocamera non c'è, non ha il permesso o il codice è rovinato.
 */
export function Scanner({ titolo, qr, trovato, chiudi }: { titolo: string; qr?: boolean; trovato: (codice: string) => void; chiudi: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stato, setStato] = useState<'avvio' | 'pronto' | 'senza_camera'>('avvio');
  const [scritto, setScritto] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const fatto = useRef(trovato);
  useEffect(() => {
    fatto.current = trovato;
  }, [trovato]);

  useEffect(() => {
    let flusso: MediaStream | null = null;
    let fermo = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('nessuna fotocamera');
        flusso = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (fermo || !video.current) return;
        video.current.srcObject = flusso;
        await video.current.play();
        const r = await rilevatore(qr ? ['qr_code'] : PRODOTTI);
        setStato('pronto');
        const guarda = async () => {
          if (fermo || !video.current) return;
          try {
            const [primo] = await r.detect(video.current);
            if (primo?.rawValue && !fermo) {
              fermo = true;
              navigator.vibrate?.(60);
              fatto.current(primo.rawValue.trim());
              return;
            }
          } catch {
            // Un fotogramma non leggibile: si riprova al prossimo.
          }
          timer = setTimeout(guarda, 250);
        };
        void guarda();
      } catch {
        if (!fermo) setStato('senza_camera');
      }
    })();
    return () => {
      fermo = true;
      clearTimeout(timer);
      flusso?.getTracks().forEach((t) => t.stop());
    };
  }, [qr]);

  function scrivi(e: FormEvent) {
    e.preventDefault();
    const codice = scritto.replace(/\s/g, '');
    if (!qr && !/^\d{8,14}$/.test(codice)) return setErrore('Il codice a barre ha da 8 a 14 cifre.');
    if (!codice) return setErrore('Scrivi il codice.');
    trovato(codice);
  }

  return (
    <Foglio titolo={titolo} chiudi={chiudi}>
      {stato !== 'senza_camera' ? (
        <div className="scanner">
          <video ref={video} muted playsInline aria-label="Inquadratura della fotocamera" />
          <p className="tenue" aria-live="polite">
            {stato === 'avvio' ? 'Accendo la fotocamera…' : qr ? 'Inquadra il codice QR in fondo allo scontrino.' : 'Inquadra il codice a barre della confezione.'}
          </p>
        </div>
      ) : (
        <div className="avviso info">La fotocamera non è disponibile (o manca il permesso): scrivi il codice qui sotto.</div>
      )}
      <form onSubmit={scrivi} noValidate>
        <label className="campo">
          <span>{qr ? 'Oppure incolla il contenuto del QR' : 'Oppure scrivi le cifre sotto il codice'}</span>
          <input inputMode={qr ? 'text' : 'numeric'} value={scritto} onChange={(e) => setScritto(e.target.value)} />
        </label>
        {errore && (
          <div className="avviso errore" role="alert">
            {errore}
          </div>
        )}
        <button type="submit" className="bottone pieno">
          Usa questo codice
        </button>
      </form>
    </Foglio>
  );
}
