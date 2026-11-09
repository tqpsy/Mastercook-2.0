import { type FormEvent, memo, useMemo, useState } from 'react';
import { IconaCibo } from '../../ui/IconaCibo';
import { iconaIngrediente } from '../../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../../catalogo/tipi';
import { useFamiglia, useVista } from '../../dati/contesto';
import type { Indice, Ingrediente } from '../../dominio/ricette';
import { eFresco, giorniTra, type Luogo, oggi, stima } from '../../dominio/scadenze';
import { type Scritta, scrittaVuota, UNITA_BASE } from '../../dominio/unita';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { LivelloScorta } from '../../ui/LivelloScorta';
import { type Livello, puoAOcchio } from '../../dominio/livello';
import { Foglio } from '../../ui/Foglio';
import { dataBreve, quantitaDa } from './NuovoLotto';
import { ElencoLotti, type Lotto, useConsiglioPosto } from '../Casa';

interface RigaDaCompletare {
  id: string;
  ing: Ingrediente;
  data: string;
  negozio: string | null;
}

/**
 * Frigo, freezer e dispensa con i loro prodotti. Separato e memorizzato: toccando un prodotto si apre la sua scheda
 * senza ridisegnare tutti gli elenchi (con un centinaio di prodotti la scheda si apriva in ritardo sul telefono).
 */
