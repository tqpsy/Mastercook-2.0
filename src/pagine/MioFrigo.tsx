import { useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { conPiani, cosaCiVa, FRIGO_BASE, type Frigo, LIMITI, type Piano, type PianoFreezer, type PosizioneFreezer, posti, posto, PRODUCONO_ETILENE, REGOLE_CONFEZIONE, riassunto, temperatura, zonaPerGuida } from '../dominio/frigo';
import { Foglio } from '../ui/Foglio';
import { DisegnoFrigoMio, useFrigo } from '../ui/FrigoMio';
import { Icona } from '../ui/Icona';

export { useFrigo };

/** La voce in Impostazioni: apre il configuratore. */
export function VoceMioFrigo() {
  const frigo = useFrigo();
  const [aperto, setAperto] = useState(false);
  return (
    <>
      <h2>Il mio frigorifero</h2>
      <div className="scheda">
        <button className="voce" onClick={() => setAperto(true)}>
          <span className="emoji" aria-hidden>
            🧊
          </span>
          <span className="cresce">
            <strong>{frigo ? 'Modifica il frigorifero' : 'Configura il tuo frigorifero'}</strong>
            <span className="tenue" style={{ display: 'block' }}>
              {riassunto(frigo)}
            </span>
          </span>
          <Icona nome="avanti" />
        </button>
      </div>
      {aperto && <ConfiguraFrigo chiudi={() => setAperto(false)} />}
    </>
  );
}

const POSIZIONI: { id: PosizioneFreezer; nome: string }[] = [
  { id: 'sotto', nome: 'Sotto' },
  { id: 'sopra', nome: 'Sopra' },
  { id: 'fianco', nome: 'Di fianco' },
  { id: 'nessuno', nome: 'Nessuno' },
];

function Contatore({ nome, valore, limiti, cambia }: { nome: string; valore: number; limiti: readonly [number, number]; cambia: (n: number) => void }) {
  return (
    <div className="riga contatore-frigo" role="group" aria-label={nome}>
      <span className="cresce">{nome}</span>
      <button type="button" className="bottone tondo" aria-label={`${nome}: uno in meno`} disabled={valore <= limiti[0]} onClick={() => cambia(valore - 1)}>
        −
      </button>
      <strong aria-live="polite" className="numero">
        {valore}
      </strong>
      <button type="button" className="bottone tondo primario" aria-label={`${nome}: uno in più`} disabled={valore >= limiti[1]} onClick={() => cambia(valore + 1)}>
        +
      </button>
    </div>
  );
}

function Segmenti<T extends string>({ nome, valore, scelte, cambia }: { nome: string; valore: T; scelte: { id: T; nome: string }[]; cambia: (v: T) => void }) {
  return (
    <div className="scelte segmenti" role="radiogroup" aria-label={nome}>
      {scelte.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={valore === s.id} aria-pressed={valore === s.id} onClick={() => cambia(s.id)}>
          {s.nome}
        </button>
      ))}
    </div>
  );
}

function Litri({ nome, valore, cambia }: { nome: string; valore: number | null; cambia: (n: number | null) => void }) {
  return (
    <label className="riga contatore-frigo">
      <span className="cresce">{nome}</span>
      <input
        className="dato"
        inputMode="numeric"
        placeholder="—"
        style={{ width: 80, textAlign: 'right' }}
        value={valore ?? ''}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10);
          cambia(Number.isFinite(n) ? n : null);
        }}
      />
      <span className="tenue">litri</span>
    </label>
  );
}

/**
 * Il configuratore: a sinistra (o in alto) il frigo disegnato com'è, che cambia mentre lo si imposta; si tocca una
 * parte per vedere cosa ci va. Sotto: freezer, ripiani, cassetti, sportello e capienza.
 */
