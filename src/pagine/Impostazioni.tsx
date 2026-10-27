import { useEffect, useState } from 'react';
import { idDispositivo, righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { esporta } from '../dati/esportazione';
import { spiegaMotivo } from '../dati/messaggi';
import { VERSIONE_APP } from '../dati/tipi';
import { impostaChiave, type StatoChiave, statoChiave } from '../piattaforma/fotoFrigo';
import { eliminaFamiglia, type FamigliaMia, mieFamiglie, trasportoSupabase } from '../piattaforma/supabase';
import { Ripristino } from '../ui/Ripristino';

export function Impostazioni({ email, esci, apriFamiglia }: { email: string; esci: () => void; apriFamiglia: (famiglia: string) => void }) {
  const { ruolo, utenteId } = useFamiglia();
  const vista = useVista();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const amministratore = ruolo === 'amministratore';

  return (
    <>
      <h2>Famiglia</h2>
      <div className="scheda">
        {famiglia && amministratore ? <NomeFamiglia nome={String(famiglia.nome)} versione={famiglia.versione ?? 1} /> : <p>{String(famiglia?.nome ?? '')}</p>}
      </div>

      {amministratore && <Inviti />}
      <Accessi amministratore={amministratore} io={utenteId} />
      <ChiaveGemini amministratore={amministratore} />
      <IMieiDati nomeFamiglia={String(famiglia?.nome ?? 'famiglia')} apriFamiglia={apriFamiglia} />
      {amministratore && famiglia && <EliminaFamiglia nome={String(famiglia.nome)} apriFamiglia={apriFamiglia} />}

      <h2>Questo dispositivo</h2>
      <div className="scheda">
        <p>
          Accesso come <strong>{email}</strong>
        </p>
        <p className="tenue">Versione dell’app {VERSIONE_APP}</p>
        <button className="bottone pieno" onClick={esci}>
          Esci
        </button>
      </div>
    </>
  );
}

function NomeFamiglia({ nome, versione }: { nome: string; versione: number }) {
  const { esegui } = useFamiglia();
  const [testo, setTesto] = useState(nome);
  return (
    <form
      className="campo"
      style={{ margin: 0 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (testo.trim() && testo.trim() !== nome) void esegui('modifica_famiglia', { versione_attesa: versione, campi: { nome: testo.trim() } });
      }}
    >
      <span>Nome della famiglia</span>
      <div className="riga">
        <input className="cresce" value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={80} required />
        {testo.trim() !== nome && <button className="bottone primario piccolo">Salva</button>}
      </div>
    </form>
  );
}

function linkInvito(codice: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}#invito=${codice}`;
}

