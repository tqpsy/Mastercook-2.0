import { useEffect, useId, useRef, useState } from 'react';
import { type DataLetta, dataDiScadenza } from '../dominio/dataDaTesto';
import { nuovaConferma } from '../dominio/dataDalVivo';
import { Foglio } from './Foglio';
import { leggiScatole, liberaPaddle } from './paddle';

/** Dopo tanto senza una data confermata si propone di scattare una foto (letta da Gemini). */
const ATTESA_PROPOSTA_MS = 10_000;
/** La fascia del fotogramma che si legge: quasi tutta la larghezza, il centro in altezza (dentro il mirino). */
const FASCIA = { x: 0.05, y: 0.3, w: 0.9, h: 0.4 };

const dataBreve = (d: string) => d.split('-').reverse().join('/');

/**
 * «Fotografa la data» dal vivo, come l'obiettivo di Google: la fotocamera resta accesa e ogni mezzo secondo circa si legge
 * la fascia al centro (PaddleOCR, sul telefono: l'immagine non esce dal dispositivo). Appena la stessa data si legge due volte
 * di fila la si prende. Basta un fotogramma a fuoco: la sfocatura di una foto sola non è più un problema.
 * Se non si trova nulla, si può scattare una foto (`foto`) e farla leggere a Gemini; senza fotocamera, scegliere un file.
 */
export function LettoreData({ trovata, foto, chiudi }: { trovata: (d: DataLetta) => void; foto: (f: Blob) => void; chiudi: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const id = useId();
  const [stato, setStato] = useState<'avvio' | 'carico' | 'cerco' | 'senza_camera'>('avvio');
  const [vista, setVista] = useState<string | null>(null);
  const [propongo, setPropongo] = useState(false);
  const fatto = useRef({ trovata, chiudi });
  useEffect(() => {
    fatto.current = { trovata, chiudi };
  }, [trovata, chiudi]);

  useEffect(() => {
    let flusso: MediaStream | null = null;
    let fermo = false;
    const proposta = setTimeout(() => setPropongo(true), ATTESA_PROPOSTA_MS);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('nessuna fotocamera');
        flusso = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
        if (fermo || !video.current) return;
        video.current.srcObject = flusso;
        await video.current.play();
      } catch {
        if (!fermo) setStato('senza_camera');
        return;
      }
      setStato('carico');
      const conferma = nuovaConferma();
      const tela = document.createElement('canvas');
      let primo = true;
      while (!fermo && video.current) {
        const v = video.current;
        if (v.videoWidth > 0) {
          const sw = v.videoWidth * FASCIA.w;
          const sh = v.videoHeight * FASCIA.h;
          const scala = Math.min(1, 1280 / sw);
          tela.width = Math.round(sw * scala);
          tela.height = Math.round(sh * scala);
          tela.getContext('2d', { willReadFrequently: true })!.drawImage(v, v.videoWidth * FASCIA.x, v.videoHeight * FASCIA.y, sw, sh, 0, 0, tela.width, tela.height);
          try {
            const { scatole } = await leggiScatole(tela, () => undefined);
            if (fermo) return;
            if (primo) {
              primo = false;
              setStato('cerco');
            }
            const letta = dataDiScadenza(scatole.map((s) => s.testo).join('\n'));
            setVista(letta ? dataBreve(letta.data) : null);
            const sicura = conferma.registra(letta);
            if (sicura) {
              fermo = true;
              navigator.vibrate?.(60);
              fatto.current.trovata(sicura);
              fatto.current.chiudi();
              return;
            }
          } catch {
            // I modelli non si caricano (niente rete la prima volta, poca memoria): si passa alla foto.
            if (!fermo) {
              setStato('cerco');
              setPropongo(true);
            }
            return;
          }
        }
        await new Promise((ok) => setTimeout(ok, 150));
      }
    })();
    return () => {
      fermo = true;
      clearTimeout(proposta);
      flusso?.getTracks().forEach((t) => t.stop());
      void liberaPaddle().catch(() => undefined);
    };
  }, []);

  function scatta() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob(
      (b) => {
        if (!b) return;
        foto(b);
        chiudi();
      },
      'image/jpeg',
      0.85,
    );
  }

  return (
    <Foglio titolo="Fotografa la data" chiudi={chiudi}>
      {stato !== 'senza_camera' ? (
        <div className="scanner">
          <div className="scanner-cornice">
            <video ref={video} muted playsInline aria-label="Inquadratura della fotocamera" />
            <div className="mirino" aria-hidden />
          </div>
          <p className="tenue" aria-live="polite">
            {stato === 'avvio' && 'Accendo la fotocamera…'}
            {stato === 'carico' && 'Preparo la lettura (la prima volta ci mette un po’)…'}
            {stato === 'cerco' && (vista ? `Vedo ${vista}… la controllo ancora una volta.` : 'Avvicina la data al riquadro e tieni fermo.')}
          </p>
          {propongo && stato !== 'avvio' && (
            <button type="button" className="bottone pieno" onClick={scatta}>
              Non la trova? Scatta una foto
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="avviso info">La fotocamera dal vivo non è disponibile (o manca il permesso): scatta una foto.</div>
          <label htmlFor={id} className="bottone pieno">
            <span aria-hidden>📷</span> Scatta una foto
          </label>
          <input
            id={id}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                foto(f);
                chiudi();
              }
            }}
          />
        </>
      )}
    </Foglio>
  );
}