export function ConfiguraFrigo({ chiudi }: { chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const salvato = useFrigo();
  return (
    <EditorFrigo
      iniziale={salvato}
      chiudi={chiudi}
      salva={async (frigo) => {
        await esegui('imposta_frigo', { frigo });
        chiudi();
      }}
    />
  );
}

/**
 * I piani dall'alto, uno per riga: per ognuno si sceglie ripiano o cassetto (nel frigo anche due cassetti
 * affiancati), così si possono avere cassetti uno sopra l'altro. «+ Aggiungi un piano» lo mette in basso.
 */
function Piani<T extends string>({
  nome,
  piani,
  scelte,
  nuovo,
  limiti,
  cambia,
}: {
  nome: string;
  piani: T[];
  scelte: { id: T; nome: string }[];
  nuovo: T;
  limiti: readonly [number, number];
  cambia: (p: T[]) => void;
}) {
  return (
    <>
      <p className="tenue piccolo" style={{ margin: '8px 0 0' }}>
        Dall’alto (1) in basso: per ogni piano scegli ripiano o cassetto.{scelte.length > 2 && ' Più cassetti uno sotto l’altro? Metti «Cassetto» su più piani.'}
      </p>
      <ol className="piani-frigo" aria-label={`${nome}, dall’alto`}>
        {piani.map((p, i) => {
          const etichetta = `${nome} ${i + 1}${i === 0 && piani.length > 1 ? ' (in alto)' : i === piani.length - 1 && piani.length > 1 ? ' (in basso)' : ''}`;
          return (
            <li key={i}>
              <span className="numero-piano" aria-hidden>
                {i + 1}
              </span>
              <Segmenti nome={etichetta} valore={p} scelte={scelte} cambia={(v) => cambia(piani.map((x, j) => (j === i ? v : x)))} />
              <button
                type="button"
                className="bottone tondo"
                aria-label={`Togli ${etichetta.toLowerCase()}`}
                disabled={piani.length <= limiti[0]}
                onClick={() => cambia(piani.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="bottone piccolo"
        aria-label={`Aggiungi un ${nome.toLowerCase()} in basso`}
        disabled={piani.length >= limiti[1]}
        onClick={() => cambia([...piani, nuovo])}
      >
        + Aggiungi un piano in basso
      </button>
    </>
  );
}

export function EditorFrigo({ iniziale, salva, chiudi }: { iniziale: Frigo | null; salva: (f: Frigo) => Promise<void>; chiudi: () => void }) {
  const [f, setF] = useState<Frigo>(iniziale ?? FRIGO_BASE);
  const [scelto, setScelto] = useState<string | null>(null);
  // Ogni modifica ricalcola i conteggi dai piani.
  const cambia = (parte: Partial<Frigo>) => setF((x) => conPiani({ ...x, ...parte }));
  const cambiaFreezer = (parte: Partial<Frigo['freezer']>) => setF((x) => conPiani({ ...x, freezer: { ...x.freezer, ...parte } }));
  const parte = posto(f, scelto);
  const ciVa = parte ? cosaCiVa(f, parte.id) : [];
  const litriValidi = (n: number | null) => n === null || (n >= LIMITI.litri[0] && n <= LIMITI.litri[1]);
  const valido = litriValidi(f.litri) && litriValidi(f.freezer.litri);

  return (
    <Foglio titolo="Il mio frigorifero" chiudi={chiudi} alto>
      <div className="configura-frigo">
        <div className="disegno">
          <DisegnoFrigoMio frigo={f} scelto={scelto} scegli={(id) => setScelto((s) => (s === id ? null : id))} grande />
          <div className="cosa-ci-va" aria-live="polite">
            {parte ? (
              <>
                <strong>{parte.nome}</strong>
                <span className="tenue piccolo">🌡️ {temperatura(f, parte)}</span>
                {ciVa.length ? (
                  <ul>
                    {ciVa.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="tenue"> · posto libero, per quello che vuoi tu</span>
                )}
              </>
            ) : (
              <span className="tenue">Tocca una parte del disegno per vedere cosa ci va.</span>
            )}
          </div>
        </div>

        <div className="comandi">
          <h3>Freezer</h3>
          <Segmenti nome="Dov’è il freezer" valore={f.freezer.posizione} scelte={POSIZIONI} cambia={(posizione) => cambiaFreezer({ posizione })} />

          <h3>Frigo</h3>
          <div className="scheda">
            <Piani<Piano>
              nome="Piano"
              piani={f.piani}
              scelte={[
                { id: 'r', nome: 'Ripiano' },
                { id: 'c', nome: 'Cassetto' },
                { id: 'cc', nome: '2 cassetti' },
              ]}
              nuovo="r"
              limiti={LIMITI.piani}
              cambia={(piani) => cambia({ piani })}
            />
            <Litri nome="Capienza" valore={f.litri} cambia={(litri) => cambia({ litri })} />
          </div>

          <h3>Sportello</h3>
          <div className="scheda">
            <div className="riga contatore-frigo">
              <span className="cresce">Si apre a</span>
              <Segmenti
                nome="Da che parte si apre lo sportello"
                valore={f.sportello}
                scelte={[
                  { id: 'sx', nome: 'Sinistra' },
                  { id: 'dx', nome: 'Destra' },
                ]}
                cambia={(sportello) => cambia({ sportello })}
              />
            </div>
            <Contatore nome="Balconcini" valore={f.balconcini} limiti={LIMITI.balconcini} cambia={(balconcini) => cambia({ balconcini })} />
          </div>

          {f.freezer.posizione !== 'nessuno' && (
            <>
              <h3>Dentro il freezer</h3>
              <div className="scheda">
                <Piani<PianoFreezer>
                  nome="Piano del freezer"
                  piani={f.freezer.piani}
                  scelte={[
                    { id: 'r', nome: 'Ripiano' },
                    { id: 'c', nome: 'Cassetto' },
                  ]}
                  nuovo="c"
                  limiti={LIMITI.freezer}
                  cambia={(piani) => cambiaFreezer({ piani })}
                />
                <Litri nome="Capienza" valore={f.freezer.litri} cambia={(litri) => cambiaFreezer({ litri })} />
              </div>
            </>
          )}
          {!valido && (
            <p className="avviso" role="alert">
              La capienza va da {LIMITI.litri[0]} a {LIMITI.litri[1]} litri (oppure lasciala vuota).
            </p>
          )}
          <button className="bottone primario pieno" disabled={!valido} onClick={() => void salva(f)}>
            Salva il frigorifero
          </button>
          <p className="tenue piccolo" style={{ textAlign: 'center' }}>
            Serve per dirti il ripiano preciso dove mettere le cose e per capire, dalle foto, dove sono.
          </p>
          <GuidaFrigo frigo={f} />
        </div>
      </div>
    </Foglio>
  );
}

/** Nomi in chiaro di chi produce etilene, per la guida. */
const NOMI_ETILENE = [...PRODUCONO_ETILENE].map((id) => id.slice(4).replace(/_/g, ' ')).join(', ');

/**
 * «Come sistemare il frigo»: la mappa termica del frigo configurato (zona, temperatura, cosa ci va), la regola
 * dell'etilene e le regole d'oro del confezionamento.
 */
function GuidaFrigo({ frigo }: { frigo: Frigo }) {
  const zone = posti(frigo);
  return (
    <details className="guida-frigo">
      <summary>
        <strong>Come sistemare il frigo</strong>
        <span className="tenue piccolo">Temperature, etilene e confezioni</span>
      </summary>
      <h3>Zona per zona, dall’alto</h3>
      <ul className="elenco">
        {zone.map((p) => (
          <li key={p.id} className="zona-guida">
            <strong>{p.nome}</strong> <span className="etichetta">{temperatura(frigo, p)}</span>
            <span className="tenue">{zonaPerGuida(frigo, p)}</span>
          </li>
        ))}
      </ul>
      <h3>Etilene: frutta e verdura separate</h3>
      <p className="tenue">
        Alcuni frutti emettono etilene maturando ({NOMI_ETILENE}) e fanno ingiallire e appassire prima insalate, cavoli, broccoli, carote, cetrioli, zucchine,
        asparagi ed erbe aromatiche.{' '}
        {frigo.cassetti >= 2
          ? 'Con due cassetti: verdure nel primo, frutta nel secondo.'
          : 'Con un solo cassetto: tienili in sacchetti chiusi separati, ai due lati del cassetto.'}{' '}
        Banane, avocado, pomodori, meloni e mango acerbi maturano meglio fuori dal frigo.
      </p>
      <h3>Regole d’oro per confezionare</h3>
      <ul>
        {REGOLE_CONFEZIONE.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  );
}
