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
import { Fumetto, FacciaAntonino, useAntonino, useImpara } from './Antonino';
import { adattamentiBambini, composizione, equilibrio, notaComposizione, REGOLE_BASE, type VotoSettimana, votoSettimana } from '../dominio/antonino';
import type { Persona } from '../dominio/menu';
import type { Rimedio } from '../dominio/senza';
import { EtichettaRimedio } from './Senza';

/** Cosa serve per proporre: chi mangia, vincoli, gusti, casa, e i piatti già in menu vicino a quei giorni. */
export function useContestoProposte(dati: DatiMenu, dal: string, al: string): ContestoProposte {
  const lotti = useLotti();
  const segni = useSegni();
  const { regole, memoria } = useAntonino();
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
      regole,
      memoria,
      oggi: giorno,
    };
  }, [dati, lotti, dal, al, segni, regole, memoria]);
}

const SENZA_PROPOSTE_CON_DUBBI =
  'Nessuna ricetta è adatta a tutti senza dubbi. Apri le ricette con ❔ e segna «✅ Va bene» quelle che avete controllato: poi l’app potrà proporle.';

/** Le ricette di pranzi e cene già nel menu, per contare l'equilibrio della settimana. */
function giaNelMenu(indice: Indice, dati: DatiMenu, giorni: string[]) {
  return dati.portate
    .filter((p) => p.ricetta_id && giorni.includes(p.data) && (p.categoria === 'pranzo' || p.categoria === 'cena'))
    .map((p) => ({ data: p.data, categoria: p.categoria, ricetta: indice.perId.get(p.ricetta_id!), bloccata: !!p.bloccata }))
    .filter((p): p is { data: string; categoria: string; ricetta: Ricetta; bloccata: boolean } => !!p.ricetta);
}

