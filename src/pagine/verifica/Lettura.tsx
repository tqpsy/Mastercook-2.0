import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatta } from '../../dominio/unita';
import { MAX_FOTO_ZONA, type ZonaVerifica } from '../../dominio/verifica';
import type { VistoInZona } from '../../../supabase/functions/foto-frigo/nucleo';
import { type FaseLettura } from '../../piattaforma/fotoFrigo';
import { LATO_ANALISI, riduciFoto } from '../../ui/Foto';

function Miniatura({ foto, togli }: { foto: Blob; togli: () => void }) {
  const url = useMemo(() => URL.createObjectURL(foto), [foto]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <span className="miniatura-verifica">
      {url && <img src={url} alt="Foto della zona" />}
      <button type="button" aria-label="Togli questa foto" onClick={togli}>
        ✕
      </button>
    </span>
  );
}

export function FotoZona({ zona, foto, aggiungi, togli }: { zona: ZonaVerifica; foto: Blob[]; aggiungi: (f: Blob) => void; togli: (i: number) => void }) {
  const [riduco, setRiduco] = useState(false);
  return (
    <div className="foto-zona">
      {foto.length > 0 && (
        <div className="miniature-verifica">
          {foto.map((f, i) => (
            <Miniatura key={i} foto={f} togli={() => togli(i)} />
          ))}
        </div>
      )}
      {foto.length < MAX_FOTO_ZONA && (
        <label className={`bottone ${foto.length ? '' : 'primario '}pieno`} aria-busy={riduco}>
          <span aria-hidden>📷</span> {foto.length ? 'Un’altra angolazione' : `Fotografa ${zona.nome.toLowerCase()}`}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label={`Foto di ${zona.nome}`}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setRiduco(true);
              try {
                aggiungi(await riduciFoto(f, LATO_ANALISI));
              } finally {
                setRiduco(false);
              }
            }}
          />
        </label>
      )}
    </div>
  );
}

export type StatoLettura = { fase: 'attesa' | FaseLettura | 'fatto'; visti: VistoInZona[] };

const NOME_FASE: Record<StatoLettura['fase'], string> = {
  attesa: 'In attesa',
  preparo: 'Preparo le foto',
  invio: 'Mando le foto a Google',
  guarda: 'Gemini guarda le foto',
  fatto: 'Fatto',
};

/** Quanto di una zona è fatto, per la barra: le fasi vere e poi un po' per ogni alimento trovato. */
function quotaFatta(s: StatoLettura): number {
  if (s.fase === 'fatto') return 1;
  if (s.fase === 'attesa') return 0;
  if (s.fase === 'preparo') return 0.05;
  if (s.fase === 'invio') return 0.15;
  return Math.min(0.9, 0.25 + s.visti.length * 0.06);
}

/** I secondi passati da quando il componente è comparso. */
function useSecondi(): number {
  const [inizio] = useState(() => Date.now());
  const [ora, setOra] = useState(inizio);
  useEffect(() => {
    const t = setInterval(() => setOra(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((ora - inizio) / 1000));
}

function quantoVisto(v: VistoInZona): string {
  return v.quantita !== null && v.unita ? `${v.nome} · ${formatta({ valore: v.quantita, unita: v.unita })}` : v.nome;
}

/** Una foto della zona con i riquadri degli alimenti trovati finora; l'ultimo trovato è evidenziato. */
function FotoConRiquadri({ foto, visti, cerca }: { foto: Blob; visti: { v: VistoInZona; ultimo: boolean }[]; cerca: boolean }) {
  // L'indirizzo della foto vive quanto l'immagine (anche con i doppi montaggi di React in sviluppo).
  const mostra = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const u = URL.createObjectURL(foto);
      img.src = u;
      return () => URL.revokeObjectURL(u);
    },
    [foto],
  );
  return (
    <div className={`foto-lettura${cerca ? ' cerca' : ''}`}>
      <img ref={mostra} alt="Foto che Gemini sta guardando" />
      {visti.map(({ v, ultimo }, i) => {
        const [y0, x0, y1, x1] = v.riquadro!;
        return (
          <span
            key={i}
            className={`riquadro-visto${ultimo ? ' ultimo' : ''}`}
            style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }}
            aria-hidden
          >
            <span>{v.nome}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Mentre Gemini guarda: tempo, barra, e per ogni zona la fase, le foto con i riquadri e gli alimenti trovati. */
export function Lettura({ zone, foto, stato }: { zone: ZonaVerifica[]; foto: Record<string, Blob[]>; stato: Record<string, StatoLettura> }) {
  const secondi = useSecondi();
  const finite = zone.filter((z) => stato[z.id]?.fase === 'fatto').length;
  const quota = zone.length ? zone.reduce((t, z) => t + quotaFatta(stato[z.id]), 0) / zone.length : 0;
  const trovati = zone.reduce((t, z) => t + (stato[z.id]?.visti.length ?? 0), 0);
  return (
    <div className="lettura-verifica">
      <div className="riga" style={{ justifyContent: 'space-between' }}>
        <strong>
          {finite} di {zone.length} {zone.length === 1 ? 'zona' : 'zone'}
        </strong>
        <span className="tenue" aria-label="Tempo trascorso">
          {Math.floor(secondi / 60)}:{String(secondi % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="barra-lettura" role="progressbar" aria-label="Avanzamento della verifica" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(quota * 100)}>
        <span style={{ width: `${Math.round(quota * 100)}%` }} />
      </div>
      <p className="tenue piccolo" role="status" aria-live="polite" style={{ margin: '6px 0 12px' }}>
        {trovati ? `Trovati ${trovati} ${trovati === 1 ? 'alimento' : 'alimenti'} finora` : 'Gemini guarda le foto…'}
      </p>
      {zone.map((z) => {
        const s = stato[z.id];
        const lavora = s.fase !== 'attesa' && s.fase !== 'fatto';
        const fotoZona = foto[z.id] ?? [];
        return (
          <section key={z.id} className="zona-lettura" aria-label={`Lettura di ${z.nome}`} aria-busy={lavora}>
            <div className="riga" style={{ justifyContent: 'space-between' }}>
              <strong>{z.nome}</strong>
              <span className={`fase-lettura ${s.fase}`}>
                {s.fase === 'fatto' ? '✓ ' : ''}
                {s.fase === 'guarda' && s.visti.length ? `Trovati ${s.visti.length}…` : NOME_FASE[s.fase]}
              </span>
            </div>
            {s.fase !== 'attesa' && (
              <>
                <div className={`foto-lettura-elenco${fotoZona.length > 1 ? ' piu' : ''}`}>
                  {fotoZona.map((f, i) => (
                    <FotoConRiquadri
                      key={i}
                      foto={f}
                      cerca={lavora}
                      visti={s.visti.map((v, j) => ({ v, ultimo: lavora && j === s.visti.length - 1 })).filter(({ v }) => v.riquadro && (v.foto ?? 0) === i)}
                    />
                  ))}
                </div>
                {s.visti.length > 0 && (
                  <ul className="visti-lettura" aria-label={`Trovati in ${z.nome}`}>
                    {s.visti.map((v, j) => (
                      <li key={j} className={lavora && j === s.visti.length - 1 ? 'ultimo' : ''}>
                        {quantoVisto(v)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export const NOME_CERTEZZA = { sicuro: 'sicuro', probabile: 'probabile', incerto: 'incerto' } as const;
