import { type ChangeEvent, useState } from 'react';
import { idDispositivo } from '../dati/contesto';
import { controllaFile, type FileEsportazione } from '../dati/esportazione';
import { spiegaMotivo } from '../dati/messaggi';
import { VERSIONE_APP } from '../dati/tipi';
import { trasportoSupabase } from '../piattaforma/supabase';

/** Ripristino di un'esportazione: crea sempre una famiglia nuova, mai sopra quella aperta. */
export function Ripristino({ nomeUtente, fatto }: { nomeUtente: string; fatto: (famiglia: string) => void }) {
  const [file, setFile] = useState<FileEsportazione | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [attendi, setAttendi] = useState(false);
  const [ids, setIds] = useState(() => ({ comando: crypto.randomUUID(), famiglia: crypto.randomUUID() }));

  async function scegli(e: ChangeEvent<HTMLInputElement>) {
    setErrore(null);
    setFile(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const c = controllaFile(await f.text());
    if (!c.valido) return setErrore(c.motivo);
    setFile(c.file);
    setIds({ comando: crypto.randomUUID(), famiglia: crypto.randomUUID() });
  }

  async function ripristina() {
    if (!file) return;
    setAttendi(true);
    setErrore(null);
    try {
      const esito = await trasportoSupabase.applica({
        id: ids.comando,
        famiglia_id: ids.famiglia,
        tipo: 'ripristina_famiglia',
        dati: { file, nome: `${String(file.tabelle.famiglia[0].nome)} (ripristinata)`.slice(0, 80), nome_utente: nomeUtente || 'Io' },
        versione_app: VERSIONE_APP,
        dispositivo: idDispositivo(),
      });
      if (esito.esito === 'applicato') return fatto(ids.famiglia);
      setErrore(spiegaMotivo(esito.dettaglio.motivo));
    } catch {
      setErrore('Serve la connessione per ripristinare. Riprova appena sei online.');
    }
    setAttendi(false);
  }

  const data = file ? new Date(file.esportato_il).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return (
    <div style={{ textAlign: 'left' }}>
      <label className="campo">
        <span>File di esportazione (.json)</span>
        <input type="file" accept="application/json,.json" onChange={scegli} />
      </label>
      {file && (
        <div className="avviso info">
          <p>
            <strong>{String(file.tabelle.famiglia[0].nome)}</strong>, esportata il {data}: {file.conteggi.membro} persone, {file.conteggi.vincolo_alimentare} tra allergie, intolleranze ed esigenze.
          </p>
          <p>Verrà creata una famiglia nuova, separata da quelle che hai già. Gli inviti e gli accessi non vengono ripristinati.</p>
          <button className="bottone primario pieno" onClick={ripristina} disabled={attendi}>
            {attendi ? 'Ripristino…' : 'Ripristina in una famiglia nuova'}
          </button>
        </div>
      )}
      {errore && <div className="avviso errore">{errore}</div>}
    </div>
  );
}
