import { type ChangeEvent, useMemo, useState } from 'react';
import { idDispositivo } from '../dati/contesto';
import { controllaFile, type FileEsportazione } from '../dati/esportazione';
import { useCatalogo } from '../dati/indice';
import { spiegaMotivo } from '../dati/messaggi';
import { convertiVecchio, eFileVecchio, type FileVecchio, leggiVecchio, personeVecchie } from '../dati/migrazione';
import { type Trasporto, VERSIONE_APP } from '../dati/tipi';
import { oggi } from '../dominio/scadenze';
import { supabase, trasportoSupabase } from '../piattaforma/supabase';

/**
 * Ripristino di un'esportazione: crea sempre una famiglia nuova, mai sopra quella aperta.
 * Accetta anche il file del vecchio Mastercook: prima mostra il rapporto (cosa entra e cosa no), poi importa.
 */
export function Ripristino({ nomeUtente, fatto, trasporto = trasportoSupabase }: { nomeUtente: string; fatto: (famiglia: string) => void; trasporto?: Trasporto }) {
  const [file, setFile] = useState<FileEsportazione | null>(null);
  const [vecchio, setVecchio] = useState<FileVecchio | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [attendi, setAttendi] = useState(false);
  const [ids, setIds] = useState(() => ({ comando: crypto.randomUUID(), famiglia: crypto.randomUUID() }));

  async function scegli(e: ChangeEvent<HTMLInputElement>) {
    setErrore(null);
    setFile(null);
    setVecchio(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const testo = await f.text();
    setIds({ comando: crypto.randomUUID(), famiglia: crypto.randomUUID() });
    let json: unknown = null;
    try {
      json = JSON.parse(testo);
    } catch {
      // Lo dice controllaFile.
    }
    if (eFileVecchio(json)) {
      const l = leggiVecchio(json);
      return l.valido ? setVecchio(l.file) : setErrore(l.motivo);
    }
    const c = controllaFile(testo);
    if (!c.valido) return setErrore(c.motivo);
    setFile(c.file);
  }

  async function ripristina(daCaricare: FileEsportazione, nome: string) {
    setAttendi(true);
    setErrore(null);
    try {
      const esito = await trasporto.applica({
        id: ids.comando,
        famiglia_id: ids.famiglia,
        tipo: 'ripristina_famiglia',
        dati: { file: daCaricare, nome: nome.slice(0, 80), nome_utente: nomeUtente || 'Io' },
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
          <button className="bottone primario pieno" onClick={() => void ripristina(file, `${String(file.tabelle.famiglia[0].nome)} (ripristinata)`)} disabled={attendi}>
            {attendi ? 'Ripristino…' : 'Ripristina in una famiglia nuova'}
          </button>
        </div>
      )}
      {vecchio && <DalVecchio vecchio={vecchio} attendi={attendi} importa={(f, nome) => void ripristina(f, nome)} />}
      {errore && <div className="avviso errore">{errore}</div>}
    </div>
  );
}

/** Il file del vecchio Mastercook: «tu chi sei?», il rapporto della prova a secco e il bottone per importare. */
function DalVecchio({ vecchio, attendi, importa }: { vecchio: FileVecchio; attendi: boolean; importa: (f: FileEsportazione, nome: string) => void }) {
  const catalogo = useCatalogo();
  const persone = useMemo(() => personeVecchie(vecchio), [vecchio]);
  const [io, setIo] = useState<string>(() => persone.find((p) => p.con_account)?.id ?? '');
  const conversione = useMemo(() => (catalogo ? convertiVecchio(vecchio, catalogo, { io: io || null, oggi: oggi(), adesso: new Date() }) : null), [vecchio, catalogo, io]);
  if (!conversione) return <p className="tenue">Preparo il rapporto…</p>;
  const { rapporto } = conversione;
  const e = rapporto.entra;

  async function conferma() {
    // Chi importa diventa la persona scelta: serve il suo id, che si legge dall'accesso.
    const { data } = await supabase().auth.getSession();
    const utente_id = data.session?.user.id;
    const { file } = convertiVecchio(vecchio, catalogo!, { io: io || null, utente_id, oggi: oggi(), adesso: new Date() });
    importa(file, `${rapporto.nome} (importata)`);
  }

  return (
    <div className="avviso info" aria-label="Importazione dal vecchio Mastercook">
      <p>
        <strong>{rapporto.nome}</strong>, dal vecchio Mastercook
        {rapporto.esportato_il ? `, scaricata il ${new Date(rapporto.esportato_il).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}` : ''}. Non ho ancora
        scritto nulla: ecco cosa succede se importi.
      </p>
      {persone.length > 0 && (
        <label className="campo">
          <span>Tu chi sei nel vecchio Mastercook?</span>
          <select className="dato" value={io} onChange={(x) => setIo(x.target.value)}>
            {persone.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
            <option value="">Nessuno di questi</option>
          </select>
        </label>
      )}
      <p style={{ marginBottom: 4 }}>
        <strong>Entra</strong>
      </p>
      <ul aria-label="Cosa entra" style={{ marginTop: 0 }}>
        <li>{e.persone} persone, con {e.vincoli} tra allergie, intolleranze ed esigenze</li>
        <li>{e.gusti} «piace» e «non piace»</li>
        <li>{e.ricette} ricette tue</li>
        <li>{e.lotti} cose in casa, con quantità e date</li>
        <li>{e.portate} piatti del menu da oggi in poi</li>
      </ul>
      {rapporto.da_controllare.length > 0 && (
        <>
          <p style={{ marginBottom: 4 }}>
            <strong>Da ricontrollare dopo</strong>
          </p>
          <ul aria-label="Da ricontrollare" style={{ marginTop: 0 }}>
            {rapporto.da_controllare.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {rapporto.scarti.length > 0 && (
        <details>
          <summary>Lasciati fuori ({rapporto.scarti.length})</summary>
          <ul aria-label="Lasciati fuori">
            {rapporto.scarti.map((s, i) => (
              <li key={i}>
                {s.cosa}: {s.motivo}
              </li>
            ))}
          </ul>
        </details>
      )}
      {rapporto.non_importato.length > 0 && (
        <details>
          <summary>Cosa resta solo nel vecchio</summary>
          <ul>
            {rapporto.non_importato.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      <p>Verrà creata una famiglia nuova. Il vecchio Mastercook resta com’è: se qualcosa non torna, elimini la famiglia importata e riprovi.</p>
      <button className="bottone primario pieno" onClick={() => void conferma()} disabled={attendi}>
        {attendi ? 'Importo…' : 'Importa in una famiglia nuova'}
      </button>
    </div>
  );
}
