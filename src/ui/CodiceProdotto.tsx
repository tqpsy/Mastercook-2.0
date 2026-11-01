import { useEffect, useMemo, useState } from 'react';
import { useVista } from '../dati/contesto';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { type ProdottoEsterno, suggerisciIngrediente } from '../dominio/scontrini';
import type { UnitaBase } from '../dominio/unita';
import { CercaIngrediente } from './CercaIngrediente';
import { Foglio } from './Foglio';
import { chiediAOpenFoodFacts, cercaSuOpenFoodFacts } from './openFoodFacts';
import { FoglioSchedaProdotto } from './SchedaProdotto';
import { Scanner } from './Scanner';

/** Un codice a barre che la famiglia ha già associato a un ingrediente. */
export interface Prodotto {
  id: string;
  codice: string;
  ingrediente_id: string;
  nome: string | null;
  quantita: number | null;
  unita: UnitaBase | null;
}

export function useProdotti(): Map<string, Prodotto> {
  const righe = useVista().righe.prodotto;
  return useMemo(
    () =>
      new Map(
        (righe ?? [])
          .filter((p) => !p.eliminato_il)
          .map((p) => [String(p.codice), { ...(p as unknown as Prodotto), quantita: p.quantita == null ? null : Number(p.quantita) }]),
      ),
    [righe],
  );
}

export interface ProdottoScansionato {
  codice: string;
  ingrediente: Ingrediente;
  /** Presente se la famiglia aveva già associato questo codice. */
  prodotto?: Prodotto;
  /** Per un codice nuovo: nome e formato proposti da Open Food Facts, se li conosce. */
  esterno?: ProdottoEsterno;
}

/**
 * Scansiona un codice a barre. Se la famiglia lo conosce, dice subito cos'è; altrimenti chiede di
 * sceglierlo una volta (con il suggerimento di Open Food Facts, a cui va solo il numero del codice),
 * e chi chiama lo ricorda con `salva_prodotto`.
 */
export function ScansionaProdotto({ indice, trovato, chiudi }: { indice: Indice; trovato: (p: ProdottoScansionato) => void; chiudi: () => void }) {
  const prodotti = useProdotti();
  const [nuovo, setNuovo] = useState<string | null>(null);

  if (nuovo) return <CodiceNuovo indice={indice} codice={nuovo} trovato={trovato} chiudi={chiudi} />;
  return (
    <Scanner
      titolo="Scansiona il codice a barre"
      chiudi={chiudi}
      trovato={(codice) => {
        const p = prodotti.get(codice);
        // Valori e ingredienti si chiedono subito: quando si apre la scheda sono già pronti.
        void chiediAOpenFoodFacts(codice);
        const ingrediente = p ? indice.ingrediente(p.ingrediente_id) : undefined;
        if (p && ingrediente) trovato({ codice, ingrediente, prodotto: p });
        else setNuovo(codice);
      }}
    />
  );
}

function CodiceNuovo({ indice, codice, trovato, chiudi }: { indice: Indice; codice: string; trovato: (p: ProdottoScansionato) => void; chiudi: () => void }) {
  const [esterno, setEsterno] = useState<ProdottoEsterno | null | undefined>(undefined);
  const [dettagli, setDettagli] = useState(false);
  useEffect(() => {
    let attivo = true;
    void cercaSuOpenFoodFacts(codice).then((x) => attivo && setEsterno(x ?? null));
    return () => {
      attivo = false;
    };
  }, [codice]);
  const suggerito = esterno ? suggerisciIngrediente(esterno.nome, indice) : undefined;
  const scelto = (ingrediente: Ingrediente) => trovato({ codice, ingrediente, ...(esterno ? { esterno } : {}) });

  return (
    <Foglio titolo="Codice nuovo" chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Il codice {codice} non è ancora tra i vostri prodotti. Dimmi cos’è: dalla prossima volta lo riconosco.
      </p>
      {esterno === undefined ? (
        <p className="tenue" aria-live="polite">
          Cerco il prodotto su Open Food Facts…
        </p>
      ) : (
        <>
          {esterno && (
            <div className="avviso info">
              Open Food Facts: <strong>{esterno.nome}</strong>
              <button className="bottone piccolo" style={{ marginLeft: 8 }} onClick={() => setDettagli(true)}>
                <span aria-hidden>📋</span> Valori e ingredienti
              </button>
              {suggerito && (
                <button className="bottone primario pieno" style={{ marginTop: 8 }} onClick={() => scelto(suggerito)}>
                  È <span aria-hidden>{suggerito.emoji}</span> {suggerito.nome}
                </button>
              )}
            </div>
          )}
          <CercaIngrediente indice={indice} etichetta={suggerito ? 'Oppure cerca' : 'Cos’è?'} autoFocus={!suggerito} scegli={scelto} />
        </>
      )}
      {dettagli && <FoglioSchedaProdotto codice={codice} {...(esterno ? { nome: esterno.nome } : {})} chiudi={() => setDettagli(false)} />}
    </Foglio>
  );
}
