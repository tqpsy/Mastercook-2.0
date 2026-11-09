import { type FormEvent, useState } from 'react';
import { useFamiglia } from '../../dati/contesto';
import type { Indice, Ingrediente } from '../../dominio/ricette';
import { type Osservazione, quantitaVoce, stimaPrezzo, type VoceSpesa } from '../../dominio/spesa';
import { formatta, formattaEuro, formattaGiorno, type Scritta, scrittaVuota, UNITA_BASE } from '../../dominio/unita';
import { CampoQuantita } from '../../ui/CampoQuantita';
import { CercaIngrediente } from '../../ui/CercaIngrediente';
import { Foglio } from '../../ui/Foglio';
import { quantitaDa } from '../Casa';
import { nomeVoce, perNegozio, quantitaNegozio } from '../Spesa';

/** Le voci per reparto del negozio, nell'ordine del catalogo; le voci senza ingrediente in fondo. */
export function raggruppa(indice: Indice, voci: VoceSpesa[]) {
  const altro = { id: 'altro', nome: 'Altro', emoji: '🛍️' };
  const gruppi = new Map<string, VoceSpesa[]>();
  for (const v of voci) {
    const r = (v.ingrediente_id && indice.ingrediente(v.ingrediente_id)?.reparto) || 'altro';
    gruppi.set(r, [...(gruppi.get(r) ?? []), v]);
  }
  const ordine = [...indice.catalogo.reparti.filter((r) => r.id !== 'altro'), altro];
  return ordine
    .filter((r) => gruppi.has(r.id))
    .map((r) => [r, (gruppi.get(r.id) ?? []).sort((a, b) => nomeVoce(indice, a).localeCompare(nomeVoce(indice, b)))] as const);
}

export function RigaVoce({ indice, voce: v, prezzi, apri }: { indice: Indice; voce: VoceSpesa; prezzi: Map<string, Osservazione[]>; apri: () => void }) {
  const { esegui } = useFamiglia();
  const nome = nomeVoce(indice, v);
  const nelCarrello = v.stato === 'nel_carrello';
  const prezzo = v.ingrediente_id ? stimaPrezzo(prezzi.get(v.ingrediente_id), quantitaVoce(v)) : null;
  const ing = v.ingrediente_id ? indice.ingrediente(v.ingrediente_id) : undefined;
  return (
    <li className="riga">
      <input
        type="checkbox"
        className="spunta"
        checked={nelCarrello}
        aria-label={nelCarrello ? `Togli ${nome} dal carrello` : `Metti ${nome} nel carrello`}
        onChange={() => esegui('imposta_stato_voce', { id: v.id, stato: nelCarrello ? 'da_acquistare' : 'nel_carrello' })}
      />
      <button className="voce cresce" onClick={apri} aria-label={`Apri ${nome}`}>
        <span aria-hidden>{ing?.emoji ?? '🛍️'}</span>
        <span className="cresce">
          <span style={nelCarrello ? { textDecoration: 'line-through' } : undefined}>{nome}</span>
          <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
            {[quantitaNegozio(v, perNegozio(indice, v.ingrediente_id)), v.tipo === 'manuale' && 'aggiunta a mano', v.nota, prezzo && `~${formattaEuro(prezzo.euro)}`, v.in_attesa && 'in invio'].filter(Boolean).join(' · ')}
          </span>
        </span>
        {v.non_piu_necessaria && <span className="etichetta avviso-data">non più necessaria</span>}
      </button>
    </li>
  );
}

