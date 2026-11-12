/** Menu: aggiungere un piatto (cerca con i filtri, idee, avanzi in casa, chi mangia). */
import { useMemo, useState } from 'react';
import { useFamiglia, useVista } from '../../dati/contesto';
import { NOME_ESITO } from '../../dominio/compatibilita';
import { dataLunga, gustiPerPiatto, ID_OSPITI, ospitiDel, type Persona, valutaPortata } from '../../dominio/menu';
import { CATEGORIE, type Categoria } from '../../catalogo/tipi';
import { haPrincipale, type Principale, usaIngrediente } from '../../dominio/principale';
import { BottoniSegno, CercaRicetta, type Segno } from '../../ui/FiltriRicetta';
import { RICETTE_PER_PASTO } from '../../dominio/proposte';
import { filtra, iconaRicetta, type Indice, type Ricetta } from '../../dominio/ricette';
import { IdeePerPasto } from '../Proposte';
import { useConferme } from '../ConfermaPasto';
import { IconaLuogo } from '../../ui/Icona';
import { avanziInCasa } from '../../dominio/avanzi';
import { Foglio } from '../../ui/Foglio';
import { formattaGiorno } from '../../dominio/unita';
import { ICONA_ESITO, MarchiSegni, useIcone, useSegni } from '../Ricette';
import { IconaCibo } from '../../ui/IconaCibo';
import { type Rimedio, rimedio, type Senza } from '../../dominio/senza';
import { AvvisoNonSiToglie, EtichettaRimedio, FoglioSenza } from '../Senza';
import { datiAlPasto, type DatiMenu, nomeCategoria } from '../../dati/menu';
import { BottoneOspiti, SpunteChiMangia } from './ChiMangia';

type Scelta = { ricetta_id: string; testo: null } | { ricetta_id: null; testo: string };

/** Filtri della scelta del piatto, gli stessi per l'idea e per la ricerca. */
interface FiltroPiatto {
  categoria: Categoria | null;
  principale: Principale | null;
  /** Un ingrediente preciso (id), cercato per nome. */
  ingrediente: string | null;
  /** Solo le ⭐ preferite o le 💫 da ospiti. */
  segno: Segno | null;
}
const SENZA_FILTRI: FiltroPiatto = { categoria: null, principale: null, ingrediente: null, segno: null };
const PER_PAGINA = 12;

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
function RisultatiPiatto({
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
function FiltroCategoria({ pasto, filtro, cambia }: { pasto: string; filtro: FiltroPiatto; cambia: (f: FiltroPiatto) => void }) {
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

/**
 * Gli avanzi che sono in casa (in frigo, in freezer o in dispensa), da mettere nel pasto: quelli segnati con
 * «✓ Mangiato» e i piatti cucinati in anticipo, di un giorno prima o di un pasto prima nello stesso giorno.
 * Toccandone uno il pasto prende l'avanzo, non una ricetta da cucinare. Un avanzo senza il piatto d'origine
 * nel menu (piatto scritto a mano, tolto dal menu, portato dalla vecchia app) entra come piatto col suo nome.
 * Senza avanzi resta una riga che dice dove compariranno.
 */
function AvanziInCasa({
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
