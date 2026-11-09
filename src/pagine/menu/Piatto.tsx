import { useMemo, useState } from 'react';
import { useFamiglia, useVista } from '../../dati/contesto';
import { NOME_ESITO } from '../../dominio/compatibilita';
import { alPasto, dataLunga, gustiPerPiatto, ID_OSPITI, ospitiDel, type Persona, type PortataMenu, valutaPortata } from '../../dominio/menu';
import { avanziDi, porzioniPortata } from '../../dominio/consumi';
import { CATEGORIE, type Categoria } from '../../catalogo/tipi';
import { haPrincipale, type Principale, usaIngrediente } from '../../dominio/principale';
import { BottoniSegno, CercaRicetta, type Segno } from '../../ui/FiltriRicetta';
import { RICETTE_PER_PASTO } from '../../dominio/proposte';
import { filtra, iconaRicetta, type Indice, type Ricetta } from '../../dominio/ricette';
import { IdeePerPasto } from '../Proposte';
import { useConferme } from '../ConfermaPasto';
import { SegnaCucinato, usePronti } from '../Cucinato';
import { type Luogo, piuGiorni } from '../../dominio/scadenze';
import { Icona, IconaLuogo } from '../../ui/Icona';
import { avanziInCasa } from '../../dominio/avanzi';
import { Foglio } from '../../ui/Foglio';
import { formattaGiorno } from '../../dominio/unita';
import { AvvisoAdatto, ICONA_ESITO, MarchiSegni, motiviInBreve, RicettaDelPiatto, useIcone, useSegni } from '../Ricette';
import { IconaCibo } from '../../ui/IconaCibo';
import { type Rimedio, rimedio, type Senza } from '../../dominio/senza';
import { AvvisoNonSiToglie, EtichettaRimedio, FoglioSenza } from '../Senza';
import { type DatiMenu, datiAlPasto, descrivi } from './dati';
import { formattaPorzioni } from './Griglie';
import { BottoneOspiti } from './Ospiti';

export type Scelta = { ricetta_id: string; testo: null } | { ricetta_id: null; testo: string };

/** Filtri della scelta del piatto, gli stessi per l'idea e per la ricerca. */
export interface FiltroPiatto {
  categoria: Categoria | null;
  principale: Principale | null;
  /** Un ingrediente preciso (id), cercato per nome. */
  ingrediente: string | null;
  /** Solo le ⭐ preferite o le 💫 da ospiti. */
  segno: Segno | null;
}
export const SENZA_FILTRI: FiltroPiatto = { categoria: null, principale: null, ingrediente: null, segno: null };
export const PER_PAGINA = 12;

/** Cerca una ricetta per nome oppure scrivi il piatto a mano (per cambiare un piatto già nel menu). */
export function CercaPiatto({ indice, dati, scegli, etichetta, persone }: { indice: Indice; dati: DatiMenu; scegli: (s: Scelta) => void; etichetta: string; persone?: Persona[] }) {
  const [testo, setTesto] = useState('');
  return (
    <div className="campo cerca-piatto">
      <label>
        <span>{etichetta}</span>
        <input type="search" value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Carbonara, minestrone, pizza…" autoFocus />
      </label>
      <RisultatiPiatto indice={indice} dati={dati} scegli={scegli} persone={persone} testo={testo} />
    </div>
  );
}

