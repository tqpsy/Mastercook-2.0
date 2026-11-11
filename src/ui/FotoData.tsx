import { useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { type DataLetta, dataDiScadenza } from '../dominio/dataDaTesto';
import { leggiDataConGemini } from '../piattaforma/fotoFrigo';
import { riduciFoto } from './Foto';
import { LettoreData } from './LettoreData';
import { leggiTestoData } from './ocr';

/**
 * «Fotografa la data»: si apre la fotocamera dal vivo (LettoreData) e l'app legge la data stampata sulla confezione sul telefono.
 * Se così non si trova, si scatta una foto: la legge Gemini (chiave gratuita della famiglia, brava con le stampe a puntini,
 * sfocate o su metallo) e, senza rete o chiave, il telefono. Le foto non si salvano. Chi chiama controlla il risultato nel campo data.
 */
export function FotoData({ letta }: { letta: (d: DataLetta) => void }) {
  const { famiglia, dove, utenteId } = useFamiglia();
  const [stato, setStato] = useState<'pronto' | 'leggo'>('pronto');
  const [aperto, setAperto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  /** Dalla foto scattata (dopo che dal vivo non si è trovato nulla): Gemini, poi il telefono. */
  async function daFoto(file: Blob) {
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
      <button type="button" className="bottone piccolo" disabled={stato === 'leggo'} onClick={() => setAperto(true)}>
        <span aria-hidden>📷</span> {stato === 'leggo' ? 'Leggo la data…' : 'Fotografa la data'}
      </button>
      {aperto && <LettoreData trovata={letta} foto={(f) => void daFoto(f)} chiudi={() => setAperto(false)} />}
      {errore && (
        <div className="avviso errore" role="alert" style={{ marginTop: 8 }}>
          {errore}
        </div>
      )}
    </div>
  );
}