function nomiInsieme(nomi: string[]): string {
  return nomi.length < 2 ? nomi.join('') : `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
}

/**
 * Antonino propone la settimana: un piatto per ogni pasto vuoto da oggi in poi, guardando anche l'equilibrio
 * (pesce, legumi, carne rossa, verdure ogni giorno). Si cambia con 🔄, si toglie con ✕; entra nel menu solo
 * ciò che si conferma. Confermando, Antonino ricorda cosa avete scelto e cosa avete scartato.
 */
export function ProponiSettimana({ indice, dati, giorni, chiudi }: { indice: Indice; dati: DatiMenu; giorni: string[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const impara = useImpara();
  const da = giorni.filter((g) => g >= oggi());
  const contesto = useContestoProposte(dati, giorni[0], giorni[giorni.length - 1]);
  const pasti = dati.categorie.filter((c) => c.attiva && RICETTE_PER_PASTO[c.valore]);
  const gia = useMemo(() => giaNelMenu(indice, dati, giorni), [indice, dati, giorni]);
  const [scarta, setScarta] = useState<Map<string, string[]>>(new Map());
  const proposte = useMemo(() => {
    const posti = da.flatMap((data) => pasti.filter((c) => !dati.portate.some((p) => p.data === data && p.categoria === c.valore)).map((c) => ({ data, categoria: c.valore })));
    return proponi(indice, posti, contesto, new Map(), scarta, { piatti: gia });
  }, [indice, dati, contesto, scarta, gia]); // eslint-disable-line react-hooks/exhaustive-deps
  const chiave = (p: { data: string; categoria: string }) => `${p.data}|${p.categoria}`;
  const [indici, setIndici] = useState<Record<string, number>>({});
  const [tolte, setTolte] = useState<Set<string>>(new Set());
  const scelta = (p: (typeof proposte)[number]): Ricetta => [p.ricetta, ...p.altre][indici[chiave(p)] ?? 0] ?? p.ricetta;
  const daMettere = proposte.filter((p) => !tolte.has(chiave(p)));
  const principaliSettimana = [...gia, ...daMettere.filter((p) => p.categoria === 'pranzo' || p.categoria === 'cena').map((p) => ({ data: p.data, ricetta: scelta(p) }))];
  const voci = equilibrio(indice, principaliSettimana, contesto.regole ?? REGOLE_BASE, da).filter(
    (v) => v.min !== undefined || v.stato !== 'ok' || v.gruppo === 'carne_rossa',
  );
  const bambini = conBambini(dati.persone);
  const urgenti = [...new Set(contesto.urgenti.filter((id) => id !== 'ing:avanzo'))];
  const nellaSettimana = new Set(principaliSettimana.flatMap((p) => p.ricetta.ingredienti.map((g) => g.ingrediente_id)));
  const usati = urgenti.filter((u) => [...indice.estendi([u])].some((id) => nellaSettimana.has(id)));
  // Il voto guarda tutta la settimana, anche i giorni già passati: le frequenze sono settimanali.
  const voto = votoSettimana(indice, principaliSettimana, contesto.regole ?? REGOLE_BASE, giorni, {
    bambini,
    mese: Number(oggi().slice(5, 7)),
    urgenti: urgenti.length,
    urgentiUsati: usati.length,
  });
  const scadono = [...new Set(proposte.flatMap((p) => p.motivi.filter((m) => m.endsWith('che scade presto')).map((m) => m.replace(/^usa /, '').replace(/ che scade presto$/, ''))))];

  async function conferma() {
    for (const p of daMettere) {
      const ordine = dati.portate.filter((x) => x.data === p.data && x.categoria === p.categoria).length;
      await esegui('aggiungi_portata', { id: crypto.randomUUID(), data: p.data, categoria: p.categoria, ricetta_id: scelta(p).id, ordine, origine: 'automatica' });
    }
    // Antonino impara: la prima proposta cambiata o tolta è «scartata», ciò che entra nel menu è «scelto».
    for (const p of proposte) {
      if (tolte.has(chiave(p)) || scelta(p) !== p.ricetta) impara('scartata', p.ricetta.id);
      if (!tolte.has(chiave(p))) impara('scelta', scelta(p).id);
    }
    chiudi();
  }

  function rifai() {
    setScarta((s) => {
      const n = new Map(s);
      for (const p of proposte) n.set(chiave(p), [...(n.get(chiave(p)) ?? []), scelta(p).id]);
      return n;
    });
    setIndici({});
    setTolte(new Set());
  }

  const giorniConPiatti = da.filter((d) => proposte.some((p) => p.data === d) || gia.some((p) => p.data === d));
  return (
    <Foglio titolo="Antonino ti propone la settimana" chiudi={chiudi}>
      {proposte.length === 0 ? (
        <Fumetto>
          {!da.length
            ? 'Questa settimana è già passata.'
            : dati.vincoli.length && !candidate(indice, 'cena', contesto).length
              ? SENZA_PROPOSTE_CON_DUBBI
              : 'I pasti di questa settimana sono già tutti nel menu.'}
        </Fumetto>
      ) : (
        <div className="settimana-antonino">
          <div className="riassunto">
            <Fumetto>
              Ho riempito{' '}
              <strong>
                {proposte.length} {proposte.length === 1 ? 'pasto vuoto' : 'pasti vuoti'}
              </strong>
              {gia.some((p) => p.bloccata) ? ' e lasciato com’erano i piatti 🔒 bloccati' : ''}. Solo piatti adatti a chi mangia
              {scadono.length ? `; prima ${nomiInsieme(scadono.slice(0, 3))}, che scadono presto` : ''}. Nel menu entra solo ciò che confermi.
            </Fumetto>
            {voci.length > 0 && (
              <>
                <div className="tenue piccolo" style={{ margin: '0 2px 6px', fontWeight: 600 }}>
                  Equilibrio della settimana
                </div>
                <ul className="equilibrio" aria-label="Equilibrio della settimana">
                  {voci.map((v) => (
                    <li key={v.gruppo} className={v.stato}>
                      <span aria-hidden>{v.emoji}</span> {v.nome}
                      <strong>
                        {v.gruppo === 'verdure_giorni' ? `${v.conta}/${v.min}` : v.conta} {v.stato === 'ok' ? '✓' : v.stato === 'troppo' ? '↑' : ''}
                      </strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <VotoAntonino voto={voto} />
            <div className="bottoni-antonino">
              <button className="bottone primario pieno" disabled={!daMettere.length} onClick={() => void conferma()}>
                ✓ Metti nel menu ({daMettere.length})
              </button>
              <button className="bottone pieno" onClick={rifai}>
                🔄 Rifai tutta la settimana
              </button>
            </div>
          </div>
          <div className="giorni-antonino" aria-label="Proposte">
            {giorniConPiatti.map((d) => (
              <section key={d} aria-label={dataLunga(d)}>
                <h3 className="giorno-antonino">{dataLunga(d)}</h3>
                <ul className="elenco">
                  {pasti.map((c) => {
                    const p = proposte.find((x) => x.data === d && x.categoria === c.valore);
                    if (!p) {
                      const fatti = gia.filter((x) => x.data === d && x.categoria === c.valore);
                      return fatti.map((x) => (
                        <li key={`${c.valore}-${x.ricetta.id}`} className="piatto-antonino gia">
                          <span className="icona-voce" aria-hidden>
                            <IconaCibo valore={iconaRicetta(indice, x.ricetta)} />
                          </span>
                          <span className="cresce">
                            <span className="pasto-antonino">
                              {c.nome}
                              {x.bloccata ? ' · 🔒 bloccato' : ' · già nel menu'}
                            </span>
                            <strong>{x.ricetta.titolo}</strong>
                          </span>
                        </li>
                      ));
                    }
                    const r = scelta(p);
                    const k = chiave(p);
                    const via = tolte.has(k);
                    const nome = c.nome.toLowerCase();
                    const motivi = (indici[k] ?? 0) === 0 ? p.motivi : [];
                    return (
                      <li key={k} className={`piatto-antonino${via ? ' tolta' : ''}`}>
                        <span className="icona-voce" aria-hidden>
                          <IconaCibo valore={iconaRicetta(indice, r)} />
                        </span>
                        <span className="cresce">
                          <span className="pasto-antonino">{c.nome}</span>
                          <strong>{r.titolo}</strong>
                          {motivi.length > 0 && <span className="tenue motivi">{motivi.join(' · ')}</span>}
                          <ConsigliDelDietista indice={indice} ricetta={r} bambini={bambini} />
                        </span>
                        <span className="azioni">
                          {p.altre.length > 0 && !via && (
                            <button
                              className="bottone piccolo"
                              aria-label={`Un’altra per ${nome} di ${dataLunga(p.data)}`}
                              onClick={() => setIndici((x) => ({ ...x, [k]: ((x[k] ?? 0) + 1) % (p.altre.length + 1) }))}
                            >
                              🔄
                            </button>
                          )}
                          <button
                            className="bottone piccolo"
                            aria-label={via ? `Rimetti ${r.titolo} a ${nome} di ${dataLunga(p.data)}` : `Togli ${r.titolo} da ${nome} di ${dataLunga(p.data)}`}
                            onClick={() =>
                              setTolte((t) => {
                                const n = new Set(t);
                                if (n.has(k)) n.delete(k);
                                else n.add(k);
                                return n;
                              })
                            }
                          >
                            {via ? '↩︎' : '✕'}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </Foglio>
  );
}

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
  /** `rimedio`: la ricetta va bene togliendo un ingrediente; chi la sceglie decide per chi toglierlo. */
  scegli: (ricetta_id: string, rimedio?: Rimedio) => void;
}) {
  const base = useContestoProposte(dati, data, data);
  const contesto = useMemo(() => ({ ...base, conOspiti }), [base, conOspiti]);
  // Con la casa vuota si parte dal ricettario; altrimenti da ciò che c'è.
  const casaVuota = base.inCasa.length === 0;
  const [modo, setModo] = useState<ModoSuggerimento>(casaVuota ? 'ricettario' : 'casa');
  // Antonino propone anche le ricette ⛔ che vanno bene togliendo un ingrediente, dopo le altre.
  const filtro = useMemo(() => ({ ...filtroScelto, modo: casaVuota ? 'ricettario' : modo, conRimedi: true }), [filtroScelto, modo, casaVuota]);
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
  const impara = useImpara();
  // Antonino impara: l'idea scelta è «scelta», quelle saltate con «Un'altra» prima di sceglierla sono «scartate».
  function prendi(id: string, rimedio?: Rimedio) {
    for (const x of idee.slice(Math.max(0, quale - 3), quale)) impara('scartata', x.ricetta.id);
    impara('scelta', id);
    scegli(id, rimedio);
  }
  return (
    <section className="idea-pasto" aria-label="Antonino consiglia">
      <div className="riga" style={{ gap: 8 }}>
        <FacciaAntonino piccola />
        <span className="titoletto cresce">
          Antonino consiglia
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
          <button type="button" className="voce idea" onClick={() => prendi(idea.ricetta.id, idea.rimedio)} aria-label={`Metti nel menu ${idea.ricetta.titolo}`}>
            <span className="icona-voce grande" aria-hidden>
              <IconaCibo valore={iconaRicetta(indice, idea.ricetta, icone?.get(idea.ricetta.id))} />
            </span>
            <span className="cresce">
              <strong>{idea.ricetta.titolo}</strong>
              <span className="tenue" style={{ display: 'block' }}>
                {[CATEGORIE.find((c) => c.id === idea.ricetta.categoria)?.nome, minuti(idea.ricetta), ...idea.motivi.filter((m) => !m.startsWith('✂️'))]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {idea.rimedio && <EtichettaRimedio indice={indice} rimedio={idea.rimedio} />}
              <ConsigliDelDietista indice={indice} ricetta={idea.ricetta} bambini={conBambini(dati.persone)} />
            </span>
            <span className="tenue" aria-hidden>
              ＋
            </span>
          </button>
          <div className="riga" style={{ gap: 8 }}>
            <button type="button" className="bottone piccolo cresce" onClick={() => setQuale(quale + 1)} disabled={quale + 1 >= idee.length}>
              {quale + 1 >= idee.length ? 'Nessun’altra idea con questi filtri' : '🔄 Un’altra'}
            </button>
            <button type="button" className="bottone piccolo" aria-label={`Non proporre più ${idea.ricetta.titolo}`} title="Non proporla più" onClick={() => impara('mai_piu', idea.ricetta.id)}>
              🚫 Mai più
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function minuti(r: Ricetta) {
  const m = r.minuti_totali ?? ((r.minuti_preparazione ?? 0) + (r.minuti_cottura ?? 0) || null);
  return m ? `${m} min` : null;
}

/** A tavola ci sono bambini: chi ha una porzione da bambino (meno di quella di un adulto). */
export function conBambini(persone: Persona[]): boolean {
  return persone.some((p) => p.porzione < 1);
}

/** Sotto un piatto: come completare il pasto e, con i bambini, come adattarlo. */
export function ConsigliDelDietista({ indice, ricetta, bambini }: { indice: Indice; ricetta: Ricetta; bambini: boolean }) {
  const nota = notaComposizione(composizione(indice, ricetta), ricetta.categoria);
  const adatta = bambini ? adattamentiBambini(indice, ricetta) : [];
  if (!nota && !adatta.length) return null;
  return (
    <span className="consigli-dietista">
      {nota && <span className="nota-pasto">🍽️ {nota}</span>}
      {adatta.map((a) => (
        <span key={a.testo} className={`per-bambini${a.rischio ? ' rischio' : ''}`}>
          🧒 {a.testo}
        </span>
      ))}
    </span>
  );
}

/** Il voto della settimana (stima) con le voci e ciò che lo abbassa. */
function VotoAntonino({ voto }: { voto: VotoSettimana }) {
  const [aperto, setAperto] = useState(false);
  return (
    <section className="voto-antonino" aria-label="Voto della settimana">
      <button type="button" className="voce" aria-expanded={aperto} onClick={() => setAperto(!aperto)}>
        <span className="numero-voto">{voto.totale}</span>
        <span className="cresce">
          <strong>Voto della settimana</strong>
          <span className="tenue piccolo" style={{ display: 'block' }}>
            stima su 100 · {voto.criticita.length ? `${voto.criticita.length} ${voto.criticita.length === 1 ? 'cosa' : 'cose'} da migliorare` : 'niente da segnalare'}
          </span>
        </span>
        <span aria-hidden>{aperto ? '▴' : '▾'}</span>
      </button>
      {aperto && (
        <>
          <ul className="voci-voto">
            {voto.voci.map((v) => (
              <li key={v.nome}>
                <span className="cresce">{v.nome}</span>
                <strong>
                  {v.punti} / {v.max}
                </strong>
              </li>
            ))}
          </ul>
          {voto.criticita.length > 0 && (
            <ul className="criticita" aria-label="Da migliorare">
              {voto.criticita.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <p className="tenue piccolo" style={{ margin: '6px 0 0' }}>
            Antonino guarda i gruppi di alimenti, non calorie e nutrienti: è un confronto tra settimane, non un parere medico.
          </p>
        </>
      )}
    </section>
  );
}
