import type { Session } from '@supabase/supabase-js';
import Dexie from 'dexie';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { configurato } from './config';
import { Archivio } from './dati/archivio';
import { FamigliaAperta, nomeArchivio, type Sessione, useFamiglia } from './dati/contesto';
import { ErroreRete } from './dati/tipi';
import { Accesso } from './pagine/Accesso';
import { Casa } from './pagine/Casa';
import { Famiglia } from './pagine/Famiglia';
import { Impostazioni } from './pagine/Impostazioni';
import { Invito } from './pagine/Invito';
import { Menu } from './pagine/Menu';
import { NuovaFamiglia } from './pagine/NuovaFamiglia';
import { Oggi } from './pagine/Oggi';
import { Ricette } from './pagine/Ricette';
import { esci, type FamigliaMia, mieFamiglie, supabase } from './piattaforma/supabase';
import { StatoSync } from './ui/StatoSync';

const CHIAVE_INVITO = 'mc-invito';
const CHIAVE_FAMIGLIA = 'mc-famiglia';

function leggi<T>(chiave: string): T | null {
  try {
    const v = localStorage.getItem(chiave);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function scrivi(chiave: string, valore: unknown) {
  try {
    if (valore === null) localStorage.removeItem(chiave);
    else localStorage.setItem(chiave, JSON.stringify(valore));
  } catch {
    // Archivio del browser non disponibile: si continua senza ricordare la scelta.
  }
}

/** Il codice d'invito arriva nel link (#invito=…) e va ricordato durante il giro dall'accesso Google. */
function codiceInvitoDalLink(): string | null {
  const m = window.location.hash.match(/invito=([a-f0-9]{32,80})/);
  if (m) {
    scrivi(CHIAVE_INVITO, m[1]);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return leggi<string>(CHIAVE_INVITO);
}

export function App() {
  if (!configurato) {
    return (
      <main className="centrata">
        <h1>Mastercook</h1>
        <div className="avviso">L’app non è ancora collegata al suo database. Manca la configurazione del progetto Supabase.</div>
      </main>
    );
  }
  return <ConAccesso />;
}

type Fase =
  | { tipo: 'carico' }
  | { tipo: 'accesso' }
  | { tipo: 'invito'; codice: string }
  | { tipo: 'nuova' }
  | { tipo: 'errore'; testo: string }
  | { tipo: 'pronta'; sessione: Sessione };

function ConAccesso() {
  const [auth, setAuth] = useState<Session | null | undefined>(undefined);
  const [invito, setInvito] = useState<string | null>(() => codiceInvitoDalLink());
  const [famiglie, setFamiglie] = useState<{ utente: string; elenco: FamigliaMia[] } | { utente: string; errore: string } | null>(null);
  const [riprova, setRiprova] = useState(0);
  const [aperta, setAperta] = useState(() => leggi<FamigliaMia & { utente: string }>(CHIAVE_FAMIGLIA));

  useEffect(() => {
    void supabase()
      .auth.getSession()
      .then(({ data }) => setAuth(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setAuth(s));
    const hash = () => setInvito(codiceInvitoDalLink());
    window.addEventListener('hashchange', hash);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener('hashchange', hash);
    };
  }, []);

  const utenteId = auth?.user.id;

  // Le famiglie dell'utente si chiedono al server; offline si riapre l'ultima usata su questo dispositivo.
  useEffect(() => {
    if (!utenteId) return;
    let valido = true;
    mieFamiglie()
      .then((elenco) => valido && setFamiglie({ utente: utenteId, elenco }))
      .catch((e) =>
        valido &&
        setFamiglie({
          utente: utenteId,
          errore: e instanceof ErroreRete ? 'Serve la connessione per il primo accesso su questo dispositivo.' : 'Qualcosa non ha funzionato.',
        }),
      );
    return () => {
      valido = false;
    };
  }, [utenteId, riprova]);

  const fase = useMemo((): Fase => {
    if (auth === undefined) return { tipo: 'carico' };
    if (!utenteId) return { tipo: 'accesso' };
    if (invito) return { tipo: 'invito', codice: invito };
    const note = famiglie?.utente === utenteId ? famiglie : null;
    const ricordata = aperta?.utente === utenteId ? aperta : null;
    if (note && 'elenco' in note) {
      const scelta = note.elenco.find((f) => f.famiglia_id === ricordata?.famiglia_id) ?? note.elenco[0];
      if (!scelta) return { tipo: 'nuova' };
      return { tipo: 'pronta', sessione: { utenteId, famiglia: scelta.famiglia_id, ruolo: scelta.ruolo } };
    }
    if (ricordata) return { tipo: 'pronta', sessione: { utenteId, famiglia: ricordata.famiglia_id, ruolo: ricordata.ruolo } };
    if (note && 'errore' in note) return { tipo: 'errore', testo: note.errore };
    return { tipo: 'carico' };
  }, [auth, utenteId, invito, famiglie, aperta]);

  // Si ricorda la famiglia aperta per poterla riaprire senza rete.
  const sessioneAperta = fase.tipo === 'pronta' ? fase.sessione : null;
  useEffect(() => {
    if (!sessioneAperta) return;
    const nome = famiglie && 'elenco' in famiglie ? (famiglie.elenco.find((f) => f.famiglia_id === sessioneAperta.famiglia)?.nome ?? '') : '';
    scrivi(CHIAVE_FAMIGLIA, { famiglia_id: sessioneAperta.famiglia, nome, ruolo: sessioneAperta.ruolo, utente: sessioneAperta.utenteId });
  }, [sessioneAperta, famiglie]);

  const apri = useCallback(
    (famiglia: string) => {
      scrivi(CHIAVE_INVITO, null);
      setInvito(null);
      if (utenteId) setAperta({ famiglia_id: famiglia, nome: '', ruolo: 'membro', utente: utenteId });
      setRiprova((n) => n + 1);
    },
    [utenteId],
  );

  const nomeGoogle = String(auth?.user.user_metadata?.given_name ?? auth?.user.user_metadata?.name ?? '').split(' ')[0];

  switch (fase.tipo) {
    case 'carico':
      return null;
    case 'accesso':
      return <Accesso invito={!!invito} />;
    case 'invito':
      return (
        <Invito
          codice={fase.codice}
          nomeSuggerito={nomeGoogle}
          entrato={apri}
          annulla={() => {
            scrivi(CHIAVE_INVITO, null);
            setInvito(null);
          }}
        />
      );
    case 'nuova':
      return <NuovaFamiglia nomeSuggerito={nomeGoogle} creata={apri} />;
    case 'errore':
      return (
        <main className="centrata">
          <div className="avviso errore">{fase.testo}</div>
          <button className="bottone primario" onClick={() => setRiprova((n) => n + 1)}>
            Riprova
          </button>
        </main>
      );
    case 'pronta':
      return (
        <FamigliaAperta key={`${fase.sessione.utenteId}:${fase.sessione.famiglia}:${fase.sessione.ruolo}`} sessione={fase.sessione}>
          <Guscio email={auth?.user.email ?? ''} apriFamiglia={apri} />
        </FamigliaAperta>
      );
  }
}

type Scheda = 'oggi' | 'menu' | 'ricette' | 'casa' | 'famiglia' | 'impostazioni';

function Guscio({ email, apriFamiglia }: { email: string; apriFamiglia: (famiglia: string) => void }) {
  const [scheda, setScheda] = useState<Scheda>('oggi');
  const { sync, utenteId, archivio } = useFamiglia();
  const schede = useMemo(
    () =>
      [
        { id: 'oggi', nome: 'Oggi', icona: '☀️' },
        { id: 'menu', nome: 'Menu', icona: '📅' },
        { id: 'ricette', nome: 'Ricette', icona: '📖' },
        { id: 'casa', nome: 'Casa', icona: '🏠' },
        { id: 'famiglia', nome: 'Famiglia', icona: '👪' },
      ] as const,
    [],
  );

  async function esciDaQui() {
    const s = sync.leggiStato();
    const nonSalvate = s.in_attesa + s.da_sistemare;
    const domanda = nonSalvate
      ? `Ci sono ${nonSalvate} modifiche non ancora salvate sul server: uscendo andranno perse. Uscire lo stesso?`
      : 'Uscire? I dati della famiglia verranno tolti da questo dispositivo e riscaricati al prossimo accesso.';
    if (!window.confirm(domanda)) return;
    archivio.close();
    await Dexie.delete(nomeArchivio(utenteId));
    scrivi(CHIAVE_FAMIGLIA, null);
    await esci();
  }

  return (
    <>
      <header className="testata">
        <h1>{scheda === 'impostazioni' ? 'Impostazioni' : schede.find((s) => s.id === scheda)?.nome}</h1>
        <div className="riga">
          <StatoSync />
          <button className="bottone piccolo" aria-label="Impostazioni" aria-pressed={scheda === 'impostazioni'} onClick={() => setScheda('impostazioni')}>
            <span aria-hidden>⚙️</span>
          </button>
        </div>
      </header>
      <main className="pagina">
        {scheda === 'oggi' && <Oggi vai={setScheda} />}
        {scheda === 'menu' && <Menu />}
        {scheda === 'ricette' && <Ricette />}
        {scheda === 'casa' && <Casa />}
        {scheda === 'famiglia' && <Famiglia />}
        {scheda === 'impostazioni' && <Impostazioni email={email} esci={esciDaQui} apriFamiglia={apriFamiglia} />}
      </main>
      <nav className="schede">
        {schede.map((s) => (
          <button key={s.id} aria-current={scheda === s.id ? 'page' : undefined} onClick={() => setScheda(s.id)}>
            <span className="icona" aria-hidden>
              {s.icona}
            </span>
            {s.nome}
          </button>
        ))}
      </nav>
    </>
  );
}

// Esportato per i test: l'archivio di un utente.
export { Archivio };
