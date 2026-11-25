import { type ChangeEvent, useState } from 'react';
import { IconaCibo } from '../ui/IconaCibo';
import { iconaIngrediente } from '../dominio/iconeCibo';
import { LUOGHI, NOME_LUOGO } from '../catalogo/tipi';
import { useFamiglia, useVista } from '../dati/contesto';
import type { Indice } from '../dominio/ricette';
import { giorniTra, type Luogo, oggi } from '../dominio/scadenze';
import { type LetturaGeometrica, leggiLettura, leggiScontrino, type RigaDaAbbinare } from '../dominio/scontrini';
import { type Azione, costruisciImportazione, righeDaLettura, riabbina, type RigaInRevisione, rigaVuota, testoEuro } from '../dominio/importaScontrino';
import { formattaEuro, formattaGiorno, leggiNumero, UNITA_BASE } from '../dominio/unita';
import { confrontaLetture, type ControlloLettura } from '../dominio/doppiaLettura';
import { type ScontrinoNoto, trovaDoppione } from '../dominio/doppioni';
import { CampoQuantita } from '../ui/CampoQuantita';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { Foglio } from '../ui/Foglio';
import { leggiTestoDaFoto } from '../ui/ocr';
import { leggiTestoDaPdf } from '../ui/pdf';
import { Scanner } from '../ui/Scanner';
import { useDatiSpesa } from './Spesa';

