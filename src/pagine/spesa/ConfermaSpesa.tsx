import { useState } from 'react';
import { LUOGHI, NOME_LUOGO } from '../../catalogo/tipi';
import { useFamiglia } from '../../dati/contesto';
import type { Indice } from '../../dominio/ricette';
import { type Luogo, oggi } from '../../dominio/scadenze';
import { type RigaDaConfermare, righeDaConfermare, type VoceSpesa } from '../../dominio/spesa';
import { leggiNumero, type Unita, UNITA_BASE } from '../../dominio/unita';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { CercaIngrediente } from '../../ui/CercaIngrediente';
import { Foglio } from '../../ui/Foglio';
import { quantitaDa } from '../Casa';

/** Conferma della spesa: due tocchi dal carrello («Conferma la spesa», poi «Conferma»). */
export function ConfermaSpesa({ indice, carrello, chiudi }: { indice: Indice; carrello: VoceSpesa[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const giorno = oggi();
  const [righe, setRighe] = useState<(RigaDaConfermare & { numero: string; euro: string; scelta?: Unita; quante?: string })[]>(() =>
    righeDaConfermare(carrello, (id) => indice.ingrediente(id), giorno, () => crypto.randomUUID()).map((r) => ({
      ...r,
      numero: r.quantita == null ? '' : String(r.quantita).replace('.', ','),
      euro: '',
    })),
  );
  const [negozio, setNegozio] = useState('');
  const [nuova, setNuova] = useState(false);
  const [nonPresi, setNonPresi] = useState<Set<string>>(() => new Set());
  // Una spunta appena data può arrivare un attimo dopo l'apertura: le voci entrate nel carrello si aggiungono.
  const mancanti = carrello.filter((v) => !nonPresi.has(v.id) && !righe.some((r) => r.voce_id === v.id));
  if (mancanti.length) {
    setRighe([
      ...righe,
      ...righeDaConfermare(mancanti, (id) => indice.ingrediente(id), giorno, () => crypto.randomUUID()).map((r) => ({
        ...r,
        numero: r.quantita == null ? '' : String(r.quantita).replace('.', ','),
        euro: '',
      })),
    ]);
  }
  const [errore, setErrore] = useState<string | null>(null);
  const cambia = (i: number, x: Partial<(typeof righe)[number]>) => setRighe(righe.map((r, j) => (j === i ? { ...r, ...x } : r)));

  async function conferma() {
    const pronte: Record<string, unknown>[] = [];
    for (const r of righe) {
      const nome = r.ingrediente_id ? indice.nome(r.ingrediente_id) : r.nome;
      const ing = r.ingrediente_id ? indice.ingrediente(r.ingrediente_id) : undefined;
      let quantita: number | null = null;
      let unita = r.unita;
      if (ing && r.unita) {
        // Scritta in kg o in pezzi: si salva in unità base (i pezzi di un ingrediente che si pesa diventano grammi).
        const q = quantitaDa({ numero: r.numero, unita: r.scelta ?? r.unita, quante: r.quante ?? '1' }, ing);
        if (typeof q === 'string') return setErrore(`Scrivi quanto ${nome} hai comprato.`);
        quantita = q.valore;
        unita = q.unita;
      } else if (r.ingrediente_id) {
        quantita = leggiNumero(r.numero);
        if (quantita === null || quantita <= 0) return setErrore(`Scrivi quanto ${nome} hai comprato.`);
      }
      const prezzo = r.euro.trim() ? leggiNumero(r.euro) : null;
      if (r.euro.trim() && prezzo === null) return setErrore(`Il prezzo di ${nome} non è un numero.`);
      const riga: Record<string, unknown> = { ...r, quantita, unita, prezzo };
      delete riga.numero;
      delete riga.euro;
      delete riga.scelta;
      delete riga.quante;
      pronte.push(riga);
    }
    if (!pronte.length) return setErrore('Non c’è niente da confermare.');
    await esegui('conferma_acquisto', {
      id: crypto.randomUUID(),
      fonte: righe.some((r) => r.voce_id) ? 'carrello' : 'manuale',
      data: giorno,
      negozio: negozio.trim() || null,
      righe: pronte,
    });
    chiudi();
  }

  return (
    <Foglio titolo="Conferma la spesa" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Controlla le quantità comprate. Il prezzo è facoltativo; le date di scadenza le puoi scrivere dopo, nella casa.
      </p>
      <ul className="elenco">
        {righe.map((r, i) => {
          const ing = r.ingrediente_id ? indice.ingrediente(r.ingrediente_id) : undefined;
          const nome = ing?.nome ?? r.nome ?? 'Voce';
          return (
            <li key={r.id}>
              <div className="riga spazio">
                <strong>
                  {ing?.emoji ?? '🛍️'} {nome}
                </strong>
                <button className="bottone piccolo" aria-label={`Non l’ho preso: ${nome}`} onClick={() => {
                    if (r.voce_id) setNonPresi(new Set([...nonPresi, r.voce_id]));
                    setRighe(righe.filter((_, j) => j !== i));
                  }}
                >
                  Non preso
                </button>
              </div>
              <div className="riga" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                {ing && r.unita && (
                  <CampoQuantita
                    compatto
                    nome={nome}
                    scritta={{ numero: r.numero, unita: r.scelta ?? r.unita, quante: r.quante ?? '1' }}
                    cambia={({ unita, ...x }) => cambia(i, unita ? { ...x, scelta: unita } : x)}
                    dimensione={ing.dimensione}
                    pesoPz={ing.peso_pz}
                  />
                )}
                <label className="riga">
                  <input className="dato" inputMode="decimal" aria-label={`Prezzo di ${nome}`} value={r.euro} onChange={(e) => cambia(i, { euro: e.target.value })} placeholder="€" style={{ width: 80 }} />
                  <span>€</span>
                </label>
                {ing && (
                  <select className="dato" aria-label={`Dove va ${nome}`} value={r.luogo} onChange={(e) => cambia(i, { luogo: e.target.value as Luogo })} style={{ width: 'auto' }}>
                    {LUOGHI.map((l) => (
                      <option key={l} value={l}>
                        {NOME_LUOGO[l]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {nuova ? (
        <CercaIngrediente
          indice={indice}
          etichetta="Cos’altro hai comprato?"
          autoFocus
          scegli={(ing) => {
            setRighe([
              ...righe,
              {
                ...righeDaConfermare(
                  [{ id: '', tipo: 'manuale', ingrediente_id: ing.id, testo: null, unita: UNITA_BASE[ing.dimensione], quantita_richiesta: null, quantita_scelta: null, stato: 'nel_carrello', non_piu_necessaria: false, nota: null }],
                  (id) => indice.ingrediente(id),
                  giorno,
                  () => crypto.randomUUID(),
                )[0],
                voce_id: null,
                numero: '',
                euro: '',
              },
            ]);
            setNuova(false);
          }}
        />
      ) : (
        <button className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => setNuova(true)}>
          + Altro comprato
        </button>
      )}
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Negozio (facoltativo)</span>
        <input value={negozio} onChange={(e) => setNegozio(e.target.value)} maxLength={80} />
      </label>
      {errore && <div className="avviso errore">{errore}</div>}
      <button className="bottone primario pieno" onClick={conferma}>
        Conferma
      </button>
    </Foglio>
  );
}
