import { useMemo, useState } from 'react';
import { CATEGORIE, type Categoria } from '../catalogo/tipi';
import { righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type Esito, NOME_ESITO, valutaPerFamiglia, type ValutazioneFamiglia, type Vincolo } from '../dominio/compatibilita';
import { copertura, filtra, iconaRicetta, type Indice, type Ricetta } from '../dominio/ricette';
import { formatta, scala } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { Foto } from '../ui/Foto';
import { EditorRicetta, type Bozza } from './EditorRicetta';

const PAGINA = 40;
const TEMPI = [
  { valore: 20, nome: '≤ 20 min' },
  { valore: 40, nome: '≤ 40 min' },
  { valore: 60, nome: '≤ 1 ora' },
];

export const ICONA_ESITO: Record<Esito, string> = { adatta: '✅', da_verificare: '❔', non_adatta: '⛔' };

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
  const proposte = [...new Set([...r.ingredienti.map((g) => indice.ingrediente(g.ingrediente_id)?.emoji).filter((e): e is string => !!e), ...ICONE_PIATTI])];
  async function scegli(emoji: string | null) {
    await esegui('scegli_icona', { id: crypto.randomUUID(), ricetta_id: r.id, emoji });
    chiudi();
  }
  return (
    <Foglio titolo="Cambia icona" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {r.titolo}: ora <span aria-hidden>{attuale}</span>
        {scelta ? ' (scelta dalla famiglia)' : ' (automatica, dall’ingrediente principale)'}. Vale per tutta la famiglia.
      </p>
      <div className="scelte" role="group" aria-label="Icone proposte">
        {proposte.map((e) => (
          <button key={e} className="bottone" aria-label={`Usa ${e}`} aria-pressed={e === attuale} onClick={() => scegli(e)}>
            {e}
          </button>
        ))}
      </div>
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
  const { membro, vincolo_alimentare } = vista.righe;
  return useMemo(() => {
    const membri = (membro ?? []).filter((m) => !m.eliminato_il && !m.archiviato).map((m) => ({ id: m.id, nome: String(m.nome) }));
    const vincoli = (vincolo_alimentare ?? []).filter((v) => !v.eliminato_il) as unknown as Vincolo[];
    return { membri, vincoli };
  }, [membro, vincolo_alimentare]);
}

