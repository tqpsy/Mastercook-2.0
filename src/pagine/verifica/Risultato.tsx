import { useState } from 'react';
import { iconaIngrediente } from '../../dominio/iconeCibo';
import type { Indice, Ingrediente } from '../../dominio/ricette';
import { formatta, leggiNumero, type Scritta, scrittaVuota, totaleScritta, UNITA_BASE } from '../../dominio/unita';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { daGuardare, type Decisione, NOME_TIPO, type RigaVerifica, type TipoRiga, type ZonaVerifica } from '../../dominio/verifica';
import { CercaIngrediente } from '../../ui/CercaIngrediente';
import { IconaCibo } from '../../ui/IconaCibo';
import { NOME_CERTEZZA } from './Lettura';

export function Risultato({
  indice,
  righe,
  zone,
  completa,
  setCompleta,
  decisioni,
  decidi,
  correggi,
  spostati,
  sposta,
  avanti,
  rifai,
}: {
  indice: Indice;
  righe: RigaVerifica[];
  zone: ZonaVerifica[];
  completa: boolean;
  setCompleta: (x: boolean) => void;
  decisioni: Record<string, Decisione>;
  decidi: (chiave: string, d: Decisione | null) => void;
  correggi: (nomi: string[], ing: Ingrediente) => void;
  spostati: Record<string, string>;
  sposta: (chiave: string, posto: string | null) => void;
  avanti: () => void;
  rifai: () => void;
}) {
  const anomalie = daGuardare(righe);
  const mostrate = completa ? righe : anomalie;
  const gruppi = (Object.keys(NOME_TIPO) as TipoRiga[]).map((t) => ({ t, righe: mostrate.filter((r) => r.tipo === t) })).filter((g) => g.righe.length);
  const decise = new Set([...Object.keys(decisioni), ...Object.keys(spostati)].filter((k) => righe.some((r) => r.chiave === k))).size;
  return (
    <>
      <div className="scelte" role="radiogroup" aria-label="Verifica">
        <button type="button" aria-pressed={!completa} onClick={() => setCompleta(false)}>
          Rapida ({anomalie.length})
        </button>
        <button type="button" aria-pressed={completa} onClick={() => setCompleta(true)}>
          Completa ({righe.length})
        </button>
      </div>
      {!mostrate.length && <p>{righe.length ? 'Tutto torna: niente da controllare.' : 'Nelle foto non ho riconosciuto alimenti. Prova con più luce o più da vicino.'}</p>}
      {gruppi.map((g) => (
        <section key={g.t} aria-label={NOME_TIPO[g.t]}>
          <h3>
            {NOME_TIPO[g.t]} <span className="etichetta">{g.righe.length}</span>
          </h3>
          {g.t === 'non_visto' && <p className="tenue piccolo">Non visti nelle foto: potrebbero essere dietro ad altro. Dimmi tu.</p>}
          {g.t === 'posto' && <p className="tenue piccolo">Per l’igiene del frigo: spostali e dimmelo, aggiorno il posto in Casa.</p>}
          <ul className="elenco">
            {g.righe.map((r) => (
              <RigaVista
                key={r.chiave}
                indice={indice}
                r={r}
                zone={zone}
                decisione={decisioni[r.chiave] ?? null}
                decidi={(d) => decidi(r.chiave, d)}
                correggi={correggi}
                spostato={!!spostati[r.chiave]}
                sposta={(x) => sposta(r.chiave, x ? (r.avvisoPosto?.dove.id ?? null) : null)}
              />
            ))}
          </ul>
        </section>
      ))}
      <div className="riga barra-verifica">
        <button className="bottone" onClick={rifai}>
          Altre foto
        </button>
        <button className="bottone primario cresce" onClick={avanti}>
          Rivedi e conferma{decise ? ` (${decise})` : ''}
        </button>
      </div>
    </>
  );
}

