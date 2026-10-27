import { useMemo, useState } from 'react';
import { useFamiglia, useVista, type Vista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type Esito, NOME_ESITO, type Verifica, type Vincolo } from '../dominio/compatibilita';
import {
  type CategoriaPasto,
  categorieDellaFamiglia,
  dataLunga,
  type Eccezione,
  giorniDellaSettimana,
  type Gusto,
  gustiPerPiatto,
  lunedi,
  nomeGiorno,
  nomeSettimana,
  type Persona,
  type PortataMenu,
  porzioniAutomatiche,
  ripetiSettimana,
  valutaPortata,
} from '../dominio/menu';
import { filtra, type Indice } from '../dominio/ricette';
import { oggi, piuGiorni } from '../dominio/scadenze';
import { Foglio } from '../ui/Foglio';
import { ICONA_ESITO } from './Ricette';

type Modo = 'giorni' | 'griglia' | 'panoramica';
const MODI: { id: Modo; nome: string }[] = [
  { id: 'giorni', nome: 'Giorni' },
  { id: 'griglia', nome: 'Griglia' },
  { id: 'panoramica', nome: 'Panoramica' },
];
const CHIAVE_MODO = 'mc-menu-modo';

/** La scelta della vista è di questo dispositivo: sul telefono di base i giorni, sul tablet la griglia. */
function modoIniziale(): Modo {
  try {
    const v = localStorage.getItem(CHIAVE_MODO);
    if (v === 'giorni' || v === 'griglia' || v === 'panoramica') return v;
  } catch {
    // Archivio del browser non disponibile.
  }
  return window.innerWidth >= 700 ? 'griglia' : 'giorni';
}

export interface DatiMenu {
  persone: Persona[];
  vincoli: Vincolo[];
  verifiche: Verifica[];
  gusti: Gusto[];
  categorie: CategoriaPasto[];
  portate: PortataMenu[];
  eccezioni: Eccezione[];
}

const numero = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function useDatiMenu(vista: Vista): DatiMenu {
  const r = vista.righe;
  return useMemo(() => {
    const attive = (t: keyof typeof r) => (r[t] ?? []).filter((x) => !x.eliminato_il);
    return {
      persone: attive('membro')
        .filter((m) => !m.archiviato)
        .map((m) => ({ id: m.id, nome: String(m.nome), porzione: Number(m.porzione ?? 1) })),
      vincoli: attive('vincolo_alimentare') as unknown as Vincolo[],
      verifiche: attive('ricetta_verificata').map((v) => ({ membro_id: String(v.membro_id), ricetta_id: String(v.ricetta_id), versione_ricetta: Number(v.versione_ricetta) })),
      gusti: attive('gusto') as unknown as Gusto[],
      categorie: categorieDellaFamiglia(attive('categoria_pasto')),
      portate: attive('portata')
        .map((p) => ({
          ...(p as unknown as PortataMenu),
          porzioni: numero(p.porzioni),
          ordine: Number(p.ordine ?? 0),
          bloccata: !!p.bloccata,
          ricetta_id: (p.ricetta_id as string | null) ?? null,
          testo: (p.testo as string | null) ?? null,
        }))
        .sort((a, b) => a.ordine - b.ordine || String(a.id).localeCompare(String(b.id))),
      eccezioni: attive('eccezione_membro').map((e) => ({ ...(e as unknown as Eccezione), porzioni: numero(e.porzioni) })),
    };
  }, [r]);
}

