/**
 * Piatto senza un ingrediente, nell'interfaccia: l'etichetta ✂️ sulle idee e sulle ricette trovate, il foglio
 * «per chi toglierlo» (solo per chi non può o per tutti) e l'avviso quando togliere non basta.
 * La logica sta in src/dominio/senza.ts.
 */
import { useState } from 'react';
import { ingredientiPiatto } from '../dominio/consumi';
import type { Persona } from '../dominio/menu';
import type { Indice, Ricetta } from '../dominio/ricette';
import { elencoNomi, quotaSenza, type Rimedio, type Senza, senzaDaScegliere, testoRimedio } from '../dominio/senza';
import { formatta } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { Sigla, sigleDi } from '../ui/Sigla';

const nomiInFila = (nomi: string[]) => (nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}` : (nomi[0] ?? ''));

/** L'etichetta gialla «✂️ Si fa senza panna per Sara». */
export function EtichettaRimedio({ indice, rimedio }: { indice: Indice; rimedio: Rimedio }) {
  return <span className="etichetta-taglio">✂️ {testoRimedio(indice, rimedio)}</span>;
}

/** «Senza panna per Sara · senza burro»: cosa è tolto da una portata, in breve. */
export function testoSenza(indice: Indice, senza: Senza[] | undefined, persone: { id: string; nome: string }[]): string {
  if (!senza?.length) return '';
  const perTutti = senza.filter((s) => s.membro_id === null).map((s) => s.ingrediente_id);
  const perChi = new Map<string, string[]>();
  for (const s of senza) {
    if (s.membro_id === null || perTutti.includes(s.ingrediente_id)) continue;
    const nome = persone.find((p) => p.id === s.membro_id)?.nome;
    if (nome) perChi.set(s.ingrediente_id, [...(perChi.get(s.ingrediente_id) ?? []), nome]);
  }
  // Raggruppa gli ingredienti tolti alle stesse persone: «senza panna e burro per Sara».
  const gruppi = new Map<string, string[]>();
  for (const [id, nomi] of perChi) gruppi.set(nomiInFila(nomi), [...(gruppi.get(nomiInFila(nomi)) ?? []), id]);
  return [
    ...(perTutti.length ? [`senza ${elencoNomi(indice, perTutti)}`] : []),
    ...[...gruppi].map(([chi, ids]) => `senza ${elencoNomi(indice, ids)} per ${chi}`),
  ].join(' · ');
}

/** Per ogni ingrediente tolto: l'etichetta da mostrare nella ricetta e quanta parte se ne usa. */
export function toltiDellaPortata(
  senza: Senza[] | undefined,
  persone: Persona[],
  fuori: Set<string>,
  porzioni: number,
): Map<string, { etichetta: string; quota: number; nomi: string[] }> {
  const tolti = new Map<string, { etichetta: string; quota: number; nomi: string[] }>();
  for (const s of senza ?? []) {
    if (tolti.has(s.ingrediente_id)) continue;
    const quota = quotaSenza(senza, s.ingrediente_id, persone, fuori, porzioni);
    const chi = (senza ?? []).filter((x) => x.ingrediente_id === s.ingrediente_id && x.membro_id).map((x) => persone.find((p) => p.id === x.membro_id)?.nome);
    const nomi = chi.filter((n): n is string => !!n);
    tolti.set(s.ingrediente_id, { etichetta: quota === 0 ? 'tolto per tutti' : `non per ${nomiInFila(nomi)}`, quota, nomi });
  }
  return tolti;
}

/**
 * Il foglio «per chi toglierlo»: chi non può mangiare il piatto e perché, cosa si toglie, e la scelta tra solo per
 * loro (la loro porzione si mette da parte prima) e per tutti. Mostra cosa cambia nella spesa e in casa.
 */
export function FoglioSenza({
  indice,
  ricetta,
  rimedio,
  persone,
  famiglia,
  porzioni,
  iniziale,
  bottone,
  conferma,
  chiudi,
}: {
  indice: Indice;
  ricetta: Ricetta;
  rimedio: Rimedio;
  /** Chi mangia il piatto (ospiti compresi, come una persona sola). */
  persone: Persona[];
  /** Gli id delle persone della famiglia: agli ospiti si toglie per tutti. */
  famiglia: Set<string>;
  porzioni: number;
  iniziale?: 'loro' | 'tutti';
  /** Il testo del bottone: «Aggiungi alla cena», «Salva»… */
  bottone: string;
  conferma: (senza: Senza[]) => void;
  chiudi: () => void;
}) {
  const soloOspiti = rimedio.perMembro.every((m) => !famiglia.has(m.membro_id));
  const [perTutti, setPerTutti] = useState(iniziale === 'tutti' || soloOspiti);
  const sigle = sigleDi(persone.filter((p) => famiglia.has(p.id)));
  const loro = rimedio.perMembro.filter((m) => famiglia.has(m.membro_id));
  const nomiLoro = nomiInFila(loro.map((m) => m.nome));
  const quantita = ingredientiPiatto(indice, ricetta, porzioni);
  const quanto = (id: string, quota = 1) => {
    const c = quantita.find((x) => x.ingrediente_id === id);
    return c ? formatta({ valore: Math.round(c.quantita * quota * 10) / 10, unita: c.unita }) : null;
  };
  const sceltaLoro = senzaDaScegliere(rimedio, false, famiglia);
  const fuori = new Set<string>();
  const nomiIngredienti = elencoNomi(indice, rimedio.togli);

  return (
    <Foglio titolo={ricetta.titolo} chiudi={chiudi}>
      <div className="avviso errore" role="note">
        {rimedio.perMembro.map((m) => (
          <div key={m.membro_id}>
            ⛔ <strong>{m.nome}</strong>: non può mangiare {elencoNomi(indice, m.togli)}
          </div>
        ))}
      </div>

      <h3 className="titoletto">Cosa togliere</h3>
      <ul className="elenco togli-ingredienti" aria-label="Cosa togliere">
        {rimedio.togli.map((id) => (
          <li key={id} className="riga">
            <span aria-hidden>✂️</span>
            <strong className="cresce">{indice.nome(id)}</strong>
            {quanto(id) && <span className="tenue">{quanto(id)}</span>}
          </li>
        ))}
      </ul>

      <h3 className="titoletto">Per chi</h3>
      <div className="scelte-senza" role="radiogroup" aria-label="Per chi toglierlo">
        {!soloOspiti && (
          <button type="button" role="radio" aria-checked={!perTutti} className="scelta-senza" onClick={() => setPerTutti(false)}>
            <strong>
              Solo per{' '}
              {loro.map((m) => (
                <span key={m.membro_id}>
                  <Sigla s={sigle.get(m.membro_id)} /> {m.nome}{' '}
                </span>
              ))}
            </strong>
            <span className="tenue piccolo">
              Prima di aggiungere {nomiIngredienti}, metti da parte la porzione di {nomiLoro}.
              <br />
              🛒 Spesa e casa:{' '}
              {rimedio.togli
                .map((id) => {
                  const q = quotaSenza(sceltaLoro, id, persone, fuori, porzioni);
                  return q === 0 ? `${indice.nome(id).toLowerCase()} non serve` : `${indice.nome(id).toLowerCase()} ${quanto(id, q) ?? ''} invece di ${quanto(id) ?? ''}`;
                })
                .join('; ')}
              .
            </span>
          </button>
        )}
        <button type="button" role="radio" aria-checked={perTutti} className="scelta-senza" onClick={() => setPerTutti(true)}>
          <strong>Per tutti</strong>
          <span className="tenue piccolo">
            Nessuno lo mette: un piatto solo, più semplice.
            <br />
            🛒 Spesa e casa: {nomiIngredienti} non {rimedio.togli.length > 1 ? 'servono' : 'serve'}.
          </span>
        </button>
      </div>
      {rimedio.perMembro.some((m) => m.dopo !== 'adatta') && (
        <p className="tenue piccolo">Anche senza, per qualcuno resta qualcosa da controllare (❔): lo vedi nel piatto.</p>
      )}
      <p className="tenue piccolo">Vale solo per questo pasto: la ricetta resta com’è.</p>
      <button type="button" className="bottone primario pieno" onClick={() => conferma(senzaDaScegliere(rimedio, perTutti, famiglia))}>
        ✓ {bottone}
      </button>
    </Foglio>
  );
}

/**
 * Togliere non basta (l'ingrediente principale, un allergene dichiarato, le uova crude): lo si dice, e si può
 * far mangiare altro a chi non può o aggiungerlo lo stesso.
 */
export function AvvisoNonSiToglie({
  rimedio,
  famiglia,
  mangiaAltro,
  aggiungiLoStesso,
}: {
  rimedio: Rimedio;
  famiglia: Set<string>;
  mangiaAltro: (chi: string[]) => void;
  aggiungiLoStesso: () => void;
}) {
  const bloccati = rimedio.perMembro.filter((m) => m.bloccato || m.dopo === 'non_adatta');
  const loro = bloccati.filter((m) => famiglia.has(m.membro_id));
  return (
    <div className="non-si-toglie">
      {bloccati.map((m) => (
        <p key={m.membro_id} className="avviso" style={{ margin: '0 0 8px' }}>
          ⚠️ <strong>{m.nome}</strong>: {m.bloccato ?? 'anche togliendo gli ingredienti resta non adatto'}. Non si può togliere.
        </p>
      ))}
      <div className="riga" style={{ gap: 8 }}>
        {loro.length > 0 && loro.length === bloccati.length && (
          <button type="button" className="bottone piccolo cresce" onClick={() => mangiaAltro(loro.map((m) => m.membro_id))}>
            🍽️ {nomiInFila(loro.map((m) => m.nome))} {loro.length > 1 ? 'mangiano' : 'mangia'} altro
          </button>
        )}
        <button type="button" className="bottone piccolo cresce" onClick={aggiungiLoStesso}>
          Aggiungi lo stesso ⛔
        </button>
      </div>
    </div>
  );
}
