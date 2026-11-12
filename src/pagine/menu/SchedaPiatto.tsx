/** Menu: la scheda di un piatto già in menu (cambia, chi mangia, senza un ingrediente, più giorni, cucinato). */
import { useState } from 'react';
import { useFamiglia, useVista } from '../../dati/contesto';
import { alPasto, dataLunga, ospitiDel, type PortataMenu } from '../../dominio/menu';
import { avanziDi, porzioniPortata } from '../../dominio/consumi';
import type { Indice, Ricetta } from '../../dominio/ricette';
import { useConferme } from '../ConfermaPasto';
import { SegnaCucinato, usePronti } from '../Cucinato';
import { type Luogo, piuGiorni } from '../../dominio/scadenze';
import { Icona, IconaLuogo } from '../../ui/Icona';
import { Foglio } from '../../ui/Foglio';
import { AvvisoAdatto, motiviInBreve, RicettaDelPiatto } from '../Ricette';
import { rimedio } from '../../dominio/senza';
import { FoglioSenza } from '../Senza';
import { datiAlPasto, type DatiMenu, descrivi, nomeCategoria } from '../../dati/menu';
import { formattaPorzioni } from './Riquadri';
import { CercaPiatto } from './NuovoPiatto';
import { BottoneOspiti, SpunteChiMangia } from './ChiMangia';

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
function AvanzoDi({ dati, portata: p }: { dati: DatiMenu; portata: PortataMenu }) {
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
function DuraPiuGiorni({ dati, portata: p, cucinate }: { dati: DatiMenu; portata: PortataMenu; cucinate: number }) {
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
function SenzaNelPiatto({
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
