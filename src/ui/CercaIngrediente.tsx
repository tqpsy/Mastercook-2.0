import { useState } from 'react';
import { useFamiglia } from '../dati/contesto';
import type { Indice, Ingrediente } from '../dominio/ricette';
import { ALLERGENI_UE } from '../dominio/vincoli';
import type { Dimensione } from '../dominio/unita';

const DIMENSIONI: { id: Dimensione; nome: string }[] = [
  { id: 'massa', nome: 'Si pesa (g, kg)' },
  { id: 'volume', nome: 'Si misura (ml, l)' },
  { id: 'pezzi', nome: 'Si conta (pezzi)' },
];

/**
 * Cerca un ingrediente nel catalogo e in quelli della famiglia. Se non c'è, lo si aggiunge alla
 * famiglia: allergeni compresi, oppure «non lo so» (le ricette che lo usano saranno «da verificare»).
 */
export function CercaIngrediente({ indice, scegli, etichetta = 'Ingrediente', autoFocus }: { indice: Indice; scegli: (i: Ingrediente) => void; etichetta?: string; autoFocus?: boolean }) {
  const [testo, setTesto] = useState('');
  const [nuovo, setNuovo] = useState(false);
  const trovati = indice.cercaIngredienti(testo, 8);

  if (nuovo) return <NuovoIngrediente nome={testo.trim()} indice={indice} fatto={scegli} annulla={() => setNuovo(false)} />;

  return (
    <div className="campo">
      <label>
        <span>{etichetta}</span>
        <input value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Cerca: pomodori, latte, spaghetti…" autoFocus={autoFocus} />
      </label>
      {testo.trim() && (
        <ul className="elenco risultati" aria-label="Risultati">
          {trovati.map((i) => (
            <li key={i.id}>
              <button type="button" className="voce" onClick={() => scegli(i)}>
                <span aria-hidden>{i.emoji}</span> {i.nome}
                {!i.di_sistema && <span className="tenue"> · della famiglia</span>}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="voce" onClick={() => setNuovo(true)}>
              + Aggiungi «{testo.trim()}» come nuovo ingrediente
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function NuovoIngrediente({ nome: iniziale, indice, fatto, annulla }: { nome: string; indice: Indice; fatto: (i: Ingrediente) => void; annulla: () => void }) {
  const { esegui } = useFamiglia();
  const [nome, setNome] = useState(iniziale);
  const [dimensione, setDimensione] = useState<Dimensione | null>(null);
  const [reparto, setReparto] = useState('altro');
  const [allergeniNoti, setAllergeniNoti] = useState<boolean | null>(null);
  const [allergeni, setAllergeni] = useState<string[]>([]);

  async function salva() {
    if (!dimensione || allergeniNoti === null || !nome.trim()) return;
    const id = crypto.randomUUID();
    const dati = { id, nome: nome.trim(), dimensione, reparto, allergeni: allergeniNoti ? allergeni : [], allergeni_noti: allergeniNoti, emoji: '🛒' };
    await esegui('crea_ingrediente', dati);
    fatto({ ...dati, sinonimi: [], luogo: 'dispensa', giorni: null, classi: [], genitore: null, base: false, di_sistema: false, versione: 1, in_attesa: true });
  }

  return (
    <div className="scheda" style={{ background: 'var(--superficie-2)' }}>
      <h3>Nuovo ingrediente</h3>
      <label className="campo">
        <span>Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
      </label>
      <div className="campo">
        <span>Come si misura</span>
        <div className="scelte">
          {DIMENSIONI.map((d) => (
            <button type="button" key={d.id} aria-pressed={dimensione === d.id} onClick={() => setDimensione(d.id)}>
              {d.nome}
            </button>
          ))}
        </div>
      </div>
      <label className="campo">
        <span>Reparto</span>
        <select value={reparto} onChange={(e) => setReparto(e.target.value)}>
          {indice.catalogo.reparti.map((r) => (
            <option key={r.id} value={r.id}>
              {r.emoji} {r.nome}
            </option>
          ))}
        </select>
      </label>
      <div className="campo">
        <span>Allergeni</span>
        <div className="scelte">
          <button type="button" aria-pressed={allergeniNoti === false} onClick={() => setAllergeniNoti(false)}>
            Non lo so
          </button>
          <button type="button" aria-pressed={allergeniNoti === true} onClick={() => setAllergeniNoti(true)}>
            Li conosco
          </button>
        </div>
        {allergeniNoti === false && <p className="tenue">Le ricette che lo usano saranno segnate «da verificare» per chi ha allergie.</p>}
        {allergeniNoti && (
          <>
            <p className="tenue">Tocca quelli che contiene (nessuno se non ne contiene).</p>
            <div className="scelte">
              {ALLERGENI_UE.map((a) => {
                const codice = a.oggetto.slice(4);
                const dentro = allergeni.includes(codice);
                return (
                  <button type="button" key={codice} aria-pressed={dentro} onClick={() => setAllergeni((xs) => (dentro ? xs.filter((x) => x !== codice) : [...xs, codice]))}>
                    {a.nome}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="riga">
        <button type="button" className="bottone" onClick={annulla}>
          Indietro
        </button>
        <button type="button" className="bottone primario cresce" disabled={!dimensione || allergeniNoti === null || !nome.trim()} onClick={salva}>
          Aggiungi ingrediente
        </button>
      </div>
    </div>
  );
}