/** «pane», «pane e latte», «pane, latte e uova». */
function elencoNomi(nomi: string[]): string {
  const n = nomi.map((x) => x.toLowerCase());
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

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
  /** Quanti prezzi la lettura ha corretto da sola perché il conto tornasse. */
  const [corretti, setCorretti] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [leggiQr, setLeggiQr] = useState(false);
  const [righe, setRighe] = useState<RigaInRevisione[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  /** Il confronto tra le due letture della foto (righe, campi e righe forse perse), o `null` se il testo è incollato. */
  const [controllo, setControllo] = useState<ControlloLettura | null>(null);
  const [daFoto, setDaFoto] = useState(false);
  /** La data è incerta (non letta, o le due letture non concordano): va confermata prima di importare. */
  const [dataIncerta, setDataIncerta] = useState<string | null>(null);
  const [dataConfermata, setDataConfermata] = useState(false);
  /** Di una foto: i campi che non si sono letti (ora, totale), da scrivere guardando lo scontrino. */
  const [nonLetti, setNonLetti] = useState<string[]>([]);
  /** Lo scontrino sembra uno già importato ma chi lo importa dice che è un altro. */
  const [altroScontrino, setAltroScontrino] = useState(false);
  /** Si sta importando: un secondo tocco non deve accodare un secondo comando. */
  const [importando, setImportando] = useState(false);
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
      const { testo: letto, controllo: secondo, righe } = await leggiTestoDaFoto(file, setLettura);
      setTesto(letto);
      leggi(letto, secondo, true, righe);
    } catch {
      setErrore('Non sono riuscito a leggere la foto (serve la rete la prima volta). Riprova o incolla il testo.');
    } finally {
      setLettura(null);
    }
  }

  /** Uno scontrino digitale salvato come PDF: il testo c'è già, si legge come se fosse incollato. */
  async function pdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrore(null);
    setLettura(0);
    try {
      const letto = await leggiTestoDaPdf(file);
      if (letto.replace(/\s/g, '').length < 20) return setErrore('Questo PDF non contiene testo (forse è una scansione). Fotografa lo scontrino o scegli uno screenshot.');
      setTesto(letto);
      leggi(letto);
    } catch {
      setErrore('Non sono riuscito a leggere il PDF. Riprova, oppure copia il testo dello scontrino e incollalo qui sotto.');
    } finally {
      setLettura(null);
    }
  }

  /** `righe`: le righe della foto con la fiducia della lettura (il loro testo è `t`): dicono anche quali righe sono incerte. */
  function leggi(t = testo, secondo: string | null = null, fotografata = false, righe: LetturaGeometrica | null = null) {
    const s = righe ? leggiLettura(righe) : leggiScontrino(t);
    if (!s.righe.length) return setErrore('Non ho trovato righe con un prezzo. Controlla il testo o rifai la foto, dritta e con buona luce.');
    setErrore(null);
    const giorno = s.data ?? data;
    setNegozio(s.negozio ?? '');
    setData(giorno);
    setOra(s.ora ?? '');
    setTotale(testoEuro(s.totale));
    setCorretti(s.corretti);
    // Una foto si legge due volte: dove le due letture non coincidono una delle due sbaglia, e una persona guarda la riga.
    const c = confrontaLetture(s, secondo ? leggiScontrino(secondo) : null);
    setControllo(c);
    setDaFoto(fotografata);
    setDataIncerta(fotografata ? (s.data === null ? 'Non ho letto la data: ho messo oggi.' : c.campi.data ? 'Le due letture della foto non coincidono sulla data.' : null) : null);
    setDataConfermata(false);
    setNonLetti(fotografata ? [s.ora === null ? 'l’ora' : '', s.totale === null ? 'il totale' : ''].filter(Boolean) : []);
    setAltroScontrino(false);
    setRighe(righeDaLettura(s, c, daAbbinare(giorno), indice, () => crypto.randomUUID()));
    setRevisione(true);
  }

  /** Cambiata la data, le righe non toccate si riabbinano con la spesa confermata in quei giorni. */
  function cambiaData(giorno: string) {
    setData(giorno);
    setRighe(riabbina(righe, daAbbinare(giorno), indice));
  }

  const cambia = (i: number, x: Partial<RigaInRevisione>) => {
    setSenzaQuantita(null);
    // Chi corregge il nome o il prezzo di una riga segnalata l'ha guardata.
    setRighe(righe.map((r, j) => (j === i ? { ...r, ...x, auto: r.auto && !('azione' in x || 'ing' in x), ...('euro' in x || 'descrizione' in x ? { controllata: true } : {}) } : r)));
  };
  /** Righe già spuntate o confermate a mano che nessuna riga dello scontrino ha preso. */
  const giaInCasa = candidate.filter((c) => !righe.some((r) => r.azione === `abbina:${c.id}`));
  const nuoveInCasa = righe.filter((r) => r.azione === 'casa');
  const daControllare = righe.filter((r) => r.dubbia && !r.controllata).length;
  const somma = Math.round(righe.filter((r) => r.azione !== 'ignora').reduce((s, r) => s + (leggiNumero(r.euro) ?? 0), 0) * 100) / 100;
  const tot = totale.trim() ? leggiNumero(totale) : null;
  // Gli scontrini già importati, con i nomi delle loro righe: serve a capire se questo è lo stesso letto un po' diverso.
  const nomiRighe = new Map<string, string[]>();
  for (const r of vista.righe.scontrino_riga ?? []) if (!r.eliminato_il) nomiRighe.set(String(r.scontrino_id), [...(nomiRighe.get(String(r.scontrino_id)) ?? []), String(r.descrizione ?? '')]);
  const noti: ScontrinoNoto[] = (vista.righe.scontrino ?? [])
    .filter((x) => !x.eliminato_il)
    .map((x) => ({ data: String(x.data), ora: x.ora ? String(x.ora) : null, totale: x.totale == null ? null : Number(x.totale), negozio: x.negozio ? String(x.negozio) : null, descrizioni: nomiRighe.get(String(x.id)) ?? [] }));
  const doppione = revisione ? trovaDoppione({ data, ora, totale: tot, negozio, descrizioni: righe.map((r) => r.descrizione) }, noti) : null;
  const sembraDoppio = doppione !== null && !doppione.esatto && !altroScontrino;
  /** Finché ci sono righe segnalate da controllare, una data incerta da confermare o un possibile doppione da escludere, non si importa. */
  const bloccato = daControllare > 0 || (dataIncerta !== null && !dataConfermata) || sembraDoppio;
  const motivoBlocco = [daControllare ? (daControllare === 1 ? 'la riga segnalata' : `le ${daControllare} righe segnalate`) : '', dataIncerta !== null && !dataConfermata ? 'la data' : '', sembraDoppio ? 'se è già stato importato' : ''].filter(Boolean).join(' e ');

  async function importa(saltaQuantita = false) {
    if (importando) return;
    setSenzaQuantita(null);
    if (bloccato) return setErrore(`Prima di importare controlla ${motivoBlocco}.`);
    const esito = costruisciImportazione({ negozio, data, ora, totale, qr, testo, righe }, () => crypto.randomUUID());
    if (esito.errore !== undefined) return setErrore(esito.errore);
    setErrore(null);
    if (esito.mancanti.length && !saltaQuantita) return setSenzaQuantita(esito.mancanti);
    setImportando(true);
    try {
      await esegui('importa_scontrino', esito.comando);
    } catch {
      setImportando(false);
      return setErrore('Non sono riuscito a importare lo scontrino. Riprova.');
    }
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
          Fotografa lo scontrino (dritto, intero, con buona luce), scegli lo screenshot di quello digitale o carica il suo PDF (il più preciso): lo leggo sul telefono e poi controlli tu ogni riga. Le righe già confermate dal carrello prendono solo il prezzo.
        </p>
        {lettura !== null ? (
          <div className="avviso info" aria-live="polite">
            Sto leggendo… {Math.round(lettura * 100)}%
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
            {/* Lo scontrino digitale come PDF (da Chrome: «Condividi › Stampa › Salva come PDF»): il testo c'è già, si legge senza errori. */}
            <label className="bottone pieno" style={{ marginTop: 8 }}>
              <span aria-hidden>📄</span> Carica un PDF
              <input type="file" accept="application/pdf" onChange={pdf} hidden />
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
          <input
            type="date"
            value={data}
            onChange={(e) => {
              cambiaData(e.target.value);
              setDataConfermata(!!e.target.value);
            }}
          />
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
      {corretti > 0 && (
        <div className="avviso">
          {corretti === 1 ? 'Un prezzo era letto male e l’ho corretto' : `${corretti} prezzi erano letti male e li ho corretti`} perché il conto tornasse con il totale. Controlla sullo scontrino.
        </div>
      )}
      {dataIncerta !== null && (
        <div className="avviso attenzione">
          <p style={{ margin: 0 }}>{dataIncerta} Guarda la data sullo scontrino: da lei dipendono le scadenze.</p>
          {!dataConfermata && (
            <button className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => setDataConfermata(true)}>
              La data è giusta
            </button>
          )}
        </div>
      )}
      {nonLetti.length > 0 && <div className="avviso info">Non ho letto {nonLetti.join(' e ')}: scrivilo guardando lo scontrino{nonLetti.includes('il totale') ? ' (serve anche a controllare che il conto torni)' : ''}.</div>}
      {controllo?.disponibile && (controllo.campi.ora || controllo.campi.totale) && (
        <div className="avviso attenzione">Le due letture della foto non coincidono su {[controllo.campi.ora ? 'ora' : '', controllo.campi.totale ? 'totale' : ''].filter(Boolean).join(' e ')}: controllali sullo scontrino.</div>
      )}
      {controllo?.disponibile && controllo.mancanti.length > 0 && (
        <div className="avviso attenzione">
          Rileggendo la foto ho trovato anche {controllo.mancanti.map((m) => `${m.descrizione} (${testoEuro(m.prezzo)} €)`).join(', ')}, che nella prima lettura non ci sono. Se sono sullo scontrino, aggiungile con «+ Riga mancante».
        </div>
      )}
      {daFoto && controllo && !controllo.disponibile && <div className="avviso info">Non sono riuscito a rileggere la foto per controllare la lettura: guarda ogni riga con attenzione.</div>}
      {daControllare > 0 && (
        <div className="avviso attenzione" role="status">
          {daControllare === 1 ? 'Una riga è segnalata' : `${daControllare} righe sono segnalate`} (bordo colorato): nome o prezzo possono essere sbagliati, il motivo è scritto sotto la riga. Guardale sullo scontrino e segna «Controllata», o correggile.
          {righe.length >= 6 && daControllare * 2 > righe.length && (
            <>
              {' '}
              Sono molte: le due letture non concordano. Se hai fatto una foto, può essere storta o poco nitida; se è uno screenshot, controlla le righe.
            </>
          )}
          {daControllare >= 4 && (
            <div className="riga" style={{ flexWrap: 'wrap', marginTop: 8 }}>
              <button className="bottone piccolo" onClick={() => setRighe(righe.map((r) => (r.dubbia ? { ...r, controllata: true } : r)))}>
                Le ho controllate tutte
              </button>
              {daFoto && (
                <button className="bottone piccolo" onClick={() => setRevisione(false)}>
                  Rifaccio la foto
                </button>
              )}
            </div>
          )}
        </div>
      )}
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
      {doppione?.esatto && <div className="avviso attenzione">Sembra uno scontrino già importato il {formattaGiorno(doppione.noto.data)}: importarlo di nuovo non cambierà niente.</div>}
      {doppione && !doppione.esatto && (
        <div className="avviso attenzione">
          <p style={{ margin: 0 }}>
            Sembra lo stesso scontrino già importato il {formattaGiorno(doppione.noto.data)}{doppione.noto.totale !== null ? ` (stesso totale, ${formattaEuro(doppione.noto.totale)})` : ''}, letto un po’ diverso. Se lo importi di nuovo le stesse cose entrano in casa due volte.
          </p>
          {!altroScontrino && (
            <button className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => setAltroScontrino(true)}>
              È un altro scontrino
            </button>
          )}
        </div>
      )}

      <ul className="elenco" aria-label="Righe dello scontrino">
        {righe.map((r, i) => (
          <li key={r.id} className={r.dubbia && !r.controllata ? 'dubbia' : undefined}>
            <div className="riga" style={{ flexWrap: 'wrap' }}>
              <input className="dato cresce" aria-label={`Descrizione della riga ${i + 1}`} value={r.descrizione} onChange={(e) => cambia(i, { descrizione: e.target.value })} maxLength={120} />
              <label className="riga">
                <input className="dato" inputMode="decimal" aria-label={`Prezzo di ${r.descrizione}`} value={r.euro} onChange={(e) => cambia(i, { euro: e.target.value })} style={{ width: 80 }} />
                <span>€</span>
              </label>
            </div>
            {r.dubbia && (
              <label className="riga dubbia-nota">
                <input type="checkbox" checked={!!r.controllata} onChange={(e) => cambia(i, { controllata: e.target.checked })} aria-label={`Ho controllato ${r.descrizione}`} />
                <span>{r.controllata ? 'Controllata' : `Da controllare: ${r.dubbia}.`}</span>
              </label>
            )}
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
        onClick={() => setRighe([...righe, rigaVuota(crypto.randomUUID())])}
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
        <>
          {bloccato && <p className="tenue">Prima di importare controlla {motivoBlocco}.</p>}
          <button className="bottone primario pieno" onClick={() => importa()} disabled={bloccato || importando}>
            Importa lo scontrino
          </button>
        </>
      )}
    </Foglio>
  );
}