function RigaVista({
  indice,
  r,
  zone,
  decisione,
  decidi,
  correggi,
  spostato,
  sposta,
}: {
  indice: Indice;
  r: RigaVerifica;
  zone: ZonaVerifica[];
  decisione: Decisione | null;
  decidi: (d: Decisione | null) => void;
  correggi: (nomi: string[], ing: Ingrediente) => void;
  spostato: boolean;
  sposta: (si: boolean) => void;
}) {
  const [apri, setApri] = useState<'quantita' | 'prodotto' | null>(null);
  const q = (v: number | null) => (v === null || !r.unita ? null : formatta({ valore: v, unita: r.unita }));
  const nome = r.ingrediente?.nome ?? `«${r.nomi[0]}»`;
  const zona = zone.find((z) => z.id === r.zona)?.nome;
  const scelto = (a: Decisione['azione']) => decisione?.azione === a;
  const tasto = (etichetta: string, d: Decisione) => (
    <button type="button" aria-pressed={scelto(d.azione) && (!('valore' in d) || (decisione as { valore?: number }).valore === d.valore)} onClick={() => decidi(scelto(d.azione) ? null : d)}>
      {etichetta}
    </button>
  );
  const nuovo = r.tipo === 'nuovo' || (r.tipo === 'incerto' && !r.lotti.length);

  let descrizione: string;
  if (r.tipo === 'non_visto') descrizione = `In casa ${q(r.inCasa)}${zona ? ` · di solito in ${zona.toLowerCase()}` : ''} · non l’ho visto`;
  else if (r.tipo === 'quantita') descrizione = `In casa ${q(r.inCasa)} · ne vedo ${q(r.visto)}`;
  else if (nuovo) descrizione = `${r.ingrediente ? 'Non è in casa' : 'Non so cos’è'} · ${q(r.visto) ? `ne vedo ${q(r.visto)}` : 'quantità da dire'}${zona ? ` · ${zona.toLowerCase()}` : ''}`;
  else descrizione = `In casa ${q(r.inCasa) ?? ''}${r.visto !== null ? ` · ne vedo ${q(r.visto)}` : ' · visto'}${r.altrove ? ` · registrato in ${r.altrove.toLowerCase()}` : ''}`;

  return (
    <li className="riga-verifica">
      <div className="riga spazio">
        <span>
          <IconaCibo valore={r.ingrediente ? iconaIngrediente(r.ingrediente) : '❓'} /> <strong>{nome}</strong>
          {r.tipo === 'incerto' && r.ingrediente && <span className="tenue"> ?</span>}
        </span>
        <span className="riga" style={{ gap: 4 }}>
          {r.menu && <span className="etichetta menu-verifica">menu</span>}
          {r.certezza && <span className={`etichetta certezza-${r.certezza}`}>{NOME_CERTEZZA[r.certezza]}</span>}
        </span>
      </div>
      <p className="tenue piccolo" style={{ margin: '4px 0 8px' }}>
        {descrizione}
        {r.tipo === 'incerto' && r.nomi.length > 0 && r.ingrediente && ` · visto come «${r.nomi.join('», «')}»`}
      </p>
      {r.avvisoPosto && (
        <div className={`avviso-posto${r.avvisoPosto.grave ? ' grave' : ''}`} role="note" aria-label={`Posto di ${nome}`}>
          <strong>
            {r.avvisoPosto.grave ? '⚠️ ' : ''}Va {r.avvisoPosto.dove.zona === 'cassetto' ? 'nel' : r.avvisoPosto.dove.zona === 'sportello' ? 'nel' : 'sul'} {r.avvisoPosto.dove.nome.toLowerCase()}.
          </strong>{' '}
          <span>{r.avvisoPosto.perche}</span>
          <div className="scelte piccole" style={{ marginTop: 8 }}>
            <button type="button" aria-pressed={spostato} onClick={() => sposta(!spostato)}>
              L’ho spostato
            </button>
            {r.tipo === 'posto' && tasto('Va bene così', { azione: 'presente' })}
          </div>
        </div>
      )}
      <div className="scelte piccole" role="group" aria-label={`Cosa fare con ${nome}`}>
        {r.tipo === 'non_visto' && (
          <>
            {tasto('C’è', { azione: 'presente' })}
            {tasto('Finito', { azione: 'terminato' })}
          </>
        )}
        {r.tipo === 'quantita' && (
          <>
            {r.visto !== null && tasto(`Sono ${q(r.visto)}`, { azione: 'quantita', valore: r.visto })}
            {tasto(`Restano ${q(r.inCasa)}`, { azione: 'presente' })}
            {tasto('Finito', { azione: 'terminato' })}
          </>
        )}
        {r.tipo === 'incerto' && r.ingrediente && (
          <button type="button" onClick={() => correggi(r.nomi, r.ingrediente!)}>
            Sì, è {r.ingrediente.nome.toLowerCase()}
          </button>
        )}
        {nuovo && r.ingrediente && r.tipo === 'nuovo' && r.visto !== null && tasto(`Aggiungi ${q(r.visto)}`, { azione: 'aggiungi', valore: r.visto })}
        {r.tipo === 'coerente' && r.lotti.length > 0 && tasto('Finito', { azione: 'terminato' })}
        {(r.lotti.length > 0 || (r.tipo === 'nuovo' && r.ingrediente)) && (
          <button type="button" aria-pressed={apri === 'quantita'} onClick={() => setApri(apri === 'quantita' ? null : 'quantita')}>
            Quantità…
          </button>
        )}
        {r.nomi.length > 0 && (
          <button type="button" aria-pressed={apri === 'prodotto'} onClick={() => setApri(apri === 'prodotto' ? null : 'prodotto')}>
            Altro prodotto…
          </button>
        )}
        {(nuovo || r.tipo === 'incerto') && tasto('Non c’è', { azione: 'non_c_e' })}
        {r.lotti.length > 0 && tasto('Non so', { azione: 'non_verificabile' })}
      </div>
      {apri === 'quantita' && (r.ingrediente || r.unita) && (
        <QuantitaVerifica
          ingrediente={r.ingrediente}
          iniziale={decisione && 'valore' in decisione ? decisione.valore : (r.visto ?? r.inCasa)}
          fatto={(v) => {
            decidi(r.lotti.length ? (v === 0 ? { azione: 'terminato' } : { azione: 'quantita', valore: v }) : { azione: 'aggiungi', valore: v });
            setApri(null);
          }}
        />
      )}
      {apri === 'prodotto' && (
        <CercaIngrediente
          indice={indice}
          etichetta="Che cos’è?"
          autoFocus
          iniziale={r.nomi[0] ?? ''}
          scegli={(i) => {
            correggi(r.nomi, i);
            setApri(null);
          }}
        />
      )}
      {decisione && <p className="piccolo decisione-verifica">✓ {testoDecisione(decisione, q)}</p>}
      {spostato && r.avvisoPosto && <p className="piccolo decisione-verifica">✓ Spostato: in Casa lo segno {r.avvisoPosto.dove.zona === 'ripiano' ? 'sul' : 'nel'} {r.avvisoPosto.dove.nome.toLowerCase()}</p>}
    </li>
  );
}