/** Le ricette trovate per nome e filtri, con l'esito per chi mangia. Con un filtro attivo l'elenco c'è anche senza scrivere. */
export function RisultatiPiatto({
  indice,
  dati,
  scegli,
  persone,
  testo,
  filtro = SENZA_FILTRI,
  icone,
  vuoto,
  rimedi,
}: {
  indice: Indice;
  dati: DatiMenu;
  scegli: (s: Scelta) => void;
  persone?: Persona[];
  testo: string;
  filtro?: FiltroPiatto;
  icone?: Map<string, string>;
  /** Cosa dire quando non c'è ancora niente da cercare. */
  vuoto?: string;
  /**
   * Aggiungendo un piatto: una ricetta ⛔ che va bene togliendo un ingrediente apre «per chi toglierlo»;
   * se togliere non basta, lo dice e propone di far mangiare altro a chi non può.
   */
  rimedi?: { senza: (r: Ricetta, x: Rimedio) => void; mangiaAltro: (ricetta_id: string, chi: string[]) => void };
}) {
  const [quante, setQuante] = useState(PER_PAGINA);
  const [aperta, setAperta] = useState<string | null>(null);
  const chi = persone ?? dati.persone;
  const segni = useSegni();
  const filtrato = !!(filtro.categoria || filtro.principale || filtro.ingrediente || filtro.segno);
  const cerca = !!testo.trim() || filtrato;
  const chiave = `${testo}|${filtro.categoria}|${filtro.principale}|${filtro.ingrediente}|${filtro.segno}`;
  const [ultima, setUltima] = useState(chiave);
  if (ultima !== chiave) {
    setUltima(chiave);
    setQuante(PER_PAGINA);
  }
  const tutte = useMemo(
    () =>
      cerca
        ? filtra(indice, {
            testo,
            categoria: filtro.categoria,
            cucina: null,
            minuti: null,
            inCasa: null,
            origine: 'tutte',
            archiviate: false,
          })
            .filter((r) => r.categoria !== 'base' || filtro.categoria === 'base')
            .filter((r) => haPrincipale(indice, r, filtro.principale) && usaIngrediente(indice, r, filtro.ingrediente))
            .filter((r) => (filtro.segno === 'preferita' ? segni.preferite.has(r.id) : filtro.segno === 'ospiti' ? segni.perOspiti.has(r.id) : true))
        : [],
    [indice, testo, cerca, filtro, segni],
  );
  if (!cerca) return vuoto ? <p className="tenue piccolo risultati-piatto">{vuoto}</p> : null;
  const trovate = tutte.slice(0, quante);
  return (
    <div className="risultati-piatto">
      {filtrato && <p className="tenue piccolo conteggio">{tutte.length === 1 ? '1 ricetta' : `${tutte.length} ricette`} con questi filtri</p>}
      <ul className="elenco risultati compatti" aria-label="Risultati">
        {trovate.map((r) => {
          const v = dati.vincoli.length ? valutaPortata(indice, r, chi, dati.vincoli, [], dati.verifiche) : null;
          const no = gustiPerPiatto(indice, r, chi, dati.gusti).filter((g) => g.valore === 'non_piace');
          const x = rimedi && v?.esito === 'non_adatta' ? rimedio(indice, r, chi, dati.vincoli, dati.verifiche) : null;
          const tocca = () => {
            if (x?.possibile) rimedi!.senza(r, x);
            else if (x) setAperta(aperta === r.id ? null : r.id);
            else scegli({ ricetta_id: r.id, testo: null });
          };
          return (
            <li key={r.id}>
              <button type="button" className="voce" onClick={tocca} aria-expanded={x && !x.possibile ? aperta === r.id : undefined}>
                <span className="icona-voce" aria-hidden>
                  <IconaCibo valore={iconaRicetta(indice, r, icone?.get(r.id))} />
                </span>
                <span className="cresce">
                  {r.titolo}
                  <MarchiSegni id={r.id} segni={segni} />
                  {(v || no.length > 0) && (
                    <span className="tenue" style={{ display: 'block' }}>
                      {[v && NOME_ESITO[v.esito], no.length > 0 && `non piace a ${no.map((g) => g.nome).join(', ')}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {x?.possibile && <EtichettaRimedio indice={indice} rimedio={x} />}
                </span>
                {v && <span aria-hidden>{ICONA_ESITO[v.esito]}</span>}
              </button>
              {x && !x.possibile && aperta === r.id && (
                <AvvisoNonSiToglie
                  rimedio={x}
                  famiglia={new Set(dati.persone.filter((m) => m.id !== ID_OSPITI).map((m) => m.id))}
                  mangiaAltro={(loro) => rimedi!.mangiaAltro(r.id, loro)}
                  aggiungiLoStesso={() => scegli({ ricetta_id: r.id, testo: null })}
                />
              )}
            </li>
          );
        })}
        {tutte.length > quante && (
          <li>
            <button type="button" className="voce" onClick={() => setQuante(quante + PER_PAGINA)}>
              Mostra altre ({tutte.length - quante})
            </button>
          </li>
        )}
        {testo.trim() && (
          <li>
            <button type="button" className="voce" onClick={() => scegli({ ricetta_id: null, testo: testo.trim() })}>
              ✏️ Scrivi «{testo.trim()}» senza ricetta
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Le categorie di piatto: una riga di bottoni piccoli, prima quelle adatte al pasto. */
/** Prima ⭐ preferite e 💫 per ospiti, poi le categorie (quelle adatte al pasto per prime), sulla stessa riga. */
export function FiltroCategoria({ pasto, filtro, cambia }: { pasto: string; filtro: FiltroPiatto; cambia: (f: FiltroPiatto) => void }) {
  const adatte = RICETTE_PER_PASTO[pasto] ?? [];
  const categorie = [...CATEGORIE.filter((c) => adatte.includes(c.id)), ...CATEGORIE.filter((c) => !adatte.includes(c.id))];
  return (
    <div className="scelte compatte">
      <BottoniSegno segno={filtro.segno} cambia={(segno) => cambia({ ...filtro, segno })} />
      <span className="separatore" aria-hidden />
      <div className="gruppo-in-riga" role="group" aria-label="Categoria">
        {categorie.map((c) => (
          <button key={c.id} type="button" aria-pressed={filtro.categoria === c.id} onClick={() => cambia({ ...filtro, categoria: filtro.categoria === c.id ? null : c.id })}>
            {c.emoji} {c.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

export function nomeCategoria(dati: DatiMenu, valore: string) {
  return dati.categorie.find((c) => c.valore === valore)?.nome ?? 'Pasto';
}

/**
 * Gli avanzi che sono in casa (in frigo, in freezer o in dispensa), da mettere nel pasto: quelli segnati con
 * «✓ Mangiato» e i piatti cucinati in anticipo, di un giorno prima o di un pasto prima nello stesso giorno.
 * Toccandone uno il pasto prende l'avanzo, non una ricetta da cucinare. Un avanzo senza il piatto d'origine
 * nel menu (piatto scritto a mano, tolto dal menu, portato dalla vecchia app) entra come piatto col suo nome.
 * Senza avanzi resta una riga che dice dove compariranno.
 */
export function AvanziInCasa({
  indice,
  dati,
  data,
  categoria,
  icone,
  scegli,
  scegliTesto,
}: {
  indice: Indice;
  dati: DatiMenu;
  data: string;
  categoria: string;
  icone: Map<string, string>;
  scegli: (avanzo_di: string) => void;
  scegliTesto: (testo: string) => void;
}) {
  const vista = useVista();
  const { conferme } = useConferme(vista);
  const lotti = vista.righe.lotto;
  const avanzi = useMemo(() => avanziInCasa(indice, dati, conferme, lotti ?? [], data, categoria), [lotti, conferme, dati, indice, data, categoria]);
  if (!avanzi.length)
    return (
      <p className="avanzi-vuoto tenue piccolo">
        <IconaLuogo luogo="frigo" /> Nessun avanzo in casa. Quando segni «✓ Mangiato» e metti via le porzioni avanzate, le trovi qui.
      </p>
    );
  return (
    <div className="avanzi-in-casa" role="group" aria-label="Avanzi in casa">
      <span className="titoletto-avanzi">
        <IconaLuogo luogo="frigo" /> Avanzi in casa: toccane uno per mangiarlo qui
      </span>
      <div className="avanzi-scelte">
        {avanzi.map((a) => (
          <button
            key={a.chiave}
            type="button"
            className="voce-avanzo"
            aria-label={`Mangia l’avanzo: ${a.titolo}`}
            onClick={() => (a.origine ? scegli(a.origine.id) : scegliTesto(a.titolo))}
          >
            <span className="tondo-piatto" aria-hidden>
              {a.ricetta ? <IconaCibo valore={iconaRicetta(indice, a.ricetta, icone.get(a.ricetta.id))} /> : <IconaLuogo luogo={a.luogo} grandezza={20} />}
            </span>
            <span className="cresce">
              <strong>{a.titolo}</strong>
              <span className="tenue piccolo">
                <IconaLuogo luogo={a.luogo} /> {a.porzioni.toLocaleString('it-IT')} {a.porzioni === 1 ? 'porzione' : 'porzioni'} in {a.luogo}
                {a.entro ? ` · entro ${formattaGiorno(a.entro)}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NuovoPiatto({
  indice,
  dati: tutti,
  data,
  categoria,
  per,
  chiudi,
  apriOspiti,
}: {
  indice: Indice;
  dati: DatiMenu;
  data: string;
  categoria: string;
  /** Per chi è il piatto (id dei membri); di base per tutti. */
  per?: string[];
  chiudi: () => void;
  apriOspiti: () => void;
}) {
  const { esegui } = useFamiglia();
  const dati = datiAlPasto(tutti, data, categoria);
  const quanti = dati.portate.filter((p) => p.data === data && p.categoria === categoria).length;
  const [chi, setChi] = useState<Set<string>>(() => new Set(per ?? tutti.persone.map((x) => x.id)));
  const [filtro, setFiltro] = useState<FiltroPiatto>(SENZA_FILTRI);
  const [testo, setTesto] = useState('');
  const icone = useIcone();
  // Le proposte e gli avvisi guardano solo chi lo mangia (e gli ospiti del pasto, se ci sono).
  const perLoro = {
    ...dati,
    persone: dati.persone.filter((x) => chi.has(x.id) || !tutti.persone.some((m) => m.id === x.id)),
  };

  /** Una ricetta ⛔ che va bene togliendo un ingrediente: si sceglie per chi toglierlo prima di aggiungerla. */
  const [daTogliere, setDaTogliere] = useState<{ ricetta: Ricetta; rimedio: Rimedio; origine: 'manuale' | 'automatica' } | null>(null);
  const famiglia = new Set(tutti.persone.map((x) => x.id));

  /** Il piatto nuovo e, per chi non è spuntato (o `fuori`), «non mangia questo piatto». */
  async function aggiungi(campi: Record<string, unknown>, fuori: string[] = []) {
    const id = crypto.randomUUID();
    await esegui('aggiungi_portata', { id, data, categoria, ...campi, ordine: quanti });
    for (const x of tutti.persone)
      if (!chi.has(x.id) || fuori.includes(x.id)) await esegui('imposta_eccezione', { id: crypto.randomUUID(), portata_id: id, membro_id: x.id, tipo: 'non_mangia' });
    chiudi();
  }

  /** Un avanzo in casa nel pasto: si mangia quello, non si cucina e non va nella spesa. */
  async function aggiungiAvanzo(avanzo_di: string) {
    const id = crypto.randomUUID();
    await esegui('aggiungi_avanzo', { id, avanzo_di, data, categoria, ordine: quanti });
    for (const x of tutti.persone) if (!chi.has(x.id)) await esegui('imposta_eccezione', { id: crypto.randomUUID(), portata_id: id, membro_id: x.id, tipo: 'non_mangia' });
    chiudi();
  }

  if (daTogliere)
    return (
      <FoglioSenza
        indice={indice}
        ricetta={daTogliere.ricetta}
        rimedio={daTogliere.rimedio}
        persone={perLoro.persone}
        famiglia={famiglia}
        porzioni={perLoro.persone.reduce((t, x) => t + x.porzione, 0)}
        bottone={`Aggiungi a ${nomeCategoria(dati, categoria).toLowerCase()}`}
        conferma={(senza: Senza[]) => aggiungi({ ricetta_id: daTogliere.ricetta.id, origine: daTogliere.origine, senza })}
        chiudi={() => setDaTogliere(null)}
      />
    );

  return (
    <Foglio titolo={`${nomeCategoria(dati, categoria)} di ${dataLunga(data)}`} chiudi={chiudi} alto>
      <div className="nuovo-piatto">
        <AvanziInCasa
          indice={indice}
          dati={tutti}
          data={data}
          categoria={categoria}
          icone={icone}
          scegli={(avanzo_di) => aggiungiAvanzo(avanzo_di)}
          scegliTesto={(t) => aggiungi({ testo: t })}
        />
        <FiltroCategoria pasto={categoria} filtro={filtro} cambia={setFiltro} />
        <CercaRicetta
          indice={indice}
          etichetta="Cosa si mangia"
          segnaposto="Ricetta o ingrediente: carbonara, zucchine…"
          testo={testo}
          cambiaTesto={setTesto}
          filtro={filtro}
          cambia={(f) => setFiltro({ ...filtro, ...f })}
        />
        {chi.size === 0 ? (
          <p className="tenue">Spunta almeno una persona qui sotto.</p>
        ) : (
          <>
            <IdeePerPasto indice={indice} dati={perLoro} data={data} categoria={categoria} filtro={filtro} conOspiti={!!ospitiDel(tutti.ospiti, data, categoria)} icone={icone} scegli={(ricetta_id, x) => {
                const r = indice.perId.get(ricetta_id);
                if (x && r) setDaTogliere({ ricetta: r, rimedio: x, origine: 'automatica' });
                else aggiungi({ ricetta_id, origine: 'automatica' });
              }} />
            <RisultatiPiatto
              indice={indice}
              dati={perLoro}
              testo={testo}
              filtro={filtro}
              icone={icone}
              vuoto="Scegli una categoria o un ingrediente, o scrivi un nome: qui compaiono le ricette."
              scegli={(s) => aggiungi(s)}
              rimedi={{
                senza: (ricetta, x) => setDaTogliere({ ricetta, rimedio: x, origine: 'manuale' }),
                mangiaAltro: (ricetta_id, loro) => aggiungi({ ricetta_id }, loro),
              }}
            />
          </>
        )}
        <div className="chi-e-ospiti">
          {tutti.persone.length > 1 && (
            <SpunteChiMangia
              compatte
              persone={tutti.persone}
              mangia={(id) => chi.has(id)}
              cambia={(id, si) => {
                const n = new Set(chi);
                if (si) n.add(id);
                else n.delete(id);
                setChi(n);
              }}
            />
          )}
          <BottoneOspiti ospiti={ospitiDel(tutti.ospiti, data, categoria)} apri={apriOspiti} />
        </div>
      </div>
    </Foglio>
  );
}

export function SchedaPiatto({
  indice,
  dati,
  portata: p,
  chiudi,
  apriOspiti,
  apriNuovo,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  chiudi: () => void;
  apriOspiti: () => void;
  /** Apre «aggiungi un piatto» allo stesso pasto, per queste persone. */
  apriNuovo: (per: string[]) => void;
}) {
  const { esegui } = useFamiglia();
  const d = descrivi(indice, dati, p);
  // Chi non mangia questo piatto e a questo pasto non ha ancora nessun altro piatto.
  const delPasto = dati.portate.filter((x) => x.data === p.data && x.categoria === p.categoria);
  const senzaPiatto = dati.persone.filter((x) => delPasto.every((q) => dati.eccezioni.some((e) => e.portata_id === q.id && e.membro_id === x.id && e.tipo === 'non_mangia')));
  const [cambia, setCambia] = useState(false);
  const [cucina, setCucina] = useState(false);
  const pronto = usePronti().get(p.id);
  const vista = useVista();
  const confermato = useConferme(vista).attive.has(p.id);
  // «Ogni giorno da qui» è acceso se la regola del piatto continua anche nei giorni dopo questo.
  const regola = p.fisso_id ? (vista.righe.pasto_fisso ?? []).find((f) => f.id === p.fisso_id && !f.eliminato_il) : undefined;
  const ogniGiorno = !!regola && (!regola.al || String(regola.al) > p.data);
  const [data, setData] = useState(p.data);
  const [categoria, setCategoria] = useState(p.categoria);
  const [note, setNote] = useState(p.note ?? '');
  const modifica = (campi: Record<string, unknown>) =>
    esegui('modifica_portata', {
      id: p.id,
      versione_attesa: p.versione ?? 1,
      campi,
    });
  const automatiche = porzioniPortata({ ...p, porzioni: null }, dati.persone, dati.eccezioni, dati.ospiti);
  // Il ricettario apre la ricetta da leggere; un avanzo apre quella del piatto da cui viene.
  const [leggi, setLeggi] = useState(false);
  const origine = p.avanzo_di ? dati.portate.find((x) => x.id === p.avanzo_di) : undefined;
  const ricetta = d.ricetta ?? (origine?.ricetta_id ? indice.perId.get(origine.ricetta_id) : undefined);

  return (
    <Foglio
      titolo={d.titolo}
      chiudi={chiudi}
      azione={
        ricetta && (
          <button className="bottone tondo apri-ricettario" onClick={() => setLeggi(true)} aria-label={`Apri la ricetta: ${ricetta.titolo}`} title="Apri la ricetta">
            <Icona nome="ricette" grandezza={22} />
          </button>
        )
      }
    >
      {leggi && ricetta && (
        <RicettaDelPiatto
          indice={indice}
          dati={dati}
          aperta={{
            ricetta,
            porzioni: Math.max(0.5, Math.round((d.porzioni + d.dopo) * 2) / 2),
            chi: dati.persone.filter((x) => !d.eccezioni.some((e) => e.membro_id === x.id)).map((x) => x.id),
            senza: p.avanzo_di ? origine?.senza : p.senza,
          }}
          quando={`${nomeCategoria(dati, p.categoria)} di ${dataLunga(p.data)}`}
          chiudi={() => setLeggi(false)}
        />
      )}
      <p className="tenue" style={{ marginTop: 0, textTransform: 'capitalize' }}>
        {nomeCategoria(dati, p.categoria)} · {dataLunga(p.data)}
        {p.origine === 'ripetuta' && ' · ripetuto dalla settimana prima'}
        {p.origine === 'automatica' && ' · ✨ proposto dall’app'}
        {ogniGiorno && ' · 🔁 ogni giorno'}
        {!d.ricetta && ' · senza ricetta'}
      </p>
      {p.avanzo_di && <AvanzoDi dati={dati} portata={p} />}

      {d.valutazione && (
        <AvvisoAdatto
          esito={d.valutazione.esito}
          adatto="Adatto a chi lo mangia"
          righe={d.valutazione.perMembro.flatMap((m) =>
            m.valutazione
              ? [
                  {
                    id: m.membro_id,
                    nome: `${m.nome}${m.mangia === 'alternativa' ? ' (piatto a parte)' : ''}`,
                    esito: m.valutazione.esito,
                    testo: motiviInBreve(m.valutazione) || 'da controllare',
                  },
                ]
              : [],
          )}
        />
      )}
      {d.ricetta && !!p.senza?.length && <SenzaNelPiatto indice={indice} dati={dati} portata={p} ricetta={d.ricetta} testo={d.senza} modifica={modifica} />}
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
          dati={datiAlPasto(dati, p.data, p.categoria)}
          etichetta="Nuovo piatto"
          scegli={async (s) => {
            await modifica(s);
            // Un piatto fisso si può cambiare solo per oggi o da questo giorno in poi.
            if (ogniGiorno && p.fisso_id && window.confirm('Cambiarlo anche nei giorni dopo? (Annulla = solo questo giorno)')) {
              await esegui('ferma_pasto_fisso', {
                id: p.fisso_id,
                dal: p.data,
                tieni: p.id,
              });
              await esegui('fissa_pasto', {
                id: crypto.randomUUID(),
                categoria: p.categoria,
                ...s,
                porzioni: p.porzioni,
                ordine: p.ordine,
                dal: p.data,
                da_portata: p.id,
              });
            }
            setCambia(false);
          }}
        />
      ) : (
        <div className="riga" style={{ flexWrap: 'wrap' }}>
          <button className="bottone piccolo" onClick={() => setCambia(true)}>
            Cambia piatto
          </button>
        </div>
      )}
      {!cambia && (
        <label className="riga" style={{ margin: '12px 0', minHeight: 44 }}>
          <input
            type="checkbox"
            checked={ogniGiorno}
            onChange={async (e) => {
              if (e.target.checked) {
                // Da questo giorno compreso: questa portata diventa il primo giorno, con le stesse persone a tavola.
                await esegui('fissa_pasto', {
                  id: crypto.randomUUID(),
                  categoria: p.categoria,
                  ...(p.ricetta_id ? { ricetta_id: p.ricetta_id } : { testo: p.testo }),
                  porzioni: p.porzioni,
                  ordine: p.ordine,
                  dal: p.data,
                  da_portata: p.id,
                });
              } else if (p.fisso_id) {
                if (!window.confirm('Non ripeterlo più nei giorni dopo? Questo pasto resta nel menu.')) return;
                // Si ferma dal giorno dopo: il pasto di questo giorno non si tocca.
                await esegui('ferma_pasto_fisso', { id: p.fisso_id, dal: piuGiorni(p.data, 1) });
              }
            }}
          />
          <span>🔁 Ogni giorno, da questo giorno in poi</span>
        </label>
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

      {p.ricetta_id && !p.avanzo_di && <DuraPiuGiorni dati={dati} portata={p} cucinate={d.porzioni + d.dopo} />}
      {!p.avanzo_di && !confermato && (
        <div className="campo" style={{ marginTop: 16 }}>
          <span>Preparato in anticipo?</span>
          {pronto ? (
            <p className="tenue" style={{ margin: 0 }}>
              🍳 Cucinato: in {pronto.luogo} {pronto.quantita === 1 ? 'c’è' : 'ci sono'} {formattaPorzioni(pronto.quantita)}
              {pronto.data_limite && `, da mangiare entro ${dataLunga(pronto.data_limite)}`}.
            </p>
          ) : (
            <button className="bottone" aria-label={`Cucinato: ${d.titolo}`} onClick={() => setCucina(true)}>
              🍳 Cucinato
            </button>
          )}
        </div>
      )}
      {cucina && <SegnaCucinato indice={indice} dati={dati} portata={p} titolo={d.titolo} chiudi={() => setCucina(false)} />}

      <div className="campo">
        {dati.persone.length > 1 && (
          <>
            <SpunteChiMangia
              persone={dati.persone}
              mangia={(id) => !d.eccezioni.some((e) => e.membro_id === id)}
              nota={(id) => {
                const e = d.eccezioni.find((x) => x.membro_id === id && x.tipo === 'alternativa');
                return e ? `piatto a parte: ${e.ricetta_id ? (indice.perId.get(e.ricetta_id)?.titolo ?? 'ricetta') : e.testo}` : null;
              }}
              cambia={async (id, si) => {
                const e = d.eccezioni.find((x) => x.membro_id === id);
                if (si && e) await esegui('rimuovi_eccezione', { id: e.id });
                if (!si)
                  await esegui('imposta_eccezione', {
                    id: crypto.randomUUID(),
                    portata_id: p.id,
                    membro_id: id,
                    tipo: 'non_mangia',
                    versione_attesa: e?.versione,
                  });
                // Piatto di ogni giorno: chi mangia vale anche per i giorni dopo.
                if (ogniGiorno) await esegui('allinea_chi_mangia_fisso', { portata_id: p.id });
              }}
            />
            {ogniGiorno && (
              <p className="tenue" style={{ margin: '0 0 8px' }}>
                🔁 Chi mangia vale anche per i giorni dopo.
              </p>
            )}
            {senzaPiatto.length > 0 && (
              <button className="bottone piccolo" onClick={() => apriNuovo(senzaPiatto.map((x) => x.id))}>
                + Un altro piatto per {senzaPiatto.map((x) => x.nome).join(', ')}
              </button>
            )}
          </>
        )}
        <BottoneOspiti ospiti={ospitiDel(dati.ospiti, p.data, p.categoria)} apri={apriOspiti} />
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

/** Un avanzo: si mangia ciò che è avanzato dal piatto di un altro giorno, non si cucina di nuovo. */
export function AvanzoDi({ dati, portata: p }: { dati: DatiMenu; portata: PortataMenu }) {
  const origine = dati.portate.find((x) => x.id === p.avanzo_di);
  const lotti = useVista().righe.lotto;
  const lotto = (lotti ?? []).find((l) => !l.eliminato_il && l.ingrediente_id === 'ing:avanzo' && l.portata_id === p.avanzo_di);
  return (
    <p className="avviso" style={{ marginTop: 0 }}>
      <IconaLuogo luogo={(lotto?.luogo as Luogo | undefined) ?? 'frigo'} /> Avanzo {origine ? `di ${nomeCategoria(dati, origine.categoria).toLowerCase()} di ${dataLunga(origine.data)}` : 'di un altro giorno'}: non si cucina e non va nella spesa.
      Confermando, si toglie dall’avanzo in casa.
    </p>
  );
}

/**
 * Un piatto che dura più giorni (una torta, un ragù): si mettono le porzioni nei pasti dei giorni dopo.
 * Il primo giorno si cucina e si compra per tutti; i giorni dopo si mangia l'avanzo.
 */
export function DuraPiuGiorni({ dati, portata: p, cucinate }: { dati: DatiMenu; portata: PortataMenu; cucinate: number }) {
  const { esegui } = useFamiglia();
  const giorni = [1, 2, 3, 4, 5, 6].map((n) => piuGiorni(p.data, n));
  const [giorno, setGiorno] = useState(giorni[0]);
  const [categoria, setCategoria] = useState(p.categoria);
  const avanzi = avanziDi(p, dati.portate);
  return (
    <div className="campo" style={{ marginTop: 16 }}>
      <span>Dura più giorni?</span>
      {avanzi.length > 0 && (
        <>
          <p className="tenue" style={{ margin: '0 0 6px' }}>
            Si cucinano {formattaPorzioni(cucinate)}: le altre si mangiano dopo.
          </p>
          <ul className="elenco" aria-label="Avanzi nei giorni dopo">
            {avanzi.map((a) => (
              <li key={a.id} className="riga">
                <span className="cresce" style={{ textTransform: 'capitalize' }}>
                  {nomeCategoria(dati, a.categoria)} · {dataLunga(a.data)}
                </span>
                <button className="bottone piccolo" aria-label={`Togli l’avanzo di ${dataLunga(a.data)}`} onClick={() => esegui('rimuovi_portata', { id: a.id })}>
                  Togli
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="riga" style={{ flexWrap: 'wrap' }}>
        <select className="dato" aria-label="Giorno dell’avanzo" value={giorno} onChange={(e) => setGiorno(e.target.value)} style={{ width: 'auto' }}>
          {giorni.map((g) => (
            <option key={g} value={g}>
              {dataLunga(g)}
            </option>
          ))}
        </select>
        <select className="dato" aria-label="Pasto dell’avanzo" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ width: 'auto' }}>
          {dati.categorie.map((c) => (
            <option key={c.valore} value={c.valore}>
              {c.nome}
            </option>
          ))}
        </select>
        <button
          className="bottone piccolo"
          onClick={() =>
            esegui('aggiungi_avanzo', {
              id: crypto.randomUUID(),
              avanzo_di: p.id,
              data: giorno,
              categoria,
              ordine: dati.portate.filter((x) => x.data === giorno && x.categoria === categoria).length,
            })
          }
        >
          <IconaLuogo luogo="frigo" /> Avanza anche qui
        </button>
      </div>
    </div>
  );
}

/**
 * Cosa è tolto dal piatto («✂️ Senza panna per Sara»): si cambia per chi (solo per lei o per tutti) o si rimette.
 * Il foglio usa la ricetta com'è, per chi mangia il piatto quel giorno.
 */
export function SenzaNelPiatto({
  indice,
  dati,
  portata: p,
  ricetta,
  testo,
  modifica,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  ricetta: Ricetta;
  testo: string;
  modifica: (campi: Record<string, unknown>) => Promise<unknown>;
}) {
  const [cambia, setCambia] = useState(false);
  const alTavolo = alPasto(dati.persone, dati.vincoli, ospitiDel(dati.ospiti, p.data, p.categoria));
  const fuori = new Set(dati.eccezioni.filter((e) => e.portata_id === p.id).map((e) => e.membro_id));
  const mangiano = alTavolo.persone.filter((x) => !fuori.has(x.id));
  const x = rimedio(indice, ricetta, mangiano, alTavolo.vincoli, dati.verifiche);
  const perTutti = (p.senza ?? []).every((s) => s.membro_id === null);
  return (
    <div className="senza-nel-piatto riga">
      <span aria-hidden style={{ fontSize: '1.3rem' }}>
        ✂️
      </span>
      <span className="cresce">
        <strong>{testo.charAt(0).toUpperCase() + testo.slice(1)}</strong>
      </span>
      <span className="senza-bottoni">
        {x?.possibile && (
          <button type="button" className="bottone piccolo" onClick={() => setCambia(true)}>
            Cambia
          </button>
        )}
        <button
          type="button"
          className="bottone piccolo"
          onClick={() => window.confirm('Rimettere gli ingredienti tolti? Il piatto tornerà ⛔ per chi non può mangiarli.') && modifica({ senza: [] })}
        >
          Rimetti
        </button>
      </span>
      {cambia && x?.possibile && (
        <FoglioSenza
          indice={indice}
          ricetta={ricetta}
          rimedio={x}
          persone={mangiano}
          famiglia={new Set(dati.persone.map((m) => m.id))}
          porzioni={porzioniPortata(p, dati.persone, dati.eccezioni, dati.ospiti)}
          iniziale={perTutti ? 'tutti' : 'loro'}
          bottone="Salva"
          conferma={async (senza) => {
            await modifica({ senza });
            setCambia(false);
          }}
          chiudi={() => setCambia(false)}
        />
      )}
    </div>
  );
}

/** Chi mangia il piatto: una spunta per persona. Chi non è spuntato può avere un altro piatto nello stesso pasto. */
export function SpunteChiMangia({
  persone,
  mangia,
  cambia,
  nota,
  compatte,
}: {
  /** In una riga di bottoni, come nella scelta di un piatto nuovo. */
  compatte?: boolean;
  persone: Persona[];
  mangia: (id: string) => boolean;
  cambia: (id: string, mangia: boolean) => void;
  nota?: (id: string) => string | null;
}) {
  return (
    <fieldset className={`spunte${compatte ? ' compatte' : ''}`} style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
      <legend style={{ fontWeight: 600, marginBottom: 4 }}>Chi mangia questo piatto</legend>
      {persone.map((x) => (
        <label key={x.id} className={compatte ? 'spunta-chip' : 'riga'} style={compatte ? undefined : { minHeight: 44 }}>
          <input type="checkbox" checked={mangia(x.id)} onChange={(e) => cambia(x.id, e.target.checked)} />
          <span className="cresce">
            {x.porzione < 1 && <span aria-hidden>🧒 </span>}
            {x.nome}
            {nota?.(x.id) && <span className="tenue"> · {nota(x.id)}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