export const ColonneLuoghi = memo(function ColonneLuoghi({
  indice,
  lotti,
  giorno,
  luogo,
  apri,
}: {
  indice: Indice;
  lotti: Lotto[];
  giorno: string;
  luogo: Luogo;
  apri: (id: string) => void;
}) {
  const perLuogo = useMemo(
    () =>
      new Map(
        LUOGHI.map((l) => [l, lotti.filter((x) => x.luogo === l).sort((a, b) => indice.nome(a.ingrediente_id).localeCompare(indice.nome(b.ingrediente_id), 'it'))]),
      ),
    [lotti, indice],
  );
  return (
    <div className="colonne-luoghi">
      {LUOGHI.map((l) => {
        const qui = perLuogo.get(l)!;
        return (
          <section key={l} className={`scheda luogo${l === luogo ? ' attivo' : ''}`} aria-label={NOME_LUOGO[l]}>
            <h3 className="titolo-luogo">
              {NOME_LUOGO[l]} <span className="etichetta">{qui.length}</span>
            </h3>
            {qui.length ? (
              <ElencoLotti indice={indice} lotti={qui} giorno={giorno} apri={apri} />
            ) : (
              <p className="tenue" style={{ margin: 0 }}>
                Niente in {NOME_LUOGO[l].toLowerCase()}. Aggiungi ciò che hai con «+ Aggiungi»: la quantità la scrivi tu, l’app non la indovina.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
});

/**
 * Le cose comprate con lo scontrino senza scriverne la quantità: in casa entrano quando si scrive quanto.
 * Si vedono per 30 giorni dall'acquisto; dopo non servono più (ormai è stato mangiato o buttato).
 */
export function DaCompletare({ indice }: { indice: Indice }) {
  const vista = useVista();
  const [aperta, setAperta] = useState<RigaDaCompletare | null>(null);
  const giorno = oggi();
  const acquisti = new Map((vista.righe.acquisto ?? []).filter((a) => !a.eliminato_il && a.stato !== 'annullato').map((a) => [a.id, a]));
  const elenco: RigaDaCompletare[] = [];
  for (const r of vista.righe.acquisto_riga ?? []) {
    const a = acquisti.get(String(r.acquisto_id));
    const ing = r.ingrediente_id ? indice.ingrediente(String(r.ingrediente_id)) : undefined;
    if (r.eliminato_il || r.lotto_id || r.quantita != null || !a || !ing) continue;
    const data = String(a.data).slice(0, 10);
    if (giorniTra(data, giorno) > 30) continue;
    elenco.push({ id: r.id, ing, data, negozio: (a.negozio as string | null) ?? null });
  }
  if (!elenco.length) return null;
  elenco.sort((x, y) => y.data.localeCompare(x.data) || x.ing.nome.localeCompare(y.ing.nome, 'it'));
  return (
    <section className="scheda" aria-label="Da completare">
      <h3 style={{ marginTop: 0 }}>
        Da completare <span className="etichetta">{elenco.length}</span>
      </h3>
      <p className="tenue" style={{ margin: '0 0 8px' }}>
        Comprati con lo scontrino senza la quantità: scrivila e li metto in casa.
      </p>
      <ul className="elenco">
        {elenco.map((r) => (
          <li key={r.id}>
            <button className="voce" onClick={() => setAperta(r)} aria-label={`Scrivi la quantità di ${r.ing.nome}`}>
              <span className="emoji" aria-hidden>
                <IconaCibo valore={iconaIngrediente(r.ing)} />
              </span>
              <span className="cresce">
                <strong>{r.ing.nome}</strong>
                <span className="tenue" style={{ display: 'block' }}>
                  {[`comprato ${dataBreve(r.data)}`, r.negozio].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="etichetta avviso-data">quantità?</span>
            </button>
          </li>
        ))}
      </ul>
      {aperta && <CompletaRiga riga={aperta} chiudi={() => setAperta(null)} />}
    </section>
  );
}

function CompletaRiga({ riga, chiudi }: { riga: RigaDaCompletare; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const { ing } = riga;
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota(ing.dimensione !== 'pezzi' && ing.peso_pz ? 'pz' : UNITA_BASE[ing.dimensione]));
  const cambiaScritta = (x: Partial<Scritta>) => setScritta((s) => ({ ...s, ...x }));
  const [luogo, setLuogo] = useState<Luogo>(ing.luogo);
  const [errore, setErrore] = useState<string | null>(null);
  const consiglio = useConsiglioPosto(ing, luogo);
  // Fresco o sfuso: la scadenza la calcola l'app dal giorno dell'acquisto, come nello scontrino.
  const proposta = eFresco(ing) ? stima(ing, luogo, riga.data) : null;
  // Il formaggio comprato senza pesarlo: pezzi e quanto ne resta, come in «Aggiungi».
  const [aOcchio, setAOcchio] = useState(false);
  const [occhio, setOcchio] = useState<{ pezzi: number; livello: Livello }>({ pezzi: 1, livello: 'tanto' });
  const conOcchio = aOcchio && puoAOcchio(ing);

  async function salva(e: FormEvent) {
    e.preventDefault();
    const q = conOcchio ? null : quantitaDa(scritta, ing);
    if (typeof q === 'string') return setErrore(q);
    await esegui('completa_riga_acquisto', {
      id: riga.id,
      lotto_id: crypto.randomUUID(),
      ...(q ? { quantita: q.valore, unita: q.unita } : occhio),
      luogo,
      posto: consiglio?.posto.id ?? null,
      ...(proposta
        ? { data_limite: proposta.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: proposta.calcolata_il, affidabilita: 'bassa' }
        : { tipo_data: 'sconosciuta' }),
    });
    chiudi();
  }

  return (
    <Foglio titolo={`Quanto ${ing.nome.toLowerCase()}?`} chiudi={chiudi}>
      <form onSubmit={salva} noValidate>
        <p className="tenue" style={{ marginTop: 0 }}>
          Comprato {dataBreve(riga.data)}
          {riga.negozio ? ` da ${riga.negozio}` : ''}. Scrivi quanto ne hai preso: entra in casa con la data dello scontrino.
        </p>
        {puoAOcchio(ing) && (
          <div className="scelte" role="group" aria-label="Come lo conti">
            <button type="button" aria-pressed={!aOcchio} onClick={() => setAOcchio(false)}>
              Peso o misuro
            </button>
            <button type="button" aria-pressed={aOcchio} onClick={() => setAOcchio(true)}>
              A occhio
            </button>
          </div>
        )}
        {conOcchio ? (
          <LivelloScorta pezzi={occhio.pezzi} livello={occhio.livello} cambia={(x) => setOcchio((o) => ({ ...o, ...x }))} />
        ) : (
          <div style={{ marginTop: puoAOcchio(ing) ? 12 : 0 }}>
            <CampoQuantita scritta={scritta} cambia={cambiaScritta} dimensione={ing.dimensione} pesoPz={ing.peso_pz} autoFocus />
          </div>
        )}
        <div className="campo">
          <span>Dove</span>
          <div className="scelte">
            {LUOGHI.map((l) => (
              <button type="button" key={l} aria-pressed={luogo === l} onClick={() => setLuogo(l)}>
                {NOME_LUOGO[l]}
              </button>
            ))}
          </div>
        </div>
        {consiglio && <p className="tenue">📍 Mettilo qui: {consiglio.posto.nome}{consiglio.inFondo ? ', in fondo' : ''}.</p>}
        {proposta && <p className="tenue">Scadenza automatica: {dataBreve(proposta.data_limite)}. Puoi cambiarla dopo.</p>}
        {errore && (
          <div className="avviso errore" role="alert">
            {errore}
          </div>
        )}
        <button type="submit" className="bottone primario pieno">
          Metti in casa
        </button>
      </form>
    </Foglio>
  );
}