export function NuovaVoce({ indice, chiudi }: { indice: Indice; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [ing, setIng] = useState<Ingrediente | null>(null);
  const [testo, setTesto] = useState<string | null>(null);
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota('g'));
  const cambiaScritta = (x: Partial<Scritta>) => setScritta((s) => ({ ...s, ...x }));
  const [errore, setErrore] = useState<string | null>(null);

  async function salva(e: FormEvent) {
    e.preventDefault();
    let q: { valore: number; unita: string } | null = null;
    if (scritta.numero.trim()) {
      const x = quantitaDa(scritta, ing ?? undefined);
      if (typeof x === 'string') return setErrore(x);
      q = x;
    }
    await esegui('aggiungi_voce', {
      id: crypto.randomUUID(),
      ingrediente_id: ing?.id ?? null,
      testo: ing ? null : testo,
      quantita: ing ? (q?.valore ?? null) : null,
      unita: ing ? (q?.unita ?? UNITA_BASE[ing.dimensione]) : null,
    });
    chiudi();
  }

  return (
    <Foglio titolo="Aggiungi alla lista" chiudi={chiudi}>
      {!ing && testo === null ? (
        <>
          <CercaIngrediente
            indice={indice}
            etichetta="Cosa serve?"
            autoFocus
            scegli={(i) => {
              setIng(i);
              cambiaScritta({ unita: UNITA_BASE[i.dimensione] });
            }}
          />
          <button className="bottone piccolo" onClick={() => setTesto('')}>
            ✏️ Scrivi qualcosa che non è un alimento
          </button>
        </>
      ) : (
        <form onSubmit={salva} noValidate>
          {ing ? (
            <>
              <div className="riga spazio">
                <strong>
                  {ing.emoji} {ing.nome}
                </strong>
                <button type="button" className="bottone piccolo" onClick={() => setIng(null)}>
                  Cambia
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <CampoQuantita scritta={scritta} cambia={cambiaScritta} dimensione={ing.dimensione} pesoPz={ing.peso_pz} etichetta="Quantità (facoltativa)" autoFocus />
              </div>
            </>
          ) : (
            <label className="campo">
              <span>Cosa</span>
              <input value={testo ?? ''} onChange={(e) => setTesto(e.target.value)} maxLength={120} placeholder="Detersivo, pile, tovaglioli…" autoFocus required />
            </label>
          )}
          {errore && <div className="avviso errore">{errore}</div>}
          <button className="bottone primario pieno" disabled={!ing && !testo?.trim()}>
            Aggiungi
          </button>
        </form>
      )}
    </Foglio>
  );
}

export function SchedaVoce({ indice, voce: v, prezzi, chiudi }: { indice: Indice; voce: VoceSpesa; prezzi: Map<string, Osservazione[]>; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const ing = v.ingrediente_id ? indice.ingrediente(v.ingrediente_id) : undefined;
  const [scritta, setScritta] = useState<Scritta>(() => scrittaVuota(v.unita ?? 'g', String(quantitaVoce(v) ?? '').replace('.', ',')));
  const cambiaScritta = (x: Partial<Scritta>) => setScritta((s) => ({ ...s, ...x }));
  const [nota, setNota] = useState(v.nota ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const prezzo = v.ingrediente_id ? stimaPrezzo(prezzi.get(v.ingrediente_id), quantitaVoce(v)) : null;

  async function salva(e: FormEvent) {
    e.preventDefault();
    const campi: Record<string, unknown> = {};
    if (ing && v.unita) {
      let n: number | null = null;
      if (scritta.numero.trim()) {
        const q = quantitaDa(scritta, ing);
        if (typeof q === 'string') return setErrore(q);
        n = q.valore;
      }
      if (n !== quantitaVoce(v)) campi[v.tipo === 'derivata' ? 'quantita_scelta' : 'quantita_richiesta'] = n;
    }
    if ((nota.trim() || null) !== v.nota) campi.nota = nota.trim() || null;
    if (Object.keys(campi).length) await esegui('modifica_voce', { id: v.id, versione_attesa: v.versione ?? 1, campi });
    chiudi();
  }

  return (
    <Foglio titolo={nomeVoce(indice, v)} chiudi={chiudi}>
      <p className="tenue" style={{ marginTop: 0 }}>
        {v.tipo === 'derivata' ? `Dal menu${v.quantita_richiesta != null && v.unita ? `: servono ${formatta({ valore: v.quantita_richiesta, unita: v.unita })}` : ''}` : 'Aggiunta a mano'}
        {prezzo && ` · circa ${formattaEuro(prezzo.euro)} (stima dai prezzi fino al ${formattaGiorno(prezzo.dal)})`}
      </p>
      {v.non_piu_necessaria && <div className="avviso info">Il menu è cambiato e questa voce non serve più. Puoi toglierla o tenerla.</div>}
      <form onSubmit={salva} noValidate>
        {ing && v.unita && <CampoQuantita scritta={scritta} cambia={cambiaScritta} dimensione={ing.dimensione} pesoPz={ing.peso_pz} />}
        <label className="campo">
          <span>Nota</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Marca, formato…" />
        </label>
        {errore && <div className="avviso errore">{errore}</div>}
        <button className="bottone primario pieno">Salva</button>
      </form>
      <button
        className="bottone pericolo pieno"
        style={{ marginTop: 8 }}
        onClick={async () => {
          await esegui('imposta_stato_voce', { id: v.id, stato: 'rimossa' });
          chiudi();
        }}
      >
        Togli dalla lista
      </button>
    </Foglio>
  );
}
