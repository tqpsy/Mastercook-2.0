import { useId, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { type DataLetta, dataDiScadenza } from '../dominio/dataDaTesto';
import { leggiDataConGemini } from '../piattaforma/fotoFrigo';
import { riduciFoto } from './Foto';
import { leggiTestoData } from './ocr';

/**
 * «Fotografa la data»: si scatta la data stampata sulla confezione e l'app la legge sul telefono
 * Prima la legge Gemini (chiave gratuita della famiglia, molto più brava con le stampe a puntini, sfocate o su metallo),
 * poi, se non c'è rete o chiave, la legge il telefono. La foto non si salva. Chi chiama controlla il risultato nel campo data.
 */
export function FotoData({ letta }: { letta: (d: DataLetta) => void }) {
  const id = useId();
  const { famiglia, dove, utenteId } = useFamiglia();
  const [stato, setStato] = useState<'pronto' | 'leggo'>('pronto');
  const [errore, setErrore] = useState<string | null>(null);

  async function scelta(file: File | undefined) {
    if (!file) return;
    setErrore(null);
    setStato('leggo');
    try {
      let d: DataLetta | null = null;
      const g = await leggiDataConGemini(famiglia, await riduciFoto(file, 1600), { dove, utenteId });
      if ('data' in g && g.data) d = { data: g.data.data, ...(g.data.tipo ? { tipo: g.data.tipo } : {}) };
      // Senza rete, senza chiave o con la quota finita: la legge il telefono.
      else d = dataDiScadenza(await leggiTestoData(file));
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
