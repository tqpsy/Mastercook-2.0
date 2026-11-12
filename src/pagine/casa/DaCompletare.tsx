/** Casa: le righe dello scontrino entrate senza quantità, da completare. */
import { type FormEvent, useState } from 'react';
import { IconaCibo } from '../../ui/IconaCibo';
import { iconaIngrediente } from '../../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../../catalogo/tipi';
import { useFamiglia, useVista } from '../../dati/contesto';
import type { Indice, Ingrediente } from '../../dominio/ricette';
import { eFresco, giorniTra, type Luogo, oggi, stima } from '../../dominio/scadenze';
import { type Scritta, scrittaVuota, UNITA_BASE } from '../../dominio/unita';
import { confezioneDa } from '../../dominio/confezioni';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { LivelloScorta } from '../../ui/LivelloScorta';
import { type Livello, puoAOcchio } from '../../dominio/livello';
import { type ProdottoScansionato, useProdotti } from '../../ui/CodiceProdotto';
import { Scanner } from '../../ui/Scanner';
import { FotoData } from '../../ui/FotoData';
import { chiediAOpenFoodFacts } from '../../ui/openFoodFacts';
import { Foglio } from '../../ui/Foglio';
import { quantitaDa } from '../../dati/lotti';
import { dataBreve, schedaDelCodice, useConsiglioPosto } from './comuni';

interface RigaDaCompletare {
  id: string;
  ing: Ingrediente;
  data: string;
  negozio: string | null;
}

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
  // Codice a barre e foto della data: riempiono da soli la quantità e la scadenza.
  const prodotti = useProdotti();
  const [scansiona, setScansiona] = useState(false);
  const [codice, setCodice] = useState<ProdottoScansionato | null>(null);
  const [tipoData, setTipoData] = useState<'scadenza' | 'tmc' | null>(null);
  const [data, setData] = useState('');

  async function codiceLetto(c: string) {
    setScansiona(false);
    const p = prodotti.get(c);
    const esterno = p ? undefined : (await chiediAOpenFoodFacts(c))?.esterno;
    setCodice({ codice: c, ingrediente: ing, ...(p ? { prodotto: p } : {}), ...(esterno ? { esterno } : {}) });
    const formato = p?.quantita && p.unita ? { quantita: p.quantita, unita: p.unita } : esterno?.formato;
    if (formato && formato.unita === UNITA_BASE[ing.dimensione]) {
      setAOcchio(false);
      cambiaScritta({ numero: String(formato.quantita).replace('.', ','), unita: formato.unita, quante: '1' });
    }
  }

  async function salva(e: FormEvent) {
    e.preventDefault();
    const q = conOcchio ? null : quantitaDa(scritta, ing);
    if (typeof q === 'string') return setErrore(q);
    const confezione = q ? confezioneDa(scritta, ing.dimensione, ing.peso_pz) : null;
    if (tipoData && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErrore('Scrivi la data che c’è sulla confezione.');
    await esegui('completa_riga_acquisto', {
      id: riga.id,
      lotto_id: crypto.randomUUID(),
      ...(q ? { quantita: q.valore, unita: q.unita, ...(confezione ? { confezione } : {}) } : occhio),
      luogo,
      posto: consiglio?.posto.id ?? null,
      ...(tipoData
        ? { data_limite: data, tipo_data: tipoData, fonte_data: 'confezione' }
        : proposta
          ? { data_limite: proposta.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: proposta.calcolata_il, affidabilita: 'bassa' }
          : { tipo_data: 'sconosciuta' }),
    });
    // Il codice si ricorda con la quantità scritta, come in «Aggiungi in casa».
    if (codice && q && (!codice.prodotto || codice.prodotto.ingrediente_id !== ing.id || codice.prodotto.quantita !== (confezione ?? q.valore) || codice.prodotto.unita !== q.unita)) {
      const scheda = await schedaDelCodice(codice);
      await esegui('salva_prodotto', {
        id: crypto.randomUUID(),
        codice: codice.codice,
        ingrediente_id: ing.id,
        nome: codice.prodotto?.nome ?? codice.esterno?.nome ?? null,
        quantita: confezione ?? q.valore,
        unita: q.unita,
        ...(scheda ? { scheda } : {}),
      });
    }
    chiudi();
  }

  if (scansiona) return <Scanner titolo="Scansiona il codice a barre" chiudi={() => setScansiona(false)} trovato={(c) => void codiceLetto(c)} />;

  return (
    <Foglio titolo={`Quanto ${ing.nome.toLowerCase()}?`} chiudi={chiudi}>
      <form onSubmit={salva} noValidate>
        <button type="button" className="bottone pieno" onClick={() => setScansiona(true)}>
          <span aria-hidden>📷</span> Scansiona il codice a barre
        </button>
        {codice && (
          <p className="tenue" role="status">
            Codice {codice.codice}
            {codice.prodotto?.nome ?? codice.esterno?.nome ? `: ${codice.prodotto?.nome ?? codice.esterno?.nome}` : ''}. Controlla la quantità qui sotto.
          </p>
        )}
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
        <div className="campo">
          <span>Data sulla confezione</span>
          <div className="scelte">
            <button type="button" aria-pressed={tipoData === null} onClick={() => setTipoData(null)}>
              Non la so
            </button>
            <button type="button" aria-pressed={tipoData === 'scadenza'} onClick={() => setTipoData('scadenza')}>
              Da consumarsi entro
            </button>
            <button type="button" aria-pressed={tipoData === 'tmc'} onClick={() => setTipoData('tmc')}>
              Preferibilmente entro
            </button>
          </div>
          {tipoData && <input type="date" aria-label="Data" value={data} onChange={(e) => setData(e.target.value)} />}
          <FotoData
            letta={(d) => {
              setData(d.data);
              setTipoData(d.tipo ?? tipoData ?? 'scadenza');
            }}
          />
        </div>
        {!tipoData && proposta && <p className="tenue">Scadenza automatica: {dataBreve(proposta.data_limite)}. Puoi cambiarla dopo.</p>}
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
