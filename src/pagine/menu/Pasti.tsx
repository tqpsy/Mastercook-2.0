/** Menu: quali pasti ha la famiglia (colazione, pranzo, cena…) e in che ordine. */
import { useState } from 'react';
import { useFamiglia } from '../../dati/contesto';
import type { CategoriaPasto } from '../../dominio/menu';
import { Foglio } from '../../ui/Foglio';

/** Quali pasti usa la famiglia: spuntino e merenda si accendono, altri si creano. */
export function Pasti({ categorie, chiudi }: { categorie: CategoriaPasto[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [nome, setNome] = useState('');
  const [emoji, setEmoji] = useState('🍽️');

  function accendi(c: CategoriaPasto, attiva: boolean) {
    if (c.standard) void esegui('imposta_categoria', { chiave: c.valore, attiva });
    else
      void esegui('modifica_categoria', {
        id: c.id,
        versione_attesa: c.versione,
        campi: { attiva },
      });
  }

  return (
    <Foglio titolo="Pasti della famiglia" chiudi={chiudi}>
      <ul className="elenco">
        {categorie.map((c) => (
          <li key={c.valore}>
            <label className="riga" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={c.attiva} onChange={(e) => accendi(c, e.target.checked)} />
              <span aria-hidden>{c.emoji}</span>
              <span className="cresce">{c.nome}</span>
            </label>
          </li>
        ))}
      </ul>
      <form
        className="campo"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!nome.trim()) return;
          await esegui('crea_categoria', {
            id: crypto.randomUUID(),
            nome: nome.trim(),
            emoji: emoji || null,
            ordine: 10 + categorie.length,
          });
          setNome('');
        }}
      >
        <span>Nuovo pasto</span>
        <div className="riga">
          <input aria-label="Emoji del pasto" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} style={{ width: 64 }} />
          <input aria-label="Nome del pasto" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} className="cresce" placeholder="Brunch, dopo-scuola…" required />
          <button className="bottone primario piccolo">Aggiungi</button>
        </div>
      </form>
      <p className="tenue">Un pasto spento sparisce dal calendario, ma i piatti già messi restano visibili.</p>
    </Foglio>
  );
}