export function Ricette() {
  const vista = useVista();
  const indice = useIndice(vista);
  const inCasa = useInCasa();
  const icone = useIcone();
  const { membri, vincoli } = useCommensali();
  const [testo, setTesto] = useState('');
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [cucina, setCucina] = useState<string | null>(null);
  const [minuti, setMinuti] = useState<number | null>(null);
  const [soloCasa, setSoloCasa] = useState(false);
  const [origine, setOrigine] = useState<'tutte' | 'famiglia'>('tutte');
  const [archiviate, setArchiviate] = useState(false);
  const [quante, setQuante] = useState(PAGINA);
  const [aperta, setAperta] = useState<string | null>(null);
  const [bozza, setBozza] = useState<Bozza | null>(null);

  const trovate = useMemo(
    () => (indice ? filtra(indice, { testo, categoria, cucina, minuti, inCasa: soloCasa ? inCasa : null, origine, archiviate }) : []),
    [indice, testo, categoria, cucina, minuti, soloCasa, inCasa, origine, archiviate],
  );
  const conVincoli = vincoli.length > 0;

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando le ricette…</p>;
  const ricetta = aperta ? indice.perId.get(aperta) : undefined;
  const filtriAttivi = !!(categoria || cucina || minuti || soloCasa || origine !== 'tutte' || archiviate);

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
      <details style={{ marginBottom: 12 }} open={filtriAttivi}>
        <summary>Altri filtri</summary>
        <div className="scelte" role="group" aria-label="Filtri" style={{ marginTop: 8 }}>
          <button aria-pressed={soloCasa} onClick={() => setSoloCasa(!soloCasa)} disabled={!inCasa.size}>
            🏠 Con ciò che ho
          </button>
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
        {trovate.length === 1 ? '1 ricetta' : `${trovate.length} ricette`}
        {conVincoli && ' · ✅ adatta a tutti · ❔ da verificare · ⛔ non adatta a qualcuno'}
      </p>
      {trovate.length === 0 && <div className="avviso info">Nessuna ricetta con questi filtri.</div>}
      <div className="scheda" style={{ padding: trovate.length ? undefined : 0 }}>
        <ul className="elenco">
          {trovate.slice(0, quante).map((r) => (
            <VoceRicetta key={r.id} indice={indice} ricetta={r} icona={iconaRicetta(indice, r, icone.get(r.id))} inCasa={inCasa} esito={conVincoli ? valutaPerFamiglia(indice, r, membri, vincoli).esito : null} apri={() => setAperta(r.id)} />
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
          valutazione={conVincoli ? valutaPerFamiglia(indice, ricetta, membri, vincoli) : null}
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
  inCasa,
  esito,
  apri,
}: {
  indice: Indice;
  ricetta: Ricetta;
  icona: string;
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
          {icona}
        </span>
        <span className="cresce">
          <strong>{r.titolo}</strong>
          {r.in_attesa && <span className="etichetta attesa" style={{ marginLeft: 8 }}>in invio</span>}
          <span className="tenue" style={{ display: 'block' }}>
            {[cat?.nome, cucina && `${cucina.bandiera} ${cucina.nome}`, minutiDi(r) && `${minutiDi(r)} min`, !r.di_sistema && 'della famiglia', r.archiviata && 'archiviata', cop && cop.totali > 0 && `${cop.presenti}/${cop.totali} in casa`]
              .filter(Boolean)
              .join(' · ')}
          </span>
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

function SchedaRicetta({
  indice,
  ricetta: r,
  iconaScelta,
  inCasa,
  valutazione,
  chiudi,
  modifica,
}: {
  indice: Indice;
  ricetta: Ricetta;
  iconaScelta?: string;
  inCasa: Set<string>;
  valutazione: ValutazioneFamiglia | null;
  chiudi: () => void;
  modifica: (b: Bozza) => void;
}) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const nelMenu = righeAttive(vista, 'portata').some((p) => p.ricetta_id === r.id) || righeAttive(vista, 'eccezione_membro').some((e) => e.ricetta_id === r.id);
  const [porzioni, setPorzioni] = useState(r.porzioni);
  const casa = indice.estendi(inCasa);
  const origine = r.derivata_da ? indice.perId.get(r.derivata_da) : undefined;
  const [cambiaIcona, setCambiaIcona] = useState(false);

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
      <Foto percorso={r.foto} alt={`Foto di ${r.titolo}`} />
      <p className="tenue">
        <button className="bottone piccolo" onClick={() => setCambiaIcona(true)} aria-label={`Cambia icona: ${r.titolo}`} style={{ marginRight: 8 }}>
          <span aria-hidden>{iconaRicetta(indice, r, iconaScelta)}</span> Cambia icona
        </button>

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
                {m.nome}: {ICONA_ESITO[m.valutazione.esito]} {m.valutazione.motivi.length ? m.valutazione.motivi.join('; ') : 'nessun problema noto'}
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
          <span aria-live="polite">{porzioni === 1 ? '1 porzione' : `${porzioni} porzioni`}</span>
          <button className="bottone piccolo" onClick={() => setPorzioni(Math.min(50, porzioni + 1))} aria-label="Una porzione in più">
            +
          </button>
        </div>
      </div>
      <ul className="elenco">
        {r.ingredienti.map((g) => {
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
        })}
      </ul>
      {porzioni !== r.porzioni && <p className="tenue">Quantità ricalcolate da {r.porzioni} porzioni: i pezzi sono arrotondati al mezzo.</p>}

      <h3>Preparazione</h3>
      <ol style={{ paddingLeft: 20 }}>
        {r.passi.map((p) => (
          <li key={p.id} style={{ marginBottom: 8 }}>
            {p.testo}
          </li>
        ))}
      </ol>

      <div className="riga" style={{ flexWrap: 'wrap', marginTop: 16 }}>
        <button className="bottone" onClick={() => modifica({ tipo: 'copia', da: r })}>
          {r.di_sistema ? 'Crea la mia versione' : 'Duplica'}
        </button>
        {!r.di_sistema && (
          <>
            <button className="bottone primario" onClick={() => modifica({ tipo: 'modifica', ricetta: r })}>
              Modifica
            </button>
            <button className="bottone" onClick={() => archivia(!r.archiviata)}>
              {r.archiviata ? 'Riporta tra le ricette' : 'Archivia'}
            </button>
            <button className="bottone pericolo" onClick={elimina}>
              Elimina
            </button>
          </>
        )}
      </div>
      {r.di_sistema && <p className="tenue">Le ricette di Mastercook non si modificano: crea la tua versione e cambiala come vuoi.</p>}
    </Foglio>
  );
}
