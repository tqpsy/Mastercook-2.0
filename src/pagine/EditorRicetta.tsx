import { type FormEvent, useState } from 'react';
import { CATEGORIE, type Categoria } from '../catalogo/tipi';
import { useFamiglia } from '../dati/contesto';
import type { Indice, Ingrediente, Ricetta, RigaRicetta } from '../dominio/ricette';
import { inBase, leggiNumero, UNITA, type Unita, UNITA_BASE, unitaPer } from '../dominio/unita';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { Foglio } from '../ui/Foglio';
import { Foto, riduciFoto } from '../ui/Foto';

export type Bozza = { tipo: 'nuova' } | { tipo: 'copia'; da: Ricetta } | { tipo: 'modifica'; ricetta: Ricetta };

interface RigaBozza {
  chiave: string;
  originale?: RigaRicetta;
  ingrediente_id: string;
  numero: string;
  unita: Unita;
  qb: boolean;
  opzionale: boolean;
  testo: string;
}

interface PassoBozza {
  chiave: string;
  originale?: { id: string; testo: string; ordine: number; versione?: number };
  testo: string;
}

const CAMPI = ['titolo', 'descrizione', 'categoria', 'cucina', 'provenienza', 'porzioni', 'minuti_totali', 'foto'] as const;

const numeroInTesto = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

function righeDa(r: Ricetta | undefined, copia: boolean): RigaBozza[] {
  return (r?.ingredienti ?? []).map((g) => ({
    chiave: crypto.randomUUID(),
    originale: copia ? undefined : g,
    ingrediente_id: g.ingrediente_id,
    numero: numeroInTesto(g.quantita),
    unita: g.unita,
    qb: g.qb,
    opzionale: g.opzionale,
    testo: g.testo ?? '',
  }));
}

/**
 * Scrive o cambia una ricetta della famiglia. Il salvataggio manda solo ciò che è cambiato, riga per
 * riga: due persone che correggono righe diverse della stessa ricetta non si pestano i piedi.
 */
