import { type Dimensione, leggiNumero, leggiQuante, riepilogoScritta, type Scritta, UNITA, type Unita, unitaPer } from '../dominio/unita';

/**
 * Dove si scrive una quantità: quanto (g, kg, ml, l o pz) e quante confezioni o pezzi ne hai.
 * «3 vasetti di yogurt da 125 ml» = 125 · ml · 3, e sotto «= 375 ml». Con una confezione sola resta il
 * campo di sempre. `compatto`: tutto su una riga, per gli elenchi (conferma della spesa, scontrino, ricetta).
 */
export function CampoQuantita({
  scritta,
  cambia,
  dimensione,
  pesoPz,
  nome,
  etichetta = 'Quantità',
  compatto,
  autoFocus,
  disabilitato,
}: {
  scritta: Scritta;
  cambia: (x: Partial<Scritta>) => void;
  dimensione: Dimensione;
  pesoPz?: number | null;
  /** Il nome dell'ingrediente, per chi usa il lettore di schermo («Quantità di Yogurt»). */
  nome?: string;
  etichetta?: string;
  compatto?: boolean;
  autoFocus?: boolean;
  disabilitato?: boolean;
}) {
  const di = nome ? ` di ${nome}` : '';
  const quante = leggiQuante(scritta.quante) ?? 1;
  const piuDiUna = quante !== 1;
  const riepilogo = riepilogoScritta(scritta, dimensione, pesoPz);
  const unita = unitaPer(dimensione, pesoPz);
  const passo = (d: number) => {
    const n = leggiNumero(scritta.quante) ?? 1;
    cambia({ quante: String(Math.max(1, Math.floor(n) + d)) });
  };
  const sceltaUnita = (classe?: string) => (
    <select className={classe} aria-label={`Unità${di}`} value={scritta.unita} disabled={disabilitato} onChange={(e) => cambia({ unita: e.target.value as Unita })}>
      {(unita.includes(scritta.unita) ? unita : [scritta.unita, ...unita]).map((u) => (
        <option key={u} value={u}>
          {UNITA[u].nome}
        </option>
      ))}
    </select>
  );

  if (compatto) {
    return (
      <span className="riga campo-quantita compatto">
        <input
          className="dato"
          inputMode="decimal"
          aria-label={`${piuDiUna ? 'Quanto ne contiene una confezione' : etichetta}${di}`}
          value={scritta.numero}
          disabled={disabilitato}
          onChange={(e) => cambia({ numero: e.target.value })}
          autoFocus={autoFocus}
        />
        {sceltaUnita('dato')}
        <span aria-hidden>×</span>
        <input
          className="dato quante"
          inputMode="decimal"
          aria-label={`Quante confezioni${di}`}
          value={scritta.quante}
          disabled={disabilitato}
          onChange={(e) => cambia({ quante: e.target.value })}
          onFocus={(e) => e.target.select()}
        />
        {riepilogo && <span className="tenue">{riepilogo}</span>}
      </span>
    );
  }

  return (
    <div className="campo-quantita">
      <div className="riga" style={{ alignItems: 'flex-end' }}>
        <label className="campo cresce">
          <span>{piuDiUna ? 'Ognuna da' : etichetta}</span>
          <input inputMode="decimal" value={scritta.numero} disabled={disabilitato} onChange={(e) => cambia({ numero: e.target.value })} autoFocus={autoFocus} />
        </label>
        <label className="campo">
          <span>Unità</span>
          {sceltaUnita()}
        </label>
      </div>
      <div className="riga quante-confezioni">
        <span className="tenue cresce">Quante confezioni o pezzi</span>
        <span className="porzioni-contatore">
          <button type="button" className="bottone tondo" aria-label={`Una confezione in meno${di}`} disabled={disabilitato || quante <= 1} onClick={() => passo(-1)}>
            −
          </button>
          <input
            className="dato"
            inputMode="decimal"
            aria-label={`Quante confezioni${di}`}
            value={scritta.quante}
            disabled={disabilitato}
            onChange={(e) => cambia({ quante: e.target.value })}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="bottone tondo piu" aria-label={`Una confezione in più${di}`} disabled={disabilitato} onClick={() => passo(1)}>
            +
          </button>
        </span>
      </div>
      {riepilogo && <p className="tenue riepilogo-quantita">In tutto {riepilogo.startsWith('≈') ? 'circa ' : ''}{riepilogo.slice(2)}</p>}
    </div>
  );
}
