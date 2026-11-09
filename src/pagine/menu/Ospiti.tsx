import { useState } from 'react';
import { idDispositivo, useFamiglia } from '../../dati/contesto';
import { type CategoriaPasto, dataLunga, type OspitiPasto, ospitiDel, PORZIONE_BAMBINO } from '../../dominio/menu';
import { ALLERGENI_UE, ESIGENZE, INTOLLERANZE, type VoceVincolo } from '../../dominio/vincoli';
import { oggi } from '../../dominio/scadenze';
import { Foglio } from '../../ui/Foglio';
import { type DatiMenu } from './dati';
import { nomeCategoria } from './Piatto';

export function contaOspiti(o: Pick<OspitiPasto, 'adulti' | 'bambini'>) {
  const parti = [];
  if (o.adulti) parti.push(o.adulti === 1 ? '1 adulto' : `${o.adulti} adulti`);
  if (o.bambini) parti.push(o.bambini === 1 ? '1 bambino' : `${o.bambini} bambini`);
  return parti.join(' e ');
}

/** Nel calendario, solo se a quel pasto ci sono ospiti. */
export function EtichettaOspiti({ ospiti, apri }: { ospiti?: OspitiPasto; apri: () => void }) {
  if (!ospiti) return null;
  return (
    <button className="etichetta" onClick={apri} aria-label={`Ospiti: ${contaOspiti(ospiti)}`}>
      👥 {ospiti.adulti + ospiti.bambini}
      {ospiti.oggetti.length > 0 && ' ⚠️'}
      {ospiti.in_attesa && ' · in invio'}
    </button>
  );
}

export function BottoneOspiti({ ospiti, apri }: { ospiti?: OspitiPasto; apri: () => void }) {
  return (
    <button className="bottone piccolo" onClick={apri}>
      👥 {ospiti ? `Ospiti: ${contaOspiti(ospiti)}` : 'Ci sono ospiti?'}
    </button>
  );
}

export const GRUPPI_OSPITI: { nome: string; voci: VoceVincolo[] }[] = [
  { nome: 'Allergie', voci: ALLERGENI_UE },
  { nome: 'Intolleranze', voci: INTOLLERANZE },
  { nome: 'Esigenze', voci: ESIGENZE },
];

/**
 * Ospiti a un pasto: quanti adulti e bambini e cosa non possono mangiare. Niente nomi; le esigenze
 * si dimenticano appena il pasto è passato, restano solo i numeri per spesa e consumi.
 */
export function SchedaOspiti({ dati, data, categoria, chiudi }: { dati: DatiMenu; data: string; categoria: string; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const attuali = ospitiDel(dati.ospiti, data, categoria);
  const [adulti, setAdulti] = useState(attuali?.adulti ?? 1);
  const [bambini, setBambini] = useState(attuali?.bambini ?? 0);
  const [oggetti, setOggetti] = useState<string[]>(attuali?.oggetti ?? []);
  const passato = data < oggi();

  async function salva(a: number, b: number) {
    await esegui('imposta_ospiti', {
      data,
      categoria,
      adulti: a,
      bambini: b,
      oggetti: passato ? [] : oggetti,
      ...(attuali && !attuali.in_attesa ? { versione_attesa: attuali.versione } : {}),
      dispositivo: idDispositivo(),
    });
    chiudi();
  }

  const contatore = (nome: string, valore: number, cambia: (n: number) => void) => (
    <div className="riga" role="group" aria-label={nome}>
      <span className="cresce">{nome}</span>
      <button className="bottone piccolo" aria-label={`${nome}: uno in meno`} onClick={() => cambia(Math.max(0, valore - 1))}>
        −
      </button>
      <span aria-live="polite" style={{ minWidth: 24, textAlign: 'center' }}>
        {valore}
      </span>
      <button className="bottone piccolo" aria-label={`${nome}: uno in più`} onClick={() => cambia(Math.min(50, valore + 1))}>
        +
      </button>
    </div>
  );

  return (
    <Foglio titolo={`Ospiti a ${nomeCategoria(dati, categoria).toLowerCase()} di ${dataLunga(data)}`} chiudi={chiudi}>
      <div className="campo">
        {contatore('Adulti', adulti, setAdulti)}
        {contatore('Bambini', bambini, setBambini)}
        <p className="tenue" style={{ margin: 0 }}>
          Le porzioni dei piatti crescono da sole: un adulto conta 1, un bambino {PORZIONE_BAMBINO.toLocaleString('it-IT')}.
        </p>
      </div>
      {!passato &&
        GRUPPI_OSPITI.map((g) => (
          <div className="campo" key={g.nome}>
            <span>{g.nome} degli ospiti</span>
            <div className="riga" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-label={`${g.nome} degli ospiti`}>
              {g.voci.map((v) => {
                const scelto = oggetti.includes(v.oggetto);
                return (
                  <button
                    key={v.oggetto}
                    className="etichetta"
                    aria-pressed={scelto}
                    onClick={() => setOggetti(scelto ? oggetti.filter((o) => o !== v.oggetto) : [...oggetti, v.oggetto])}
                  >
                    {scelto ? '✓ ' : ''}
                    {v.nome}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      <p className="tenue">
        {passato
          ? 'Il pasto è passato: si segnano solo quanti eravate, per i consumi.'
          : 'Niente nomi. Il menu controlla i piatti anche per gli ospiti; le loro allergie ed esigenze si cancellano da sole dopo il pasto.'}
      </p>
      <div className="riga" style={{ flexWrap: 'wrap' }}>
        <button className="bottone primario" disabled={adulti + bambini === 0} onClick={() => void salva(adulti, bambini)}>
          Salva gli ospiti
        </button>
        {attuali && (
          <button className="bottone" onClick={() => void salva(0, 0)}>
            Nessun ospite
          </button>
        )}
      </div>
    </Foglio>
  );
}

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
