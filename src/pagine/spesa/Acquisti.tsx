import { type FormEvent, useState } from 'react';
import { useFamiglia } from '../../dati/contesto';
import type { Indice } from '../../dominio/ricette';
import { type Acquisto, type RigaAcquisto } from '../../dominio/spesa';
import { formattaEuro, formattaGiorno, leggiNumero } from '../../dominio/unita';
import { Foglio } from '../../ui/Foglio';

export function Acquisti({ indice, acquisti, righe, apri }: { indice: Indice; acquisti: Acquisto[]; righe: RigaAcquisto[]; apri: (id: string) => void }) {
  if (!acquisti.length) return null;
  return (
    <section className="scheda" aria-label="Acquisti recenti" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Acquisti recenti</h3>
      <ul className="elenco">
        {acquisti.slice(0, 10).map((a) => {
          const sue = righe.filter((r) => r.acquisto_id === a.id);
          const totale = sue.reduce((s, r) => s + (r.prezzo ?? 0), 0);
          const titolo = `${formattaGiorno(a.data)}${a.negozio ? ` · ${a.negozio}` : ''}`;
          return (
            <li key={a.id}>
              <button className="voce" onClick={() => apri(a.id)} aria-label={`Apri l’acquisto di ${titolo}`}>
                <span className="cresce">
                  <strong>{titolo}</strong>
                  <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
                    {[
                      sue.length === 1 ? '1 riga' : `${sue.length} righe`,
                      sue
                        .slice(0, 3)
                        .map((r) => (r.ingrediente_id ? indice.nome(r.ingrediente_id) : r.nome))
                        .join(', '),
                      totale > 0 && formattaEuro(totale),
                      a.in_attesa && 'in invio',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {a.stato === 'annullato' && <span className="etichetta">annullato</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SchedaAcquisto({ indice, acquisto: a, righe, chiudi }: { indice: Indice; acquisto: Acquisto; righe: RigaAcquisto[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const annullato = a.stato === 'annullato';
  return (
    <Foglio titolo={`Spesa di ${formattaGiorno(a.data)}`} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {[a.negozio, a.fonte === 'carrello' ? 'dal carrello' : a.fonte === 'scontrino' ? 'dallo scontrino' : 'registrata a mano', annullato && 'annullata: le quantità sono state tolte dalla casa'].filter(Boolean).join(' · ')}
      </p>
      <ul className="elenco">
        {righe.map((r) => (
          <RigaComprata key={r.id} indice={indice} riga={r} modificabile={!annullato} />
        ))}
      </ul>
      {!annullato && (
        <button
          className="bottone pericolo pieno"
          style={{ marginTop: 12 }}
          onClick={async () => {
            if (!window.confirm('Annullare questo acquisto? Le quantità verranno tolte dalla casa; la cronologia resta.')) return;
            await esegui('annulla_acquisto', { id: a.id });
            chiudi();
          }}
        >
          Annulla l’acquisto
        </button>
      )}
    </Foglio>
  );
}

function RigaComprata({ indice, riga: r, modificabile }: { indice: Indice; riga: RigaAcquisto; modificabile: boolean }) {
  const { esegui } = useFamiglia();
  const [numero, setNumero] = useState(r.quantita == null ? '' : String(r.quantita).replace('.', ','));
  const [euro, setEuro] = useState(r.prezzo == null ? '' : String(r.prezzo).replace('.', ','));
  const [errore, setErrore] = useState<string | null>(null);
  const nome = r.ingrediente_id ? indice.nome(r.ingrediente_id) : (r.nome ?? 'Voce');
  // Dallo scontrino senza quantità: la quantità si scrive in Casa › Da completare, qui si corregge solo il prezzo.
  const conQuantita = Boolean(r.ingrediente_id && r.quantita != null);
  const q = conQuantita ? leggiNumero(numero) : null;
  const p = euro.trim() ? leggiNumero(euro) : null;
  const cambiata = (conQuantita && q !== r.quantita) || p !== r.prezzo;

  async function salva(e: FormEvent) {
    e.preventDefault();
    if (conQuantita && (q === null || q <= 0)) return setErrore('Scrivi una quantità.');
    if (euro.trim() && p === null) return setErrore('Il prezzo non è un numero.');
    setErrore(null);
    await esegui('correggi_riga_acquisto', {
      id: r.id,
      ...(conQuantita && q !== r.quantita ? { quantita_vista: r.quantita, quantita_nuova: q } : {}),
      ...(p !== r.prezzo ? { prezzo: p } : {}),
    });
  }

  return (
    <li>
      <form onSubmit={salva} className="riga" style={{ flexWrap: 'wrap' }}>
        <strong className="cresce">{nome}</strong>
        {conQuantita && r.unita && (
          <label className="riga">
            <input className="dato" inputMode="decimal" aria-label={`Quantità di ${nome}`} value={numero} onChange={(e) => setNumero(e.target.value)} disabled={!modificabile} style={{ width: 90 }} />
            <span>{r.unita}</span>
          </label>
        )}
        <label className="riga">
          <input className="dato" inputMode="decimal" aria-label={`Prezzo di ${nome}`} value={euro} onChange={(e) => setEuro(e.target.value)} disabled={!modificabile} placeholder="€" style={{ width: 80 }} />
          <span>€</span>
        </label>
        {modificabile && cambiata && <button className="bottone primario piccolo">Correggi</button>}
      </form>
      {!r.ingrediente_id && <p className="tenue" style={{ margin: '4px 0 0' }}>Non è un alimento: non va in casa.</p>}
      {r.ingrediente_id && !conQuantita && <p className="tenue" style={{ margin: '4px 0 0' }}>Quantità da scrivere in Casa, alla voce «Da completare».</p>}
      {errore && <div className="avviso errore">{errore}</div>}
    </li>
  );
}
