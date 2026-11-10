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
import { comandoRicetta, leggiPiano, type Piano, pianoDaLettura, regoleConPiano, riassuntoPiano, ricetteNuove } from '../dominio/piano';
import { type ErrorePiano, leggiPianoConGemini } from '../piattaforma/fotoFrigo';
import { riduciFoto } from '../ui/Foto';
import { Foglio } from '../ui/Foglio';
import { Icona } from '../ui/Icona';
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
  const [foglio, setFoglio] = useState(false);
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
      <div className="scheda">
        <button className="voce" onClick={() => setFoglio(true)}>
          <span className="emoji" aria-hidden>
            <FacciaAntonino piccola />
          </span>
          <span className="cresce">
            <strong>Antonino</strong>
            <span className="tenue" style={{ display: 'block' }}>
              Il menu della settimana, il piano del nutrizionista e quello che ha imparato
            </span>
          </span>
          <Icona nome="avanti" />
        </button>
      </div>
      {foglio && (
        <Foglio titolo="Antonino" chiudi={() => setFoglio(false)} alto>
      <div className="antonino-impostazioni">
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
        </Foglio>
      )}
    </>
  );
}

const SPIEGA_ERRORE_PIANO: Record<ErrorePiano, string> = {
  quota: 'Per oggi le letture gratuite di Gemini sono finite. Riprova domani.',
  chiave: 'La chiave Gemini della famiglia non è valida: chi amministra la controlla in Impostazioni › Foto del frigo.',
  non_configurata: 'Per leggere un PDF o una foto serve la chiave Gemini della famiglia: chi amministra la inserisce in Impostazioni › Foto del frigo.',
  rete: 'Serve la connessione a internet per leggere il piano. Riprova quando c’è rete.',
  gemini: 'Gemini non è riuscito a leggere il piano. Riprova, oppure con una foto più nitida.',
  non_autorizzato: 'Non risulti in questa famiglia: esci e rientra, poi riprova.',
  illeggibile: 'Non ho trovato un piano alimentare in questo file.',
  formato: 'Questo file non lo so leggere: usa un PDF o una foto (JPEG o PNG).',
};

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
  const { esegui, famiglia, dove, utenteId } = useFamiglia();
  const file = useRef<HTMLInputElement>(null);
  const [leggo, setLeggo] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const p = regole.piano;
  const acceso = pianoAcceso(p);

  /** Il file del piano: il .json già pronto (si legge qui, gratis) oppure un PDF o una foto, che legge Gemini. */
  async function leggiFile(f: File): Promise<{ piano: Piano; avvisi: string[] } | null> {
    const nome = f.name.toLowerCase();
    const mime = f.type || (nome.endsWith('.pdf') ? 'application/pdf' : '');
    // Il .json già pronto si riconosce dal contenuto: scaricato sul telefono può arrivare come testo o senza tipo.
    const documento = mime === 'application/pdf' || mime.startsWith('image/');
    const testo = !documento && f.size < 2_000_000 ? await f.text() : null;
    if (testo !== null && (nome.endsWith('.json') || mime.includes('json') || testo.replace(/^\uFEFF/, '').trimStart().startsWith('{')))
      return { piano: leggiPiano(testo, oggi()), avvisi: [] };
    if (!indice) return null;
    setLeggo(true);
    try {
      const immagine = mime.startsWith('image/');
      const dati = immagine ? await riduciFoto(f) : f;
      const r = await leggiPianoConGemini(famiglia, dati, immagine ? 'image/jpeg' : mime, { dove, utenteId });
      if ('errore' in r) throw new Error(SPIEGA_ERRORE_PIANO[r.errore] + (r.dettaglio ? ` (Risposta di Google: ${r.dettaglio})` : ''));
      const { piano, nonTrovati } = pianoDaLettura(r.piano, indice, oggi());
      const avvisi = [...riassuntoPiano(piano, indice), ...(nonTrovati.length ? [`Non riconosco: ${nonTrovati.join(', ')}.`] : [])];
      return { piano, avvisi };
    } finally {
      setLeggo(false);
    }
  }

  async function carica(f: File) {
    setEsito(null);
    try {
      const letto = await leggiFile(f);
      if (!letto) return;
      const { piano, avvisi } = letto;
      const titoli = (indice?.ricette ?? []).filter((r) => !r.di_sistema && !r.archiviata).map((r) => r.titolo);
      const nuove = ricetteNuove(piano, titoli);
      const mancano = nuove.filter((r) => r.ingredienti.some((g) => !indice?.ingrediente(g.ingrediente_id)));
      const daCreare = nuove.filter((r) => !mancano.includes(r));
      const domanda = `${avvisi.length ? `Ho letto il piano.\n\n${avvisi.join('\n')}\n\n` : ''}Antonino seguirà «${piano.nome}» per tutta la famiglia: le frequenze della settimana e le regole di pranzo e cena cambiano.${
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
          Carica il piano del nutrizionista (PDF o foto): seguo le sue frequenze e le sue regole per pranzo e cena, per tutta la famiglia.
        </p>
      )}
      <div className="riga" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="bottone piccolo" disabled={leggo} onClick={() => file.current?.click()}>
          📄 {leggo ? 'Leggo il piano…' : acceso ? 'Carica un piano nuovo' : 'Carica il piano'}
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
      {/* Niente filtro sul tipo: alcuni telefoni non lasciano scegliere i .json scaricati; il file si controlla dopo. */}
      <input ref={file} type="file" hidden aria-label="File del piano" onChange={(e) => {
          const f = e.target.files?.[0];
          // Così lo stesso file si può scegliere di nuovo (per esempio dopo un errore di Gemini).
          e.target.value = '';
          if (f) void carica(f);
        }} />
      <p className="tenue piccolo">Un PDF o una foto li legge Gemini con la chiave della famiglia: passano a Google e non si salvano.</p>
      {esito && (
        <p className={`avviso ${esito.ok ? 'info' : 'errore'}`} role="status">
          {esito.testo}
        </p>
      )}
    </section>
  );
}
