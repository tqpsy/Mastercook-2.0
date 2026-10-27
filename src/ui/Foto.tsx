import { useEffect, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { scaricaFoto } from '../piattaforma/supabase';

/** Lato lungo massimo: abbastanza per il tablet, leggera da caricare (di solito 150–300 KB). */
const LATO = 1280;

/** Riduce la foto scattata o scelta a un JPEG di al massimo 1280 px. */
export async function riduciFoto(file: Blob): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scala = Math.min(1, LATO / Math.max(img.width, img.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(img.width * scala);
  tela.height = Math.round(img.height * scala);
  tela.getContext('2d')!.drawImage(img, 0, 0, tela.width, tela.height);
  img.close();
  return new Promise((ok, ko) => tela.toBlob((b) => (b ? ok(b) : ko(new Error('foto non leggibile'))), 'image/jpeg', 0.82));
}

/**
 * L'immagine di un file: prima dal dispositivo (anche senza rete), altrimenti dal deposito,
 * e poi tenuta sul dispositivo per le volte successive.
 */
export function useFoto(percorso: string | null | undefined, file?: Blob | null): { url: string | null; pronta: boolean } {
  const { archivio, famiglia } = useFamiglia();
  const [stato, setStato] = useState<{ url: string | null; pronta: boolean }>({ url: null, pronta: false });
  useEffect(() => {
    let valido = true;
    let creato: string | null = null;
    const mostra = (b: Blob) => {
      if (!valido) return;
      creato = URL.createObjectURL(b);
      setStato({ url: creato, pronta: true });
    };
    void (async () => {
      if (file) return mostra(file);
      if (!percorso) return setStato({ url: null, pronta: true });
      const locale = await archivio.foto.get(percorso);
      if (locale) return mostra(locale.file);
      const remoto = await scaricaFoto(percorso);
      if (!remoto) return valido && setStato({ url: null, pronta: true });
      await archivio.foto.put({ percorso, famiglia_id: famiglia, file: remoto, caricata: true });
      mostra(remoto);
    })();
    return () => {
      valido = false;
      if (creato) URL.revokeObjectURL(creato);
    };
  }, [archivio, famiglia, percorso, file]);
  return stato;
}

export function Foto({ percorso, file, alt }: { percorso: string | null | undefined; file?: Blob | null; alt: string }) {
  const { url, pronta } = useFoto(percorso, file);
  if (!percorso && !file) return null;
  if (!url) return !pronta ? <div className="foto vuota" aria-busy="true" /> : <div className="foto vuota">📷 Foto non disponibile senza rete</div>;
  return <img className="foto" src={url} alt={alt} />;
}
