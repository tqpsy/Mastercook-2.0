import { useEffect, useState } from 'react';
import { idDispositivo, righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { esporta } from '../dati/esportazione';
import { spiegaMotivo } from '../dati/messaggi';
import { VERSIONE_APP } from '../dati/tipi';
import { impostaChiave, type StatoChiave, statoChiave } from '../piattaforma/fotoFrigo';
import { cancellaLocale, famiglieLocali } from '../piattaforma/locale/motore';
import { type AnteprimaEliminazione, anteprimaEliminazione, eliminaFamiglia, eliminaMioAccount, type FamigliaMia, mieFamiglie } from '../piattaforma/supabase';
import { Foglio } from '../ui/Foglio';
import { leggiCollegamento, salvaSulDrive, scriviCollegamento } from '../dati/copiaDrive';
import { collegaDrive, scollegaDrive, tokenValido } from '../piattaforma/drive';
import { useStatoCopia } from '../ui/CopiaAutomatica';
import { SpiegazioneDrive, spiegaErroreDrive } from '../ui/Drive';
import { Ripristino } from '../ui/Ripristino';
import { TestoPrivacy } from './Privacy';
import { leggiTema, scegliTema, type Tema } from '../ui/tema';
import { COSTRUITA_IL, cercaAggiornamento, type EsitoAggiornamento } from '../ui/aggiornamento';

export function Impostazioni({
  email,
  esci,
  apriFamiglia,
  dimentica,
}: {
  email: string;
  esci: () => void;
  apriFamiglia: (famiglia: string) => void;
  dimentica: () => Promise<void>;
}) {
  const { ruolo, utenteId, dove } = useFamiglia();
  const vista = useVista();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const amministratore = ruolo === 'amministratore';

  return (
    <>
      <h2>Famiglia</h2>
      <div className="scheda">
        {famiglia && amministratore ? <NomeFamiglia nome={String(famiglia.nome)} versione={famiglia.versione ?? 1} /> : <p>{String(famiglia?.nome ?? '')}</p>}
        <p className="tenue" style={{ marginBottom: 0 }}>
          {dove === 'locale'
            ? '📱 I dati di questa famiglia stanno solo su questo telefono: non escono da qui. Per non perderli, collega il tuo Google Drive o salva ogni tanto una copia.'
            : '☁️ I dati di questa famiglia stanno sul server di Mastercook, in Europa, e si vedono da tutti i telefoni della famiglia.'}
        </p>
      </div>

      {amministratore && dove === 'server' && <Inviti />}
      <Accessi amministratore={amministratore} io={utenteId} />
      <ChiaveGemini amministratore={amministratore} />
      {dove === 'locale' && <CopiaSulDrive nome={String(famiglia?.nome ?? 'Famiglia')} />}
      <IMieiDati nomeFamiglia={String(famiglia?.nome ?? 'famiglia')} apriFamiglia={apriFamiglia} />
      {amministratore && famiglia && <EliminaFamiglia nome={String(famiglia.nome)} apriFamiglia={apriFamiglia} />}
      <PrivacyEAccount dimentica={dimentica} />

      <h2>Questo dispositivo</h2>
      <div className="scheda">
        <SceltaTema />
        <p>
          Accesso come <strong>{email}</strong>
        </p>
        <Aggiornamento />
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
  const { famiglia, utenteId, trasporto, dove } = useFamiglia();
  const vista = useVista();
  const io = righeAttive(vista, 'membro').find((m) => m.utente_id === utenteId);
  const [stato, setStato] = useState<string | null>(null);
  const [altre, setAltre] = useState<FamigliaMia[]>([]);
  const [ripristino, setRipristino] = useState(false);

  useEffect(() => {
    let valido = true;
    void Promise.allSettled([mieFamiglie(), famiglieLocali(utenteId)]).then(([s, l]) => {
      if (!valido) return;
      const qui = l.status === 'fulfilled' ? l.value.map((f) => ({ ...f, dove: 'locale' as const })) : [];
      setAltre([...(s.status === 'fulfilled' ? s.value : []), ...qui]);
    });
    return () => {
      valido = false;
    };
  }, [utenteId]);

  async function scarica() {
    setStato('Preparo il file…');
    try {
      const file = await esporta(trasporto, famiglia);
      const giorno = new Date().toISOString().slice(0, 10);
      const nomeFile = `mastercook-${nomeFamiglia.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${giorno}.json`;
      const blob = new File([JSON.stringify(file, null, 2)], nomeFile, { type: 'application/json' });
      const fatto = `${file.conteggi.membro} persone, ${file.conteggi.vincolo_alimentare} tra allergie ed esigenze.`;
      // Sul telefono si apre la scelta di dove metterla (su iPhone: «Salva in File», anche iCloud Drive).
      if (navigator.canShare?.({ files: [blob] })) {
        try {
          await navigator.share({ files: [blob], title: `Mastercook: ${nomeFamiglia}` });
          return setStato(`Copia salvata: ${fatto}`);
        } catch (e) {
          if ((e as Error).name === 'AbortError') return setStato(null);
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nomeFile;
      a.click();
      URL.revokeObjectURL(a.href);
      setStato(`Scaricato: ${fatto}`);
    } catch {
      setStato(dove === 'locale' ? 'Non sono riuscito a preparare il file. Riprova.' : 'Serve la connessione per esportare: il file si prepara dal server, così è completo.');
    }
  }

  return (
    <>
      <h2>I tuoi dati</h2>
      <div className="scheda">
        <p className="tenue">
          Salva una copia completa dei dati della famiglia in un file da conservare dove vuoi: sul telefono, su iCloud Drive (su iPhone scegli «Salva in File»),
          sul computer. Si può ripristinare in qualsiasi momento.
        </p>
        <button className="bottone pieno" onClick={scarica}>
          Salva una copia
        </button>
        {stato && <p className="tenue" style={{ marginTop: 10 }}>{stato}</p>}
        <button className="bottone pieno" style={{ marginTop: 10 }} onClick={() => setRipristino((x) => !x)}>
          Ripristina da un file
        </button>
        {ripristino && (
          <div style={{ marginTop: 12 }}>
            <Ripristino nomeUtente={String(io?.nome ?? '')} fatto={apriFamiglia} trasporto={trasporto} />
          </div>
        )}
        {altre.length > 1 && (
          <>
            <h3 style={{ marginTop: 18 }}>Le tue famiglie</h3>
            <ul className="elenco">
              {altre.map((f) => (
                <li key={f.famiglia_id} className="riga">
                  <span className="cresce">
                    {f.nome}
                    {f.dove === 'locale' && <span className="tenue"> · 📱 solo su questo telefono</span>}
                  </span>
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
  const { famiglia, archivio, dove, trasporto, utenteId } = useFamiglia();
  const [scritto, setScritto] = useState('');
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function elimina() {
    setAttendi(true);
    setErrore(null);
    try {
      const altre = [...(await mieFamiglie().catch(() => [] as FamigliaMia[])), ...(await famiglieLocali(utenteId).catch(() => []))];
      const esito =
        dove === 'locale'
          ? await trasporto.applica({ id: crypto.randomUUID(), famiglia_id: famiglia, tipo: 'elimina_famiglia', dati: { nome: scritto.trim() }, versione_app: VERSIONE_APP, dispositivo: idDispositivo() })
          : await eliminaFamiglia(famiglia, scritto.trim(), idDispositivo(), VERSIONE_APP);
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
  const { famiglia, dove, utenteId } = useFamiglia();
  const [stato, setStato] = useState<StatoChiave | null | undefined>(undefined);
  const [nuova, setNuova] = useState('');
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let valido = true;
    void statoChiave(famiglia, { dove, utenteId }).then((s) => valido && setStato(s));
    return () => {
      valido = false;
    };
  }, [famiglia, dove, utenteId]);

  async function salva(chiave: string) {
    setAttendi(true);
    setErrore(null);
    const r = await impostaChiave(famiglia, chiave, { dove, utenteId });
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
              rileggere, nemmeno tu: la usa solo {dove === 'locale' ? 'questo telefono' : 'il server'} per leggere le foto. Consiglio: attiva la fatturazione sul progetto della chiave; con qualche foto al
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

/**
 * L'informativa e l'eliminazione del proprio account: prima si mostra cosa succede (famiglie che spariscono e
 * famiglie da cui si esce), poi si conferma scrivendo ELIMINA.
 */
function PrivacyEAccount({ dimentica }: { dimentica: () => Promise<void> }) {
  const { utenteId } = useFamiglia();
  const [leggi, setLeggi] = useState(false);
  const [locali, setLocali] = useState<{ famiglia_id: string; nome: string }[]>([]);
  const [anteprima, setAnteprima] = useState<AnteprimaEliminazione | null>(null);
  const [scritto, setScritto] = useState('');
  const [attendi, setAttendi] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function prepara() {
    setErrore(null);
    try {
      setAnteprima(await anteprimaEliminazione());
      setLocali(await famiglieLocali(utenteId).catch(() => []));
    } catch {
      setErrore('Serve la connessione per eliminare l’account.');
    }
  }

  async function elimina() {
    if (!anteprima) return;
    setAttendi(true);
    setErrore(null);
    try {
      const esito = await eliminaMioAccount(anteprima);
      if (esito.esito === 'applicato') {
        // Anche le famiglie tenute solo su questo telefono.
        await cancellaLocale(utenteId);
        return await dimentica();
      }
      setErrore(spiegaMotivo(esito.dettaglio.motivo));
    } catch {
      setErrore('Serve la connessione per eliminare l’account. Riprova appena sei online.');
    }
    setAttendi(false);
  }

  return (
    <>
      <h2>Privacy</h2>
      <div className="scheda" aria-label="Privacy e account">
        <button className="bottone pieno" onClick={() => setLeggi(true)}>
          Come trattiamo i tuoi dati
        </button>
        {!anteprima ? (
          <button className="bottone pieno pericolo" style={{ marginTop: 10 }} onClick={() => void prepara()}>
            Elimina il mio account
          </button>
        ) : (
          <div className="avviso errore" style={{ marginTop: 10 }}>
            {anteprima.cancellate.length > 0 && (
              <p>
                Si cancellano per sempre, con tutti i loro dati: <strong>{anteprima.cancellate.map((f) => f.nome).join(', ')}</strong>. Se vuoi tenerne una copia,
                esportala prima.
              </p>
            )}
            {locali.length > 0 && (
              <p>
                Da questo telefono si cancellano anche: <strong>{locali.map((f) => f.nome).join(', ')}</strong>.
              </p>
            )}
            {anteprima.lasciate.length > 0 && (
              <p>
                Esci da <strong>{anteprima.lasciate.map((f) => f.nome).join(', ')}</strong>: la famiglia continua per gli altri, che tengono la tua scheda (senza il
                tuo account) finché non la tolgono.
              </p>
            )}
            <p>Il tuo accesso con Google viene cancellato. Non si torna indietro.</p>
            <label className="campo">
              <span>Scrivi ELIMINA per confermare</span>
              <input value={scritto} onChange={(e) => setScritto(e.target.value)} autoComplete="off" />
            </label>
            <div className="riga" style={{ flexWrap: 'wrap' }}>
              <button className="bottone primario pericolo" disabled={scritto.trim() !== 'ELIMINA' || attendi} onClick={() => void elimina()}>
                {attendi ? 'Elimino…' : 'Elimina il mio account'}
              </button>
              <button className="bottone" onClick={() => setAnteprima(null)}>
                Annulla
              </button>
            </div>
          </div>
        )}
        {errore && <div className="avviso errore">{errore}</div>}
      </div>
      {leggi && (
        <Foglio titolo="Privacy" chiudi={() => setLeggi(false)}>
          <TestoPrivacy />
        </Foglio>
      )}
    </>
  );
}

/** Per una famiglia sul telefono: collegare il proprio Google Drive per la copia automatica, vederne lo stato, scollegarlo. */
function CopiaSulDrive({ nome }: { nome: string }) {
  const { famiglia, trasporto } = useFamiglia();
  const stato = useStatoCopia(famiglia);
  const [spiega, setSpiega] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function collega() {
    setSpiega(false);
    setErrore(null);
    try {
      await collegaDrive(true);
      scriviCollegamento(famiglia, leggiCollegamento(famiglia) ?? {});
    } catch (e) {
      setErrore(spiegaErroreDrive(e));
    }
  }

  async function salvaOra() {
    setErrore(null);
    try {
      if (!tokenValido()) await collegaDrive(false);
    } catch (e) {
      return setErrore(spiegaErroreDrive(e));
    }
    await salvaSulDrive({ famiglia, nome, trasporto });
  }

  async function scollega() {
    if (!window.confirm('Scollegare il Drive? La cartella Mastercook e la copia restano nel tuo Drive: se vuoi le cancelli da lì.')) return;
    scriviCollegamento(famiglia, null);
    await scollegaDrive();
  }

  const descrizione = !stato
    ? 'La famiglia è solo su questo telefono. Collega il tuo Google Drive per avere una copia automatica e ritrovarla su un altro telefono.'
    : stato.tipo === 'aggiornata'
      ? `Copia aggiornata alle ${new Date(stato.il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, nella cartella Mastercook del tuo Drive.`
      : stato.tipo === 'in_corso'
        ? 'Salvo la copia sul Drive…'
        : stato.tipo === 'serve_permesso'
          ? 'Google chiede di confermare per aggiornare la copia.'
          : stato.tipo === 'conflitto'
            ? 'Sul Drive c’è una copia più recente fatta da un altro dispositivo: scegli quale tenere nell’avviso in alto.'
            : stato.tipo === 'errore'
              ? stato.testo
              : 'La copia si aggiorna da sola dopo ogni modifica.';

  return (
    <>
      <h2>Google Drive</h2>
      <div className="scheda" aria-label="Copia sul Google Drive">
        <p style={{ marginTop: 0 }}>{descrizione}</p>
        {stato ? (
          <>
            <p className="tenue">Mastercook usa solo la sua cartella: non vede né tocca gli altri file del tuo Drive.</p>
            <div className="riga" style={{ flexWrap: 'wrap' }}>
              <button className="bottone primario" disabled={stato.tipo === 'in_corso'} onClick={() => void salvaOra()}>
                Salva ora sul Drive
              </button>
              <button className="bottone" onClick={() => void scollega()}>
                Scollega il Drive
              </button>
            </div>
          </>
        ) : (
          <button className="bottone primario pieno" onClick={() => setSpiega(true)}>
            Collega il mio Google Drive
          </button>
        )}
        {errore && (
          <div className="avviso errore" role="alert" style={{ marginTop: 10 }}>
            {errore}
          </div>
        )}
      </div>
      {spiega && <SpiegazioneDrive continua={() => void collega()} chiudi={() => setSpiega(false)} />}
    </>
  );
}

const TEMI: { id: Tema; nome: string }[] = [
  { id: 'automatico', nome: 'Automatico' },
  { id: 'chiaro', nome: 'Chiaro' },
  { id: 'scuro', nome: 'Scuro' },
];

/** Chiaro, scuro o come il telefono: vale solo per questo dispositivo. */
function SceltaTema() {
  const [tema, setTema] = useState<Tema>(leggiTema);
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ marginTop: 0, marginBottom: 6 }}>Aspetto</p>
      <div className="scelte" role="group" aria-label="Aspetto dell’app">
        {TEMI.map((t) => (
          <button
            key={t.id}
            className="bottone"
            aria-pressed={tema === t.id}
            onClick={() => {
              scegliTema(t.id);
              setTema(t.id);
            }}
          >
            {t.nome}
          </button>
        ))}
      </div>
      <p className="tenue" style={{ marginBottom: 0 }}>
        {tema === 'automatico' ? 'Segue l’impostazione del telefono.' : 'Vale solo su questo dispositivo.'}
      </p>
    </div>
  );
}

function dataVersione(): string {
  const d = COSTRUITA_IL ? new Date(COSTRUITA_IL) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

const ESITI: Record<Exclude<EsitoAggiornamento, 'aggiornata'>, string> = {
  gia_ultima: 'Hai già l’ultima versione.',
  senza_rete: 'Senza rete non posso controllare: riprova quando sei connesso.',
};

/** Scarica subito la versione nuova, senza dover chiudere e riaprire l'app. */
function Aggiornamento() {
  const [cerco, setCerco] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  const data = dataVersione();

  async function aggiorna() {
    setCerco(true);
    setEsito(null);
    try {
      const e = await cercaAggiornamento();
      if (e !== 'aggiornata') setEsito(ESITI[e]);
    } catch {
      setEsito('Non sono riuscito a controllare: chiudi e riapri l’app.');
    } finally {
      setCerco(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <p className="tenue" style={{ marginTop: 0, marginBottom: 6 }}>
        Versione dell’app {VERSIONE_APP}
        {data && ` · del ${data}`}
      </p>
      <button className="bottone pieno" onClick={aggiorna} disabled={cerco}>
        {cerco ? 'Cerco la versione nuova…' : '🔄 Aggiorna l’app'}
      </button>
      {esito && (
        <p className="tenue" role="status" style={{ marginBottom: 0 }}>
          {esito}
        </p>
      )}
    </div>
  );
}
