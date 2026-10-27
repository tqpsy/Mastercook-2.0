import { useState } from 'react';
import { righeAttive, useFamiglia, useVista } from '../dati/contesto';
import { useIndice } from '../dati/indice';
import { type ConfermaPasto as Conferma, daConfermare, NOME_ESITO, ricettePerUrgenti } from '../dominio/consumi';
import type { PortataMenu } from '../dominio/menu';
import type { Indice } from '../dominio/ricette';
import { daUsarePresto, oggi } from '../dominio/scadenze';
import { formatta, formattaGiorno } from '../dominio/unita';
import { Foglio } from '../ui/Foglio';
import { Foto, riduciFoto } from '../ui/Foto';
import { EtichettaData, useLotti } from './Casa';
import { ConfermaPasto, useConferme } from './ConfermaPasto';
import { useOggiSiMangia } from './Menu';

const titoloDi = (indice: Indice, p: PortataMenu) => (p.ricetta_id ? indice.perId.get(p.ricetta_id)?.titolo : null) ?? p.testo ?? 'Piatto';

/** Conferma in un tocco «come previsto», oppure apre le domande; a conferma fatta, l'esito e «Correggi». */
function StatoPasto({ titolo, conferma, apri, portata }: { titolo: string; conferma?: Conferma; apri: () => void; portata: PortataMenu }) {
  const { esegui, archivio, famiglia } = useFamiglia();
  const [vedi, setVedi] = useState(false);
  if (conferma) {
    // Dopo la conferma, la foto del piatto è una proposta facoltativa (R-CON-5).
    async function scatta(f: File | undefined) {
      if (!f || !conferma) return;
      const percorso = `${famiglia}/${crypto.randomUUID()}.jpg`;
      await archivio.foto.put({ percorso, famiglia_id: famiglia, file: await riduciFoto(f), caricata: false });
      await esegui('foto_pasto', { id: conferma.id, foto: percorso });
    }
    return (
      <span className="riga">
        <span className="etichetta">{NOME_ESITO[conferma.esito]}</span>
        {conferma.esito !== 'saltato' &&
          (conferma.foto ? (
            <button className="bottone piccolo" onClick={() => setVedi(true)} aria-label={`Foto del piatto: ${titolo}`}>
              <span aria-hidden>🖼️</span>
            </button>
          ) : (
            <label className="bottone piccolo" aria-label={`Aggiungi una foto del piatto: ${titolo}`}>
              <span aria-hidden>📷</span>
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void scatta(e.target.files?.[0])} />
            </label>
          ))}
        <button className="bottone piccolo" onClick={apri} aria-label={`Correggi: ${titolo}`}>
          Correggi
        </button>
        {vedi && conferma.foto && (
          <Foglio titolo={titolo} chiudi={() => setVedi(false)}>
            <Foto percorso={conferma.foto} alt={`Foto di ${titolo}`} />
            <button
              className="bottone pieno"
              style={{ marginTop: 12 }}
              onClick={async () => {
                if (!window.confirm('Togliere la foto di questo piatto?')) return;
                await esegui('foto_pasto', { id: conferma.id, foto: null });
                setVedi(false);
              }}
            >
              Togli la foto
            </button>
          </Foglio>
        )}
      </span>
    );
  }
  return (
    <span className="riga">
      <button
        className="bottone primario piccolo"
        aria-label={`Mangiato come previsto: ${titolo}`}
        onClick={() => esegui('conferma_pasto', { id: crypto.randomUUID(), portata_id: portata.id, esito: 'come_previsto' })}
      >
        ✓ Mangiato
      </button>
      <button className="bottone piccolo" onClick={apri} aria-label={`Com’è andato: ${titolo}`}>
        Altro…
      </button>
    </span>
  );
}

/**
 * Oggi: cosa si mangia (e confermarlo in un tocco), i pasti ancora da confermare, cosa usare presto.
 */