function testoDecisione(d: Decisione, q: (v: number | null) => string | null): string {
  switch (d.azione) {
    case 'presente':
      return 'C’è: resta com’è';
    case 'terminato':
      return 'Finito: lo tolgo dalla casa';
    case 'quantita':
      return `Ne restano ${q(d.valore)}`;
    case 'aggiungi':
      return `Lo metto in casa: ${q(d.valore)}`;
    case 'non_verificabile':
      return 'Non si può verificare: resta com’è';
    case 'non_c_e':
      return 'Non c’è: Gemini si è sbagliato, me lo ricordo';
  }
}

function QuantitaVerifica({ ingrediente, iniziale, fatto }: { ingrediente: Ingrediente | null; iniziale: number | null; fatto: (v: number) => void }) {
  const dimensione = ingrediente?.dimensione ?? 'pezzi';
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota(UNITA_BASE[dimensione], iniziale === null ? '' : String(iniziale).replace('.', ',')));
  const [errore, setErrore] = useState<string | null>(null);
  return (
    <form
      className="quantita-verifica"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (leggiNumero(scritta.numero) === 0) return fatto(0);
        const b = totaleScritta(scritta, dimensione, ingrediente?.peso_pz);
        if (!b.ok) return setErrore(b.motivo === 'confezioni_non_valide' ? 'Scrivi quante confezioni, per esempio 1 o 3.' : 'Scrivi un numero, per esempio 2 o 1,5.');
        fatto(b.quantita.valore);
      }}
    >
      <CampoQuantita
        scritta={scritta}
        cambia={(x) => setScritta((s) => ({ ...s, ...x }))}
        dimensione={dimensione}
        pesoPz={ingrediente?.peso_pz}
        etichetta="Quanto ce n’è"
        autoFocus
      />
      <button type="submit" className="bottone primario pieno">
        OK
      </button>
      {errore && (
        <p className="avviso errore" role="alert" style={{ width: '100%', margin: 0 }}>
          {errore}
        </p>
      )}
      <span className="tenue piccolo" style={{ width: '100%' }}>
        0 = finito.
      </span>
    </form>
  );
}
