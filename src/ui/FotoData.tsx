import { useId, useState } from 'react';
import { type DataLetta, dataDiScadenza } from '../dominio/dataDaTesto';
import { riduciFoto } from './Foto';
import { leggiTestoSparso } from './ocr';

/**
 * «Fotografa la data»: si scatta la data stampata sulla confezione e l'app la legge sul telefono
 * (la foto non esce dal dispositivo). Chi chiama controlla il risultato nel campo data.
 */
export function FotoData({ letta }: { letta: (d: DataLetta) => void }) {
  const id = useId();
  const [stato, setStato] = useState<'pronto' | 'leggo'>('pronto');
  const [errore, setErrore] = useState<string | null>(null);

  async function scelta(file: File | undefined) {
    if (!file) return;
    setErrore(null);
    setStato('leggo');
    try {
      const d = dataDiScadenza(await leggiTestoSparso(await riduciFoto(file, 2000)));
      if (d) letta(d);
      else setErrore('Non trovo una data nella foto. Riprova più da vicino, oppure scrivila a mano.');
    } catch {
      setErrore('Non riesco a leggere la foto. Scrivi la data a mano.');
    } finally {
      setStato('pronto');
    }
  }

  return (
    <div>
      <label htmlFor={id} className="bottone piccolo" aria-disabled={stato === 'leggo'}>
        <span aria-hidden>📷</span> {stato === 'leggo' ? 'Leggo la data…' : 'Fotografa la data'}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={stato === 'leggo'}
        onChange={(e) => (void scelta(e.target.files?.[0]), (e.target.value = ''))}
      />
      {errore && (
        <div className="avviso errore" role="alert" style={{ marginTop: 8 }}>
          {errore}
        </div>
      )}
    </div>
  );
}