export function EditorRicetta({ indice, bozza, chiudi }: { indice: Indice; bozza: Bozza; chiudi: (id?: string) => void }) {
  const { esegui, archivio, famiglia } = useFamiglia();
  const base = bozza.tipo === 'nuova' ? undefined : bozza.tipo === 'copia' ? bozza.da : bozza.ricetta;
  const copia = bozza.tipo !== 'modifica';
  const [titolo, setTitolo] = useState(bozza.tipo === 'copia' ? `${bozza.da.titolo} (mia versione)` : (base?.titolo ?? ''));
  const [descrizione, setDescrizione] = useState(base?.descrizione ?? '');
  const [categoria, setCategoria] = useState<Categoria | null>(base?.categoria ?? null);
  const [cucina, setCucina] = useState(base?.cucina ?? 'italiana');
  const [provenienza, setProvenienza] = useState(base?.provenienza ?? '');
  const [porzioni, setPorzioni] = useState(String(base?.porzioni ?? 4));
  const [minuti, setMinuti] = useState(base ? numeroInTesto(base.minuti_totali) : '');
  const [righe, setRighe] = useState<RigaBozza[]>(() => righeDa(base, copia));
  const [passi, setPassi] = useState<PassoBozza[]>(() =>
    base?.passi.length ? base.passi.map((p) => ({ chiave: crypto.randomUUID(), originale: copia ? undefined : p, testo: p.testo })) : [{ chiave: crypto.randomUUID(), testo: '' }],
  );
  const [foto, setFoto] = useState<{ percorso: string | null; file: Blob | null }>({ percorso: base?.foto ?? null, file: null });
  const [cerca, setCerca] = useState(false);
  const [errori, setErrori] = useState<string[]>([]);

  const cambiaRiga = (chiave: string, campi: Partial<RigaBozza>) => setRighe((rs) => rs.map((r) => (r.chiave === chiave ? { ...r, ...campi } : r)));
  const sposta = <T,>(xs: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const copiaXs = [...xs];
    [copiaXs[i], copiaXs[j]] = [copiaXs[j], copiaXs[i]];
    return copiaXs;
  };

  async function scegliFoto(f: File | undefined) {
    if (!f) return;
    // Una foto nuova non prende il posto di quella che c'è senza chiederlo.
    if ((foto.percorso || foto.file) && !window.confirm('Sostituire la foto attuale con quella nuova?')) return;
    try {
      setFoto({ percorso: `${famiglia}/${crypto.randomUUID()}.jpg`, file: await riduciFoto(f) });
    } catch {
      setErrori(['Questa immagine non si riesce a leggere: prova con un’altra.']);
    }
  }

  function aggiungiIngrediente(i: Ingrediente) {
    setRighe((rs) => [...rs, { chiave: crypto.randomUUID(), ingrediente_id: i.id, numero: '', unita: UNITA_BASE[i.dimensione], qb: false, opzionale: false, testo: '' }]);
    setCerca(false);
  }

  async function salva(e: FormEvent) {
    e.preventDefault();
    const problemi: string[] = [];
    if (!titolo.trim()) problemi.push('Manca il titolo.');
    if (!categoria) problemi.push('Scegli la categoria.');
    const nPorzioni = leggiNumero(porzioni);
    if (!nPorzioni || !Number.isInteger(nPorzioni) || nPorzioni < 1 || nPorzioni > 50) problemi.push('Le porzioni vanno da 1 a 50.');
    const nMinuti = minuti.trim() ? leggiNumero(minuti) : null;
    if (minuti.trim() && (!nMinuti || !Number.isInteger(nMinuti) || nMinuti > 5760)) problemi.push('Il tempo va scritto in minuti interi.');
    if (!righe.length) problemi.push('Aggiungi almeno un ingrediente.');

    const righeFinali = righe.map((r, ordine) => {
      const ing = indice.ingrediente(r.ingrediente_id);
      const nome = ing?.nome ?? 'ingrediente';
      let quantita: number | null = null;
      let unita = UNITA[r.unita].base;
      if (!r.qb) {
        const n = leggiNumero(r.numero);
        const esito = n === null ? null : inBase(n, r.unita, ing?.dimensione ?? 'massa');
        if (!esito || !esito.ok) problemi.push(esito && esito.motivo === 'unita_incompatibile' ? `${nome}: unità non adatta.` : `${nome}: scrivi la quantità oppure scegli «q.b.».`);
        else ({ valore: quantita, unita } = esito.quantita);
      }
      return { r, campi: { ingrediente_id: r.ingrediente_id, quantita, unita, qb: r.qb, opzionale: r.opzionale, testo: r.testo.trim() || null, ordine } };
    });
    const passiFinali = passi.map((p, ordine) => ({ p, campi: { testo: p.testo.trim(), ordine } })).filter((x) => x.campi.testo);
    if (!passiFinali.length) problemi.push('Scrivi almeno un passaggio.');
    setErrori(problemi);
    if (problemi.length) return;

    const scheda: Record<(typeof CAMPI)[number], unknown> = {
      titolo: titolo.trim(),
      descrizione: descrizione.trim() || null,
      categoria,
      cucina,
      provenienza: provenienza.trim() || null,
      porzioni: nPorzioni,
      minuti_totali: nMinuti,
      foto: foto.percorso,
    };
    // Il file resta sul dispositivo e parte prima del comando che lo cita (anche più tardi, senza rete).
    if (foto.file && foto.percorso) await archivio.foto.put({ percorso: foto.percorso, famiglia_id: famiglia, file: foto.file, caricata: false });

    const id = bozza.tipo === 'modifica' ? bozza.ricetta.id : crypto.randomUUID();
    const dati: Record<string, unknown> = { id };
    if (bozza.tipo === 'modifica') {
      const prima = bozza.ricetta as unknown as Record<string, unknown>;
      const campi = Object.fromEntries(CAMPI.filter((k) => !uguali(prima[k], scheda[k])).map((k) => [k, scheda[k]]));
      if (Object.keys(campi).length) Object.assign(dati, { versione_attesa: bozza.ricetta.versione, campi });
    } else {
      Object.assign(dati, { nuova: true, campi: { ...scheda, derivata_da: bozza.tipo === 'copia' ? bozza.da.id : null } });
    }

    const tenute = new Set(righeFinali.map((x) => x.r.originale?.id).filter(Boolean));
    dati.ingredienti = {
      aggiungi: righeFinali.filter((x) => !x.r.originale).map((x) => ({ id: crypto.randomUUID(), ...x.campi })),
      modifica: righeFinali.flatMap((x) => {
        const o = x.r.originale as unknown as Record<string, unknown> | undefined;
        if (!o) return [];
        const campi = Object.fromEntries(Object.entries(x.campi).filter(([k, v]) => !uguali(o[k], v)));
        return Object.keys(campi).length ? [{ id: o.id, versione_attesa: o.versione, campi }] : [];
      }),
      rimuovi: copia ? [] : (base?.ingredienti ?? []).filter((g) => !tenute.has(g.id)).map((g) => g.id),
    };
    const passiTenuti = new Set(passiFinali.map((x) => x.p.originale?.id).filter(Boolean));
    dati.passi = {
      aggiungi: passiFinali.filter((x) => !x.p.originale).map((x) => ({ id: crypto.randomUUID(), ...x.campi })),
      modifica: passiFinali.flatMap((x) => {
        const o = x.p.originale;
        if (!o) return [];
        const campi = Object.fromEntries(Object.entries(x.campi).filter(([k, v]) => !uguali((o as unknown as Record<string, unknown>)[k], v)));
        return Object.keys(campi).length ? [{ id: o.id, versione_attesa: o.versione, campi }] : [];
      }),
      rimuovi: copia ? [] : (base?.passi ?? []).filter((p) => !passiTenuti.has(p.id)).map((p) => p.id),
    };
    await esegui('salva_ricetta', dati);
    chiudi(id);
  }

  return (
    <Foglio titolo={bozza.tipo === 'modifica' ? 'Modifica ricetta' : 'Nuova ricetta'} chiudi={() => chiudi()}>
      <form onSubmit={salva} noValidate>
        <label className="campo">
          <span>Titolo</span>
          <input value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={120} required />
        </label>
        <div className="campo">
          <span>Categoria</span>
          <div className="scelte">
            {CATEGORIE.map((c) => (
              <button type="button" key={c.id} aria-pressed={categoria === c.id} onClick={() => setCategoria(c.id)}>
                {c.emoji} {c.nome}
              </button>
            ))}
          </div>
        </div>
        <div className="riga" style={{ alignItems: 'flex-end' }}>
          <label className="campo cresce">
            <span>Porzioni</span>
            <input inputMode="numeric" value={porzioni} onChange={(e) => setPorzioni(e.target.value)} />
          </label>
          <label className="campo cresce">
            <span>Minuti in tutto</span>
            <input inputMode="numeric" value={minuti} onChange={(e) => setMinuti(e.target.value)} placeholder="es. 30" />
          </label>
        </div>
        <label className="campo">
          <span>Cucina</span>
          <select value={cucina} onChange={(e) => setCucina(e.target.value)}>
            {indice.catalogo.cucine.map((c) => (
              <option key={c.id} value={c.id}>
                {c.bandiera} {c.nome}
              </option>
            ))}
          </select>
        </label>

        <div className="campo">
          <span>Foto</span>
          <Foto percorso={foto.percorso} file={foto.file} alt={`Foto di ${titolo}`} />
          <div className="riga">
            <label className="bottone">
              {foto.percorso ? 'Cambia foto' : 'Aggiungi foto'}
              <input type="file" accept="image/*" hidden onChange={(e) => (void scegliFoto(e.target.files?.[0]), (e.target.value = ''))} />
            </label>
            {foto.percorso && (
              <button type="button" className="bottone" onClick={() => window.confirm('Togliere la foto da questa ricetta?') && setFoto({ percorso: null, file: null })}>
                Togli foto
              </button>
            )}
          </div>
        </div>

        <h3>Ingredienti</h3>
        <ul className="elenco">
          {righe.map((r, i) => {
            const ing = indice.ingrediente(r.ingrediente_id);
            return (
              <li key={r.chiave}>
                <div className="riga spazio">
                  <strong>
                    {ing?.emoji} {ing?.nome ?? 'Ingrediente sconosciuto'}
                  </strong>
                  <span className="riga">
                    <button type="button" className="bottone piccolo" onClick={() => setRighe(sposta(righe, i, -1))} aria-label={`Sposta su ${ing?.nome}`} disabled={i === 0}>
                      ↑
                    </button>
                    <button type="button" className="bottone piccolo pericolo" onClick={() => setRighe(righe.filter((x) => x.chiave !== r.chiave))} aria-label={`Togli ${ing?.nome}`}>
                      ✕
                    </button>
                  </span>
                </div>
                <div className="riga" style={{ marginTop: 6 }}>
                  <input
                    aria-label={`Quantità di ${ing?.nome}`}
                    inputMode="decimal"
                    value={r.qb ? '' : r.numero}
                    disabled={r.qb}
                    placeholder={r.qb ? 'q.b.' : 'quantità'}
                    onChange={(e) => cambiaRiga(r.chiave, { numero: e.target.value })}
                    style={{ width: 110 }}
                  />
                  <select aria-label={`Unità di ${ing?.nome}`} value={r.unita} disabled={r.qb} onChange={(e) => cambiaRiga(r.chiave, { unita: e.target.value as Unita })}>
                    {unitaPer(ing?.dimensione ?? 'massa').map((u) => (
                      <option key={u} value={u}>
                        {UNITA[u].nome}
                      </option>
                    ))}
                  </select>
                  <label className="riga">
                    <input type="checkbox" checked={r.qb} onChange={(e) => cambiaRiga(r.chiave, { qb: e.target.checked })} /> q.b.
                  </label>
                  <label className="riga">
                    <input type="checkbox" checked={r.opzionale} onChange={(e) => cambiaRiga(r.chiave, { opzionale: e.target.checked })} /> facoltativo
                  </label>
                </div>
                <input
                  aria-label={`Nota per ${ing?.nome}`}
                  value={r.testo}
                  onChange={(e) => cambiaRiga(r.chiave, { testo: e.target.value })}
                  placeholder="Come appare nella ricetta (facoltativo): «2 uova grandi»"
                  maxLength={200}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </li>
            );
          })}
        </ul>
        {cerca ? (
          <CercaIngrediente indice={indice} scegli={aggiungiIngrediente} autoFocus />
        ) : (
          <button type="button" className="bottone pieno" onClick={() => setCerca(true)}>
            + Ingrediente
          </button>
        )}

        <h3>Preparazione</h3>
        {passi.map((p, i) => (
          <div key={p.chiave} className="riga" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
            <span style={{ paddingTop: 10 }}>{i + 1}.</span>
            <textarea
              aria-label={`Passaggio ${i + 1}`}
              className="cresce"
              rows={2}
              maxLength={2000}
              value={p.testo}
              onChange={(e) => setPassi(passi.map((x) => (x.chiave === p.chiave ? { ...x, testo: e.target.value } : x)))}
            />
            <button type="button" className="bottone piccolo pericolo" onClick={() => setPassi(passi.filter((x) => x.chiave !== p.chiave))} aria-label={`Togli il passaggio ${i + 1}`}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="bottone pieno" onClick={() => setPassi([...passi, { chiave: crypto.randomUUID(), testo: '' }])}>
          + Passaggio
        </button>

        <details style={{ marginTop: 12 }}>
          <summary>Descrizione e provenienza</summary>
          <label className="campo">
            <span>Descrizione</span>
            <textarea rows={3} maxLength={2000} value={descrizione} onChange={(e) => setDescrizione(e.target.value)} />
          </label>
          <label className="campo">
            <span>Provenienza</span>
            <input value={provenienza} maxLength={120} onChange={(e) => setProvenienza(e.target.value)} placeholder="es. ricetta della nonna, Toscana" />
          </label>
        </details>

        {errori.length > 0 && (
          <div className="avviso errore" role="alert">
            {errori.map((x) => (
              <div key={x}>{x}</div>
            ))}
          </div>
        )}
        <button type="submit" className="bottone primario pieno" style={{ marginTop: 12 }}>
          Salva ricetta
        </button>
      </form>
    </Foglio>
  );
}

function uguali(a: unknown, b: unknown): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (typeof a === 'number' || typeof b === 'number') return a !== null && b !== null && Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}
