import { useMemo, useState } from 'react';
import { useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { GRUPPI, type Gruppo, memoriaDa, type MemoriaAntonino, type Obiettivo, REGOLE_BASE, regoleDa, regoleDaSalvare, type RegoleAntonino } from '../dominio/antonino';
import { oggi } from '../dominio/scadenze';
import faccia from '../ui/antonino.webp';

/** La faccia di Antonino, tonda. */
export function FacciaAntonino({ piccola }: { piccola?: boolean }) {
  return <img className={`antonino-faccia${piccola ? ' piccola' : ''}`} src={faccia} alt="" aria-hidden width={piccola ? 34 : 48} height={piccola ? 34 : 48} />;
}

/** Quello che Antonino dice, in un fumetto accanto alla sua faccia. */
export function Fumetto({ children, piccola }: { children: React.ReactNode; piccola?: boolean }) {
  return (
    <div className="antonino-dice">
      <FacciaAntonino piccola={piccola} />
      <div className="fumetto">{children}</div>
    </div>
  );
}

/** Le regole e la memoria di Antonino per la famiglia aperta. */
export function useAntonino(): { regole: RegoleAntonino; memoria: MemoriaAntonino } {
  const impostazioni = useVista().righe.famiglia?.find((r) => !r.eliminato_il)?.impostazioni as Record<string, unknown> | undefined;
  const chiave = JSON.stringify(impostazioni?.antonino ?? null);
  return useMemo(() => ({ regole: regoleDa(impostazioni), memoria: memoriaDa(impostazioni) }), [chiave]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Per insegnare ad Antonino: «l'avete scartata», «l'avete scelta», «non proporla più». */
export function useImpara() {
  const { esegui } = useFamiglia();
  return (evento: 'scartata' | 'scelta' | 'mai_piu' | 'riproponi' | 'dimentica', ricetta_id?: string) =>
    void esegui('antonino_impara', { evento, ...(ricetta_id ? { ricetta_id } : {}), data: oggi() });
}

function testoObiettivo(o: Obiettivo | undefined): string {
  if (!o || (o.min === undefined && o.max === undefined)) return 'libero';
  if (o.min !== undefined && o.max !== undefined) return o.min === o.max ? `${o.min} volte` : `da ${o.min} a ${o.max} volte`;
  if (o.min !== undefined) return `almeno ${o.min} ${o.min === 1 ? 'volta' : 'volte'}`;
  return o.max === 0 ? 'mai' : `al massimo ${o.max} ${o.max === 1 ? 'volta' : 'volte'}`;
}

/** Un numero da 0 a 14 con − e +; «–» vuol dire nessun limite. */
function Contatore({ etichetta, valore, cambia }: { etichetta: string; valore: number | undefined; cambia: (v: number | undefined) => void }) {
  return (
    <span className="passi-antonino" role="group" aria-label={etichetta}>
      <button type="button" className="bottone piccolo" aria-label={`${etichetta}: meno`} disabled={valore === undefined} onClick={() => cambia(valore === 0 ? undefined : valore! - 1)}>
        −
      </button>
      <span className="valore">{valore ?? '–'}</span>
      <button type="button" className="bottone piccolo" aria-label={`${etichetta}: più`} disabled={valore === 14} onClick={() => cambia(valore === undefined ? 0 : valore + 1)}>
        +
      </button>
    </span>
  );
}

/**
 * Impostazioni › Antonino: cosa sa e cosa ha imparato. Qui la famiglia gli «insegna» la settimana
 * (quante volte pesce, legumi, carne rossa…) e può riprendere i piatti che gli ha detto di non proporre più.
 */
export function AntoninoImpostazioni() {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const { regole, memoria } = useAntonino();
  const impara = useImpara();
  const [aperto, setAperto] = useState(false);
  const indice = useIndice(vista);
  const modificate = Object.keys(regoleDaSalvare(regole)).length > 0;
  const ricordi = memoria.scartate.size + memoria.scelte.size + memoria.maiPiu.size;

  function salva(nuove: RegoleAntonino) {
    const r = regoleDaSalvare(nuove);
    void esegui('antonino_regole', { regole: Object.keys(r).length ? r : null });
  }
  function cambia(g: Gruppo, campo: 'min' | 'max', v: number | undefined) {
    const o = { ...(regole.obiettivi[g] ?? {}) };
    if (v === undefined) delete o[campo];
    else o[campo] = v;
    if (campo === 'min' && v !== undefined && o.max !== undefined && o.max < v) o.max = v;
    if (campo === 'max' && v !== undefined && o.min !== undefined && o.min > v) o.min = v;
    salva({ ...regole, obiettivi: { ...regole.obiettivi, [g]: o } });
  }

  return (
    <>
      <h2>Antonino</h2>
      <div className="scheda antonino-impostazioni">
        <Fumetto>
          Sono Antonino: preparo il menu della settimana e vi consiglio cosa cucinare. Propongo solo piatti adatti a chi mangia; qui sotto potete insegnarmi come
          volete la settimana.
        </Fumetto>
        <button type="button" className="voce" aria-expanded={aperto} onClick={() => setAperto(!aperto)}>
          <span className="cresce">
            <strong>La settimana che preferite</strong>
            <span className="tenue" style={{ display: 'block' }}>
              {modificate ? 'Regole vostre' : 'Linee guida per una sana alimentazione'} · pranzi e cene
            </span>
          </span>
          <span aria-hidden>{aperto ? '▴' : '▾'}</span>
        </button>
        {aperto && (
          <>
            <ul className="elenco obiettivi-antonino" aria-label="Quante volte a settimana">
              {GRUPPI.filter((g) => g.id !== 'verdure').map((g) => {
                const o = regole.obiettivi[g.id];
                return (
                  <li key={g.id}>
                    <span className="cresce">
                      <span aria-hidden>{g.emoji}</span> <strong>{g.nome}</strong>
                      <span className="tenue" style={{ display: 'block' }}>
                        {testoObiettivo(o)}
                      </span>
                    </span>
                    <span className="limiti">
                      <span className="tenue piccolo">almeno</span>
                      <Contatore etichetta={`${g.nome}, almeno`} valore={o?.min} cambia={(v) => cambia(g.id, 'min', v)} />
                      <span className="tenue piccolo">al massimo</span>
                      <Contatore etichetta={`${g.nome}, al massimo`} valore={o?.max} cambia={(v) => cambia(g.id, 'max', v)} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <label className="riga" style={{ margin: '8px 0' }}>
              <input type="checkbox" checked={regole.verdureOgniGiorno} onChange={(e) => salva({ ...regole, verdureOgniGiorno: e.target.checked })} />
              <span>🥦 Verdure ogni giorno</span>
            </label>
            {modificate && (
              <button type="button" className="bottone piccolo" onClick={() => salva(REGOLE_BASE)}>
                Torna alle linee guida
              </button>
            )}
          </>
        )}
        {memoria.maiPiu.size > 0 && (
          <>
            <h3 className="titoletto" style={{ marginTop: 14 }}>
              Piatti che non propongo più
            </h3>
            <ul className="elenco" aria-label="Piatti che non propone più">
              {[...memoria.maiPiu].map((id) => (
                <li key={id} className="riga spazio">
                  <span>{indice?.perId.get(id)?.titolo ?? 'Ricetta tolta'}</span>
                  <button type="button" className="bottone piccolo" onClick={() => impara('riproponi', id)}>
                    Riproponila
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="tenue" style={{ marginBottom: 0 }}>
          {ricordi
            ? `Ricordo ${memoria.scelte.size} piatti che scegliete e ${memoria.scartate.size} che scartate: li propongo più o meno spesso.`
            : 'Quando scegliete o scartate un piatto che vi propongo, me lo ricordo.'}
        </p>
        {ricordi > 0 && (
          <button type="button" className="bottone piccolo" style={{ marginTop: 8 }} onClick={() => window.confirm('Antonino dimentica i piatti scelti, scartati e da non proporre più. Le regole della settimana restano.') && impara('dimentica')}>
            Dimentica cosa ho imparato
          </button>
        )}
      </div>
    </>
  );
}
