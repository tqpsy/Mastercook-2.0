import { type ChangeEvent, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import { useFamiglia, useVista } from '../dati/contesto';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { normalizza } from '../dominio/ricette';
import { eFresco, giorniTra, type Luogo, oggi, stima } from '../dominio/scadenze';
import { abbinaRighe, leggiScontrino, quantitaProposta, type RigaDaAbbinare, type RigaLetta, suggerisciIngrediente, unisciDescrizioni } from '../dominio/scontrini';
import { formattaEuro, formattaGiorno, leggiNumero, type Unita, UNITA_BASE } from '../dominio/unita';
import { CampoQuantita } from '../ui/CampoQuantita';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { Foglio } from '../ui/Foglio';
import { leggiTestoDaFoto } from '../ui/ocr';
import { Scanner } from '../ui/Scanner';
import { quantitaDa } from './Casa';
import { useDatiSpesa } from './Spesa';

/** Cosa fare di una riga: dare il prezzo a una riga già confermata, metterla in casa, solo spesa, o niente. */
type Azione = `abbina:${string}` | 'casa' | 'altro' | 'ignora';

interface RigaInRevisione {
  id: string;
  descrizione: string;
  euro: string;
  azione: Azione;
  ing: Ingrediente | null;
  numero: string;
  unita: Unita;
  /** Quante confezioni (3 vasetti di yogurt): vuoto o «1» per una sola. */
  quante?: string;
  luogo: Luogo;
  cerca: boolean;
  /** Scelta dall'app e non toccata: se cambia la data si riabbina con la spesa di quel giorno. */
  auto?: boolean;
}

/** «pane», «pane e latte», «pane, latte e uova». */
function elencoNomi(nomi: string[]): string {
  const n = nomi.map((x) => x.toLowerCase());
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

const testoEuro = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','));

/** Le righe confermate dal carrello nei giorni vicini allo scontrino, ancora senza scontrino (lo scontrino ne aggiorna il prezzo). */
function useDaAbbinare(indice: Indice): (data: string) => RigaDaAbbinare[] {
  const vista = useVista();
  const { acquisti, righe } = useDatiSpesa(vista);
  const abbinate = new Set((vista.righe.scontrino_riga ?? []).filter((r) => !r.eliminato_il && r.acquisto_riga_id).map((r) => String(r.acquisto_riga_id)));
  return (data) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return [];
    const vicini = new Set(acquisti.filter((a) => a.stato === 'confermato' && a.fonte !== 'scontrino' && Math.abs(giorniTra(a.data, data)) <= 3).map((a) => a.id));
    return righe
      .filter((r) => vicini.has(r.acquisto_id) && !abbinate.has(r.id))
      .map((r) => ({ id: r.id, ingrediente_id: r.ingrediente_id, nome: r.ingrediente_id ? indice.nome(r.ingrediente_id) : (r.nome ?? 'Voce') }));
  };
}

/**
 * Uno scontrino: foto (letta sul telefono) o testo incollato, poi la revisione riga per riga.
 * Niente entra in casa o prende un prezzo finché non si preme «Importa».
 */