/** Come si presenta un piatto: nome, esito per chi lo mangia, gusti contrari, porzioni. */
function descrivi(indice: Indice, dati: DatiMenu, p: PortataMenu) {
  const ricetta = p.ricetta_id ? (indice.perId.get(p.ricetta_id) ?? null) : null;
  const eccezioni = dati.eccezioni.filter((e) => e.portata_id === p.id);
  const valutazione = dati.vincoli.length ? valutaPortata(indice, ricetta, dati.persone, dati.vincoli, eccezioni, dati.verifiche) : null;
  const mangiano = dati.persone.filter((x) => !eccezioni.some((e) => e.membro_id === x.id));
  const gusti = ricetta ? gustiPerPiatto(indice, ricetta, mangiano, dati.gusti) : [];
  return {
    ricetta,
    titolo: ricetta?.titolo ?? p.testo ?? 'Piatto',
    eccezioni,
    valutazione,
    gusti,
    nonPiace: gusti.filter((g) => g.valore === 'non_piace'),
    porzioni: p.porzioni ?? porzioniAutomatiche(dati.persone, eccezioni),
  };
}

export function Menu() {
  const vista = useVista();
  const indice = useIndice(vista);
  const dati = useDatiMenu(vista);
  const { esegui } = useFamiglia();
  const giorno = oggi();
  const [lun, setLun] = useState(() => lunedi(giorno));
  const [modo, setModo] = useState<Modo>(modoIniziale);
  const [nuova, setNuova] = useState<{ data: string; categoria: string } | null>(null);
  const [aperta, setAperta] = useState<string | null>(null);
  const [pasti, setPasti] = useState(false);

  if (!vista.pronta || !indice) return <p className="tenue">Sto caricando il menu…</p>;
  const giorni = giorniDellaSettimana(lun);
  const fine = giorni[6];
  const settimana = dati.portate.filter((p) => p.data >= lun && p.data <= fine);
  const precedente = dati.portate.filter((p) => p.data >= piuGiorni(lun, -7) && p.data < lun);
  // Si vedono i pasti attivi, più quelli spenti che in questa settimana hanno già qualcosa.
  const categorie = dati.categorie.filter((c) => c.attiva || settimana.some((p) => p.categoria === c.valore));
  const piatti = (data: string, categoria: string) => settimana.filter((p) => p.data === data && p.categoria === categoria);
  const portataAperta = aperta ? dati.portate.find((p) => p.id === aperta) : undefined;

  function cambiaModo(m: Modo) {
    setModo(m);
    try {
      localStorage.setItem(CHIAVE_MODO, m);
    } catch {
      // Si ricorderà solo finché la pagina resta aperta.
    }
  }

  async function ripeti() {
    if (settimana.length && !window.confirm(`Aggiungere i ${precedente.length} piatti della settimana prima a quelli già in menu?`)) return;
    const dati2 = ripetiSettimana(precedente, dati.eccezioni, piuGiorni(lun, -7), lun, () => crypto.randomUUID());
    await esegui('ripeti_portate', dati2);
  }

  const cella = (data: string, c: CategoriaPasto) => (
    <>
      {piatti(data, c.valore).map((p) => (
        <Piatto key={p.id} indice={indice} dati={dati} portata={p} apri={() => setAperta(p.id)} />
      ))}
      <button className="aggiungi-piatto" aria-label={`Aggiungi a ${c.nome.toLowerCase()} di ${dataLunga(data)}`} onClick={() => setNuova({ data, categoria: c.valore })}>
        +
      </button>
    </>
  );

  return (
    <>
      <div className="riga spazio" style={{ marginBottom: 8 }}>
        <button className="bottone piccolo" aria-label="Settimana prima" onClick={() => setLun(piuGiorni(lun, -7))}>
          ‹
        </button>
        <h2 style={{ margin: 0, textAlign: 'center' }} className="cresce" aria-live="polite">
          {nomeSettimana(lun)}
        </h2>
        <button className="bottone piccolo" aria-label="Settimana dopo" onClick={() => setLun(piuGiorni(lun, 7))}>
          ›
        </button>
      </div>
      <div className="riga" style={{ flexWrap: 'wrap', marginBottom: 12, justifyContent: 'center' }}>
        {lun !== lunedi(giorno) && (
          <button className="bottone piccolo" onClick={() => setLun(lunedi(giorno))}>
            Questa settimana
          </button>
        )}
        <button className="bottone piccolo" onClick={ripeti} disabled={!precedente.length} title={precedente.length ? undefined : 'La settimana prima è vuota'}>
          ↻ Ripeti la settimana prima
        </button>
        <button className="bottone piccolo" onClick={() => setPasti(true)}>
          Pasti
        </button>
      </div>
      <div className="scelte" role="group" aria-label="Vista" style={{ justifyContent: 'center' }}>
        {MODI.map((m) => (
          <button key={m.id} aria-pressed={modo === m.id} onClick={() => cambiaModo(m.id)}>
            {m.nome}
          </button>
        ))}
      </div>
      {dati.vincoli.length > 0 && <p className="tenue">✅ adatto · ❔ da verificare · ⛔ non adatto a chi lo mangia · 🙅 a qualcuno non piace</p>}

      {modo === 'griglia' && (
        <div className="griglia-menu" role="region" aria-label="Griglia della settimana" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th />
                {giorni.map((g) => (
                  <th key={g} scope="col" className={g === giorno ? 'oggi' : undefined}>
                    {nomeGiorno(g, true)} {Number(g.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categorie.map((c) => (
                <tr key={c.valore}>
                  <th scope="row">
                    <span aria-hidden>{c.emoji}</span> {c.nome}
                  </th>
                  {giorni.map((g) => (
                    <td key={g} className={g === giorno ? 'oggi' : undefined}>
                      {cella(g, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modo === 'giorni' &&
        giorni.map((g) => (
          <section key={g} className={`scheda giorno${g === giorno ? ' oggi' : ''}`} aria-label={dataLunga(g)}>
            <h3 style={{ marginTop: 0, textTransform: 'capitalize' }}>
              {dataLunga(g)}
              {g === giorno && <span className="etichetta" style={{ marginLeft: 8 }}>oggi</span>}
            </h3>
            {categorie.map((c) => (
              <div key={c.valore} className="pasto">
                <span className="tenue nome-pasto">
                  <span aria-hidden>{c.emoji}</span> {c.nome}
                </span>
                <div className="piatti">{cella(g, c)}</div>
              </div>
            ))}
          </section>
        ))}

      {modo === 'panoramica' && <Panoramica indice={indice} dati={dati} giorni={giorni} categorie={categorie} settimana={settimana} apri={setAperta} oggiData={giorno} />}

      {nuova && <NuovoPiatto indice={indice} dati={dati} {...nuova} chiudi={() => setNuova(null)} />}
      {portataAperta && <SchedaPiatto indice={indice} dati={dati} portata={portataAperta} chiudi={() => setAperta(null)} />}
      {pasti && <Pasti categorie={dati.categorie} chiudi={() => setPasti(false)} />}
    </>
  );
}

function Piatto({ indice, dati, portata: p, apri }: { indice: Indice; dati: DatiMenu; portata: PortataMenu; apri: () => void }) {
  const d = descrivi(indice, dati, p);
  const esito = d.valutazione?.esito;
  const confermato = useVista().righe.conferma_pasto?.some((c) => c.portata_id === p.id && c.attiva && !c.eliminato_il);
  return (
    <button className={`piatto${esito ? ` ${esito}` : ''}`} onClick={apri} aria-label={`Apri ${d.titolo}`}>
      <span className="cresce">
        {esito && <span aria-label={NOME_ESITO[esito]}>{ICONA_ESITO[esito]} </span>}
        {d.titolo}
        {d.nonPiace.length > 0 && <span title={d.nonPiace.map((g) => `a ${g.nome} non piace ${g.cosa.toLowerCase()}`).join('; ')}> 🙅</span>}
        {p.bloccata && <span aria-label="bloccato"> 🔒</span>}
        {confermato && <span aria-label="pasto confermato"> ✔️</span>}
      </span>
      <span className="tenue piccolo">
        {formattaPorzioni(d.porzioni)}
        {d.eccezioni.length > 0 && ` · ${d.eccezioni.length} a parte`}
        {p.in_attesa && ' · in invio'}
      </span>
    </button>
  );
}

function formattaPorzioni(n: number) {
  return n === 1 ? '1 porzione' : `${n.toLocaleString('it-IT')} porzioni`;
}

function Panoramica({
  indice,
  dati,
  giorni,
  categorie,
  settimana,
  apri,
  oggiData,
}: {
  indice: Indice;
  dati: DatiMenu;
  giorni: string[];
  categorie: CategoriaPasto[];
  settimana: PortataMenu[];
  apri: (id: string) => void;
  oggiData: string;
}) {
  const esiti = settimana.map((p) => descrivi(indice, dati, p));
  const problemi = esiti.filter((d) => d.valutazione && d.valutazione.esito !== 'adatta').length;
  const vuoti = giorni.reduce((n, g) => n + categorie.filter((c) => !settimana.some((p) => p.data === g && p.categoria === c.valore)).length, 0);
  return (
    <>
      <div className="scheda">
        <p style={{ margin: 0 }}>
          {settimana.length === 1 ? '1 piatto' : `${settimana.length} piatti`} in menu · {vuoti === 1 ? '1 pasto vuoto' : `${vuoti} pasti vuoti`}
          {problemi > 0 && ` · ${problemi} da controllare`}
        </p>
      </div>
      <div className="scheda">
        <ul className="elenco">
          {giorni.map((g) => {
            const delGiorno = categorie.flatMap((c) => settimana.filter((p) => p.data === g && p.categoria === c.valore).map((p) => ({ c, p })));
            return (
              <li key={g} className={g === oggiData ? 'oggi' : undefined}>
                <strong style={{ textTransform: 'capitalize' }}>{dataLunga(g)}</strong>
                {delGiorno.length === 0 ? (
                  <p className="tenue" style={{ margin: '4px 0 0' }}>
                    Niente in menu.
                  </p>
                ) : (
                  <div className="riga" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {delGiorno.map(({ c, p }) => {
                      const d = descrivi(indice, dati, p);
                      return (
                        <button key={p.id} className="etichetta" onClick={() => apri(p.id)} aria-label={`Apri ${d.titolo}`}>
                          <span aria-hidden>{c.emoji}</span> {d.valutazione && d.valutazione.esito !== 'adatta' ? `${ICONA_ESITO[d.valutazione.esito]} ` : ''}
                          {d.titolo}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

type Scelta = { ricetta_id: string; testo: null } | { ricetta_id: null; testo: string };

/** Cerca una ricetta (con l'esito per la famiglia) oppure scrivi il piatto a mano. */
function CercaPiatto({ indice, dati, scegli, etichetta, persone }: { indice: Indice; dati: DatiMenu; scegli: (s: Scelta) => void; etichetta: string; persone?: Persona[] }) {
  const [testo, setTesto] = useState('');
  const chi = persone ?? dati.persone;
  const trovate = testo.trim() ? filtra(indice, { testo, categoria: null, cucina: null, minuti: null, inCasa: null, origine: 'tutte', archiviate: false }).slice(0, 8) : [];
  return (
    <div className="campo">
      <label>
        <span>{etichetta}</span>
        <input type="search" value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Carbonara, minestrone, pizza…" autoFocus />
      </label>
      {testo.trim() && (
        <ul className="elenco risultati" aria-label="Risultati">
          {trovate.map((r) => {
            const v = dati.vincoli.length ? valutaPortata(indice, r, chi, dati.vincoli, [], dati.verifiche) : null;
            const no = gustiPerPiatto(indice, r, chi, dati.gusti).filter((g) => g.valore === 'non_piace');
            return (
              <li key={r.id}>
                <button type="button" className="voce" onClick={() => scegli({ ricetta_id: r.id, testo: null })}>
                  <span className="cresce">
                    {r.titolo}
                    {(v || no.length > 0) && (
                      <span className="tenue" style={{ display: 'block' }}>
                        {[v && NOME_ESITO[v.esito], no.length > 0 && `non piace a ${no.map((g) => g.nome).join(', ')}`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {v && <span aria-hidden>{ICONA_ESITO[v.esito]}</span>}
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" className="voce" onClick={() => scegli({ ricetta_id: null, testo: testo.trim() })}>
              ✏️ Scrivi «{testo.trim()}» senza ricetta
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function nomeCategoria(dati: DatiMenu, valore: string) {
  return dati.categorie.find((c) => c.valore === valore)?.nome ?? 'Pasto';
}

function NuovoPiatto({ indice, dati, data, categoria, chiudi }: { indice: Indice; dati: DatiMenu; data: string; categoria: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const quanti = dati.portate.filter((p) => p.data === data && p.categoria === categoria).length;
  return (
    <Foglio titolo={`${nomeCategoria(dati, categoria)} di ${dataLunga(data)}`} chiudi={chiudi}>
      <CercaPiatto
        indice={indice}
        dati={dati}
        etichetta="Cosa si mangia"
        scegli={async (s) => {
          await esegui('aggiungi_portata', { id: crypto.randomUUID(), data, categoria, ...s, ordine: quanti });
          chiudi();
        }}
      />
      <p className="tenue">Le porzioni si calcolano da sole su chi mangia a casa. Aggiungere un piatto al menu non toglie nulla dalla casa.</p>
    </Foglio>
  );
}

function SchedaPiatto({ indice, dati, portata: p, chiudi }: { indice: Indice; dati: DatiMenu; portata: PortataMenu; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const d = descrivi(indice, dati, p);
  const [cambia, setCambia] = useState(false);
  const [data, setData] = useState(p.data);
  const [categoria, setCategoria] = useState(p.categoria);
  const [note, setNote] = useState(p.note ?? '');
  const modifica = (campi: Record<string, unknown>) => esegui('modifica_portata', { id: p.id, versione_attesa: p.versione ?? 1, campi });
  const automatiche = porzioniAutomatiche(dati.persone, d.eccezioni);

  return (
    <Foglio titolo={d.titolo} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0, textTransform: 'capitalize' }}>
        {nomeCategoria(dati, p.categoria)} · {dataLunga(p.data)}
        {p.origine === 'ripetuta' && ' · ripetuto dalla settimana prima'}
        {!d.ricetta && ' · senza ricetta'}
      </p>

      {d.valutazione && <EsitoPiatto esito={d.valutazione.esito} righe={d.valutazione.perMembro.filter((m) => m.valutazione).map((m) => `${m.nome}${m.mangia === 'alternativa' ? ' (piatto a parte)' : ''}: ${ICONA_ESITO[m.valutazione!.esito]} ${m.valutazione!.motivi.join('; ') || 'nessun problema noto'}`)} />}
      {d.gusti.length > 0 && (
        <ul className="tenue" style={{ paddingLeft: 18 }}>
          {d.gusti.map((g) => (
            <li key={`${g.membro_id}${g.cosa}`}>
              {g.valore === 'piace' ? '😋' : '🙅'} A {g.nome} {g.valore === 'piace' ? 'piace' : 'non piace'} {g.cosa.toLowerCase()}
            </li>
          ))}
        </ul>
      )}

      {cambia ? (
        <CercaPiatto
          indice={indice}
          dati={dati}
          etichetta="Nuovo piatto"
          scegli={async (s) => {
            await modifica(s);
            setCambia(false);
          }}
        />
      ) : (
        <button className="bottone piccolo" onClick={() => setCambia(true)}>
          Cambia piatto
        </button>
      )}

      <div className="campo" style={{ marginTop: 16 }}>
        <span>Porzioni</span>
        <div className="riga" role="group" aria-label="Porzioni">
          <div className="scelte" style={{ margin: 0 }}>
            <button aria-pressed={p.porzioni === null} onClick={() => modifica({ porzioni: null })}>
              Automatiche ({automatiche.toLocaleString('it-IT')})
            </button>
          </div>
          <button className="bottone piccolo" aria-label="Una porzione in meno" onClick={() => modifica({ porzioni: Math.max(0.5, d.porzioni - 1) })}>
            −
          </button>
          <span aria-live="polite">{d.porzioni.toLocaleString('it-IT')}</span>
          <button className="bottone piccolo" aria-label="Una porzione in più" onClick={() => modifica({ porzioni: Math.min(99, d.porzioni + 1) })}>
            +
          </button>
        </div>
      </div>

      <div className="campo">
        <span>Chi mangia</span>
        <ul className="elenco">
          {dati.persone.map((x) => (
            <ChiMangia key={x.id} indice={indice} dati={dati} portata={p} persona={x} eccezione={d.eccezioni.find((e) => e.membro_id === x.id)} />
          ))}
        </ul>
      </div>

      <form
        className="campo"
        onSubmit={(e) => {
          e.preventDefault();
          if (data && (data !== p.data || categoria !== p.categoria)) void modifica({ data, categoria });
        }}
      >
        <span>Sposta</span>
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          <input type="date" aria-label="Giorno" value={data} onChange={(e) => setData(e.target.value)} style={{ width: 'auto' }} />
          <select aria-label="Pasto" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ width: 'auto' }}>
            {dati.categorie
              .filter((c) => c.attiva || c.valore === p.categoria)
              .map((c) => (
                <option key={c.valore} value={c.valore}>
                  {c.nome}
                </option>
              ))}
          </select>
          {(data !== p.data || categoria !== p.categoria) && <button className="bottone primario piccolo">Sposta</button>}
        </div>
      </form>

      <form
        className="campo"
        onSubmit={(e) => {
          e.preventDefault();
          void modifica({ note: note.trim() || null });
        }}
      >
        <span>Note</span>
        <div className="riga">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="cresce" aria-label="Note" />
          {note.trim() !== (p.note ?? '') && <button className="bottone primario piccolo">Salva</button>}
        </div>
      </form>

      <label className="riga" style={{ margin: '12px 0', minHeight: 44 }}>
        <input type="checkbox" checked={p.bloccata} onChange={(e) => modifica({ bloccata: e.target.checked })} />
        <span>🔒 Blocca: le proposte automatiche non lo cambieranno</span>
      </label>

      <button
        className="bottone pericolo pieno"
        onClick={async () => {
          await esegui('rimuovi_portata', { id: p.id });
          chiudi();
        }}
      >
        Togli dal menu
      </button>
    </Foglio>
  );
}

function EsitoPiatto({ esito, righe }: { esito: Esito; righe: string[] }) {
  return (
    <div className={`avviso ${esito === 'adatta' ? 'info' : 'errore'}`} style={esito === 'da_verificare' ? { background: 'var(--attenzione-tenue)', color: 'var(--attenzione)' } : undefined}>
      <strong>
        {ICONA_ESITO[esito]} {esito === 'adatta' ? 'Adatto a chi lo mangia' : NOME_ESITO[esito]}
      </strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {righe.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function ChiMangia({ indice, dati, portata, persona, eccezione }: { indice: Indice; dati: DatiMenu; portata: PortataMenu; persona: Persona; eccezione?: Eccezione }) {
  const { esegui } = useFamiglia();
  const [scegli, setScegli] = useState(false);
  const stato = eccezione?.tipo ?? 'mangia';
  const imposta = (dati: Record<string, unknown>) =>
    esegui('imposta_eccezione', { id: crypto.randomUUID(), portata_id: portata.id, membro_id: persona.id, versione_attesa: eccezione?.versione, ...dati });
  const alternativa = eccezione?.tipo === 'alternativa' ? (eccezione.ricetta_id ? indice.perId.get(eccezione.ricetta_id)?.titolo : eccezione.testo) : null;

  return (
    <li>
      <div className="riga spazio" style={{ flexWrap: 'wrap' }}>
        <strong>{persona.nome}</strong>
        <div className="scelte" role="group" aria-label={`Cosa mangia ${persona.nome}`} style={{ margin: 0 }}>
          <button aria-pressed={stato === 'mangia'} onClick={() => eccezione && esegui('rimuovi_eccezione', { id: eccezione.id })}>
            Mangia
          </button>
          <button aria-pressed={stato === 'non_mangia'} onClick={() => stato !== 'non_mangia' && imposta({ tipo: 'non_mangia' })}>
            Non c’è
          </button>
          <button aria-pressed={stato === 'alternativa'} onClick={() => setScegli(true)}>
            Altro
          </button>
        </div>
      </div>
      {alternativa && !scegli && <p className="tenue" style={{ margin: '4px 0 0' }}>Mangia: {alternativa}</p>}
      {scegli && (
        <>
          <CercaPiatto
            indice={indice}
            dati={dati}
            persone={[persona]}
            etichetta={`Cosa mangia ${persona.nome}`}
            scegli={async (s) => {
              await imposta({ tipo: 'alternativa', ...s });
              setScegli(false);
            }}
          />
          <button className="bottone piccolo" onClick={() => setScegli(false)}>
            Annulla
          </button>
        </>
      )}
    </li>
  );
}

/** Quali pasti usa la famiglia: spuntino e merenda si accendono, altri si creano. */
function Pasti({ categorie, chiudi }: { categorie: CategoriaPasto[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [nome, setNome] = useState('');
  const [emoji, setEmoji] = useState('🍽️');

  function accendi(c: CategoriaPasto, attiva: boolean) {
    if (c.standard) void esegui('imposta_categoria', { chiave: c.valore, attiva });
    else void esegui('modifica_categoria', { id: c.id, versione_attesa: c.versione, campi: { attiva } });
  }

  return (
    <Foglio titolo="Pasti della famiglia" chiudi={chiudi}>
      <ul className="elenco">
        {categorie.map((c) => (
          <li key={c.valore}>
            <label className="riga" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={c.attiva} onChange={(e) => accendi(c, e.target.checked)} />
              <span aria-hidden>{c.emoji}</span>
              <span className="cresce">{c.nome}</span>
            </label>
          </li>
        ))}
      </ul>
      <form
        className="campo"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!nome.trim()) return;
          await esegui('crea_categoria', { id: crypto.randomUUID(), nome: nome.trim(), emoji: emoji || null, ordine: 10 + categorie.length });
          setNome('');
        }}
      >
        <span>Nuovo pasto</span>
        <div className="riga">
          <input aria-label="Emoji del pasto" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} style={{ width: 64 }} />
          <input aria-label="Nome del pasto" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} className="cresce" placeholder="Brunch, dopo-scuola…" required />
          <button className="bottone primario piccolo">Aggiungi</button>
        </div>
      </form>
      <p className="tenue">Un pasto spento sparisce dal calendario, ma i piatti già messi restano visibili.</p>
    </Foglio>
  );
}

/** I piatti di oggi, per la schermata Oggi. */
export function useOggiSiMangia(): { indice: Indice | null; dati: DatiMenu; piatti: { categoria: CategoriaPasto; portata: PortataMenu; titolo: string }[] } {
  const vista = useVista();
  const indice = useIndice(vista);
  const dati = useDatiMenu(vista);
  const giorno = oggi();
  const piatti = indice
    ? dati.categorie.flatMap((c) =>
        dati.portate
          .filter((p) => p.data === giorno && p.categoria === c.valore)
          .map((p) => ({ categoria: c, portata: p, titolo: descrivi(indice, dati, p).titolo })),
      )
    : [];
  return { indice, dati, piatti };
}
