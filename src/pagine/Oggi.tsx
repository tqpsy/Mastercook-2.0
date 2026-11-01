import { useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { valutaPerFamiglia } from '../dominio/compatibilita';
import { type ConfermaPasto as Conferma, daConfermare, NOME_ESITO } from '../dominio/consumi';
import type { CategoriaPasto, Eccezione, PortataMenu } from '../dominio/menu';
import type { Indice, Ricetta } from '../dominio/ricette';
import { daUsarePresto, giorniTra, oggi, piuGiorni, statoData } from '../dominio/scadenze';
import { spesaDelGiorno, type BisognoDelGiorno } from '../dominio/spesa';
import { formatta, formattaGiorno } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { Foto, riduciFoto } from '../ui/Foto';
import { Icona } from '../ui/Icona';
import { Sigla, type SiglaPersona, sigleDi } from '../ui/Sigla';
import { useLotti } from './Casa';
import { ConfermaPasto, useConferme } from './ConfermaPasto';
import { chiLoMangia, type DatiMenu, descrivi, useDatiMenu, useProlungaFissi } from './Menu';
import { ICONA_ESITO, motiviInBreve, SchedaRicetta, useCommensali, useInCasa } from './Ricette';
import { useDatiSpesa } from './Spesa';

const titoloDi = (indice: Indice, p: PortataMenu) => (p.ricetta_id ? indice.perId.get(p.ricetta_id)?.titolo : null) ?? p.testo ?? 'Piatto';

/** Conferma in un tocco «come previsto», oppure apre le domande; a conferma fatta, l'esito e «Correggi». */
function StatoPasto({ titolo, conferma, apri, portata }: { titolo: string; conferma?: Conferma; apri: () => void; portata: PortataMenu }) {
  const { esegui, archivio, famiglia } = useFamiglia();
  const [vedi, setVedi] = useState(false);
  if (conferma) {
    // Dopo la conferma, la foto del piatto è una proposta facoltativa (R-CON-5).
    async function scatta(f: File | undefined) {
      if (!f || !conferma) return;
      const percorso = `${famiglia}/${crypto.randomUUID()}.jpg`;
      await archivio.foto.put({ percorso, famiglia_id: famiglia, file: await riduciFoto(f), caricata: false });
      await esegui('foto_pasto', { id: conferma.id, foto: percorso });
    }
    return (
      <span className="riga">
        <span className="etichetta">{NOME_ESITO[conferma.esito]}</span>
        {conferma.esito !== 'saltato' &&
          (conferma.foto ? (
            <button className="bottone piccolo" onClick={() => setVedi(true)} aria-label={`Foto del piatto: ${titolo}`}>
              <span aria-hidden>🖼️</span>
            </button>
          ) : (
            <label className="bottone piccolo" aria-label={`Aggiungi una foto del piatto: ${titolo}`}>
              <span aria-hidden>📷</span>
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void scatta(e.target.files?.[0])} />
            </label>
          ))}
        <button className="bottone piccolo" onClick={apri} aria-label={`Correggi: ${titolo}`}>
          Correggi
        </button>
        {vedi && conferma.foto && (
          <Foglio titolo={titolo} chiudi={() => setVedi(false)}>
            <Foto percorso={conferma.foto} alt={`Foto di ${titolo}`} />
            <button
              className="bottone pieno"
              style={{ marginTop: 12 }}
              onClick={async () => {
                if (!window.confirm('Togliere la foto di questo piatto?')) return;
                await esegui('foto_pasto', { id: conferma.id, foto: null });
                setVedi(false);
              }}
            >
              Togli la foto
            </button>
          </Foglio>
        )}
      </span>
    );
  }
  return (
    <span className="riga">
      <button
        className="bottone primario piccolo"
        aria-label={`Mangiato come previsto: ${titolo}`}
        onClick={() => esegui('conferma_pasto', { id: crypto.randomUUID(), portata_id: portata.id, esito: 'come_previsto' })}
      >
        ✓ Mangiato
      </button>
      <button className="bottone piccolo" onClick={apri} aria-label={`Com’è andato: ${titolo}`}>
        Cambia
      </button>
    </span>
  );
}

