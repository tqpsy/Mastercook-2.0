import { useMemo, useState } from 'react';
import type { Vista } from '../dati/contesto';
import { type Indice, numeroONull } from '../dominio/ricette';
import { oggi } from '../dominio/scadenze';
import { type AcquistoConScontrino, ALTRO, DIFFERENZA, nomeMese, resocontoSpesa, type RigaScontrino, type Scontrino } from '../dominio/speso';
import type { RigaAcquisto } from '../dominio/spesa';
import { formattaEuro } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';


/** Il resoconto dai dati della vista (scontrini compresi). */
function useResoconto(vista: Vista, indice: Indice, acquisti: AcquistoConScontrino[], righe: RigaAcquisto[]) {
  const { scontrino, scontrino_riga } = vista.righe;
  return useMemo(() => {
    const r = { scontrino, scontrino_riga };
    const vive = (t: 'scontrino' | 'scontrino_riga') => (r[t] ?? []).filter((x) => !x.eliminato_il);
    const scontrini = vive('scontrino').map((s) => ({ id: String(s.id), data: String(s.data), totale: numeroONull(s.totale), acquisto_id: (s.acquisto_id as string | null) ?? null })) as Scontrino[];
    const righeScontrino = vive('scontrino_riga').map((s) => ({
      id: String(s.id),
      scontrino_id: String(s.scontrino_id),
      prezzo: numeroONull(s.prezzo),
      acquisto_riga_id: (s.acquisto_riga_id as string | null) ?? null,
    })) as RigaScontrino[];
    return resocontoSpesa({ acquisti, righe, scontrini, righeScontrino, repartoDi: (id) => indice.ingrediente(id)?.reparto, oggi: oggi() });
  }, [scontrino, scontrino_riga, indice, acquisti, righe]);
}

/** Confronto col mese prima, solo se quel mese ha spese registrate (prima dell'app non c'era niente). */
function differenza(adesso: number, prima: { euro: number; spese: number }) {
  if (!prima.spese) return null;
  const d = Math.round((adesso - prima.euro) * 100) / 100;
  if (!d) return 'come il mese scorso';
  return `${formattaEuro(Math.abs(d))} ${d > 0 ? 'in più' : 'in meno'} del mese scorso`;
}

function Barre({ mesi, scelto, scegli }: { mesi: { mese: string; euro: number }[]; scelto?: string; scegli?: (m: string) => void }) {
  const massimo = Math.max(...mesi.map((m) => m.euro), 1);
  return (
    <div className="speso-barre" role={scegli ? 'group' : undefined} aria-label="Spesa degli ultimi mesi">
      {mesi.map((m) => {
        const contenuto = (
          <>
            <span className="speso-colonna">
              <span className="speso-barra" style={{ height: `${Math.max((m.euro / massimo) * 100, m.euro ? 4 : 0)}%` }} />
            </span>
            <span className="speso-mese">{nomeMese(m.mese, true)}</span>
          </>
        );
        return scegli ? (
          <button
            key={m.mese}
            className={`speso-voce${m.mese === scelto ? ' attiva' : ''}`}
            onClick={() => scegli(m.mese)}
            aria-pressed={m.mese === scelto}
            aria-label={`${nomeMese(m.mese)}: ${formattaEuro(m.euro)}`}
          >
            {contenuto}
          </button>
        ) : (
          <span key={m.mese} className={`speso-voce${m.mese === scelto ? ' attiva' : ''}`} aria-hidden>
            {contenuto}
          </span>
        );
      })}
    </div>
  );
}

