import { useMemo, useRef, useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import {
  GRUPPI,
  type Gruppo,
  memoriaDa,
  type MemoriaAntonino,
  type Obiettivo,
  PIANO_VUOTO,
  pianoAcceso,
  REGOLE_BASE,
  regoleDa,
  regoleDaSalvare,
  type RegoleAntonino,
  type RegolePiano,
} from '../dominio/antonino';
import { comandoRicetta, leggiPiano, regoleConPiano, ricetteNuove } from '../dominio/piano';
import type { Indice } from '../dominio/ricette';
import { oggi } from '../dominio/scadenze';
import faccia from '../ui/antonino.webp';

/** La faccia di Antonino, tonda. */
export function FacciaAntonino({ piccola }: { piccola?: boolean }) {
  return <img className={`antonino-faccia${piccola ? ' piccola' : ''}`} src={faccia} alt="" aria-hidden width={piccola ? 34 : 48} height={piccola ? 34 : 48} />;
}

/** Quello che Antonino dice, in un fumetto accanto alla sua faccia. */
export function Fumetto({ children, piccola }: { children: React.ReactNode; piccola?: boolean }) {
  return (
    <div className="antonino-dice">
      <FacciaAntonino piccola={piccola} />
      <div className="fumetto">{children}</div>
    </div>
  );
}

/** Le regole e la memoria di Antonino per la famiglia aperta. */
export function useAntonino(): { regole: RegoleAntonino; memoria: MemoriaAntonino } {
  const impostazioni = useVista().righe.famiglia?.find((r) => !r.eliminato_il)?.impostazioni as Record<string, unknown> | undefined;
  const chiave = JSON.stringify(impostazioni?.antonino ?? null);
  return useMemo(() => ({ regole: regoleDa(impostazioni), memoria: memoriaDa(impostazioni) }), [chiave]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Per insegnare ad Antonino: «l'avete scartata», «l'avete scelta», «non proporla più». */
export function useImpara() {
  const { esegui } = useFamiglia();
  return (evento: 'scartata' | 'scelta' | 'mai_piu' | 'riproponi' | 'dimentica', ricetta_id?: string) =>
    void esegui('antonino_impara', { evento, ...(ricetta_id ? { ricetta_id } : {}), data: oggi() });
}

function testoObiettivo(o: Obiettivo | undefined): string {
  if (!o || (o.min === undefined && o.max === undefined)) return 'libero';
  if (o.min !== undefined && o.max !== undefined) return o.min === o.max ? `${o.min} volte` : `da ${o.min} a ${o.max} volte`;
  if (o.min !== undefined) return `almeno ${o.min} ${o.min === 1 ? 'volta' : 'volte'}`;
  return o.max === 0 ? 'mai' : `al massimo ${o.max} ${o.max === 1 ? 'volta' : 'volte'}`;
}

/** Un numero da 0 a 14 con − e +; «–» vuol dire nessun limite. */
function Contatore({ etichetta, valore, cambia }: { etichetta: string; valore: number | undefined; cambia: (v: number | undefined) => void }) {
  return (
    <span className="passi-antonino" role="group" aria-label={etichetta}>
      <button type="button" className="bottone piccolo" aria-label={`${etichetta}: meno`} disabled={valore === undefined} onClick={() => cambia(valore === 0 ? undefined : valore! - 1)}>
        −
      </button>
      <span className="valore">{valore ?? '–'}</span>
      <button type="button" className="bottone piccolo" aria-label={`${etichetta}: più`} disabled={valore === 14} onClick={() => cambia(valore === undefined ? 0 : valore + 1)}>
        +
      </button>
    </span>
  );
}

/**
 * Impostazioni › Antonino: cosa sa e cosa ha imparato. Qui la famiglia gli «insegna» la settimana
 * (quante volte pesce, legumi, carne rossa…) e può riprendere i piatti che gli ha detto di non proporre più.
 */
export function AntoninoImpostazioni() {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const { regole, memoria } = useAntonino();
  const impara = useImpara();
  const [aperto, setAperto] = useState(false);
  const indice = useIndice(vista);
  const modificate = Object.keys(regoleDaSalvare(regole)).length > 0;
  const ricordi = memoria.scartate.size + memoria.scelte.size + memoria.maiPiu.size;

  function salva(nuove: RegoleAntonino) {
    const r = regoleDaSalvare(nuove);
    void esegui('antonino_regole', { regole: Object.keys(r).length ? r : null });
  }
  function cambia(g: Gruppo, campo: 'min' | 'max', v: number | undefined) {
    const o = { ...(regole.obiettivi[g] ?? {}) };
    if (v === undefined) delete o[campo];
    else o[campo] = v;
    if (campo === 'min' && v !== undefined && o.max !== undefined && o.max < v) o.max = v;
    if (campo === 'max' && v !== undefined && o.min !== undefined && o.min > v) o.min = v;
    salva({ ...regole, obiettivi: { ...regole.obiettivi, [g]: o } });
  }

  return (
    <>
      <h2>Antonino</h2>
      <div className="scheda antonino-impostazioni">
        <Fumetto>
          Sono Antonino: preparo il menu della settimana e vi consiglio cosa cucinare. Propongo solo piatti adatti a chi mangia; qui sotto potete insegnarmi come
          volete la settimana.
        </Fumetto>
        <button type="button" className="voce" aria-expanded={aperto} onClick={() => setAperto(!aperto)}>
          <span className="cresce">
            <strong>La settimana che preferite</strong>
            <span className="tenue" style={{ display: 'block' }}>
              {modificate ? 'Regole vostre' : 'Linee guida per una sana alimentazione'} · pranzi e cene
            </span>
          </span>
          <span aria-hidden>{aperto ? '▴' : '▾'}</span>
        </button>
        {aperto && (
          <>
            <ul className="elenco obiettivi-antonino" aria-label="Quante volte a settimana">
              {GRUPPI.filter((g) => g.id !== 'verdure').map((g) => {
                const o = regole.obiettivi[g.id];
                return (
                  <li key={g.id}>
                    <span className="cresce">
                      <span aria-hidden>{g.emoji}</span> <strong>{g.nome}</strong>
                      <span className="tenue" style={{ display: 'block' }}>
                        {testoObiettivo(o)}
                      </span>
                    </span>
                    <span className="limiti">
                      <span className="tenue piccolo">almeno</span>
                      <Contatore etichetta={`${g.nome}, almeno`} valore={o?.min} cambia={(v) => cambia(g.id, 'min', v)} />
                      <span className="tenue piccolo">al massimo</span>
                      <Contatore etichetta={`${g.nome}, al massimo`} valore={o?.max} cambia={(v) => cambia(g.id, 'max', v)} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <label className="riga" style={{ margin: '8px 0' }}>
              <input type="checkbox" checked={regole.verdureOgniGiorno} onChange={(e) => salva({ ...regole, verdureOgniGiorno: e.target.checked })} />
              <span>🥦 Verdure ogni giorno</span>
            </label>
            {modificate && (
              <button type="button" className="bottone piccolo" onClick={() => salva(REGOLE_BASE)}>
                Torna alle linee guida
              </button>
            )}
          </>
        )}
        <PianoNutrizionista regole={regole} salva={salva} indice={indice} />
        {memoria.maiPiu.size > 0 && (
          <>
            <h3 className="titoletto" style={{ marginTop: 14 }}>
              Piatti che non propongo più
            </h3>
            <ul className="elenco" aria-label="Piatti che non propone più">
              {[...memoria.maiPiu].map((id) => (
                <li key={id} className="riga spazio">
                  <span>{indice?.perId.get(id)?.titolo ?? 'Ricetta tolta'}</span>
                  <button type="button" className="bottone piccolo" onClick={() => impara('riproponi', id)}>
                    Riproponila
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="tenue" style={{ marginBottom: 0 }}>
          {ricordi
            ? `Ricordo ${memoria.scelte.size} piatti che scegliete e ${memoria.scartate.size} che scartate: li propongo più o meno spesso.`
            : 'Quando scegliete o scartate un piatto che vi propongo, me lo ricordo.'}
        </p>
        {ricordi > 0 && (
          <button type="button" className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => window.confirm('Antonino dimentica i piatti scelti, scartati e da non proporre più. Le regole della settimana restano.') && impara('dimentica')}>
            Dimentica cosa ho imparato
          </button>
        )}
      </div>
    </>
  );
}

const REGOLE_PIANO: { chiave: Exclude<keyof RegolePiano, 'preferiti' | 'nome' | 'caricato_il'>; testo: string }[] = [
  { chiave: 'cenaSenzaCarboidrati', testo: '🌙 A cena niente pasta, pane, riso, patate e legumi' },
  { chiave: 'pranzoConCarboidrati', testo: '☀️ A pranzo un carboidrato con poca proteina e le verdure' },
  { chiave: 'legumiSenzaCereali', testo: '🫘 Legumi mai con pasta, pane o riso' },
  { chiave: 'verdureAOgniPasto', testo: '🥗 Verdure a pranzo e a cena' },
];

/**
 * Il piano del nutrizionista: si carica da un file preparato una volta (vale per tutta la famiglia) e porta le
 * frequenze della settimana, le regole su pranzo e cena, gli alimenti da preferire e le ricette del piano.
 */
function PianoNutrizionista({ regole, salva, indice }: { regole: RegoleAntonino; salva: (r: RegoleAntonino) => void; indice: Indice | null | undefined }) {
  const { esegui } = useFamiglia();
  const file = useRef<HTMLInputElement>(null);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const p = regole.piano;
  const acceso = pianoAcceso(p);

  async function carica(f: File) {
    setEsito(null);
    try {
      const piano = leggiPiano(await f.text(), oggi());
      const titoli = (indice?.ricette ?? []).filter((r) => !r.di_sistema && !r.archiviata).map((r) => r.titolo);
      const nuove = ricetteNuove(piano, titoli);
      const mancano = nuove.filter((r) => r.ingredienti.some((g) => !indice?.ingrediente(g.ingrediente_id)));
      const daCreare = nuove.filter((r) => !mancano.includes(r));
      const domanda = `Antonino seguirà «${piano.nome}» per tutta la famiglia: le frequenze della settimana e le regole di pranzo e cena cambiano.${
        daCreare.length ? ` Aggiungo anche ${daCreare.length} ${daCreare.length === 1 ? 'ricetta' : 'ricette'} del piano.` : ''
      }`;
      if (!window.confirm(domanda)) return;
      await esegui('antonino_regole', { regole: regoleDaSalvare(regoleConPiano(regole, piano)) });
      for (const r of daCreare) await esegui('salva_ricetta', comandoRicetta(r, () => crypto.randomUUID()));
      const giaCi = piano.ricette.length - nuove.length;
      setEsito({
        ok: true,
        testo: [
          'Piano caricato.',
          daCreare.length ? (daCreare.length === 1 ? '1 ricetta aggiunta.' : `${daCreare.length} ricette aggiunte.`) : '',
          giaCi ? (giaCi === 1 ? '1 ricetta c’era già.' : `${giaCi} ricette c’erano già.`) : '',
          mancano.length ? `Non ho aggiunto ${mancano.map((r) => r.titolo).join(', ')}: manca un ingrediente.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    } catch (e) {
      setEsito({ ok: false, testo: e instanceof Error ? e.message : 'Non riesco a leggere il file.' });
    } finally {
      if (file.current) file.current.value = '';
    }
  }

  return (
    <section className="piano-nutrizionista" aria-label="Piano del nutrizionista">
      <h3 className="titoletto" style={{ marginTop: 14 }}>
        Piano del nutrizionista
      </h3>
      {acceso ? (
        <>
          <p className="tenue" style={{ marginTop: 0 }}>
            📄 {p.nome ?? 'Piano del nutrizionista'}
            {p.caricato_il ? ` · caricato il ${p.caricato_il.split('-').reverse().join('/')}` : ''} · vale per tutta la famiglia
          </p>
          {REGOLE_PIANO.map((x) => (
            <label key={x.chiave} className="riga" style={{ margin: '6px 0' }}>
              <input type="checkbox" checked={p[x.chiave]} onChange={(e) => salva({ ...regole, piano: { ...p, [x.chiave]: e.target.checked } })} />
              <span>{x.testo}</span>
            </label>
          ))}
          {p.preferiti.length > 0 && (
            <p className="tenue piccolo">Da preferire: {p.preferiti.map((id) => indice?.nome(id).toLowerCase() ?? id).join(', ')}</p>
          )}
        </>
      ) : (
        <p className="tenue" style={{ marginTop: 0 }}>
          Carica il file del piano: seguo le sue frequenze e le sue regole per pranzo e cena, per tutta la famiglia.
        </p>
      )}
      <div className="riga" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="bottone piccolo" onClick={() => file.current?.click()}>
          📄 {acceso ? 'Carica un piano nuovo' : 'Carica il piano'}
        </button>
        {acceso && (
          <button
            type="button"
            className="bottone piccolo"
            onClick={() => window.confirm('Antonino smette di seguire il piano. Le frequenze della settimana restano quelle di adesso.') && salva({ ...regole, piano: PIANO_VUOTO })}
          >
            Togli il piano
          </button>
        )}
      </div>
      <input ref={file} type="file" accept=".json,application/json" hidden aria-label="File del piano" onChange={(e) => e.target.files?.[0] && void carica(e.target.files[0])} />
      {esito && (
        <p className={`avviso ${esito.ok ? 'info' : 'errore'}`} role="status">
          {esito.testo}
        </p>
      )}
    </section>
  );
}
