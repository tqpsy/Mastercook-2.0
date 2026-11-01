import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { DISEGNI_CIBO, DISEGNO_PER_ID } from '../ui/disegniCibo';
import { disegno, eDisegno, iconaIngrediente, PREFISSO_DISEGNO } from '../dominio/iconeCibo';
import { CATEGORIE, type Categoria } from '../catalogo/tipi';
import { righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type Esito, type Motivo, NOME_ESITO, valutaPerFamiglia, type ValutazioneFamiglia, type Verifica, type Vincolo } from '../dominio/compatibilita';
import { righeEBasi, testoDosi, titoloBase } from '../dominio/basi';
import { copertura, filtra, iconaRicetta, type Indice, type Ricetta, type RigaRicetta } from '../dominio/ricette';
import { formatta, scala } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { Foto } from '../ui/Foto';
import { ModalitaCucina } from '../ui/ModalitaCucina';
import { EditorRicetta, type Bozza, spostaPiatti } from './EditorRicetta';
import { useLotti } from './Casa';
import { useDatiMenu } from './Menu';
import { BottoniModo, BottoniSegno, FiltroIngrediente, type FiltroIngredienti, MODI, type Segno, SEGNI } from '../ui/FiltriRicetta';
import { haPrincipale, usaIngrediente } from '../dominio/principale';
import { daUsarePresto, oggi } from '../dominio/scadenze';
import { type ModoSuggerimento, type Segni, segniDa, suggerisci, ultimeVolte } from '../dominio/suggerimenti';

const PAGINA = 40;
const TEMPI = [
  { valore: 20, nome: '≤ 20 min' },
  { valore: 40, nome: '≤ 40 min' },
  { valore: 60, nome: '≤ 1 ora' },
];

export const ICONA_ESITO: Record<Esito, string> = { adatta: '✅', da_verificare: '❔', non_adatta: '⛔' };

/** I motivi uno per riga: prima quelli da evitare, poi quelli da controllare. */
export function Motivi({ dettagli }: { dettagli: Motivo[] }) {
  const ordinati = [...dettagli].sort((a, b) => (a.esito === b.esito ? 0 : a.esito === 'non_adatta' ? -1 : 1));
  return (
    <ul style={{ margin: '2px 0 6px', paddingLeft: 4, listStyle: 'none' }}>
      {ordinati.map((d) => (
        <li key={d.testo}>
          {ICONA_ESITO[d.esito]} {d.testo.charAt(0).toUpperCase() + d.testo.slice(1)}
        </li>
      ))}
    </ul>
  );
}

/** I motivi in una riga sola, per gli elenchi stretti. */
export function motiviInBreve(v: { motivi: string[]; dettagli?: Motivo[] }): string {
  return v.dettagli?.length ? v.dettagli.map((d) => `${ICONA_ESITO[d.esito]} ${d.testo}`).join('; ') : v.motivi.join('; ');
}

/** Gli ingredienti presenti in casa: i lotti aperti con qualcosa dentro. */
export function useInCasa(): Set<string> {
  const vista = useVista();
  const lotti = vista.righe.lotto;
  return useMemo(() => new Set((lotti ?? []).filter((l) => !l.eliminato_il && !l.chiuso_il && Number(l.quantita) > 0).map((l) => String(l.ingrediente_id))), [lotti]);
}

/** Le icone scelte dalla famiglia, per ricetta. */
export function useIcone(): Map<string, string> {
  const righe = useVista().righe.icona_ricetta;
  return useMemo(() => new Map((righe ?? []).filter((r) => !r.eliminato_il).map((r) => [String(r.ricetta_id), String(r.emoji)])), [righe]);
}