/** La ricetta aperta da Oggi: quale piatto, per chi e per quante porzioni. */
interface Aperta {
  ricetta: Ricetta;
  porzioni: number;
  pasto: string;
  /** Chi mangia questo piatto (id dei membri). */
  chi: string[];
}

/** Sempre in Oggi; merenda, spuntino e i pasti della famiglia solo se accesi nel Menu o se oggi hanno un piatto. */
const SEMPRE = new Set(['colazione', 'pranzo', 'cena']);
const mezze = (n: number) => Math.max(0.5, Math.round(n * 2) / 2);
const porzioniTesto = (n: number) => (n === 1 ? '1 porzione' : `${n.toLocaleString('it-IT')} porzioni`);

/** Da che ora un pasto è passato e conta il successivo (ore e minuti in minuti dalla mezzanotte). */
const FINE_PASTO: Record<string, number> = { colazione: 10 * 60 + 30, pranzo: 15 * 60, merenda: 17 * 60 + 30, cena: 24 * 60 };

function saluto(adesso: Date) {
  const ora = adesso.getHours();
  return ora < 5 ? 'Buonanotte' : ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

/** Il pasto da mettere in evidenza: il primo, da adesso in poi, con un piatto ancora da mangiare; altrimenti quello di adesso. */
function pastoInEvidenza(pasti: CategoriaPasto[], diOggi: PortataMenu[], attive: Map<string, Conferma>, adesso: Date): CategoriaPasto | undefined {
  const minuti = adesso.getHours() * 60 + adesso.getMinutes();
  const ora = pasti.findIndex((c) => (FINE_PASTO[c.valore] ?? -1) > minuti);
  if (ora < 0) return undefined;
  const avanti = pasti.slice(ora);
  return avanti.find((c) => diOggi.some((p) => p.categoria === c.valore && !attive.has(p.id))) ?? avanti[0];
}

/**
 * Oggi: in grande il prossimo pasto (Mangiato, Cambia, ricetta), poi ciò che è da usare presto e il resto
 * della giornata, con i piatti a parte di chi mangia altro e gli avvisi per chi ha esigenze. Toccando un
 * piatto si apre la ricetta; la spesa mostra solo ciò che manca per i piatti di oggi.
 * Da 900 px in su: il pasto e la giornata a sinistra, scadenze e spesa a destra.
 */
export function Oggi({ vai }: { vai: (scheda: 'spesa' | 'casa' | 'menu') => void }) {
  const vista = useVista();
  const { utenteId } = useFamiglia();
  const indice = useIndice(vista);
  const dati = useDatiMenu(vista);
  const lotti = useLotti();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const io = righeAttive(vista, 'membro').find((m) => m.utente_id === utenteId);
  const giorno = oggi();
  useProlungaFissi(piuGiorni(giorno, 13));
  const { attive } = useConferme(vista);
  const [aperto, setAperto] = useState<string | null>(null);
  const [ricetta, setRicetta] = useState<Aperta | null>(null);
  const [spesa, setSpesa] = useState(false);
  /** Il pasto di cui è aperto il dettaglio (conferme piatto per piatto, porzioni, avvisi, foto). */
  const [pastoAperto, setPastoAperto] = useState<string | null>(null);
  const adesso = new Date();
  const diOggi = dati.portate.filter((p) => p.data === giorno);
  // Colazione, pranzo e cena ci sono sempre; gli altri pasti se accesi o se oggi hanno un piatto: 3, 4 o 5 riquadri.
  const pasti = dati.categorie.filter((c) => SEMPRE.has(c.valore) || c.attiva || diOggi.some((p) => p.categoria === c.valore));
  const evidenza = pastoInEvidenza(pasti, diOggi, attive, adesso);
  const arretrati = daConfermare(dati.portate, attive, giorno).filter((p) => p.data < giorno);
  const portataAperta = aperto ? dati.portate.find((p) => p.id === aperto) : undefined;
  const daMangiare = diOggi.filter((p) => !attive.has(p.id));
  const bisogni = indice ? spesaDelGiorno(indice, daMangiare, dati.persone, dati.eccezioni, dati.portate, dati.ospiti, lotti) : [];
  const mancano = bisogni.filter((b) => b.manca > 0).length;
  const presto = daUsarePresto(lotti, giorno);
  const data = adesso.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const nome = String(io?.nome ?? famiglia?.nome ?? '').split(' ')[0];

  const sigle = sigleDi(dati.persone);
  const iEvidenza = evidenza ? pasti.indexOf(evidenza) : -1;
  const dettaglio = pasti.find((c) => c.valore === pastoAperto);

  return (
    <div className="pagina-oggi">
      <header className="oggi-saluto">
        <p className="tenue" style={{ marginBottom: 0 }}>
          <span style={{ textTransform: 'capitalize' }}>{data}</span>
          {famiglia && (
            <>
              {' · '}
              <span>{String(famiglia.nome)}</span>
            </>
          )}
        </p>
        <h2 className="titolo-grande">{nome ? `${saluto(adesso)}, ${nome}` : saluto(adesso)}</h2>
      </header>

      {indice && presto.length > 0 && (
        // Una tendina chiusa di base, come in Casa: si vede subito quanti prodotti stanno per scadere.
        <section className="scheda oggi-presto" aria-label="Da usare presto">
          <details>
            <summary>
              <h3 style={{ display: 'inline', margin: 0 }}>
                Da usare presto <span className="etichetta">{presto.length}</span>
              </h3>
              <span className="primo-presto">
                {presto
                  .slice(0, 3)
                  .map((l) => indice.nome(l.ingrediente_id).toLowerCase())
                  .join(', ')}
                {presto.length > 3 && '…'}
              </span>
            </summary>
            <ul className="mattonelle">
              {presto.slice(0, 6).map((l) => {
                const s = statoData(l, giorno);
                const mancano = l.data_limite ? giorniTra(giorno, l.data_limite) : null;
                const quando =
                  s === 'sconosciuta' || mancano === null
                    ? 'da controllare'
                    : mancano < 0
                      ? 'scaduto'
                      : mancano === 0
                        ? 'oggi'
                        : mancano === 1
                          ? 'domani'
                          : `${mancano} giorni`;
                const tono = mancano !== null && mancano <= 1 ? 'urgente' : s === 'presto' ? 'presto' : 'calmo';
                return (
                  <li key={l.id}>
                    <button className={`mattonella ${tono}`} onClick={() => vai('casa')}>
                      <strong>{indice.nome(l.ingrediente_id)}</strong>
                      <span>{quando}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button className="link" style={{ marginTop: 8 }} onClick={() => vai('casa')}>
              {presto.length > 6 ? `Tutti e ${presto.length} in Casa` : 'Apri in Casa'}
            </button>
          </details>
        </section>
      )}

      {/* I pasti di oggi come riquadri: 2 per riga sul telefono (con 3 o 5 pasti l'ultimo prende tutta la riga),
          tutti in una riga sul tablet e sul telefono girato. */}
      <section aria-label="Oggi si mangia" className={`oggi-pasti riquadri${pasti.length >= 5 ? ' fitto' : ''}`}>
        {!indice ? (
          <p className="tenue">Sto caricando il menu…</p>
        ) : (
          pasti.map((c, i) => (
            <Riquadro
              key={c.valore}
              indice={indice}
              dati={dati}
              sigle={sigle}
              categoria={c}
              portate={diOggi.filter((p) => p.categoria === c.valore)}
              attive={attive}
              inEvidenza={c === evidenza}
              daConfermare={iEvidenza < 0 || i <= iEvidenza}
              apriRicetta={setRicetta}
              apriDettaglio={() => setPastoAperto(c.valore)}
              aggiungi={() => vai('menu')}
            />
          ))
        )}
      </section>
      {indice && diOggi.length === 0 && <div className="avviso info oggi-vuoto">Niente in menu per oggi: lo prepari dalla scheda Menu.</div>}

      <div className="oggi-lato">
        <button className="bottone pieno primario spesa-oggi" onClick={() => setSpesa(true)} disabled={!indice}>
          <Icona nome="spesa" />
          Spesa per oggi{mancano ? ` · ${mancano} ${mancano === 1 ? 'cosa' : 'cose'}` : ''}
        </button>

        {indice && arretrati.length > 0 && (
          <section className="scheda" aria-label="Pasti da confermare">
            <h3 style={{ marginTop: 0 }}>Pasti da confermare</h3>
            <p className="tenue" style={{ marginTop: 0 }}>
              Confermare toglie dalla casa ciò che è stato usato: così frigo e dispensa restano veri.
            </p>
            <ul className="elenco">
              {arretrati.map((p) => {
                const titolo = titoloDi(indice, p);
                const categoria = dati.categorie.find((c) => c.valore === p.categoria);
                return (
                  <li key={p.id} className="riga" style={{ flexWrap: 'wrap' }}>
                    <span className="cresce">
                      {titolo}{' '}
                      <span className="tenue">
                        · {formattaGiorno(p.data)}
                        {categoria && `, ${categoria.nome.toLowerCase()}`}
                      </span>
                    </span>
                    <StatoPasto titolo={titolo} portata={p} apri={() => setAperto(p.id)} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {indice && portataAperta && (
        <ConfermaPasto
          indice={indice}
          dati={dati}
          portata={portataAperta}
          titolo={titoloDi(indice, portataAperta)}
          attiva={attive.get(portataAperta.id)}
          chiudi={() => setAperto(null)}
        />
      )}
      {indice && dettaglio && (
        <Foglio titolo={`${dettaglio.nome} di oggi`} chiudi={() => setPastoAperto(null)}>
          <ul className="elenco dettaglio-pasto">
            {diOggi
              .filter((p) => p.categoria === dettaglio.valore)
              .map((p) => (
                <PiattoDiOggi
                  key={p.id}
                  indice={indice}
                  dati={dati}
                  portata={p}
                  pasto={dettaglio.nome}
                  conferma={attive.get(p.id)}
                  apriConferma={() => setAperto(p.id)}
                  apriRicetta={setRicetta}
                />
              ))}
          </ul>
        </Foglio>
      )}
      {indice && ricetta && <RicettaDiOggi indice={indice} dati={dati} aperta={ricetta} chiudi={() => setRicetta(null)} />}
      {indice && spesa && (
        <SpesaDiOggi
          indice={indice}
          bisogni={bisogni}
          aMano={daMangiare.filter((p) => !p.ricetta_id && !p.avanzo_di).length}
          chiudi={() => setSpesa(false)}
          tutta={() => {
            setSpesa(false);
            vai('spesa');
          }}
        />
      )}
    </div>
  );
}

/** Un piatto in un riquadro: il nome (tocco = ricetta) e le sigle di chi lo mangia. */
interface RigaRiquadro {
  chiave: string;
  titolo: string;
  ricetta?: Ricetta;
  porzioni: number;
  chi: string[];
  esito?: 'adatta' | 'da_verificare' | 'non_adatta';
  /** «Ricetta per Sara: …» per i piatti a parte. */
  perChi?: string;
  nota?: string;
}

/**
 * Un pasto di oggi come riquadro: i piatti con le sigle di chi li mangia (anche i piatti a parte), «✓ Mangiato»
 * per il prossimo pasto e quelli già passati, «⋯» per il dettaglio (correggere, foto, porzioni, avvisi).
 */
function Riquadro({
  indice,
  dati,
  sigle,
  categoria: c,
  portate,
  attive,
  inEvidenza,
  daConfermare,
  apriRicetta,
  apriDettaglio,
  aggiungi,
}: {
  indice: Indice;
  dati: DatiMenu;
  sigle: Map<string, SiglaPersona>;
  categoria: CategoriaPasto;
  portate: PortataMenu[];
  attive: Map<string, Conferma>;
  inEvidenza: boolean;
  daConfermare: boolean;
  apriRicetta: (a: Aperta) => void;
  apriDettaglio: () => void;
  aggiungi: () => void;
}) {
  const { esegui } = useFamiglia();
  const fatte = portate.filter((p) => attive.has(p.id));
  const fatto = portate.length > 0 && fatte.length === portate.length;
  const mancano = portate.filter((p) => !attive.has(p.id));
  const esiti = new Set(fatte.map((p) => attive.get(p.id)!.esito));
  const righe: RigaRiquadro[] = [];
  for (const p of portate) {
    const d = descrivi(indice, dati, p);
    const origine = p.avanzo_di ? dati.portate.find((x) => x.id === p.avanzo_di) : undefined;
    const ricetta = d.ricetta ?? (origine?.ricetta_id ? indice.perId.get(origine.ricetta_id) : undefined);
    const ospiti = dati.ospiti.find((o) => o.data === p.data && o.categoria === p.categoria && o.adulti + o.bambini > 0);
    righe.push({
      chiave: p.id,
      titolo: d.titolo,
      ricetta,
      porzioni: mezze(d.porzioni + d.dopo),
      chi: dati.persone.filter((x) => !d.eccezioni.some((e) => e.membro_id === x.id)).map((x) => x.id),
      esito: d.valutazione?.esito,
      nota: [p.avanzo_di && 'avanzo', ospiti && `+${ospiti.adulti + ospiti.bambini} ospiti`].filter(Boolean).join(' · ') || undefined,
    });
    for (const e of d.eccezioni.filter((x) => x.tipo === 'alternativa')) {
      const persona = dati.persone.find((x) => x.id === e.membro_id);
      if (!persona) continue;
      const r = e.ricetta_id ? indice.perId.get(e.ricetta_id) : undefined;
      righe.push({ chiave: e.id, titolo: r?.titolo ?? e.testo ?? 'altro', ricetta: r, porzioni: mezze(e.porzioni ?? persona.porzione), chi: [persona.id], perChi: persona.nome });
    }
  }
  const nomi = (chi: string[]) => {
    const n = dati.persone.filter((x) => chi.includes(x.id)).map((x) => x.nome);
    return n.length ? `per ${n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}` : n[0]}` : 'per nessuno della famiglia';
  };
  const conSigle = dati.persone.length > 1;

  return (
    <section className={`riquadro t-${c.valore}${inEvidenza ? ' prossimo' : ''}${fatto ? ' fatto' : ''}`} aria-label={c.nome}>
      <div className="testa-riquadro">
        <h3>
          <span className="emoji-pasto" aria-hidden>
            {c.emoji}
          </span>
          {c.nome}
        </h3>
        {portate.length > 0 && (
          <button className="altro-riquadro" onClick={apriDettaglio} aria-label={`Dettagli di ${c.nome.toLowerCase()}: conferme, porzioni e avvisi`}>
            ⋯
          </button>
        )}
      </div>
      {inEvidenza && !fatto && <span className="pillola-prossimo">Prossimo</span>}
      {portate.length === 0 ? (
        <>
          <p className="vuoto-riquadro">Niente in menu</p>
          <button className="aggiungi-riquadro" aria-label={`Aggiungi a ${c.nome.toLowerCase()} dal Menu`} onClick={aggiungi}>
            + Aggiungi
          </button>
        </>
      ) : (
        <ul className="piatti-riquadro">
          {righe.map((r) => {
            const dentro = (
              <>
                <span className="nome-piatto">
                  {r.esito && r.esito !== 'adatta' && <span aria-label={NOME_ESITO_PIATTO[r.esito]}>{ICONA_ESITO[r.esito]} </span>}
                  {r.titolo}
                  {r.nota && <span className="nota-piatto"> · {r.nota}</span>}
                </span>
                {conSigle && (
                  <span className="sigle">
                    {[...r.chi].sort((a, b) => (sigle.get(a)?.ordine ?? 0) - (sigle.get(b)?.ordine ?? 0)).map((id) => (
                      <Sigla key={id} s={sigle.get(id)} />
                    ))}
                  </span>
                )}
                <span className="solo-lettura"> {nomi(r.chi)}</span>
              </>
            );
            return (
              <li key={r.chiave}>
                {r.ricetta ? (
                  <button
                    className="piatto-riquadro"
                    aria-label={r.perChi ? `Ricetta per ${r.perChi}: ${r.titolo}` : `Ricetta: ${r.titolo}`}
                    onClick={() => apriRicetta({ ricetta: r.ricetta!, porzioni: r.porzioni, pasto: c.nome, chi: r.chi })}
                  >
                    {dentro}
                  </button>
                ) : (
                  <div className="piatto-riquadro">{dentro}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {fatto ? (
        <p className="esito-riquadro">
          <Icona nome="spunta" /> {esiti.size === 1 ? NOME_ESITO[[...esiti][0]] : 'Confermato'}
        </p>
      ) : (
        daConfermare &&
        mancano.length > 0 && (
          <button
            className="bottone primario piccolo mangiato-riquadro"
            aria-label={`Mangiato come previsto: ${mancano.map((p) => descrivi(indice, dati, p).titolo).join(', ')}`}
            onClick={() => {
              for (const p of mancano) void esegui('conferma_pasto', { id: crypto.randomUUID(), portata_id: p.id, esito: 'come_previsto' });
            }}
          >
            ✓ Mangiato
          </button>
        )
      )}
    </section>
  );
}

function PiattoDiOggi({
  indice,
  dati,
  portata: p,
  pasto,
  conferma,
  apriConferma,
  apriRicetta,
}: {
  indice: Indice;
  dati: DatiMenu;
  portata: PortataMenu;
  pasto: string;
  conferma?: Conferma;
  apriConferma: () => void;
  apriRicetta: (a: Aperta) => void;
}) {
  const d = descrivi(indice, dati, p);
  const esito = d.valutazione?.esito;
  const chi = dati.persone.filter((x) => !d.eccezioni.some((e) => e.membro_id === x.id)).map((x) => x.id);
  // Un avanzo si apre sulla ricetta del piatto da cui viene.
  const origine = p.avanzo_di ? dati.portate.find((x) => x.id === p.avanzo_di) : undefined;
  const ricetta = d.ricetta ?? (origine?.ricetta_id ? indice.perId.get(origine.ricetta_id) : undefined);
  // Gli avvisi di chi mangia il piatto principale e ha esigenze che il piatto non rispetta (o da controllare).
  const avvisi = (d.valutazione?.perMembro ?? []).filter((m) => m.mangia === 'principale' && m.valutazione && m.valutazione.esito !== 'adatta');
  const aParte = d.eccezioni.filter((e) => e.tipo === 'alternativa');
  const ospiti = dati.ospiti.find((o) => o.data === p.data && o.categoria === p.categoria && o.adulti + o.bambini > 0);
  const contenuto = (
    <>
      <span>
        {esito && esito !== 'adatta' && <span aria-label={NOME_ESITO_PIATTO[esito]}>{ICONA_ESITO[esito]} </span>}
        <strong>{d.titolo}</strong>
        {d.nonPiace.length > 0 && <span title={d.nonPiace.map((g) => `a ${g.nome} non piace ${g.cosa.toLowerCase()}`).join('; ')}> 🙅</span>}
      </span>
      <span className="tenue piccolo">
        {d.eccezioni.length > 0 && `${chiLoMangia(dati, d.eccezioni)} · `}
        {porzioniTesto(d.porzioni)}
        {p.avanzo_di && ' · avanzo'}
        {d.dopo > 0 && ` · cucina anche ${d.dopo.toLocaleString('it-IT')} per i giorni dopo`}
        {ospiti && ` · 👥 ${ospiti.adulti + ospiti.bambini} ospiti`}
        {!ricetta && ' · senza ricetta'}
      </span>
    </>
  );
  return (
    <li style={{ display: 'block' }}>
      {ricetta ? (
        <button
          className={`piatto${esito ? ` ${esito}` : ''}`}
          aria-label={`Ricetta: ${d.titolo}`}
          onClick={() => apriRicetta({ ricetta, porzioni: mezze(d.porzioni + d.dopo), pasto, chi })}
        >
          {contenuto}
        </button>
      ) : (
        <div className={`piatto${esito ? ` ${esito}` : ''}`} style={{ cursor: 'default' }}>
          {contenuto}
        </div>
      )}
      {(aParte.length > 0 || avvisi.length > 0) && (
        <ul className="elenco varianti" aria-label={`Piatti a parte e avvisi: ${d.titolo}`}>
          {aParte.map((e) => (
            <Variante key={e.id} indice={indice} dati={dati} eccezione={e} pasto={pasto} apriRicetta={apriRicetta} />
          ))}
          {avvisi.map((m) => (
            <li key={m.membro_id} className="tenue">
              {ICONA_ESITO[m.valutazione!.esito]} <strong>{m.nome}</strong>: {motiviInBreve(m.valutazione!) || 'da controllare'}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 4 }}>
        <StatoPasto titolo={d.titolo} portata={p} conferma={conferma} apri={apriConferma} />
      </div>
    </li>
  );
}

const NOME_ESITO_PIATTO = { adatta: 'adatto', da_verificare: 'da verificare', non_adatta: 'non adatto a qualcuno' } as const;

/** Chi ha un piatto a parte segnato dentro questo piatto (com'era prima delle spunte). */
function Variante({ indice, dati, eccezione: e, pasto, apriRicetta }: { indice: Indice; dati: DatiMenu; eccezione: Eccezione; pasto: string; apriRicetta: (a: Aperta) => void }) {
  const persona = dati.persone.find((x) => x.id === e.membro_id);
  if (!persona) return null;
  const icona = persona.porzione < 1 ? '🧒' : '🧑';
  const ricetta = e.ricetta_id ? indice.perId.get(e.ricetta_id) : undefined;
  const titolo = ricetta?.titolo ?? e.testo ?? 'altro';
  return (
    <li>
      <span aria-hidden>{icona}</span> {persona.nome} mangia{' '}
      {ricetta ? (
        <button className="link" aria-label={`Ricetta per ${persona.nome}: ${titolo}`} onClick={() => apriRicetta({ ricetta, porzioni: mezze(e.porzioni ?? persona.porzione), pasto, chi: [persona.id] })}>
          {titolo}
        </button>
      ) : (
        <strong>{titolo}</strong>
      )}
    </li>
  );
}

/** La ricetta di un piatto di oggi, per le porzioni del pasto e valutata per chi lo mangia. */
function RicettaDiOggi({ indice, dati, aperta, chiudi }: { indice: Indice; dati: DatiMenu; aperta: Aperta; chiudi: () => void }) {
  const inCasa = useInCasa();
  const { membri, vincoli, verifiche } = useCommensali();
  const loro = membri.filter((m) => aperta.chi.includes(m.id));
  const conVincoli = vincoli.some((v) => aperta.chi.includes(v.membro_id));
  const nomi = loro.map((m) => m.nome).join(', ');
  return (
    <SchedaRicetta
      key={`${aperta.ricetta.id}|${aperta.porzioni}`}
      indice={indice}
      ricetta={aperta.ricetta}
      inCasa={inCasa}
      porzioniIniziali={aperta.porzioni}
      valutazione={conVincoli ? valutaPerFamiglia(indice, aperta.ricetta, loro, vincoli, verifiche) : null}
      chiudi={chiudi}
      sopra={
        <p className="tenue" style={{ marginTop: 0 }}>
          {aperta.pasto} di oggi{nomi && dati.persone.length > 1 ? ` · per ${nomi}` : ''}
        </p>
      }
    />
  );
}

/** La spesa per i piatti di oggi ancora da mangiare: cosa manca, se è già in lista, e cosa c'è già in casa. */
function SpesaDiOggi({ indice, bisogni, aMano, chiudi, tutta }: { indice: Indice; bisogni: BisognoDelGiorno[]; aMano: number; chiudi: () => void; tutta: () => void }) {
  const vista = useVista();
  const { esegui } = useFamiglia();
  const { voci } = useDatiSpesa(vista);
  const mancano = bisogni.filter((b) => b.manca > 0);
  const ci = bisogni.filter((b) => b.manca <= 0);
  const voceDi = (b: BisognoDelGiorno) => voci.find((v) => v.ingrediente_id === b.ingrediente_id && v.unita === b.unita && (v.stato === 'da_acquistare' || v.stato === 'nel_carrello'));
  const daAggiungere = mancano.filter((b) => !voceDi(b));
  const aggiungi = (b: BisognoDelGiorno) => esegui('aggiungi_voce', { id: crypto.randomUUID(), ingrediente_id: b.ingrediente_id, testo: null, quantita: b.manca, unita: b.unita });

  return (
    <Foglio titolo="Spesa per oggi" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Solo per i piatti di oggi ancora da mangiare, tolto ciò che c’è già in casa.
      </p>
      {bisogni.length === 0 ? (
        <div className="avviso info">Oggi non serve comprare niente per il menu.</div>
      ) : mancano.length === 0 ? (
        <div className="avviso info">Hai già tutto in casa per i piatti di oggi.</div>
      ) : (
        <section aria-label="Da comprare per oggi">
          <h3 style={{ margin: '0 0 4px' }}>Da comprare</h3>
          <ul className="elenco">
            {mancano.map((b) => {
              const voce = voceDi(b);
              return (
                <li key={`${b.ingrediente_id}|${b.unita}`} className="riga" style={{ flexWrap: 'wrap' }}>
                  <span aria-hidden><IconaCibo valore={iconaIngrediente(indice.ingrediente(b.ingrediente_id))} /></span>
                  <span className="cresce">
                    {indice.nome(b.ingrediente_id)} <span className="tenue">· {formatta({ valore: b.manca, unita: b.unita })}</span>
                  </span>
                  {voce ? (
                    <span className="etichetta">{voce.stato === 'nel_carrello' ? 'nel carrello' : 'in lista'}</span>
                  ) : (
                    <button className="bottone piccolo" aria-label={`Metti in lista: ${indice.nome(b.ingrediente_id)}`} onClick={() => aggiungi(b)}>
                      + Lista
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {daAggiungere.length > 1 && (
            <button className="bottone pieno" style={{ marginTop: 8 }} onClick={() => daAggiungere.forEach((b) => void aggiungi(b))}>
              Metti tutto in lista
            </button>
          )}
        </section>
      )}
      {aMano > 0 && <p className="tenue">{aMano === 1 ? 'Un piatto è scritto a mano' : `${aMano} piatti sono scritti a mano`}: i suoi ingredienti li controlli tu.</p>}
      {ci.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Già in casa ({ci.length})</summary>
          <ul className="elenco">
            {ci.map((b) => (
              <li key={`${b.ingrediente_id}|${b.unita}`} className="riga">
                <span aria-hidden><IconaCibo valore={iconaIngrediente(indice.ingrediente(b.ingrediente_id))} /></span>
                <span className="cresce">{indice.nome(b.ingrediente_id)}</span>
                <span className="tenue">{formatta({ valore: b.serve, unita: b.unita })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <button className="bottone pieno" style={{ marginTop: 12 }} onClick={tutta}>
        Apri tutta la lista della spesa
      </button>
    </Foglio>
  );
}