export function Oggi({ vai }: { vai: (scheda: 'menu' | 'spesa' | 'ricette' | 'casa') => void }) {
  const vista = useVista();
  const indice = useIndice(vista);
  const lotti = useLotti();
  const famiglia = righeAttive(vista, 'famiglia')[0];
  const persone = righeAttive(vista, 'membro').filter((m) => !m.archiviato).length;
  const giorno = oggi();
  const presto = daUsarePresto(lotti, giorno);
  const { piatti, dati } = useOggiSiMangia();
  const { attive } = useConferme(vista);
  const [aperto, setAperto] = useState<string | null>(null);
  const arretrati = daConfermare(dati.portate, attive, giorno).filter((p) => p.data < giorno);
  const portataAperta = aperto ? dati.portate.find((p) => p.id === aperto) : undefined;
  const { esegui } = useFamiglia();
  const proposte = indice
    ? ricettePerUrgenti(
        indice,
        presto.map((l) => l.ingrediente_id),
        lotti.map((l) => l.ingrediente_id),
        dati.persone,
        dati.vincoli,
      )
    : [];
  const cenaOggi = dati.portate.some((p) => p.data === giorno && p.categoria === 'cena');
  const daComprare = righeAttive(vista, 'voce_spesa').filter((v) => v.stato === 'da_acquistare').length;
  const data = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <p className="tenue" style={{ textTransform: 'capitalize' }}>
        {data}
      </p>
      <h2>{famiglia ? `Ciao, ${String(famiglia.nome)}` : 'Ciao'}</h2>

      <section className="scheda" aria-label="Oggi si mangia">
        <h3 style={{ marginTop: 0 }}>Oggi si mangia</h3>
        {piatti.length === 0 ? (
          <p className="tenue" style={{ margin: 0 }}>
            Niente in menu per oggi.
          </p>
        ) : (
          <ul className="elenco">
            {piatti.map(({ categoria, portata, titolo }) => (
              <li key={portata.id} className="riga" style={{ flexWrap: 'wrap' }}>
                <span aria-hidden>{categoria.emoji}</span>
                <span className="cresce">
                  {titolo} <span className="tenue">· {categoria.nome.toLowerCase()}</span>
                </span>
                <StatoPasto titolo={titolo} portata={portata} conferma={attive.get(portata.id)} apri={() => setAperto(portata.id)} />
              </li>
            ))}
          </ul>
        )}
        <div className="riga" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="bottone piccolo" onClick={() => vai('menu')}>
            Apri il menu della settimana
          </button>
          <button className="bottone piccolo" onClick={() => vai('spesa')}>
            Lista della spesa{daComprare ? ` (${daComprare})` : ''}
          </button>
        </div>
      </section>

      {indice && arretrati.length > 0 && (
        <section className="scheda" aria-label="Pasti da confermare">
          <h3 style={{ marginTop: 0 }}>Pasti da confermare</h3>
          <p className="tenue" style={{ marginTop: 0 }}>
            Confermare toglie dalla casa ciò che è stato usato: così frigo e dispensa restano veri.
          </p>
          <ul className="elenco">
            {arretrati.map((p) => {
              const titolo = titoloDi(indice, p);
              const categoria = dati.categorie.find((c) => c.valore === p.categoria);
              return (
                <li key={p.id} className="riga" style={{ flexWrap: 'wrap' }}>
                  <span className="cresce">
                    {titolo}{' '}
                    <span className="tenue">
                      · {formattaGiorno(p.data)}
                      {categoria && `, ${categoria.nome.toLowerCase()}`}
                    </span>
                  </span>
                  <StatoPasto titolo={titolo} portata={p} apri={() => setAperto(p.id)} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="scheda" aria-label="Da usare presto">
        <h3 style={{ marginTop: 0 }}>Da usare presto</h3>
        {presto.length === 0 ? (
          <p className="tenue" style={{ margin: 0 }}>
            {lotti.length ? 'Niente in scadenza nei prossimi giorni.' : 'Aggiungi ciò che hai in frigo, freezer e dispensa per vedere qui cosa usare prima.'}
          </p>
        ) : (
          <ul className="elenco">
            {presto.slice(0, 5).map((l) => {
              const ing = indice?.ingrediente(l.ingrediente_id);
              return (
                <li key={l.id} className="riga">
                  <span aria-hidden>{ing?.emoji}</span>
                  <span className="cresce">
                    {l.nome ?? ing?.nome} <span className="tenue">· {formatta({ valore: l.quantita, unita: l.unita })}</span>
                  </span>
                  <EtichettaData lotto={l} giorno={giorno} />
                </li>
              );
            })}
          </ul>
        )}
        {proposte.length > 0 && (
          <>
            <h4 style={{ margin: '12px 0 4px' }}>Ricette che li usano</h4>
            <ul className="elenco" aria-label="Ricette che li usano">
              {proposte.map(({ ricetta, usa, presenti, totali }) => (
                <li key={ricetta.id} className="riga" style={{ flexWrap: 'wrap' }}>
                  <span className="cresce">
                    {ricetta.titolo}
                    <span className="tenue" style={{ display: 'block', fontSize: '0.85rem' }}>
                      usa {usa.map((id) => indice?.nome(id).toLowerCase()).join(', ')} · {presenti} su {totali} ingredienti in casa
                    </span>
                  </span>
                  {!cenaOggi && (
                    <button
                      className="bottone piccolo"
                      aria-label={`Metti a cena stasera: ${ricetta.titolo}`}
                      onClick={() => esegui('aggiungi_portata', { id: crypto.randomUUID(), data: giorno, categoria: 'cena', ricetta_id: ricetta.id, ordine: 0 })}
                    >
                      Stasera
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="riga" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="bottone piccolo" onClick={() => vai('casa')}>
            Vedi cosa c’è
          </button>
          <button className="bottone piccolo" onClick={() => vai('ricette')}>
            Cerca una ricetta
          </button>
        </div>
      </section>

      <div className="scheda">
        <p style={{ margin: 0 }}>
          {persone === 1 ? 'C’è 1 persona' : `Ci sono ${persone} persone`} in famiglia. Allergie ed esigenze di ognuno, nella scheda <strong>Famiglia</strong>, decidono quali ricette sono adatte.
        </p>
      </div>
      {indice && portataAperta && (
        <ConfermaPasto
          indice={indice}
          dati={dati}
          portata={portataAperta}
          titolo={titoloDi(indice, portataAperta)}
          attiva={attive.get(portataAperta.id)}
          chiudi={() => setAperto(null)}
        />
      )}
    </>
  );
}
