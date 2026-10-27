import { useMemo, useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import { dataLunga } from '../dominio/menu';
import { candidate, type ContestoProposte, proponi, RICETTE_PER_PASTO, tipoPiatto } from '../dominio/proposte';
import type { Indice, Ricetta } from '../dominio/ricette';
import { daUsarePresto, oggi, piuGiorni } from '../dominio/scadenze';
import { Foglio } from '../ui/Foglio';
import { useLotti } from './Casa';
import type { DatiMenu } from './Menu';

/** Cosa serve per proporre: chi mangia, vincoli, gusti, casa, e i piatti già in menu vicino a quei giorni. */
export function useContestoProposte(dati: DatiMenu, dal: string, al: string): ContestoProposte {
  const lotti = useLotti();
  return useMemo(() => {
    const giorno = oggi();
    return {
      persone: dati.persone,
      vincoli: dati.vincoli,
      verifiche: dati.verifiche,
      gusti: dati.gusti,
      inCasa: lotti.map((l) => l.ingrediente_id),
      urgenti: daUsarePresto(lotti, giorno).map((l) => l.ingrediente_id),
      recenti: dati.portate.filter((p) => p.ricetta_id && p.data >= piuGiorni(dal, -14) && p.data <= piuGiorni(al, 7)).map((p) => p.ricetta_id!),
    };
  }, [dati, lotti, dal, al]);
}

const SENZA_PROPOSTE_CON_DUBBI =
  'Nessuna ricetta è adatta a tutti senza dubbi. Apri le ricette con ❔ e segna «✅ Va bene» quelle che avete controllato: poi l’app potrà proporle.';

/**
 * Proponi la settimana: un piatto per ogni pasto vuoto da oggi in poi. Si guarda, si cambia con un tocco,
 * si tolgono quelle che non vanno; entra nel menu solo ciò che si conferma.
 */
export function ProponiSettimana({ indice, dati, giorni, chiudi }: { indice: Indice; dati: DatiMenu; giorni: string[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const da = giorni.filter((g) => g >= oggi());
  const contesto = useContestoProposte(dati, giorni[0], giorni[giorni.length - 1]);
  const pasti = dati.categorie.filter((c) => c.attiva && RICETTE_PER_PASTO[c.valore]);
  const proposte = useMemo(() => {
    const posti = da.flatMap((data) => pasti.filter((c) => !dati.portate.some((p) => p.data === data && p.categoria === c.valore)).map((c) => ({ data, categoria: c.valore })));
    return proponi(indice, posti, contesto);
  }, [indice, dati, contesto]); // eslint-disable-line react-hooks/exhaustive-deps
  const chiave = (p: { data: string; categoria: string }) => `${p.data}|${p.categoria}`;
  const [indici, setIndici] = useState<Record<string, number>>({});
  const [tolte, setTolte] = useState<Set<string>>(new Set());
  const scelta = (p: (typeof proposte)[number]): Ricetta => [p.ricetta, ...p.altre][indici[chiave(p)] ?? 0] ?? p.ricetta;
  const daMettere = proposte.filter((p) => !tolte.has(chiave(p)));

  async function conferma() {
    for (const p of daMettere) {
      const ordine = dati.portate.filter((x) => x.data === p.data && x.categoria === p.categoria).length;
      await esegui('aggiungi_portata', { id: crypto.randomUUID(), data: p.data, categoria: p.categoria, ricetta_id: scelta(p).id, ordine, origine: 'automatica' });
    }
    chiudi();
  }

  return (
    <Foglio titolo="Proposte per la settimana" chiudi={chiudi}>
      {proposte.length === 0 ? (
        <p className="tenue" style={{ marginTop: 0 }}>
          {!da.length
            ? 'Questa settimana è già passata.'
            : dati.vincoli.length && !candidate(indice, 'cena', contesto).length
              ? SENZA_PROPOSTE_CON_DUBBI
              : 'I pasti di questa settimana sono già tutti nel menu.'}
        </p>
      ) : (
        <>
          <p className="tenue" style={{ marginTop: 0 }}>
            Solo ricette adatte a tutti, senza ciò che a qualcuno non piace. Prima quelle che usano ciò che scade e ciò che avete in casa. Nulla entra nel menu finché non
            confermi.
          </p>
          <ul className="elenco" aria-label="Proposte">
            {proposte.map((p) => {
              const r = scelta(p);
              const k = chiave(p);
              const via = tolte.has(k);
              const nome = dati.categorie.find((c) => c.valore === p.categoria)?.nome ?? p.categoria;
              const motivi = (indici[k] ?? 0) === 0 ? p.motivi : [];
              return (
                <li key={k} className="riga" style={{ flexWrap: 'wrap', opacity: via ? 0.5 : 1 }}>
                  <label className="riga cresce" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={!via}
                      aria-label={`Metti ${r.titolo} a ${nome.toLowerCase()} di ${dataLunga(p.data)}`}
                      onChange={() =>
                        setTolte((t) => {
                          const n = new Set(t);
                          if (n.has(k)) n.delete(k);
                          else n.add(k);
                          return n;
                        })
                      }
                    />
                    <span>
                      <span className="tenue" style={{ display: 'block', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                        {dataLunga(p.data)} · {nome}
                      </span>
                      {r.titolo}
                      {motivi.length > 0 && (
                        <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
                          {motivi.join(' · ')}
                        </span>
                      )}
                    </span>
                  </label>
                  {p.altre.length > 0 && (
                    <button
                      className="bottone piccolo"
                      aria-label={`Un’altra per ${nome.toLowerCase()} di ${dataLunga(p.data)}`}
                      onClick={() => setIndici((x) => ({ ...x, [k]: ((x[k] ?? 0) + 1) % (p.altre.length + 1) }))}
                    >
                      ↻ Un’altra
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button className="bottone primario pieno" style={{ marginTop: 12 }} disabled={!daMettere.length} onClick={() => void conferma()}>
            Metti nel menu ({daMettere.length})
          </button>
        </>
      )}
    </Foglio>
  );
}

/** Tre idee per un pasto, quando si aggiunge un piatto: le stesse regole della settimana proposta. */
export function IdeePerPasto({ indice, dati, data, categoria, scegli }: { indice: Indice; dati: DatiMenu; data: string; categoria: string; scegli: (ricetta_id: string) => void }) {
  const contesto = useContestoProposte(dati, data, data);
  const tipi = useMemo(() => {
    const gia = dati.portate.filter((p) => p.data === data && p.ricetta_id).map((p) => p.ricetta_id!);
    return new Map([[data, gia.map((id) => indice.perId.get(id)).filter((r): r is Ricetta => !!r).map((r) => tipoPiatto(indice, r))]]);
  }, [indice, dati, data]);
  const idee = useMemo(() => {
    const [prima] = proponi(indice, [{ data, categoria }], contesto, tipi);
    return prima ? [prima.ricetta, ...prima.altre.slice(0, 2)] : [];
  }, [indice, data, categoria, contesto, tipi]);
  if (!idee.length) return null;
  return (
    <div className="campo">
      <span>Idee per questo pasto</span>
      <div className="riga" style={{ flexWrap: 'wrap' }} role="group" aria-label="Idee per questo pasto">
        {idee.map((r) => (
          <button key={r.id} className="bottone piccolo" onClick={() => scegli(r.id)}>
            ✨ {r.titolo}
          </button>
        ))}
      </div>
    </div>
  );
}