export function Scontrino({ indice, chiudi }: { indice: Indice; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const [testo, setTesto] = useState('');
  const [lettura, setLettura] = useState<number | null>(null);
  const [revisione, setRevisione] = useState(false);
  const [negozio, setNegozio] = useState('');
  const [data, setData] = useState(oggi());
  const [ora, setOra] = useState('');
  const [totale, setTotale] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [leggiQr, setLeggiQr] = useState(false);
  const [righe, setRighe] = useState<RigaInRevisione[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  /** Le righe che vanno in casa senza quantità: si possono scrivere ora o saltare e completarle dopo in Casa. */
  const [senzaQuantita, setSenzaQuantita] = useState<string[] | null>(null);
  const daAbbinare = useDaAbbinare(indice);
  const candidate = daAbbinare(data);

  async function foto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrore(null);
    setLettura(0);
    try {
      const letto = await leggiTestoDaFoto(file, setLettura);
      setTesto(letto);
      leggi(letto);
    } catch {
      setErrore('Non sono riuscito a leggere la foto (serve la rete la prima volta). Riprova o incolla il testo.');
    } finally {
      setLettura(null);
    }
  }

  function leggi(t = testo) {
    const s = leggiScontrino(t);
    if (!s.righe.length) return setErrore('Non ho trovato righe con un prezzo. Controlla il testo o rifai la foto, dritta e con buona luce.');
    setErrore(null);
    const giorno = s.data ?? data;
    setNegozio(s.negozio ?? '');
    setData(giorno);
    setOra(s.ora ?? '');
    setTotale(testoEuro(s.totale));
    setRighe(proposte(s.righe.map((r) => ({ id: crypto.randomUUID(), riga: r })), giorno));
    setRevisione(true);
  }

  /** Per ogni riga: il prezzo a una riga già spuntata o confermata (niente doppioni in casa), oppure in casa. */
  function proposte(lette: { id: string; riga: RigaLetta }[], giorno: string): RigaInRevisione[] {
    const abbinate = abbinaRighe(
      lette.map((x) => x.riga),
      daAbbinare(giorno),
      indice,
    );
    return lette.map(({ id, riga: r }, i) => {
      const ing = suggerisciIngrediente(r.descrizione, indice) ?? null;
      const q = ing ? quantitaProposta(r, ing) : null;
      return {
        id,
        descrizione: r.descrizione,
        euro: r.senzaPrezzo ? '' : testoEuro(r.prezzo),
        azione: abbinate[i] ? `abbina:${abbinate[i]}` : ing ? 'casa' : 'altro',
        ing,
        numero: q ? String(q.quantita).replace('.', ',') : '',
        // Senza quantità sullo scontrino, ciò che si conta (zucchine, mele) si propone a pezzi.
        unita: q?.unita ?? (ing ? (ing.dimensione !== 'pezzi' && ing.peso_pz ? 'pz' : UNITA_BASE[ing.dimensione]) : 'g'),
        luogo: ing?.luogo ?? 'dispensa',
        cerca: false,
        auto: true,
      };
    });
  }

  /** Cambiata la data, le righe non toccate si riabbinano con la spesa confermata in quei giorni. */
  function cambiaData(giorno: string) {
    setData(giorno);
    const auto = righe.filter((r) => r.auto);
    if (!auto.length) return;
    const nuove = new Map(
      proposte(
        auto.map((r) => ({ id: r.id, riga: { descrizione: r.descrizione, prezzo: leggiNumero(r.euro) ?? 0 } })),
        giorno,
      ).map((r) => [r.id, r]),
    );
    setRighe(righe.map((r) => {
      const n = nuove.get(r.id);
      // Quantità, unità e posto restano quelli già proposti o scritti; cambia solo dove va la riga.
      return n ? { ...r, azione: n.azione, ing: r.ing ?? n.ing } : r;
    }));
  }

  const cambia = (i: number, x: Partial<RigaInRevisione>) => {
    setSenzaQuantita(null);
    setRighe(righe.map((r, j) => (j === i ? { ...r, ...x, auto: r.auto && !('azione' in x || 'ing' in x) } : r)));
  };
  /** Righe già spuntate o confermate a mano che nessuna riga dello scontrino ha preso. */
  const giaInCasa = candidate.filter((c) => !righe.some((r) => r.azione === `abbina:${c.id}`));
  const nuoveInCasa = righe.filter((r) => r.azione === 'casa');
  const somma = Math.round(righe.filter((r) => r.azione !== 'ignora').reduce((s, r) => s + (leggiNumero(r.euro) ?? 0), 0) * 100) / 100;
  const tot = totale.trim() ? leggiNumero(totale) : null;
  const giaImportato = (vista.righe.scontrino ?? []).find(
    (s) =>
      !s.eliminato_il &&
      s.data === data &&
      (s.ora ?? '') === ora &&
      (s.totale == null ? null : Number(s.totale)) === tot &&
      normalizza(String(s.negozio ?? '')).replace(/ /g, '') === normalizza(negozio).replace(/ /g, ''),
  );

  async function importa(saltaQuantita = false) {
    setSenzaQuantita(null);
    const mancanti: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErrore('Scrivi la data dello scontrino.');
    if (ora && !/^[0-2]\d:[0-5]\d$/.test(ora)) return setErrore('L’ora si scrive come 18:30.');
    if (totale.trim() && tot === null) return setErrore('Il totale non è un numero.');
    const pronte: Record<string, unknown>[] = [];
    for (const r of righe) {
      const prezzo = r.euro.trim() ? leggiNumero(r.euro) : null;
      if (r.euro.trim() && prezzo === null) return setErrore(`Il prezzo di «${r.descrizione}» non è un numero.`);
      const base = { id: r.id, descrizione: r.descrizione.trim() || 'Riga', prezzo };
      if (r.azione.startsWith('abbina:')) {
        // Due righe sulla stessa riga già comprata (due confezioni passate una alla volta): una sola, con i prezzi sommati.
        const stessa = pronte.find((p) => p.abbina === r.azione.slice(7));
        if (stessa) {
          stessa.prezzo = prezzo == null ? stessa.prezzo : Math.round(((stessa.prezzo as number | null) ?? 0) * 100 + prezzo * 100) / 100;
          stessa.descrizione = unisciDescrizioni(String(stessa.descrizione), base.descrizione);
        } else pronte.push({ ...base, abbina: r.azione.slice(7) });
      }
      else if (r.azione === 'altro') pronte.push({ ...base, nuova: { id: crypto.randomUUID() } });
      else if (r.azione === 'ignora') pronte.push(base);
      else {
        if (!r.ing) return setErrore(`Scegli cos’è «${r.descrizione}», oppure segnalo come «solo spesa».`);
        if (!r.numero.trim()) {
          // Senza quantità la riga entra nello scontrino «da completare»: in casa arriva quando si scrive quanto (Casa).
          mancanti.push(r.ing.nome);
          pronte.push({ ...base, nuova: { id: crypto.randomUUID(), ingrediente_id: r.ing.id, luogo: r.luogo } });
          continue;
        }
        const q = quantitaDa({ numero: r.numero, unita: r.unita, quante: r.quante ?? '1' }, r.ing);
        if (typeof q === 'string') return setErrore(`${r.ing.nome}: ${q}`);
        const s = eFresco(r.ing) ? stima(r.ing, r.luogo, data) : null;
        pronte.push({
          ...base,
          nuova: {
            id: crypto.randomUUID(),
            lotto_id: crypto.randomUUID(),
            ingrediente_id: r.ing.id,
            quantita: q.valore,
            unita: q.unita,
            luogo: r.luogo,
            ...(s ? { data_limite: s.data_limite, tipo_data: 'stimata', fonte_data: 'app', calcolata_il: s.calcolata_il, affidabilita: 'bassa' } : { tipo_data: 'sconosciuta' }),
          },
        });
      }
    }
    if (!pronte.length) return setErrore('Non ci sono righe da importare.');
    setErrore(null);
    if (mancanti.length && !saltaQuantita) return setSenzaQuantita(mancanti);
    await esegui('importa_scontrino', {
      id: crypto.randomUUID(),
      acquisto_id: crypto.randomUUID(),
      negozio: negozio.trim() || null,
      data,
      ora: ora || null,
      totale: tot,
      qr,
      testo: testo.slice(0, 20000) || null,
      righe: pronte,
    });
    chiudi();
  }

  if (leggiQr) {
    return (
      <Scanner
        titolo="QR dello scontrino"
        qr
        chiudi={() => setLeggiQr(false)}
        trovato={(x) => {
          setQr(x);
          setLeggiQr(false);
        }}
      />
    );
  }

  if (!revisione) {
    return (
      <Foglio titolo="Aggiungi uno scontrino" chiudi={chiudi}>
        <p className="tenue" style={{ marginTop: 0 }}>
          Fotografa lo scontrino (dritto, intero, con buona luce) o scegli lo screenshot di quello digitale: lo leggo sul telefono e poi controlli tu ogni riga. Le righe già confermate dal carrello prendono solo il prezzo.
        </p>
        {lettura !== null ? (
          <div className="avviso info" aria-live="polite">
            Sto leggendo la foto… {Math.round(lettura * 100)}%
          </div>
        ) : (
          <>
            <label className="bottone primario pieno">
              <span aria-hidden>📷</span> Fotografa lo scontrino
              <input type="file" accept="image/*" capture="environment" onChange={foto} hidden />
            </label>
            {/* Lo scontrino digitale (Iper, Coop, Esselunga…) è uno screenshot o un'immagine già sul telefono. */}
            <label className="bottone pieno" style={{ marginTop: 8 }}>
              <span aria-hidden>🖼️</span> Scegli una foto o uno screenshot
              <input type="file" accept="image/*" onChange={foto} hidden />
            </label>
          </>
        )}
        <label className="campo" style={{ marginTop: 12 }}>
          <span>Oppure incolla il testo dello scontrino</span>
          <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={6} />
        </label>
        {errore && (
          <div className="avviso errore" role="alert">
            {errore}
          </div>
        )}
        <button className="bottone pieno" onClick={() => leggi()} disabled={!testo.trim() || lettura !== null}>
          Leggi le righe
        </button>
      </Foglio>
    );
  }

  return (
    <Foglio titolo="Controlla lo scontrino" chiudi={chiudi}>
      <div className="riga" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="campo cresce">
          <span>Negozio</span>
          <input value={negozio} onChange={(e) => setNegozio(e.target.value)} maxLength={80} />
        </label>
        <label className="campo">
          <span>Data</span>
          <input type="date" value={data} onChange={(e) => cambiaData(e.target.value)} />
        </label>
        <label className="campo">
          <span>Ora</span>
          <input value={ora} onChange={(e) => setOra(e.target.value)} placeholder="18:30" style={{ width: 80 }} />
        </label>
        <label className="campo">
          <span>Totale €</span>
          <input inputMode="decimal" value={totale} onChange={(e) => setTotale(e.target.value)} style={{ width: 90 }} />
        </label>
      </div>
      <p className="tenue" style={{ margin: '0 0 8px' }}>
        {qr ? 'QR letto: lo scontrino sarà riconosciuto se lo importi di nuovo. ' : ''}
        <button className="link" onClick={() => setLeggiQr(true)}>
          {qr ? 'Rileggi il QR' : 'Leggi il QR dello scontrino (facoltativo)'}
        </button>
      </p>
      {righe.some((r) => !r.euro.trim()) && (
        <div className="avviso attenzione">
          Di {righe.filter((r) => !r.euro.trim()).length} righe non sono riuscito a leggere il prezzo: scrivilo guardando lo scontrino.
        </div>
      )}
      {tot !== null && Math.abs(somma - tot) > 0.01 && (
        <div className="avviso attenzione">
          Le righe fanno {formattaEuro(somma)}, il totale è {formattaEuro(tot)}: controlla che non manchi niente.
        </div>
      )}
      {giaInCasa.length > 0 && nuoveInCasa.length > 0 && (
        <div className="avviso attenzione">
          Hai già messo in casa con le spunte {elencoNomi(giaInCasa.map((c) => c.nome))}. Se sono su questo scontrino, scegli «Prezzo a … già comprato» sulla riga giusta, così non entrano in casa due volte.
        </div>
      )}
      {giaImportato && <div className="avviso attenzione">Sembra uno scontrino già importato il {formattaGiorno(String(giaImportato.data))}: importarlo di nuovo non cambierà niente.</div>}

      <ul className="elenco" aria-label="Righe dello scontrino">
        {righe.map((r, i) => (
          <li key={r.id}>
            <div className="riga" style={{ flexWrap: 'wrap' }}>
              <input className="dato cresce" aria-label={`Descrizione della riga ${i + 1}`} value={r.descrizione} onChange={(e) => cambia(i, { descrizione: e.target.value })} maxLength={120} />
              <label className="riga">
                <input className="dato" inputMode="decimal" aria-label={`Prezzo di ${r.descrizione}`} value={r.euro} onChange={(e) => cambia(i, { euro: e.target.value })} style={{ width: 80 }} />
                <span>€</span>
              </label>
            </div>
            <select className="dato" aria-label={`Cosa fare di ${r.descrizione}`} value={r.azione} onChange={(e) => cambia(i, { azione: e.target.value as Azione })} style={{ marginTop: 6 }}>
              {candidate.map((c) => (
                <option key={c.id} value={`abbina:${c.id}`}>
                  Prezzo a «{c.nome}» già comprato
                </option>
              ))}
              <option value="casa">Entra in casa</option>
              <option value="altro">Solo spesa (non è cibo)</option>
              <option value="ignora">Ignora (sacchetto, riga sbagliata…)</option>
            </select>
            {r.azione === 'casa' &&
              (r.cerca || !r.ing ? (
                <CercaIngrediente
                  indice={indice}
                  etichetta={`Cos’è «${r.descrizione}»?`}
                  scegli={(ing) => cambia(i, { ing, cerca: false, unita: UNITA_BASE[ing.dimensione], luogo: ing.luogo })}
                />
              ) : (
                <div className="riga" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                  <button className="bottone piccolo" onClick={() => cambia(i, { cerca: true })} aria-label={`Cambia l’ingrediente di ${r.descrizione}`}>
                    <IconaCibo valore={iconaIngrediente(r.ing)} /> {r.ing.nome}
                  </button>
                  <CampoQuantita
                    compatto
                    nome={r.descrizione}
                    scritta={{ numero: r.numero, unita: r.unita, quante: r.quante ?? '1' }}
                    cambia={(x) => cambia(i, x)}
                    dimensione={r.ing.dimensione}
                    pesoPz={r.ing.peso_pz}
                  />
                  <select className="dato" aria-label={`Dove va ${r.descrizione}`} value={r.luogo} onChange={(e) => cambia(i, { luogo: e.target.value as Luogo })} style={{ width: 'auto' }}>
                    {LUOGHI.map((l) => (
                      <option key={l} value={l}>
                        {NOME_LUOGO[l]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
          </li>
        ))}
      </ul>
      <button
        className="bottone piccolo"
        style={{ marginTop: 8 }}
        onClick={() => setRighe([...righe, { id: crypto.randomUUID(), descrizione: '', euro: '', azione: 'altro', ing: null, numero: '', unita: 'g', luogo: 'dispensa', cerca: false }])}
      >
        + Riga mancante
      </button>
      {testo && (
        <details style={{ marginTop: 12 }}>
          <summary>Testo letto</summary>
          <pre className="testo-letto">{testo}</pre>
        </details>
      )}
      {errore && (
        <div className="avviso errore" role="alert">
          {errore}
        </div>
      )}
      {senzaQuantita ? (
        <div className="avviso attenzione" role="alert">
          <p style={{ margin: 0 }}>
            Manca la quantità di {elencoNomi(senzaQuantita)}. Scrivila qui sopra, oppure salta: lo scontrino entra lo stesso e la quantità la metti dopo in Casa, alla voce «Da completare».
          </p>
          <div className="riga" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <button className="bottone primario" onClick={() => importa(true)}>
              Salta, la metto dopo
            </button>
            <button className="bottone" onClick={() => setSenzaQuantita(null)}>
              La scrivo ora
            </button>
          </div>
        </div>
      ) : (
        <button className="bottone primario pieno" onClick={() => importa()}>
          Importa lo scontrino
        </button>
      )}
    </Foglio>
  );
}