function Inviti() {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const [copiato, setCopiato] = useState<string | null>(null);
  const [adesso] = useState(() => Date.now());
  const inviti = righeAttive(vista, 'invito').filter(
    (i) => !i.revocato && (i.in_attesa || (new Date(String(i.scade_il)).getTime() > adesso && Number(i.usi) < Number(i.usi_massimi))),
  );

  async function condividi(codice: string) {
    const url = linkInvito(codice);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mastercook', text: 'Entra nella nostra famiglia su Mastercook', url });
        return;
      }
    } catch {
      // Condivisione annullata: si prova a copiare.
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiato(codice);
    } catch {
      window.prompt('Copia questo link e mandalo:', url);
    }
  }

  return (
    <>
      <h2>Inviti</h2>
      <div className="scheda">
        <p className="tenue">Manda il link a chi vuoi far entrare: accede con Google ed è dentro. Ogni link vale 7 giorni e per 5 persone.</p>
        <ul className="elenco">
          {inviti.map((i) => (
            <li key={i.id}>
              {i.in_attesa || !i.codice ? (
                <span className="tenue">Creo il link…</span>
              ) : (
                <div className="riga" style={{ flexWrap: 'wrap' }}>
                  <span className="cresce tenue">
                    Scade il {new Date(String(i.scade_il)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} · usato {String(i.usi)} di {String(i.usi_massimi)}
                  </span>
                  <button className="bottone primario piccolo" onClick={() => condividi(String(i.codice))}>
                    {copiato === i.codice ? 'Copiato' : 'Condividi'}
                  </button>
                  <button className="bottone pericolo piccolo" onClick={() => esegui('revoca_invito', { id: i.id })}>
                    Annulla
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button className="bottone pieno" onClick={() => esegui('crea_invito', { id: crypto.randomUUID(), giorni: 7, usi_massimi: 5 })}>
          Crea un link d’invito
        </button>
      </div>
    </>
  );
}

function Accessi({ amministratore, io }: { amministratore: boolean; io: string }) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const accessi = righeAttive(vista, 'utente_famiglia');
  const membri = righeAttive(vista, 'membro');
  return (
    <>
      <h2>Chi usa l’app</h2>
      <div className="scheda">
        <ul className="elenco">
          {accessi.map((a) => {
            const m = membri.find((x) => x.utente_id === a.utente_id);
            return (
              <li key={a.id} className="riga">
                <span className="emoji">{String(m?.emoji ?? '🙂')}</span>
                <span className="cresce">
                  <strong>{String(m?.nome ?? 'Senza nome')}</strong>
                  {a.utente_id === io && ' (tu)'}
                  <span className="tenue" style={{ display: 'block' }}>
                    {a.ruolo === 'amministratore' ? 'Amministra la famiglia' : 'Familiare'}
                  </span>
                </span>
                {amministratore && a.utente_id !== io && (
                  <button
                    className="bottone pericolo piccolo"
                    onClick={() => {
                      if (window.confirm(`Togliere l’accesso a ${String(m?.nome ?? 'questa persona')}? Il suo profilo resta tra chi mangia a casa.`)) {
                        void esegui('rimuovi_accesso', { id: a.id });
                      }
                    }}
                  >
                    Togli
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function IMieiDati({ nomeFamiglia, apriFamiglia }: { nomeFamiglia: string; apriFamiglia: (famiglia: string) => void }) {
  const { famiglia, utenteId } = useFamiglia();
  const vista = useVista();
  const io = righeAttive(vista, 'membro').find((m) => m.utente_id === utenteId);
  const [stato, setStato] = useState<string | null>(null);
  const [altre, setAltre] = useState<FamigliaMia[]>([]);
  const [ripristino, setRipristino] = useState(false);

  useEffect(() => {
    let valido = true;
    mieFamiglie()
      .then((f) => valido && setAltre(f))
      .catch(() => undefined);
    return () => {
      valido = false;
    };
  }, []);

  async function scarica() {
    setStato('Preparo il file…');
    try {
      const file = await esporta(trasportoSupabase, famiglia);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const giorno = new Date().toISOString().slice(0, 10);
      a.download = `mastercook-${nomeFamiglia.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${giorno}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStato(`Scaricato: ${file.conteggi.membro} persone, ${file.conteggi.vincolo_alimentare} tra allergie ed esigenze.`);
    } catch {
      setStato('Serve la connessione per esportare: il file si prepara dal server, così è completo.');
    }
  }

  return (
    <>
      <h2>I tuoi dati</h2>
      <div className="scheda">
        <p className="tenue">Scarica una copia completa dei dati della famiglia in un file che puoi conservare. Si può ripristinare in qualsiasi momento.</p>
        <button className="bottone pieno" onClick={scarica}>
          Scarica un’esportazione
        </button>
        {stato && <p className="tenue" style={{ marginTop: 10 }}>{stato}</p>}
        <button className="bottone pieno" style={{ marginTop: 10 }} onClick={() => setRipristino((x) => !x)}>
          Ripristina da un file
        </button>
        {ripristino && (
          <div style={{ marginTop: 12 }}>
            <Ripristino nomeUtente={String(io?.nome ?? '')} fatto={apriFamiglia} />
          </div>
        )}
        {altre.length > 1 && (
          <>
            <h3 style={{ marginTop: 18 }}>Le tue famiglie</h3>
            <ul className="elenco">
              {altre.map((f) => (
                <li key={f.famiglia_id} className="riga">
                  <span className="cresce">{f.nome}</span>
                  {f.famiglia_id === famiglia ? (
                    <span className="tenue">aperta</span>
                  ) : (
                    <button className="bottone piccolo" onClick={() => apriFamiglia(f.famiglia_id)}>
                      Apri
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Eliminare la famiglia: per tornare indietro dopo un'importazione, o per cancellare i propri dati.
 * Si conferma riscrivendo il nome; poi si apre un'altra famiglia, se c'è.
 */
function EliminaFamiglia({ nome, apriFamiglia }: { nome: string; apriFamiglia: (famiglia: string) => void }) {
  const { famiglia, archivio } = useFamiglia();
  const [scritto, setScritto] = useState('');
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function elimina() {
    setAttendi(true);
    setErrore(null);
    try {
      const altre = await mieFamiglie().catch(() => [] as FamigliaMia[]);
      const esito = await eliminaFamiglia(famiglia, scritto.trim(), idDispositivo(), VERSIONE_APP);
      if (esito.esito !== 'applicato') {
        setErrore(spiegaMotivo(esito.dettaglio.motivo));
        return setAttendi(false);
      }
      // Anche la copia su questo dispositivo va via.
      await archivio.transaction('rw', [archivio.righe, archivio.coda, archivio.cursori, archivio.foto], async () => {
        await archivio.righe.where('famiglia_id').equals(famiglia).delete();
        await archivio.coda.where('famiglia_id').equals(famiglia).delete();
        await archivio.cursori.delete(famiglia);
        await archivio.foto.where('famiglia_id').equals(famiglia).delete();
      });
      apriFamiglia(altre.find((f) => f.famiglia_id !== famiglia)?.famiglia_id ?? '');
    } catch {
      setErrore('Serve la connessione per eliminare la famiglia. Riprova appena sei online.');
      setAttendi(false);
    }
  }

  return (
    <div className="scheda">
      <details>
        <summary>Elimina questa famiglia</summary>
        <p className="tenue">
          Cancella per sempre persone, allergie, ricette, casa, menu, spesa e accessi di «{nome}», per tutti. Serve anche per tornare indietro dopo
          un’importazione dal vecchio Mastercook. Prima, se vuoi, scarica un’esportazione.
        </p>
        <label className="campo">
          <span>Per confermare scrivi il nome della famiglia</span>
          <input className="dato" value={scritto} onChange={(e) => setScritto(e.target.value)} placeholder={nome} />
        </label>
        <button className="bottone pericolo pieno" disabled={attendi || scritto.trim() !== nome.trim()} onClick={() => void elimina()}>
          {attendi ? 'Elimino…' : 'Elimina per sempre'}
        </button>
        {errore && (
          <div className="avviso errore" role="alert" style={{ marginTop: 10 }}>
            {errore}
          </div>
        )}
      </details>
    </div>
  );
}

/**
 * La chiave Gemini della famiglia, per la foto del frigo. Si scrive e si toglie; dopo il salvataggio
 * non si rilegge più (nemmeno chi l'ha scritta): se ne vedono solo le ultime 4 cifre.
 */
function ChiaveGemini({ amministratore }: { amministratore: boolean }) {
  const { famiglia } = useFamiglia();
  const [stato, setStato] = useState<StatoChiave | null | undefined>(undefined);
  const [nuova, setNuova] = useState('');
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let valido = true;
    void statoChiave(famiglia).then((s) => valido && setStato(s));
    return () => {
      valido = false;
    };
  }, [famiglia]);

  async function salva(chiave: string) {
    setAttendi(true);
    setErrore(null);
    const r = await impostaChiave(famiglia, chiave);
    setAttendi(false);
    if ('stato' in r) {
      setStato(r.stato);
      setNuova('');
    } else {
      setErrore(
        r.motivo === 'chiave_non_valida'
          ? 'Non sembra una chiave di Google AI Studio: copiala di nuovo, intera.'
          : r.motivo === 'rete'
            ? 'Serve la connessione per salvare la chiave.'
            : spiegaMotivo(r.motivo),
      );
    }
  }

  const descrizione =
    stato === undefined
      ? 'Controllo…'
      : stato === null
        ? 'Senza rete non posso controllare.'
        : stato.propria
          ? `Attiva la chiave della famiglia (…${stato.finale}).`
          : stato.condivisa
            ? 'Usa la chiave di chi gestisce l’app. Puoi mettere quella della famiglia.'
            : 'Nessuna chiave: la foto del frigo non funziona finché non ne inserisci una.';

  return (
    <>
      <h2>Foto del frigo</h2>
      <div className="scheda" aria-label="Chiave Gemini">
        <p style={{ marginTop: 0 }}>{descrizione}</p>
        {amministratore ? (
          <>
            <p className="tenue">
              Crea una chiave gratuita su aistudio.google.com («Get API key», con un account Google maggiorenne) e incollala qui. Dopo il salvataggio nessuno la può
              rileggere, nemmeno tu: la usa solo il server per leggere le foto. Consiglio: attiva la fatturazione sul progetto della chiave; con qualche foto al
              giorno si spendono pochi centesimi al mese.
            </p>
            <label className="campo">
              <span>Chiave Gemini della famiglia</span>
              <input className="dato" type="password" autoComplete="off" value={nuova} onChange={(e) => setNuova(e.target.value)} placeholder="AIza…" />
            </label>
            <div className="riga" style={{ flexWrap: 'wrap' }}>
              <button className="bottone primario" disabled={attendi || !nuova.trim()} onClick={() => void salva(nuova)}>
                Salva la chiave
              </button>
              {stato?.propria && (
                <button className="bottone" disabled={attendi} onClick={() => void salva('')}>
                  Togli la chiave
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="tenue">La chiave la inserisce chi amministra la famiglia.</p>
        )}
        {errore && (
          <div className="avviso errore" role="alert" style={{ marginTop: 10 }}>
            {errore}
          </div>
        )}
      </div>
    </>
  );
}