/** Le ricette ⭐ preferite e 💫 da ospiti della famiglia (nelle impostazioni della famiglia). */
export function useSegni(): Segni {
  const righe = useVista().righe.famiglia;
  const impostazioni = righe?.find((r) => !r.eliminato_il)?.impostazioni;
  const i = impostazioni as Record<string, unknown> | undefined;
  const chiave = JSON.stringify([i?.preferite, i?.per_ospiti, i?.modificate]);
  return useMemo(() => segniDa(impostazioni), [chiave]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** ⭐ e 💫 accanto al titolo di una ricetta. */
export function MarchiSegni({ id, segni }: { id: string; segni: Segni }) {
  const preferita = segni.preferite.has(id);
  const ospiti = segni.perOspiti.has(id);
  if (!preferita && !ospiti) return null;
  const nomi = [preferita && 'preferita', ospiti && 'da ospiti'].filter(Boolean).join(' e ');
  return (
    <span className="segni-ricetta" role="img" aria-label={nomi} title={nomi}>
      {preferita && '⭐'}
      {ospiti && '💫'}
    </span>
  );
}

/** Icone di piatti da proporre, oltre a quelle degli ingredienti della ricetta. */
const ICONE_PIATTI = ['🍝', '🍚', '🍛', '🍜', '🍲', '🥘', '🍕', '🥗', '🥙', '🌮', '🍔', '🥪', '🍳', '🥩', '🍗', '🐟', '🍣', '🦐', '🥦', '🥔', '🍆', '🥕', '🍅', '🫘', '🧀', '🥟', '🍰', '🍪', '🍮', '🍨', '🥧', '☕'];

/** La prima emoji di un testo (un'emoji può essere fatta di più codici), o null se non è un'emoji. */
function primaEmoji(testo: string): string | null {
  const t = testo.trim();
  if (!t) return null;
  const pezzo = [...new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(t)][0]?.segment ?? '';
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(pezzo) && pezzo.length <= 16 ? pezzo : null;
}

function CambiaIcona({ indice, ricetta: r, scelta, chiudi }: { indice: Indice; ricetta: Ricetta; scelta?: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [scritta, setScritta] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const attuale = iconaRicetta(indice, r, scelta);
  const automatica = iconaRicetta(indice, r);
  const proposte = [...new Set([automatica, ...r.ingredienti.map((g) => iconaIngrediente(indice.ingrediente(g.ingrediente_id))).filter((e): e is string => !!e), ...ICONE_PIATTI])];
  async function scegli(emoji: string | null) {
    await esegui('scegli_icona', { id: crypto.randomUUID(), ricetta_id: r.id, emoji });
    chiudi();
  }
  const bottone = (valore: string, nome: string) => (
    <button key={valore} className="bottone icona-scelta" aria-label={`Usa ${nome}`} title={nome} aria-pressed={valore === attuale} onClick={() => scegli(valore)}>
      <IconaCibo valore={valore} />
    </button>
  );
  const nomeDi = (valore: string) => (eDisegno(valore) ? (DISEGNO_PER_ID.get(valore.slice(PREFISSO_DISEGNO.length))?.nome ?? valore) : valore);
  const gruppi = [...new Set(DISEGNI_CIBO.map((x) => x.gruppo))];
  return (
    <Foglio titolo="Cambia icona" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {r.titolo}: ora <IconaCibo valore={attuale} />
        {scelta ? ' (scelta dalla famiglia)' : ' (automatica)'}. Vale per tutta la famiglia.
      </p>
      <h3 className="titoletto-icone">Per questa ricetta</h3>
      <div className="scelte" role="group" aria-label="Icone proposte">
        {proposte.map((e) => bottone(e, nomeDi(e)))}
      </div>
      {gruppi.map((g) => (
        <div key={g}>
          <h3 className="titoletto-icone">{g}</h3>
          <div className="scelte" role="group" aria-label={`Icone disegnate: ${g}`}>
            {DISEGNI_CIBO.filter((x) => x.gruppo === g).map((x) => bottone(disegno(x.id), x.nome))}
          </div>
        </div>
      ))}
      <label className="campo">
        <span>Oppure scrivi un’emoji</span>
        <input value={scritta} onChange={(e) => setScritta(e.target.value)} maxLength={16} style={{ width: 90 }} />
      </label>
      <button
        className="bottone"
        onClick={() => {
          const e = primaEmoji(scritta);
          if (!e) return setErrore('Scrivi un’emoji, per esempio 🍛.');
          void scegli(e);
        }}
      >
        Usa questa
      </button>
      {errore && (
        <div className="avviso errore" role="alert">
          {errore}
        </div>
      )}
      {scelta && (
        <button className="bottone pieno" style={{ marginTop: 12 }} onClick={() => scegli(null)}>
          Torna all’icona automatica
        </button>
      )}
    </Foglio>
  );
}

/** Chi mangia a casa e i suoi vincoli, nella forma che serve alla valutazione. */
export function useCommensali() {
  const vista = useVista();
  const { membro, vincolo_alimentare, ricetta_verificata } = vista.righe;
  return useMemo(() => {
    const membri = (membro ?? []).filter((m) => !m.eliminato_il && !m.archiviato).map((m) => ({ id: m.id, nome: String(m.nome) }));
    const vincoli = (vincolo_alimentare ?? []).filter((v) => !v.eliminato_il) as unknown as Vincolo[];
    const verifiche: Verifica[] = (ricetta_verificata ?? [])
      .filter((v) => !v.eliminato_il)
      .map((v) => ({ membro_id: String(v.membro_id), ricetta_id: String(v.ricetta_id), versione_ricetta: Number(v.versione_ricetta), va_bene: v.va_bene !== false }));
    return { membri, vincoli, verifiche };
  }, [membro, vincolo_alimentare, ricetta_verificata]);
}

export function Ricette() {
  const vista = useVista();
  const indice = useIndice(vista);
  const inCasa = useInCasa();
  const icone = useIcone();
  const { membri, vincoli, verifiche } = useCommensali();
  const [testo, setTesto] = useState('');
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [cucina, setCucina] = useState<string | null>(null);
  const [minuti, setMinuti] = useState<number | null>(null);
  const [ingredienti, setIngredienti] = useState<FiltroIngredienti>({ principale: null, ingrediente: null });
  const [segno, setSegno] = useState<Segno | null>(null);
  const [modo, setModo] = useState<ModoSuggerimento | null>(null);
  const segni = useSegni();
  const lotti = useLotti();
  const menu = useDatiMenu(vista);
  const [origine, setOrigine] = useState<'tutte' | 'famiglia'>('tutte');
  const [archiviate, setArchiviate] = useState(false);
  const [quante, setQuante] = useState(PAGINA);
  const [aperta, setAperta] = useState<string | null>(null);
  const [bozza, setBozza] = useState<Bozza | null>(null);

  const conVincoli = vincoli.length > 0;
  const filtrate = useMemo(
    () =>
      indice
        ? filtra(indice, { testo, categoria, cucina, minuti, inCasa: null, origine, archiviate })
            .filter((r) => haPrincipale(indice, r, ingredienti.principale) && usaIngrediente(indice, r, ingredienti.ingrediente))
            .filter((r) => (segno === 'preferita' ? segni.preferite.has(r.id) : segno === 'ospiti' ? segni.perOspiti.has(r.id) : true))
        : [],
    [indice, testo, categoria, cucina, minuti, origine, archiviate, ingredienti, segno, segni],
  );
  // Suggerite: in ordine di suggerimento, con il perché; fuori quelle non adatte a qualcuno della famiglia.
  const suggerite = useMemo(() => {
    if (!indice || !modo) return null;
    const giorno = oggi();
    const adatte = conVincoli ? filtrate.filter((r) => valutaPerFamiglia(indice, r, membri, vincoli, verifiche).esito !== 'non_adatta') : filtrate;
    return suggerisci(indice, adatte, {
      modo,
      inCasa,
      urgenti: daUsarePresto(lotti, giorno).map((l) => l.ingrediente_id),
      segni,
      persone: menu.persone,
      gusti: menu.gusti,
      ultimaVolta: ultimeVolte(menu.portate, giorno),
      oggi: giorno,
    });
  }, [indice, modo, filtrate, conVincoli, membri, vincoli, verifiche, inCasa, lotti, segni, menu]);
  const trovate = suggerite ? suggerite.map((x) => x.ricetta) : filtrate;
  const perche = useMemo(() => new Map((suggerite ?? []).map((x) => [x.ricetta.id, x.motivi.join(' · ')])), [suggerite]);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando le ricette…</p>;
  const ricetta = aperta ? indice.perId.get(aperta) : undefined;
  const filtriAttivi = !!(cucina || minuti || origine !== 'tutte' || archiviate);

  return (
    <>
      <div className="riga spazio" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Ricette</h2>
        <button className="bottone primario piccolo" onClick={() => setBozza({ tipo: 'nuova' })}>
          + Ricetta
        </button>
      </div>
      <label className="campo">
        <span>Cerca</span>
        <input type="search" value={testo} onChange={(e) => (setTesto(e.target.value), setQuante(PAGINA))} placeholder="Titolo o ingrediente: carbonara, zucchine…" />
      </label>
      <div className="scelte" role="group" aria-label="Categoria" style={{ marginBottom: 8 }}>
        {CATEGORIE.map((c) => (
          <button key={c.id} aria-pressed={categoria === c.id} onClick={() => setCategoria(categoria === c.id ? null : c.id)}>
            {c.emoji} {c.nome}
          </button>
        ))}
      </div>
      <FiltroIngrediente indice={indice} filtro={ingredienti} cambia={(f) => (setIngredienti({ ...ingredienti, ...f }), setQuante(PAGINA))} />
      <div className="scelte compatte suggerisci" style={{ marginTop: 10, marginBottom: 8 }}>
        <BottoniModo modo={modo} cambia={(m) => (setModo(m), setQuante(PAGINA))} casaVuota={!inCasa.size} />
        <span className="separatore" aria-hidden />
        <BottoniSegno segno={segno} cambia={(x) => (setSegno(x), setQuante(PAGINA))} />
      </div>
      <details style={{ marginBottom: 12 }} open={filtriAttivi}>
        <summary>Altri filtri</summary>
        <div className="scelte" role="group" aria-label="Filtri" style={{ marginTop: 8 }}>
          <button aria-pressed={origine === 'famiglia'} onClick={() => setOrigine(origine === 'famiglia' ? 'tutte' : 'famiglia')}>
            👪 Della famiglia
          </button>
          {TEMPI.map((t) => (
            <button key={t.valore} aria-pressed={minuti === t.valore} onClick={() => setMinuti(minuti === t.valore ? null : t.valore)}>
              ⏱️ {t.nome}
            </button>
          ))}
          {indice.catalogo.cucine.map((c) => (
            <button key={c.id} aria-pressed={cucina === c.id} onClick={() => setCucina(cucina === c.id ? null : c.id)}>
              {c.bandiera} {c.nome}
            </button>
          ))}
          <button aria-pressed={archiviate} onClick={() => setArchiviate(!archiviate)}>
            🗄️ Anche archiviate
          </button>
        </div>
      </details>
      <p className="tenue" aria-live="polite">
        {modo && `✨ ${MODI.find((m) => m.id === modo)!.nome}: ${MODI.find((m) => m.id === modo)!.spiega}. `}
        {trovate.length === 1 ? '1 ricetta' : `${trovate.length} ricette`}
        {conVincoli && ' · ✅ adatta a tutti · ❔ da verificare · ⛔ non adatta a qualcuno'}
      </p>
      {trovate.length === 0 && (
        <div className="avviso info">
          {modo === 'casa' ? 'Con ciò che c’è in casa manca troppo per queste ricette: prova «📖 Dal ricettario» o togli un filtro.' : 'Nessuna ricetta con questi filtri.'}
        </div>
      )}
      <div className="scheda" style={{ padding: trovate.length ? undefined : 0 }}>
        <ul className="elenco">
          {trovate.slice(0, quante).map((r) => (
            <VoceRicetta key={r.id} indice={indice} ricetta={r} icona={iconaRicetta(indice, r, icone.get(r.id))} segni={segni} perche={perche.get(r.id)} inCasa={inCasa} esito={conVincoli ? valutaPerFamiglia(indice, r, membri, vincoli, verifiche).esito : null} apri={() => setAperta(r.id)} />
          ))}
        </ul>
      </div>
      {trovate.length > quante && (
        <button className="bottone pieno" onClick={() => setQuante(quante + PAGINA)}>
          Mostra altre {Math.min(PAGINA, trovate.length - quante)}
        </button>
      )}
      {ricetta && !bozza && (
        <SchedaRicetta
          indice={indice}
          ricetta={ricetta}
          iconaScelta={icone.get(ricetta.id)}
          inCasa={inCasa}
          valutazione={conVincoli ? valutaPerFamiglia(indice, ricetta, membri, vincoli, verifiche) : null}
          chiudi={() => setAperta(null)}
          modifica={(b) => setBozza(b)}
        />
      )}
      {bozza && (
        <EditorRicetta
          indice={indice}
          bozza={bozza}
          chiudi={(id) => {
            setBozza(null);
            if (id) setAperta(id);
          }}
        />
      )}
    </>
  );
}

function VoceRicetta({
  indice,
  ricetta: r,
  icona,
  segni,
  perche,
  inCasa,
  esito,
  apri,
}: {
  indice: Indice;
  ricetta: Ricetta;
  icona: string;
  segni: Segni;
  /** Perché è suggerita (quando le ricette sono in ordine di suggerimento). */
  perche?: string;
  inCasa: Set<string>;
  esito: Esito | null;
  apri: () => void;
}) {
  const cat = CATEGORIE.find((c) => c.id === r.categoria);
  const cucina = r.cucina !== 'italiana' ? indice.catalogo.cucine.find((c) => c.id === r.cucina) : undefined;
  const cop = inCasa.size ? copertura(indice, r, inCasa) : null;
  return (
    <li>
      <button className="voce" onClick={apri} aria-label={`Apri ${r.titolo}`}>
        <span className="emoji" aria-hidden>
          <IconaCibo valore={icona} />
        </span>
        <span className="cresce">
          <strong>{r.titolo}</strong>
          <MarchiSegni id={r.id} segni={segni} />
          {r.in_attesa && <span className="etichetta attesa" style={{ marginLeft: 8 }}>in invio</span>}
          <span className="tenue" style={{ display: 'block' }}>
            {[cat?.nome, cucina && `${cucina.bandiera} ${cucina.nome}`, minutiDi(r) && `${minutiDi(r)} min`, !r.di_sistema && (indice.sostituite.get(r.derivata_da ?? '')?.id === r.id ? 'modificata da voi' : 'della famiglia'), r.archiviata && 'archiviata', cop && cop.totali > 0 && `${cop.presenti}/${cop.totali} in casa`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {perche && (
            <span className="perche" style={{ display: 'block' }}>
              ✨ {perche}
            </span>
          )}
        </span>
        {esito && (
          <span title={NOME_ESITO[esito]} aria-label={NOME_ESITO[esito]}>
            {ICONA_ESITO[esito]}
          </span>
        )}
      </button>
    </li>
  );
}

export function minutiDi(r: Ricetta): number | null {
  return r.minuti_totali ?? (r.minuti_preparazione || r.minuti_cottura ? (r.minuti_preparazione ?? 0) + (r.minuti_cottura ?? 0) : null);
}

/** La ricetta aperta. Senza `modifica` (da Oggi) si legge soltanto: niente icona, copie, modifiche o eliminazioni. */
export function SchedaRicetta({
  indice,
  ricetta: r,
  iconaScelta,
  inCasa,
  valutazione,
  chiudi,
  modifica,
  porzioniIniziali,
  sopra,
}: {
  indice: Indice;
  ricetta: Ricetta;
  iconaScelta?: string;
  inCasa: Set<string>;
  valutazione: ValutazioneFamiglia | null;
  chiudi: () => void;
  modifica?: (b: Bozza) => void;
  porzioniIniziali?: number;
  /** Cosa mostrare in cima, per esempio il pasto e chi mangia il piatto. */
  sopra?: ReactNode;
}) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const nelMenu = righeAttive(vista, 'portata').some((p) => p.ricetta_id === r.id) || righeAttive(vista, 'eccezione_membro').some((e) => e.ricetta_id === r.id);
  const [porzioni, setPorzioni] = useState(() => (porzioniIniziali && porzioniIniziali > 0 ? porzioniIniziali : r.porzioni));
  const casa = indice.estendi(inCasa);
  const origine = r.derivata_da ? indice.perId.get(r.derivata_da) : undefined;
  const [cambiaIcona, setCambiaIcona] = useState(false);
  const [cucina, setCucina] = useState(false);
  const segni = useSegni();
  const segnata = (s: Segno) => (s === 'preferita' ? segni.preferite : segni.perOspiti).has(r.id);
  const chiudiCucina = useCallback(() => setCucina(false), [setCucina]);

  /** ✅ «va bene» o ❌ «non va bene» chiudono il dubbio per quella persona; «togli» lo riapre. */
  async function segna(membro_id: string, nome: string, scelta: 'va_bene' | 'non_va_bene' | 'togli', escluso: boolean) {
    if (scelta === 'va_bene' && escluso && !window.confirm(`Per ${nome} la ricetta non rispetta un’esigenza. L’avete controllata e va bene lo stesso?`)) return;
    await esegui('verifica_ricetta', { id: crypto.randomUUID(), membro_id, ricetta_id: r.id, versione_ricetta: r.versione ?? 1, va_bene: scelta === 'va_bene', scelta });
  }

  // Le basi collegate (la besciamella…): ingredienti raggruppati e la loro preparazione prima dei passaggi.
  const collegate = righeEBasi(r);
  const passiBasi = collegate.basi.flatMap((b) => (indice.perId.get(b.ricetta_id)?.passi ?? []).map((p) => `${titoloBase(indice, b.ricetta_id)}: ${p.testo}`));
  const rigaIngrediente = (g: RigaRicetta) => {
    const ing = indice.ingrediente(g.ingrediente_id);
    const presente = !!ing?.base || casa.has(g.ingrediente_id);
    return (
      <li key={g.id} className="riga">
        <span aria-hidden>{ing?.emoji}</span>
        <span className="cresce">
          {g.testo || indice.nome(g.ingrediente_id)}
          {g.opzionale && <span className="tenue"> (facoltativo)</span>}
          {inCasa.size > 0 && presente && <span className="tenue"> · in casa</span>}
        </span>
        <span>{g.qb ? 'q.b.' : formatta(g.quantita === null ? null : scala({ valore: g.quantita, unita: g.unita }, r.porzioni, porzioni))}</span>
      </li>
    );
  };

  // La versione modificata di una ricetta di Mastercook: per la famiglia ne prende il posto.
  const modificata = !r.di_sistema && !r.archiviata && indice.sostituite.get(r.derivata_da ?? '')?.id === r.id;
  async function tornaAllOriginale() {
    if (!origine || !window.confirm(`Tornare alla ricetta originale «${origine.titolo}»? La vostra versione va tra le archiviate e i piatti in programma riprendono l’originale.`)) return;
    await spostaPiatti(esegui, vista, r.id, origine.id);
    await esegui('segna_ricetta', { ricetta_id: r.id, segno: 'modificata', attivo: false });
    await archivia(true);
    chiudi();
  }

  async function archivia(archiviata: boolean) {
    await esegui('salva_ricetta', { id: r.id, versione_attesa: r.versione, campi: { archiviata } });
  }
  async function elimina() {
    if (nelMenu) {
      if (window.confirm(`«${r.titolo}» è nel menu e non si può eliminare. Vuoi archiviarla? Resterà nei menu ma non comparirà più tra le ricette.`)) await archivia(true);
      return;
    }
    if (!window.confirm(`Eliminare «${r.titolo}»? Non si potrà recuperare, se non da un file di esportazione.`)) return;
    await esegui('elimina_ricetta', { id: r.id });
    chiudi();
  }

  if (cambiaIcona) return <CambiaIcona indice={indice} ricetta={r} scelta={iconaScelta} chiudi={() => setCambiaIcona(false)} />;
  return (
    <Foglio titolo={r.titolo} chiudi={chiudi}>
      {sopra}
      <Foto percorso={r.foto} alt={`Foto di ${r.titolo}`} />
      <p className="tenue">
        {modifica && (
          <button className="bottone piccolo" onClick={() => setCambiaIcona(true)} aria-label={`Cambia icona: ${r.titolo}`} style={{ marginRight: 8 }}>
            <IconaCibo valore={iconaRicetta(indice, r, iconaScelta)} /> Cambia icona
          </button>
        )}
        {modifica &&
          r.categoria !== 'base' &&
          SEGNI.map((x) => (
            <button
              key={x.id}
              className="bottone piccolo segno-ricetta"
              aria-pressed={segnata(x.id)}
              title={segnata(x.id) ? `Togli «${x.nome.toLowerCase()}»` : `Segna come ${x.nome.toLowerCase()} per tutta la famiglia`}
              onClick={() => esegui('segna_ricetta', { ricetta_id: r.id, segno: x.id, attivo: !segnata(x.id) })}
              style={{ marginRight: 8 }}
            >
              {x.emoji} {x.nome}
            </button>
          ))}

        {[CATEGORIE.find((c) => c.id === r.categoria)?.nome, minutiDi(r) && `${minutiDi(r)} min`, r.difficolta && ['facile', 'media', 'impegnativa'][r.difficolta - 1], r.di_sistema ? 'ricetta di Mastercook' : 'ricetta della famiglia']
          .filter(Boolean)
          .join(' · ')}
        {origine && ` · tratta da «${origine.titolo}»`}
      </p>
      {r.descrizione && <p>{r.descrizione}</p>}

      {valutazione && (
        <div className={`avviso ${valutazione.esito === 'adatta' ? 'info' : 'errore'}`} style={valutazione.esito === 'da_verificare' ? { background: 'var(--attenzione-tenue)', color: 'var(--attenzione)' } : undefined}>
          <strong>
            {ICONA_ESITO[valutazione.esito]} {NOME_ESITO[valutazione.esito]}
          </strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {valutazione.perMembro.map((m) => (
              <li key={m.membro_id}>
                <strong>{m.nome}</strong>: {ICONA_ESITO[m.valutazione.esito]}{' '}
                {m.valutazione.dettagli?.length ? null : m.valutazione.motivi.length ? m.valutazione.motivi.join('; ') : 'nessun problema noto'}
                {m.valutazione.verificabile &&
                  (m.valutazione.verificata || m.valutazione.scartata ? (
                    <button
                      className="bottone piccolo"
                      style={{ marginLeft: 8 }}
                      aria-label={m.valutazione.verificata ? `Togli «va bene» per ${m.nome}` : `Togli «non va bene» per ${m.nome}`}
                      onClick={() => segna(m.membro_id, m.nome, 'togli', false)}
                    >
                      {m.valutazione.verificata ? 'Togli «va bene»' : 'Togli «non va bene»'}
                    </button>
                  ) : (
                    <>
                      <button className="bottone piccolo" style={{ marginLeft: 8 }} aria-label={`Va bene per ${m.nome}`} onClick={() => segna(m.membro_id, m.nome, 'va_bene', m.valutazione.esito === 'non_adatta')}>
                        ✅ Va bene
                      </button>
                      {m.valutazione.esito === 'da_verificare' && (
                        <button className="bottone piccolo" style={{ marginLeft: 8 }} aria-label={`Non va bene per ${m.nome}`} onClick={() => segna(m.membro_id, m.nome, 'non_va_bene', false)}>
                          ❌ Non va bene
                        </button>
                      )}
                    </>
                  ))}
                {!!m.valutazione.dettagli?.length && <Motivi dettagli={m.valutazione.dettagli} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="riga spazio" style={{ margin: '12px 0' }}>
        <h3 style={{ margin: 0 }}>Ingredienti</h3>
        <div className="riga" role="group" aria-label="Porzioni">
          <button className="bottone piccolo" onClick={() => setPorzioni(Math.max(1, porzioni - 1))} aria-label="Una porzione in meno">
            −
          </button>
          <span aria-live="polite">{porzioni === 1 ? '1 porzione' : `${porzioni.toLocaleString('it-IT')} porzioni`}</span>
          <button className="bottone piccolo" onClick={() => setPorzioni(Math.min(50, porzioni + 1))} aria-label="Una porzione in più">
            +
          </button>
        </div>
      </div>
      <ul className="elenco">{collegate.proprie.map(rigaIngrediente)}</ul>
      {collegate.basi.map((b) => (
        <div key={b.ricetta_id}>
          <h4 style={{ margin: '12px 0 4px' }}>
            🥣 {titoloBase(indice, b.ricetta_id)} <span className="tenue">· {testoDosi(b.dosi)}</span>
          </h4>
          <ul className="elenco">{b.righe.map(rigaIngrediente)}</ul>
        </div>
      ))}
      {porzioni !== r.porzioni && <p className="tenue">Quantità ricalcolate da {r.porzioni} porzioni: i pezzi sono arrotondati al mezzo.</p>}

      <h3>Preparazione</h3>
      {r.passi.length > 0 && (
        <button className="bottone primario pieno cucina-apri" onClick={() => setCucina(true)}>
          👩‍🍳 Cucina passo passo
        </button>
      )}
      {cucina && (
        <ModalitaCucina
          titolo={r.titolo}
          passi={[...passiBasi, ...r.passi.map((p) => p.testo)]}
          ingredienti={r.ingredienti.map((g) => {
            const ing = indice.ingrediente(g.ingrediente_id);
            return {
              nome: indice.nome(g.ingrediente_id),
              parole: [indice.nome(g.ingrediente_id), ...(ing?.sinonimi ?? [])],
              quantita: g.qb ? 'q.b.' : formatta(g.quantita === null ? null : scala({ valore: g.quantita, unita: g.unita }, r.porzioni, porzioni)),
            };
          })}
          chiudi={chiudiCucina}
        />
      )}
      {collegate.basi.map((b) => (
        <details key={b.ricetta_id} style={{ marginBottom: 8 }}>
          <summary>🥣 Come si fa: {titoloBase(indice, b.ricetta_id)}</summary>
          <ol style={{ paddingLeft: 20 }}>
            {(indice.perId.get(b.ricetta_id)?.passi ?? []).map((p) => (
              <li key={p.id} style={{ marginBottom: 8 }}>
                {p.testo}
              </li>
            ))}
          </ol>
        </details>
      ))}
      <ol style={{ paddingLeft: 20 }}>
        {r.passi.map((p) => (
          <li key={p.id} style={{ marginBottom: 8 }}>
            {p.testo}
          </li>
        ))}
      </ol>

      {modifica && (
        <>
          <div className="riga" style={{ flexWrap: 'wrap', marginTop: 16 }}>
            {r.di_sistema ? (
              <>
                <button className="bottone primario" onClick={() => modifica({ tipo: 'copia', da: r, sostituisce: true })}>
                  Modifica
                </button>
                <button className="bottone" onClick={() => modifica({ tipo: 'copia', da: r })}>
                  Duplica
                </button>
              </>
            ) : (
              <>
                <button className="bottone primario" onClick={() => modifica({ tipo: 'modifica', ricetta: r })}>
                  Modifica
                </button>
                <button className="bottone" onClick={() => modifica({ tipo: 'copia', da: r })}>
                  Duplica
                </button>
                {modificata && origine ? (
                  <button className="bottone" onClick={tornaAllOriginale}>
                    Torna alla ricetta originale
                  </button>
                ) : (
                  <>
                    <button className="bottone" onClick={() => archivia(!r.archiviata)}>
                      {r.archiviata ? 'Riporta tra le ricette' : 'Archivia'}
                    </button>
                    <button className="bottone pericolo" onClick={elimina}>
                      Elimina
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          {r.di_sistema && <p className="tenue">«Modifica» cambia la ricetta solo per la vostra famiglia (l’originale di Mastercook resta com’è); «Duplica» ne fa una ricetta nuova accanto a questa.</p>}
          {modificata && origine && <p className="tenue">È la vostra versione di «{origine.titolo}»: ne prende il posto in ricette, menu e proposte.</p>}
        </>
      )}
    </Foglio>
  );
}
