import { useMemo, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { dataLunga } from '../dominio/menu';
import { CATEGORIE } from '../catalogo/tipi';
import { candidate, type ContestoProposte, type FiltroProposte, proponi, RICETTE_PER_PASTO, tipoPiatto } from '../dominio/proposte';
import { iconaRicetta, type Indice, type Ricetta } from '../dominio/ricette';
import { daUsarePresto, oggi, piuGiorni } from '../dominio/scadenze';
import { Foglio } from '../ui/Foglio';
import { IconaCibo } from '../ui/IconaCibo';
import { useLotti } from './Casa';
import { useSegni } from './Ricette';
import { BottoniModo } from '../ui/FiltriRicetta';
import type { ModoSuggerimento } from '../dominio/suggerimenti';
import type { DatiMenu } from './Menu';

/** Cosa serve per proporre: chi mangia, vincoli, gusti, casa, e i piatti già in menu vicino a quei giorni. */
export function useContestoProposte(dati: DatiMenu, dal: string, al: string): ContestoProposte {
  const lotti = useLotti();
  const segni = useSegni();
  return useMemo(() => {
    const giorno = oggi();
    return {
      persone: dati.persone,
      vincoli: dati.vincoli,
      verifiche: dati.verifiche,
      gusti: dati.gusti,
      inCasa: lotti.map((l) => l.ingrediente_id),
      urgenti: daUsarePresto(lotti, giorno).map((l) => l.ingrediente_id),
      recenti: dati.portate.filter((p) => p.ricetta_id && p.data >= piuGiorni(dal, -14) && p.data <= piuGiorni(al, 7)).map((p) => p.ricetta_id!),
      segni,
    };
  }, [dati, lotti, dal, al, segni]);
}

const SENZA_PROPOSTE_CON_DUBBI =
  'Nessuna ricetta è adatta a tutti senza dubbi. Apri le ricette con ❔ e segna «✅ Va bene» quelle che avete controllato: poi l’app potrà proporle.';

/**
 * Proponi la settimana: un piatto per ogni pasto vuoto da oggi in poi. Si guarda, si cambia con un tocco,
 * si tolgono quelle che non vanno; entra nel menu solo ciò che si conferma.
 */
export function ProponiSettimana({ indice, dati, giorni, chiudi }: { indice: Indice; dati: DatiMenu; giorni: string[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const da = giorni.filter((g) => g >= oggi());
  const contesto = useContestoProposte(dati, giorni[0], giorni[giorni.length - 1]);
  const pasti = dati.categorie.filter((c) => c.attiva && RICETTE_PER_PASTO[c.valore]);
  const proposte = useMemo(() => {
    const posti = da.flatMap((data) => pasti.filter((c) => !dati.portate.some((p) => p.data === data && p.categoria === c.valore)).map((c) => ({ data, categoria: c.valore })));
    return proponi(indice, posti, contesto);
  }, [indice, dati, contesto]); // eslint-disable-line react-hooks/exhaustive-deps
  const chiave = (p: { data: string; categoria: string }) => `${p.data}|${p.categoria}`;
  const [indici, setIndici] = useState<Record<string, number>>({});
  const [tolte, setTolte] = useState<Set<string>>(new Set());
  const scelta = (p: (typeof proposte)[number]): Ricetta => [p.ricetta, ...p.altre][indici[chiave(p)] ?? 0] ?? p.ricetta;
  const daMettere = proposte.filter((p) => !tolte.has(chiave(p)));

  async function conferma() {
    for (const p of daMettere) {
      const ordine = dati.portate.filter((x) => x.data === p.data && x.categoria === p.categoria).length;
      await esegui('aggiungi_portata', { id: crypto.randomUUID(), data: p.data, categoria: p.categoria, ricetta_id: scelta(p).id, ordine, origine: 'automatica' });
    }
    chiudi();
  }

  return (
    <Foglio titolo="Proposte per la settimana" chiudi={chiudi}>
      {proposte.length === 0 ? (
        <p className="tenue" style={{ marginTop: 0 }}>
          {!da.length
            ? 'Questa settimana è già passata.'
            : dati.vincoli.length && !candidate(indice, 'cena', contesto).length
              ? SENZA_PROPOSTE_CON_DUBBI
              : 'I pasti di questa settimana sono già tutti nel menu.'}
        </p>
      ) : (
        <>
          <p className="tenue" style={{ marginTop: 0 }}>
            Solo ricette adatte a tutti, senza ciò che a qualcuno non piace. Prima quelle che usano ciò che scade e ciò che avete in casa. Nulla entra nel menu finché non
            confermi.
          </p>
          <ul className="elenco" aria-label="Proposte">
            {proposte.map((p) => {
              const r = scelta(p);
              const k = chiave(p);
              const via = tolte.has(k);
              const nome = dati.categorie.find((c) => c.valore === p.categoria)?.nome ?? p.categoria;
              const motivi = (indici[k] ?? 0) === 0 ? p.motivi : [];
              return (
                <li key={k} className="riga" style={{ flexWrap: 'wrap', opacity: via ? 0.5 : 1 }}>
                  <label className="riga cresce" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={!via}
                      aria-label={`Metti ${r.titolo} a ${nome.toLowerCase()} di ${dataLunga(p.data)}`}
                      onChange={() =>
                        setTolte((t) => {
                          const n = new Set(t);
                          if (n.has(k)) n.delete(k);
                          else n.add(k);
                          return n;
                        })
                      }
                    />
                    <span>
                      <span className="tenue" style={{ display: 'block', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                        {dataLunga(p.data)} · {nome}
                      </span>
                      {r.titolo}
                      {motivi.length > 0 && (
                        <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
                          {motivi.join(' · ')}
                        </span>
                      )}
                    </span>
                  </label>
                  {p.altre.length > 0 && (
                    <button
                      className="bottone piccolo"
                      aria-label={`Un’altra per ${nome.toLowerCase()} di ${dataLunga(p.data)}`}
                      onClick={() => setIndici((x) => ({ ...x, [k]: ((x[k] ?? 0) + 1) % (p.altre.length + 1) }))}
                    >
                      ↻ Un’altra
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button className="bottone primario pieno" style={{ marginTop: 12 }} disabled={!daMettere.length} onClick={() => void conferma()}>
            Metti nel menu ({daMettere.length})
          </button>
        </>
      )}
    </Foglio>
  );
}

/** Tre idee per un pasto, quando si aggiunge un piatto: le stesse regole della settimana proposta. */
/**
 * Un'idea alla volta per il pasto, con i filtri scelti (categoria, ingrediente principale).
 * «Un'altra» passa alla successiva finché ce ne sono; prima quelle di tipo diverso da ciò che c'è già nel giorno.
 */
export function IdeePerPasto({
  indice,
  dati,
  data,
  categoria,
  filtro: filtroScelto,
  conOspiti,
  icone,
  scegli,
}: {
  indice: Indice;
  dati: DatiMenu;
  data: string;
  categoria: string;
  filtro: FiltroProposte;
  /** Al pasto ci sono ospiti: prima le ricette 💫. */
  conOspiti?: boolean;
  icone?: Map<string, string>;
  scegli: (ricetta_id: string) => void;
}) {
  const base = useContestoProposte(dati, data, data);
  const contesto = useMemo(() => ({ ...base, conOspiti }), [base, conOspiti]);
  // Con la casa vuota si parte dal ricettario; altrimenti da ciò che c'è.
  const casaVuota = base.inCasa.length === 0;
  const [modo, setModo] = useState<ModoSuggerimento>(casaVuota ? 'ricettario' : 'casa');
  const filtro = useMemo(() => ({ ...filtroScelto, modo: casaVuota ? 'ricettario' : modo }), [filtroScelto, modo, casaVuota]);
  const idee = useMemo(() => {
    const gia = new Set(dati.portate.filter((p) => p.data === data && p.ricetta_id).map((p) => p.ricetta_id!));
    const tipi = [...gia].map((id) => indice.perId.get(id)).filter((r): r is Ricetta => !!r).map((r) => tipoPiatto(indice, r));
    const tutte = candidate(indice, categoria, contesto, filtro).filter((x) => !gia.has(x.ricetta.id));
    return [...tutte.filter((x) => !tipi.includes(x.tipo)), ...tutte.filter((x) => tipi.includes(x.tipo))];
  }, [indice, dati, data, categoria, contesto, filtro]);
  const [quale, setQuale] = useState(0);
  // Cambiando i filtri si riparte dalla migliore.
  const chiave = `${filtro.categoria ?? ''}|${filtro.principale ?? ''}|${filtro.ingrediente ?? ''}|${filtro.segno ?? ''}|${filtro.modo}`;
  const [ultima, setUltima] = useState(chiave);
  if (ultima !== chiave) {
    setUltima(chiave);
    setQuale(0);
  }
  const idea = idee[quale];
  return (
    <section className="idea-pasto" aria-label="Idea per questo pasto">
      <div className="riga spazio">
        <span className="titoletto">
          ✨ Idea per questo pasto
          {idee.length > 0 && (
            <>
              {' · '}
              <span className="tenue piccolo" style={{ fontWeight: 400 }}>
                {quale + 1} di {idee.length}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="scelte compatte modo-idea">
        <BottoniModo modo={filtro.modo} cambia={(m) => m && setModo(m)} obbligatorio casaVuota={casaVuota} />
      </div>
      {!idea ? (
        <p className="tenue" style={{ margin: '4px 0 0' }}>
          {filtro.modo === 'casa'
            ? 'Con ciò che c’è in casa non si fa niente di adatto (manca troppo): prova «📖 Dal ricettario».'
            : filtro.categoria || filtro.principale || filtro.ingrediente || filtro.segno
              ? 'Nessuna idea adatta con questi filtri: prova a toglierne uno.'
              : 'Nessuna idea per questo pasto: cerca qui sotto.'}
        </p>
      ) : (
        <>
          <button type="button" className="voce idea" onClick={() => scegli(idea.ricetta.id)} aria-label={`Metti nel menu ${idea.ricetta.titolo}`}>
            <span className="icona-voce grande" aria-hidden>
              <IconaCibo valore={iconaRicetta(indice, idea.ricetta, icone?.get(idea.ricetta.id))} />
            </span>
            <span className="cresce">
              <strong>{idea.ricetta.titolo}</strong>
              <span className="tenue" style={{ display: 'block' }}>
                {[CATEGORIE.find((c) => c.id === idea.ricetta.categoria)?.nome, minuti(idea.ricetta), ...idea.motivi].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="tenue" aria-hidden>
              ＋
            </span>
          </button>
          <button type="button" className="bottone piccolo pieno" onClick={() => setQuale(quale + 1)} disabled={quale + 1 >= idee.length}>
            {quale + 1 >= idee.length ? 'Nessun’altra idea con questi filtri' : '🔄 Un’altra'}
          </button>
        </>
      )}
    </section>
  );
}

function minuti(r: Ricetta) {
  const m = r.minuti_totali ?? ((r.minuti_preparazione ?? 0) + (r.minuti_cottura ?? 0) || null);
  return m ? `${m} min` : null;
}
