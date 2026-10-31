import type { Session } from '@supabase/supabase-js';
import Dexie from 'dexie';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { configurato } from './config';
import { Archivio } from './dati/archivio';
import { FamigliaAperta, nomeArchivio, type Sessione, useFamiglia, useVista } from './dati/contesto';
import { ErroreRete } from './dati/tipi';
import { Accesso } from './pagine/Accesso';
import { Casa, useLotti } from './pagine/Casa';
import { Famiglia } from './pagine/Famiglia';
import { Impostazioni } from './pagine/Impostazioni';
import { Invito } from './pagine/Invito';
import { Menu } from './pagine/Menu';
import { NuovaFamiglia } from './pagine/NuovaFamiglia';
import { Consenso, VERSIONE_PRIVACY } from './pagine/Privacy';
import { Oggi } from './pagine/Oggi';
import { Ricette } from './pagine/Ricette';
import { Spesa } from './pagine/Spesa';
import { famiglieLocali } from './piattaforma/locale/motore';
import { esci, type FamigliaMia, mieFamiglie, mioConsenso, supabase } from './piattaforma/supabase';
import { oggi, piuGiorni, statoData } from './dominio/scadenze';
import { CopiaAutomatica } from './ui/CopiaAutomatica';
import { Icona } from './ui/Icona';
import { aggiungiPasso, togliPasso } from './ui/indietro';
import { AvvisoSync, useStatoBreve } from './ui/StatoSync';

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
  | { tipo: 'consenso' }
  | { tipo: 'invito'; codice: string }
  | { tipo: 'nuova' }
  | { tipo: 'errore'; testo: string }
  | { tipo: 'pronta'; sessione: Sessione };

function ConAccesso() {
  const [auth, setAuth] = useState<Session | null | undefined>(undefined);
  const [invito, setInvito] = useState<string | null>(() => codiceInvitoDalLink());
  const [famiglie, setFamiglie] = useState<{ utente: string; elenco: FamigliaMia[]; consenso: number | null } | { utente: string; errore: string } | null>(null);
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

  // Le famiglie dell'utente: quelle sul server più quelle tenute solo su questo dispositivo.
  // Offline si riapre l'ultima usata; le famiglie locali si aprono comunque.
  useEffect(() => {
    if (!utenteId) return;
    let valido = true;
    void Promise.allSettled([Promise.all([mieFamiglie(), mioConsenso()]), famiglieLocali(utenteId)]).then(([server, locali]) => {
      if (!valido) return;
      const qui = locali.status === 'fulfilled' ? locali.value.map((f) => ({ ...f, dove: 'locale' as const })) : [];
      if (server.status === 'fulfilled') return setFamiglie({ utente: utenteId, elenco: [...server.value[0], ...qui], consenso: server.value[1] });
      // Senza server il consenso non si può rileggere: è stato dato al primo accesso, che richiede la rete.
      if (qui.length) return setFamiglie({ utente: utenteId, elenco: qui, consenso: VERSIONE_PRIVACY });
      setFamiglie({
        utente: utenteId,
        errore: server.reason instanceof ErroreRete ? 'Serve la connessione per il primo accesso su questo dispositivo.' : 'Qualcosa non ha funzionato.',
      });
    });
    return () => {
      valido = false;
    };
  }, [utenteId, riprova]);

  const fase = useMemo((): Fase => {
    if (auth === undefined) return { tipo: 'carico' };
    if (!utenteId) return { tipo: 'accesso' };
    const note = famiglie?.utente === utenteId ? famiglie : null;
    // Il consenso si chiede appena il server risponde; senza rete si entra se il dispositivo conosce già la famiglia.
    if (note && 'elenco' in note && (note.consenso ?? 0) < VERSIONE_PRIVACY) return { tipo: 'consenso' };
    if (invito) {
      if (!note) return { tipo: 'carico' };
      return { tipo: 'invito', codice: invito };
    }
    const ricordata = aperta?.utente === utenteId ? aperta : null;
    if (note && 'elenco' in note) {
      const scelta = note.elenco.find((f) => f.famiglia_id === ricordata?.famiglia_id) ?? note.elenco[0];
      if (!scelta) return { tipo: 'nuova' };
      return { tipo: 'pronta', sessione: { utenteId, famiglia: scelta.famiglia_id, ruolo: scelta.ruolo, dove: scelta.dove ?? 'server' } };
    }
    if (ricordata) return { tipo: 'pronta', sessione: { utenteId, famiglia: ricordata.famiglia_id, ruolo: ricordata.ruolo, dove: ricordata.dove ?? 'server' } };
    if (note && 'errore' in note) return { tipo: 'errore', testo: note.errore };
    return { tipo: 'carico' };
  }, [auth, utenteId, invito, famiglie, aperta]);

  // Si ricorda la famiglia aperta per poterla riaprire senza rete.
  const sessioneAperta = fase.tipo === 'pronta' ? fase.sessione : null;
  useEffect(() => {
    if (!sessioneAperta) return;
    const nome = famiglie && 'elenco' in famiglie ? (famiglie.elenco.find((f) => f.famiglia_id === sessioneAperta.famiglia)?.nome ?? '') : '';
    scrivi(CHIAVE_FAMIGLIA, { famiglia_id: sessioneAperta.famiglia, nome, ruolo: sessioneAperta.ruolo, dove: sessioneAperta.dove, utente: sessioneAperta.utenteId });
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
    case 'consenso':
      return <Consenso fatto={() => setRiprova((n) => n + 1)} esci={() => void esci()} />;
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
      return <NuovaFamiglia nomeSuggerito={nomeGoogle} creata={apri} utenteId={utenteId!} />;
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
        <FamigliaAperta key={`${fase.sessione.utenteId}:${fase.sessione.famiglia}:${fase.sessione.ruolo}:${fase.sessione.dove}`} sessione={fase.sessione}>
          <Guscio email={auth?.user.email ?? ''} apriFamiglia={apri} />
        </FamigliaAperta>
      );
  }
}

