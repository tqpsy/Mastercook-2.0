import { type FormEvent, useState } from 'react';
import type { RigaInVista } from '../dati/anteprima';
import { righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { ALLERGENI_UE, ESIGENZE, INTOLLERANZE, NOME_TIPO, nomeOggetto, oggettoDaTesto, type TipoVincolo } from '../dominio/vincoli';
import { CercaIngrediente } from '../ui/CercaIngrediente';
import { Foglio } from '../ui/Foglio';

const EMOJI = ['🧑', '👩', '👨', '👧', '👦', '🧒', '👶', '👵', '👴', '🧔', '👱', '🙂'];
const PORZIONI = [
  { valore: 1, nome: 'Adulto' },
  { valore: 0.8, nome: 'Ragazzo' },
  { valore: 0.6, nome: 'Bambino' },
  { valore: 0.4, nome: 'Piccolo' },
];

export function nomePorzione(p: number): string {
  return PORZIONI.find((x) => x.valore === p)?.nome ?? `Porzione ${p.toLocaleString('it-IT')}`;
}

export function Famiglia() {
  const vista = useVista();
  const [aperto, setAperto] = useState<string | 'nuovo' | null>(null);
  const membri = righeAttive(vista, 'membro').filter((m) => !m.archiviato);
  const vincoli = righeAttive(vista, 'vincolo_alimentare');

  if (!vista.pronta) return null;
  return (
    <>
      <div className="riga spazio" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Chi mangia a casa</h2>
        <button className="bottone primario piccolo" onClick={() => setAperto('nuovo')}>
          + Persona
        </button>
      </div>
      {membri.length === 0 && <p className="tenue">Sto scaricando i dati della famiglia…</p>}
      <div className="scheda">
        <ul className="elenco">
          {membri.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => setAperto(m.id)}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}
                aria-label={`Modifica ${String(m.nome)}`}
              >
                <span className="emoji">{String(m.emoji ?? '🙂')}</span>
                <span className="cresce">
                  <strong>{String(m.nome)}</strong>
                  {m.in_attesa && <span className="etichetta attesa" style={{ marginLeft: 8 }}>in invio</span>}
                  <span className="tenue" style={{ display: 'block' }}>
                    {nomePorzione(Number(m.porzione ?? 1))}
                  </span>
                  <Vincoli vincoli={vincoli.filter((v) => v.membro_id === m.id)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="tenue">
        Allergie e intolleranze sono vincoli: le ricette che non le rispettano, o di cui mancano le informazioni, non verranno mai proposte come adatte.
      </p>
      {aperto === 'nuovo' && <NuovaPersona chiudi={() => setAperto(null)} />}
      {aperto && aperto !== 'nuovo' && (
        <SchedaPersona
          membro={membri.find((m) => m.id === aperto)}
          vincoli={vincoli.filter((v) => v.membro_id === aperto)}
          chiudi={() => setAperto(null)}
        />
      )}
    </>
  );
}

function Vincoli({ vincoli, rimuovi }: { vincoli: RigaInVista[]; rimuovi?: (id: string) => void }) {
  if (!vincoli.length) return null;
  return (
    <span className="etichette">
      {vincoli.map((v) => (
        <span key={v.id} className={`etichetta ${v.tipo === 'allergia' ? 'allergia' : ''} ${v.in_attesa ? 'attesa' : ''}`}>
          {v.tipo === 'indicazione_medica' ? `🩺 ${String(v.testo ?? '')}` : `${v.tipo === 'allergia' ? '⚠️ ' : ''}${nomeOggetto(String(v.oggetto), v.testo as string | null)}`}
          {v.severita === 'evitare_anche_tracce' && ' (anche tracce)'}
          {rimuovi && (
            <button onClick={() => rimuovi(v.id)} aria-label={`Togli ${nomeOggetto(String(v.oggetto), v.testo as string | null)}`}>
              ✕
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

function NuovaPersona({ chiudi }: { chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [nome, setNome] = useState('');
  const [emoji, setEmoji] = useState('🙂');
  const [porzione, setPorzione] = useState(1);
  async function salva(e: FormEvent) {
    e.preventDefault();
    await esegui('aggiungi_membro', { id: crypto.randomUUID(), nome: nome.trim(), emoji, porzione });
    chiudi();
  }
  return (
    <Foglio titolo="Nuova persona" chiudi={chiudi}>
      <form onSubmit={salva}>
        <label className="campo">
          <span>Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} required autoFocus />
        </label>
        <SceltaEmoji valore={emoji} cambia={setEmoji} />
        <SceltaPorzione valore={porzione} cambia={setPorzione} />
        <p className="tenue">Non serve un account: anche i bambini o chi non usa l’app possono avere il loro profilo.</p>
        <button className="bottone primario pieno" disabled={!nome.trim()}>
          Aggiungi
        </button>
      </form>
    </Foglio>
  );
}

function SceltaEmoji({ valore, cambia }: { valore: string; cambia: (e: string) => void }) {
  return (
    <div className="campo">
      <span>Icona</span>
      <div className="scelte">
        {EMOJI.map((e) => (
          <button type="button" key={e} aria-pressed={valore === e} onClick={() => cambia(e)} style={{ fontSize: '1.3rem' }}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function SceltaPorzione({ valore, cambia }: { valore: number; cambia: (p: number) => void }) {
  return (
    <div className="campo">
      <span>Porzione abituale</span>
      <div className="scelte">
        {PORZIONI.map((p) => (
          <button type="button" key={p.valore} aria-pressed={valore === p.valore} onClick={() => cambia(p.valore)}>
            {p.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

function SchedaPersona({ membro, vincoli, chiudi }: { membro?: RigaInVista; vincoli: RigaInVista[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [aggiungi, setAggiungi] = useState(false);
  if (!membro) return null;
  const versione = membro.versione ?? 1;
  const modifica = (campi: Record<string, unknown>) => esegui('modifica_membro', { id: membro.id, versione_attesa: versione, campi });

  return (
    <Foglio titolo={String(membro.nome)} chiudi={chiudi}>
      <CampoTesto etichetta="Nome" valore={String(membro.nome)} salva={(nome) => modifica({ nome })} />
      <SceltaEmoji valore={String(membro.emoji ?? '')} cambia={(emoji) => modifica({ emoji })} />
      <SceltaPorzione valore={Number(membro.porzione ?? 1)} cambia={(porzione) => modifica({ porzione })} />

      <div className="campo">
        <span>Allergie, intolleranze ed esigenze</span>
        {vincoli.length ? (
          <Vincoli vincoli={vincoli} rimuovi={(id) => esegui('rimuovi_vincolo', { id })} />
        ) : (
          <p className="tenue">Nessuna indicata.</p>
        )}
        <button className="bottone piccolo" style={{ marginTop: 10 }} onClick={() => setAggiungi(true)}>
          + Aggiungi
        </button>
      </div>

      <Gusti membro={membro.id} />

      <CampoTesto etichetta="Note" valore={String(membro.note ?? '')} lungo salva={(note) => modifica({ note: note || null })} />

      {!membro.utente_id && (
        <button
          className="bottone pericolo pieno"
          onClick={async () => {
            if (window.confirm(`Togliere ${String(membro.nome)} da chi mangia a casa? Potrai sempre aggiungerlo di nuovo.`)) {
              await modifica({ archiviato: true });
              chiudi();
            }
          }}
        >
          Togli dalla famiglia
        </button>
      )}
      {aggiungi && <NuovoVincolo membro={membro.id} esistenti={vincoli} chiudi={() => setAggiungi(false)} />}
    </Foglio>
  );
}

/** Cosa piace e cosa no: non esclude ricette, le segnala nel menu. */
function Gusti({ membro }: { membro: string }) {
  const { esegui } = useFamiglia();
  const vista = useVista();
  const indice = useIndice(vista);
  const [cerca, setCerca] = useState<'piace' | 'non_piace' | null>(null);
  const gusti = righeAttive(vista, 'gusto').filter((g) => g.membro_id === membro);
  if (!indice) return null;
  const nome = (g: RigaInVista) => (g.ingrediente_id ? indice.nome(String(g.ingrediente_id)) : (indice.perId.get(String(g.ricetta_id))?.titolo ?? 'Ricetta'));
  const imposta = (dati: Record<string, unknown>, valore: 'piace' | 'non_piace') => {
    const esistente = gusti.find((g) => (g.ingrediente_id ?? g.ricetta_id) === (dati.ingrediente_id ?? dati.ricetta_id));
    return esegui('imposta_gusto', { id: crypto.randomUUID(), membro_id: membro, ...dati, valore, versione_attesa: esistente?.versione });
  };

  return (
    <div className="campo">
      <span>Gusti</span>
      {gusti.length ? (
        <ul className="elenco">
          {gusti.map((g) => (
            <li key={g.id} className="riga">
              <span aria-hidden>{g.valore === 'piace' ? '😋' : '🙅'}</span>
              <span className="cresce">
                {g.valore === 'piace' ? 'Piace' : 'Non piace'}: {nome(g)}
              </span>
              <button className="bottone piccolo" aria-label={`Togli ${nome(g)} dai gusti`} onClick={() => esegui('rimuovi_gusto', { id: g.id })}>
                Togli
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tenue">Nessun gusto indicato. Servono solo a segnalarlo nel menu, non escludono nulla.</p>
      )}
      {cerca ? (
        <>
          <CercaIngrediente
            indice={indice}
            etichetta={cerca === 'piace' ? 'Cosa piace' : 'Cosa non piace'}
            autoFocus
            scegli={(i) => {
              void imposta({ ingrediente_id: i.id }, cerca);
              setCerca(null);
            }}
          />
          <button className="bottone piccolo" onClick={() => setCerca(null)}>
            Annulla
          </button>
        </>
      ) : (
        <div className="riga" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button className="bottone piccolo" onClick={() => setCerca('piace')}>
            + Piace
          </button>
          <button className="bottone piccolo" onClick={() => setCerca('non_piace')}>
            + Non piace
          </button>
        </div>
      )}
    </div>
  );
}

function CampoTesto({ etichetta, valore, salva, lungo }: { etichetta: string; valore: string; salva: (v: string) => void; lungo?: boolean }) {
  const [testo, setTesto] = useState(valore);
  const cambiato = testo.trim() !== valore.trim();
  return (
    <form
      className="campo"
      onSubmit={(e) => {
        e.preventDefault();
        if (cambiato) salva(testo.trim());
      }}
    >
      <span>{etichetta}</span>
      <div className="riga">
        {lungo ? (
          <textarea value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={1000} className="cresce" />
        ) : (
          <input value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={60} className="cresce" required />
        )}
        {cambiato && <button className="bottone primario piccolo">Salva</button>}
      </div>
    </form>
  );
}

function NuovoVincolo({ membro, esistenti, chiudi }: { membro: string; esistenti: RigaInVista[]; chiudi: () => void }) {
  const { esegui } = useFamiglia();
  const [tipo, setTipo] = useState<TipoVincolo>('allergia');
  const [tracce, setTracce] = useState(false);
  const [testo, setTesto] = useState('');
  const [fonte, setFonte] = useState<'dichiarato' | 'medico' | 'dietista'>('dichiarato');
  const gia = new Set(esistenti.map((v) => `${String(v.tipo)}:${String(v.oggetto)}`));
  const elenco = tipo === 'allergia' ? ALLERGENI_UE : tipo === 'intolleranza' ? INTOLLERANZE : tipo === 'esigenza' ? ESIGENZE : [];

  async function aggiungi(oggetto: string, testoLibero?: string) {
    await esegui('aggiungi_vincolo', {
      id: crypto.randomUUID(),
      membro_id: membro,
      tipo,
      oggetto,
      severita: tipo === 'allergia' && tracce ? 'evitare_anche_tracce' : 'evitare',
      fonte: tipo === 'indicazione_medica' ? fonte : 'dichiarato',
      testo: testoLibero ?? null,
    });
  }

  return (
    <Foglio titolo="Aggiungi" chiudi={chiudi}>
      <div className="scelte">
        {(['allergia', 'intolleranza', 'esigenza', 'indicazione_medica'] as TipoVincolo[]).map((t) => (
          <button key={t} aria-pressed={tipo === t} onClick={() => setTipo(t)}>
            {NOME_TIPO[t]}
          </button>
        ))}
      </div>

      {tipo === 'allergia' && (
        <label className="riga" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={tracce} onChange={(e) => setTracce(e.target.checked)} style={{ width: 22, height: 22 }} />
          Evitare anche le tracce
        </label>
      )}

      {elenco.length > 0 && (
        <div className="scelte">
          {elenco.map((v) => (
            <button key={v.oggetto} aria-pressed={gia.has(`${tipo}:${v.oggetto}`)} disabled={gia.has(`${tipo}:${v.oggetto}`)} onClick={() => aggiungi(v.oggetto)}>
              {v.nome}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const oggetto = oggettoDaTesto(testo);
          if (!oggetto) return;
          await aggiungi(oggetto, testo.trim());
          setTesto('');
        }}
      >
        {tipo === 'indicazione_medica' && (
          <div className="scelte">
            {(['medico', 'dietista', 'dichiarato'] as const).map((f) => (
              <button type="button" key={f} aria-pressed={fonte === f} onClick={() => setFonte(f)}>
                {f === 'medico' ? 'Dal medico' : f === 'dietista' ? 'Dal dietista' : 'Altro'}
              </button>
            ))}
          </div>
        )}
        <label className="campo">
          <span>{tipo === 'indicazione_medica' ? 'Indicazione, così come è stata data' : 'Altro (scrivilo tu)'}</span>
          <div className="riga">
            <input value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={tipo === 'indicazione_medica' ? 2000 : 60} className="cresce" />
            <button className="bottone primario piccolo" disabled={!oggettoDaTesto(testo)}>
              Aggiungi
            </button>
          </div>
        </label>
      </form>
      {tipo !== 'esigenza' && tipo !== 'indicazione_medica' && /crud/i.test(testo) && (
        <div className="avviso info">
          Scritto a parole, l’app non lo sa valutare e mette il punto di domanda su tutte le ricette. Per i crudi ci sono le
          esigenze apposite, che guardano se nella ricetta l’alimento si cuoce.{' '}
          <button type="button" className="bottone piccolo" onClick={() => setTipo('esigenza')}>
            Vedi le esigenze sui crudi
          </button>
        </div>
      )}
      {tipo === 'indicazione_medica' && (
        <p className="tenue">L’app conserva l’indicazione e la mostra, ma non la interpreta né la sostituisce con suggerimenti automatici.</p>
      )}
      <button className="bottone pieno" onClick={chiudi}>
        Fatto
      </button>
    </Foglio>
  );
}
