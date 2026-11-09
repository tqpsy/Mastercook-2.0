import { useState } from 'react';
import { righeAttive, useFamiglia, type Vista } from '../../dati/contesto';
import type { Indice } from '../../dominio/ricette';
import { type VoceSpesa } from '../../dominio/spesa';
import { formattaGiorno, UNITA_BASE } from '../../dominio/unita';
import { ScansionaProdotto } from '../../ui/CodiceProdotto';

/** Quanti piatti del menu ci sono per giorno (gli avanzi non contano: non si comprano). */
export function piattiPerGiorno(vista: Vista): Map<string, number> {
  const conta = new Map<string, number>();
  for (const p of righeAttive(vista, 'portata')) {
    if (!p.ricetta_id || p.avanzo_di) continue;
    const g = String(p.data);
    conta.set(g, (conta.get(g) ?? 0) + 1);
  }
  return conta;
}

export function descriviGiorni(finestra: string[], scelti: string[]): string {
  if (scelti.length === finestra.length) return `Per il menu da ${formattaGiorno(finestra[0])} a ${formattaGiorno(finestra[finestra.length - 1])}`;
  const nomi = scelti.map((g) => formattaGiorno(g));
  return `Solo per ${nomi.length === 1 ? nomi[0] : `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`}`;
}

/**
 * Per quali giorni fare la spesa: anche con tutta la settimana nel menu si può comprare solo per i
 * prossimi giorni. La scelta vale per la famiglia; almeno un giorno resta sempre acceso.
 */
export function GiorniSpesa({ finestra, scelti, piatti, cambia }: { finestra: string[]; scelti: string[]; piatti: Map<string, number>; cambia: (giorni: string[]) => void }) {
  const fino = (n: number) => finestra.slice(0, n);
  const uguale = (a: string[]) => a.length === scelti.length && a.every((g) => scelti.includes(g));
  const preimpostati = [
    { nome: 'Oggi', giorni: fino(1) },
    { nome: '3 giorni', giorni: fino(3) },
    { nome: 'Settimana', giorni: finestra },
  ];
  const suMisura = !preimpostati.some((p) => uguale(p.giorni));
  // Un solo selettore; i giorni uno per uno stanno in «Personalizza» (aperto da sé se la scelta è su misura).
  const [personalizza, setPersonalizza] = useState(suMisura);
  return (
    <div className="giorni-spesa">
      <div className="scelte segmenti larghi" role="group" aria-label="Spesa per i giorni">
        {preimpostati.map((p) => (
          <button key={p.nome} aria-pressed={!personalizza && uguale(p.giorni)} onClick={() => (setPersonalizza(false), cambia(p.giorni))}>
            {p.nome}
          </button>
        ))}
        <button aria-pressed={personalizza || suMisura} onClick={() => setPersonalizza(!personalizza)}>
          Personalizza
        </button>
      </div>
      {(personalizza || suMisura) && (
      <div className="scelte giorni" role="group" aria-label="Giorni della spesa">
        {finestra.map((g, i) => {
          const acceso = scelti.includes(g);
          const n = piatti.get(g) ?? 0;
          const [nome, numero] = formattaGiorno(g).split(' ');
          return (
            <button
              key={g}
              aria-pressed={acceso}
              aria-label={`${formattaGiorno(g)}, ${n === 1 ? '1 piatto' : `${n} piatti`}`}
              disabled={acceso && scelti.length === 1}
              onClick={() => cambia(acceso ? scelti.filter((x) => x !== g) : [...scelti, g])}
            >
              <span>{i === 0 ? 'oggi' : nome}</span>
              <strong>{numero}</strong>
              <small aria-hidden>{n ? '•'.repeat(Math.min(n, 4)) : '—'}</small>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

/**
 * Un prodotto scansionato al supermercato va nel carrello: la voce della lista se c'è, altrimenti una
 * voce nuova. Un codice nuovo si ricorda per la famiglia, con la confezione se la si conosce già.
 */
export function NelCarrello({
  indice,
  voci,
  chiudi,
  messo,
}: {
  indice: Indice;
  voci: VoceSpesa[];
  chiudi: () => void;
  messo: (p: { codice: string; nome: string }) => void;
}) {
  const { esegui } = useFamiglia();
  return (
    <ScansionaProdotto
      indice={indice}
      chiudi={chiudi}
      trovato={async ({ codice, ingrediente, prodotto, esterno, scheda }) => {
        chiudi();
        messo({ codice, nome: prodotto?.nome ?? esterno?.nome ?? ingrediente.nome });
        if (!prodotto) {
          const f = esterno?.formato?.unita === UNITA_BASE[ingrediente.dimensione] ? esterno.formato : undefined;
          prodotto = { id: crypto.randomUUID(), codice, ingrediente_id: ingrediente.id, nome: esterno?.nome ?? null, quantita: f?.quantita ?? null, unita: f?.unita ?? null, ...(scheda ? { scheda } : {}) };
          await esegui('salva_prodotto', prodotto as unknown as Record<string, unknown>);
        }
        // Solo una voce nella stessa unità: 10 capsule non sono «caffè, 250 g».
        const voce = voci.find(
          (v) => v.stato === 'da_acquistare' && v.ingrediente_id && (v.unita == null || v.unita === UNITA_BASE[ingrediente.dimensione]) && indice.antenati(ingrediente.id).includes(v.ingrediente_id),
        );
        if (voce) return void (await esegui('imposta_stato_voce', { id: voce.id, stato: 'nel_carrello' }));
        const id = crypto.randomUUID();
        const formato = prodotto?.quantita && prodotto.unita ? { quantita: prodotto.quantita, unita: prodotto.unita } : {};
        await esegui('aggiungi_voce', { id, ingrediente_id: ingrediente.id, ...formato });
        await esegui('imposta_stato_voce', { id, stato: 'nel_carrello' });
      }}
    />
  );
}