type Scheda = 'oggi' | 'menu' | 'spesa' | 'ricette' | 'casa' | 'famiglia' | 'impostazioni';

/**
 * Gli avvisi dentro l'app (non notifiche): in Casa i prodotti scaduti o da usare oggi secondo la data
 * registrata; in Oggi i pasti dei giorni prima ancora da confermare.
 */
function useAvvisi(): Partial<Record<Scheda, { n: number; testo: string }>> {
  const vista = useVista();
  const lotti = useLotti();
  const giorno = oggi();
  const casa = lotti.filter((l) => ['scaduto', 'oggi'].includes(statoData(l, giorno))).length;
  const attive = new Set((vista.righe.conferma_pasto ?? []).filter((c) => c.attiva && !c.eliminato_il).map((c) => c.portata_id));
  const dal = piuGiorni(giorno, -3);
  const pasti = (vista.righe.portata ?? []).filter((p) => !p.eliminato_il && String(p.data) >= dal && String(p.data) < giorno && !attive.has(p.id)).length;
  return {
    ...(casa ? { casa: { n: casa, testo: casa === 1 ? '1 prodotto scaduto o da usare oggi' : `${casa} prodotti scaduti o da usare oggi` } } : {}),
    ...(pasti ? { oggi: { n: pasti, testo: pasti === 1 ? '1 pasto da confermare' : `${pasti} pasti da confermare` } } : {}),
  };
}