/** Riquadro «Quanto ho speso» in Spesa: totale del mese, confronto, ultimi 6 mesi; tocco = dettaglio per reparto. */
export function Speso({ vista, indice, acquisti, righe }: { vista: Vista; indice: Indice; acquisti: AcquistoConScontrino[]; righe: RigaAcquisto[] }) {
  const resoconto = useResoconto(vista, indice, acquisti, righe);
  const [aperto, setAperto] = useState(false);
  const { mesi } = resoconto;
  if (!mesi.some((m) => m.spese)) return null;
  const questo = mesi[mesi.length - 1];
  const confronto = differenza(questo.euro, mesi[mesi.length - 2]);
  return (
    <>
      <section className="scheda" aria-label="Quanto ho speso" style={{ marginTop: 16 }}>
        <button className="speso-riquadro" onClick={() => setAperto(true)} aria-label={`Quanto ho speso: ${nomeMese(questo.mese)} ${formattaEuro(questo.euro)}. Apri il dettaglio`}>
          <span className="cresce">
            <strong className="speso-titolo">Quanto ho speso</strong>
            <span className="speso-totale">{formattaEuro(questo.euro)}</span>
            <span className="tenue piccolo" style={{ display: 'block' }}>
              {[nomeMese(questo.mese), confronto].filter(Boolean).join(' · ')}
            </span>
          </span>
          <Barre mesi={mesi} scelto={questo.mese} />
        </button>
      </section>
      {aperto && <DettaglioSpeso indice={indice} resoconto={resoconto} chiudi={() => setAperto(false)} />}
    </>
  );
}

function DettaglioSpeso({ indice, resoconto, chiudi }: { indice: Indice; resoconto: ReturnType<typeof resocontoSpesa>; chiudi: () => void }) {
  const { mesi, reparti, senzaPrezzo } = resoconto;
  const [scelto, setScelto] = useState(mesi[mesi.length - 1].mese);
  const i = mesi.findIndex((m) => m.mese === scelto);
  const mese = mesi[i];
  const confronto = i > 0 ? differenza(mese.euro, mesi[i - 1]) : null;
  const nomi = new Map(indice.catalogo.reparti.map((r) => [r.id, r]));
  const voci = [...(reparti.get(scelto) ?? [])]
    .map(([id, euro]) => {
      const r = id === DIFFERENZA ? { nome: 'Sconti e righe senza tipo', emoji: '🧾' } : (nomi.get(id) ?? nomi.get(ALTRO) ?? { nome: 'Altro', emoji: '🛒' });
      return { id, euro, ...r };
    })
    .sort((a, b) => (a.id === DIFFERENZA ? 1 : b.id === DIFFERENZA ? -1 : b.euro - a.euro));
  const massimo = Math.max(...voci.map((v) => Math.abs(v.euro)), 1);
  const mancanti = senzaPrezzo.get(scelto) ?? 0;
  return (
    <Foglio titolo="Quanto ho speso" chiudi={chiudi} alto>
      <Barre mesi={mesi} scelto={scelto} scegli={setScelto} />
      <p style={{ margin: '12px 0 4px' }}>
        <span className="speso-totale">{formattaEuro(mese.euro)}</span>{' '}
        <span className="tenue">a {nomeMese(scelto)}</span>
      </p>
      <p className="tenue piccolo" style={{ marginTop: 0 }}>
        {[mese.spese === 1 ? '1 spesa' : `${mese.spese} spese`, confronto].filter(Boolean).join(' · ')}
      </p>
      {mancanti > 0 && (
        <div className="avviso info">
          {mancanti === 1 ? '1 cosa comprata non ha il prezzo' : `${mancanti} cose comprate non hanno il prezzo`}: il totale vero è un po’ più alto.
        </div>
      )}
      {voci.length > 0 && (
        <ul className="elenco speso-reparti" aria-label="Per tipo di cibo">
          {voci.map((v) => (
            <li key={v.id}>
              <span aria-hidden>{v.emoji}</span>
              <span className="cresce">
                {v.nome}
                <span className="speso-linea">
                  <span style={{ width: `${(Math.max(v.euro, 0) / massimo) * 100}%` }} />
                </span>
              </span>
              <strong>{formattaEuro(v.euro)}</strong>
            </li>
          ))}
        </ul>
      )}
      {!mese.spese && <p className="tenue">Nessuna spesa registrata in questo mese.</p>}
    </Foglio>
  );
}