function Guscio({ email, apriFamiglia }: { email: string; apriFamiglia: (famiglia: string) => void }) {
  const [scheda, setScheda] = useState<Scheda>('oggi');
  // Ogni cambio di scheda è un passo: il tasto Indietro torna alla scheda di prima, nell'ordine visitato.
  const passiSchede = useRef<number[]>([]);
  const vai = useCallback(
    (nuova: Scheda) => {
      if (nuova === scheda) return;
      const prima = scheda;
      const id = aggiungiPasso(() => {
        passiSchede.current = passiSchede.current.filter((p) => p !== id);
        setScheda(prima);
      });
      passiSchede.current.push(id);
      setScheda(nuova);
    },
    [scheda],
  );
  useEffect(
    () => () => {
      for (const p of passiSchede.current) togliPasso(p);
      passiSchede.current = [];
    },
    [],
  );
  const { sync, utenteId, archivio, dove } = useFamiglia();
  const avvisi = useAvvisi();
  const schede = useMemo(
    () =>
      [
        { id: 'oggi', nome: 'Oggi' },
        { id: 'menu', nome: 'Menu' },
        { id: 'spesa', nome: 'Spesa' },
        { id: 'casa', nome: 'Casa' },
        { id: 'ricette', nome: 'Ricette' },
      ] as const,
    [],
  );

  const statoBreve = useStatoBreve();
  const titoloScheda = scheda === 'impostazioni' ? 'Impostazioni' : scheda === 'famiglia' ? 'Famiglia' : schede.find((x) => x.id === scheda)?.nome;

  /** Dopo l'eliminazione dell'account: via la copia locale e la famiglia ricordata. */
  async function dimenticaDispositivo() {
    archivio.close();
    await Dexie.delete(nomeArchivio(utenteId));
    scrivi(CHIAVE_FAMIGLIA, null);
    window.location.reload();
  }

  async function esciDaQui() {
    const s = sync.leggiStato();
    const nonSalvate = s.in_attesa + s.da_sistemare;
    const domanda = nonSalvate
      ? `Ci sono ${nonSalvate} modifiche non ancora salvate sul server: uscendo andranno perse. Uscire lo stesso?`
      : dove === 'locale'
        ? 'Uscire? I dati della famiglia restano su questo telefono: li ritrovi rientrando con lo stesso account Google.'
        : 'Uscire? I dati della famiglia verranno tolti da questo dispositivo e riscaricati al prossimo accesso.';
    if (!window.confirm(domanda)) return;
    archivio.close();
    await Dexie.delete(nomeArchivio(utenteId));
    scrivi(CHIAVE_FAMIGLIA, null);
    await esci();
  }

  return (
    <>
      <main className="pagina">
        {/* Il nome della scheda si vede già evidenziato nella barra: qui resta solo per il lettore dello schermo. */}
        <h1 className="solo-lettore">{titoloScheda}</h1>
        <AvvisoSync />
        <CopiaAutomatica apriFamiglia={apriFamiglia} />
        {scheda === 'oggi' && <Oggi vai={vai} />}
        {scheda === 'menu' && <Menu />}
        {scheda === 'spesa' && <Spesa />}
        {scheda === 'ricette' && <Ricette />}
        {scheda === 'casa' && <Casa />}
        {scheda === 'famiglia' && (
          <>
            {/* Famiglia sta dentro Impostazioni: anche senza tasto Indietro (iPhone) si torna su. */}
            <button className="link torna" onClick={() => vai('impostazioni')}>
              <Icona nome="indietro" grandezza={20} />
              Indietro
            </button>
            <Famiglia />
          </>
        )}
        {scheda === 'impostazioni' && (
          <Impostazioni email={email} esci={esciDaQui} apriFamiglia={apriFamiglia} dimentica={dimenticaDispositivo} vaiFamiglia={() => vai('famiglia')} />
        )}
      </main>
      <nav className="schede" aria-label="Schede">
        <img className="logo-barra" src={`${import.meta.env.BASE_URL}icona.svg`} alt="" />
        {schede.map((s) => (
          <button
            key={s.id}
            aria-current={scheda === s.id ? 'page' : undefined}
            aria-describedby={avvisi[s.id] ? `avviso-${s.id}` : undefined}
            onClick={() => vai(s.id)}
          >
            <span className="icona" aria-hidden>
              <Icona nome={s.id} />
              {avvisi[s.id] && <span className="contatore">{avvisi[s.id]!.n}</span>}
            </span>
            <span className="nome-scheda">{s.nome}</span>
            {avvisi[s.id] && (
              <span id={`avviso-${s.id}`} hidden>
                {avvisi[s.id]!.testo}
              </span>
            )}
          </button>
        ))}
        <button
          className="scheda-impostazioni"
          aria-label="Impostazioni"
          aria-describedby="stato-salvataggio"
          aria-current={scheda === 'impostazioni' || scheda === 'famiglia' ? 'page' : undefined}
          onClick={() => vai('impostazioni')}
        >
          <span className="icona" aria-hidden>
            <Icona nome="impostazioni" />
            {statoBreve.classe !== 'ok' && <span className={`pallino ${statoBreve.classe}`} />}
          </span>
          <span className="nome-scheda" aria-hidden>
            Impostazioni
          </span>
          <span id="stato-salvataggio" hidden>
            Stato del salvataggio: {statoBreve.testo}
          </span>
        </button>
      </nav>
    </>
  );
}

// Esportato per i test: l'archivio di un utente.
export { Archivio };
