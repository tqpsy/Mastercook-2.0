/**
 * Importazione dal vecchio Mastercook (Fase 7, docs/migrazione.md).
 *
 * Il vecchio salva tutto in un documento Yjs; da «Impostazioni → I tuoi dati → Scarica i dati (JSON)» si ottiene
 * un file `masterfood-export`. Qui lo si converte, senza scrivere nulla, in un'esportazione `mastercook-2`:
 * la stessa che il ripristino sa già caricare in una famiglia nuova, con tutti i controlli del database.
 * Il rapporto dice cosa entra, cosa resta fuori e perché: è la «prova a secco».
 *
 * Regole: nessuna quantità inventata (una riga senza quantità o con un'unità che non torna diventa «q.b.»);
 * nessun dato di salute oltre a ciò che il nuovo usa (allergie, intolleranze, esigenze); il vecchio non si tocca.
 */
import type { Catalogo, IngredienteCatalogo } from '../catalogo/tipi';
import { normalizza } from '../dominio/ricette';
import { UNITA_BASE } from '../dominio/unita';
import { INTOLLERANZE, oggettoDaTesto } from '../dominio/vincoli';
import { FORMATO, type FileEsportazione, TABELLE_ESPORTATE, VERSIONE_FILE } from './esportazione';
import type { Riga } from './tipi';

type Oggetto = Record<string, unknown>;
type Collezione = Record<string, Oggetto>;

export interface FileVecchio {
  esportato_il?: string;
  dati: Record<string, Collezione>;
}

export type LetturaVecchio = { valido: true; file: FileVecchio } | { valido: false; motivo: string };

/** Riconosce il file del vecchio Mastercook (formato `masterfood-export`). */
export function eFileVecchio(json: unknown): boolean {
  return !!json && typeof json === 'object' && (json as Oggetto).formato === 'masterfood-export';
}

export function leggiVecchio(json: unknown): LetturaVecchio {
  if (!eFileVecchio(json)) return { valido: false, motivo: 'Il file non viene dal vecchio Mastercook.' };
  const f = json as Oggetto;
  if (!f.dati || typeof f.dati !== 'object') return { valido: false, motivo: 'Il file del vecchio Mastercook è incompleto.' };
  return { valido: true, file: { esportato_il: typeof f.esportato_il === 'string' ? f.esportato_il : undefined, dati: f.dati as Record<string, Collezione> } };
}

/** Le righe vive di una collezione (senza quelle nel cestino). */
function vive(file: FileVecchio, nome: string): Oggetto[] {
  const c = file.dati[nome];
  if (!c || typeof c !== 'object') return [];
  return Object.entries(c)
    .filter(([, o]) => o && typeof o === 'object' && !o.eliminato_il)
    .map(([id, o]) => ({ ...o, id: typeof o.id === 'string' ? o.id : id }));
}

const testo = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
const numero = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const lista = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const tronca = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const arrotonda = (n: number) => Math.round(n * 1000) / 1000;

/** Le persone del vecchio, per chiedere «tu chi sei?». */
export function personeVecchie(file: FileVecchio): { id: string; nome: string; con_account: boolean }[] {
  return vive(file, 'membri')
    .filter((m) => testo(m.nome))
    .map((m) => ({ id: String(m.id), nome: testo(m.nome), con_account: !!m.utente_id }));
}

export interface Scarto {
  cosa: string;
  motivo: string;
}

export interface RapportoMigrazione {
  nome: string;
  esportato_il?: string;
  /** Quanto entra nella famiglia nuova. */
  entra: { persone: number; vincoli: number; gusti: number; ricette: number; ingredienti_nuovi: number; lotti: number; portate: number };
  /** Cose che entrano ma vanno ricontrollate (quantità da indicare, ingredienti creati…). */
  da_controllare: string[];
  /** Singoli elementi lasciati fuori, con il motivo. */
  scarti: Scarto[];
  /** Parti del vecchio che il nuovo non importa, con il motivo. */
  non_importato: string[];
}

export interface OpzioniMigrazione {
  /** L'utente di chi importa, collegato alla persona `io` del vecchio. */
  utente_id?: string;
  /** La persona del vecchio che corrisponde a chi importa. */
  io?: string | null;
  /** Data di oggi (AAAA-MM-GG): i pasti passati non si importano. */
  oggi: string;
  adesso: Date;
}

/** Id fittizio della famiglia nel file: il ripristino rigenera tutti gli id a partire dalla famiglia nuova. */
const FAMIGLIA_FILE = '00000000-0000-4000-8000-000000000000';

const ALLERGENI = ['glutine', 'crostacei', 'uova', 'pesce', 'arachidi', 'soia', 'latte', 'frutta_a_guscio', 'sedano', 'senape', 'sesamo', 'solfiti', 'lupini', 'molluschi'];
const ESIGENZE: Record<string, string> = { vegetariano: 'cls:vegetariano', vegano: 'cls:vegano', senza_maiale: 'cls:senza_maiale', senza_alcol: 'cls:senza_alcol' };
const CATEGORIE_RICETTA = ['antipasto', 'primo', 'secondo', 'contorno', 'piatto_unico', 'dolce', 'colazione'];
const PASTI = ['colazione', 'spuntino', 'pranzo', 'merenda', 'cena'];
const LUOGHI = ['frigo', 'freezer', 'dispensa'];
const UNITA = ['g', 'ml', 'pz'] as const;
type Unita = (typeof UNITA)[number];
const DIMENSIONE: Record<Unita, IngredienteCatalogo['dimensione']> = { g: 'massa', ml: 'volume', pz: 'pezzi' };
const eUnita = (x: unknown): x is Unita => UNITA.includes(x as Unita);
const eData = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

/**
 * Converte il file del vecchio in un'esportazione `mastercook-2` e prepara il rapporto.
 * Funzione pura: stesso file e stesse opzioni, stesso risultato.
 */
export function convertiVecchio(vecchio: FileVecchio, catalogo: Catalogo, o: OpzioniMigrazione): { file: FileEsportazione; rapporto: RapportoMigrazione } {
  const fam = FAMIGLIA_FILE;
  const tabelle = Object.fromEntries(TABELLE_ESPORTATE.map((t) => [t, [] as Oggetto[]])) as Record<(typeof TABELLE_ESPORTATE)[number], Oggetto[]>;
  const scarti: Scarto[] = [];
  const da_controllare: string[] = [];
  const non_importato: string[] = [];

  // ── Catalogo: per id e per nome ──
  const perId = new Map(catalogo.ingredienti.map((i) => [i.id, i]));
  const perNome = new Map<string, IngredienteCatalogo>();
  for (const i of catalogo.ingredienti) for (const n of [i.nome, ...i.sinonimi]) if (!perNome.has(normalizza(n))) perNome.set(normalizza(n), i);
  const ricetteSistema = new Set(catalogo.ricette.map((r) => r.id));
  const reparti = new Set(catalogo.reparti.map((r) => r.id));
  const regoleCotti = new Set(catalogo.regole_cotti.map((r) => r.id));
  const cucine = new Set(catalogo.cucine.map((c) => c.id));

  // Ingredienti che il nuovo catalogo non ha: si creano nella famiglia, uno per nome e dimensione.
  const nuovi = new Map<string, Oggetto & { id: string }>();
  const prodotti = new Map(vive(vecchio, 'prodotti_nucleo').map((p) => [String(p.id), p]));
  function ingredienteNuovo(nome: string, dimensione: IngredienteCatalogo['dimensione'], extra: { reparto?: unknown; luogo?: unknown; allergeni?: unknown } = {}): string {
    const chiave = `${normalizza(nome)}|${dimensione}`;
    const gia = nuovi.get(chiave);
    if (gia) return gia.id;
    const id = `nuovo:${chiave}`;
    nuovi.set(chiave, {
      id,
      famiglia_id: fam,
      nome: tronca(nome, 80),
      sinonimi: [],
      reparto: reparti.has(String(extra.reparto)) ? String(extra.reparto) : 'altro',
      sottocategoria: null,
      dimensione,
      luogo: LUOGHI.includes(String(extra.luogo)) ? String(extra.luogo) : 'dispensa',
      giorni: null,
      allergeni: lista(extra.allergeni).filter((a): a is string => ALLERGENI.includes(String(a))),
      // Chi l'ha creato nel vecchio non ha dichiarato gli allergeni: le ricette che lo usano restano «da verificare».
      allergeni_noti: false,
      classi: [],
      genitore: null,
      emoji: null,
    });
    return id;
  }

  /** Trova l'ingrediente del nuovo: per id, poi per nome; altrimenti null. */
  function trova(id: unknown, nome: string): IngredienteCatalogo | null {
    if (typeof id === 'string' && perId.has(id)) return perId.get(id)!;
    return (nome && perNome.get(normalizza(nome))) || null;
  }

  // ── Persone e vincoli ──
  const membri = vive(vecchio, 'membri').filter((m) => testo(m.nome));
  const idMembri = new Set<string>();
  for (const m of membri) {
    const id = String(m.id);
    idMembri.add(id);
    const fattore = numero(m.fattore_porzione);
    tabelle.membro.push({
      id,
      famiglia_id: fam,
      nome: tronca(testo(m.nome), 60),
      emoji: null,
      porzione: fattore && fattore > 0 ? Math.min(3, Math.round(fattore * 100) / 100) : 1,
      note: null,
      archiviato: m.attivo === false,
      utente_id: o.io === id && o.utente_id ? o.utente_id : null,
    });
    const tracce = m.escludi_tracce === true;
    const vincolo = (tipo: string, oggetto: string, extra: Oggetto = {}) =>
      tabelle.vincolo_alimentare.push({ id: `${id}:${oggetto}`, famiglia_id: fam, membro_id: id, tipo, oggetto, severita: 'evitare', fonte: 'dichiarato', testo: null, ...extra });
    const visti = new Set<string>();
    for (const a of lista(m.allergie)) {
      if (!ALLERGENI.includes(String(a))) {
        scarti.push({ cosa: `Allergia «${String(a)}» di ${testo(m.nome)}`, motivo: 'non è uno dei 14 allergeni UE: aggiungila a mano come indicazione' });
        continue;
      }
      if (visti.has(`all:${a}`)) continue;
      visti.add(`all:${a}`);
      vincolo('allergia', `all:${a}`, { severita: tracce ? 'evitare_anche_tracce' : 'evitare' });
    }
    for (const t of lista(m.intolleranze)) {
      const s = testo(t);
      if (!s) continue;
      const nota = INTOLLERANZE.find((x) => normalizza(x.nome) === normalizza(s));
      const oggetto = nota?.oggetto ?? oggettoDaTesto(s);
      if (!oggetto || visti.has(oggetto)) continue;
      visti.add(oggetto);
      vincolo('intolleranza', oggetto, nota ? {} : { testo: tronca(s, 2000) });
    }
    for (const r of lista(m.restrizioni)) {
      const oggetto = ESIGENZE[String(r)];
      if (!oggetto || visti.has(oggetto)) continue;
      visti.add(oggetto);
      vincolo('esigenza', oggetto);
    }
  }
  if (membri.some((m) => m.anno_nascita || m.data_nascita || m.sesso || m.condizione)) {
    non_importato.push('Anno di nascita, sesso e condizioni (gravidanza, allattamento): il nuovo non li usa. Le porzioni restano quelle che avevi.');
  }

  // ── Ricette personali ──
  const ricette = vive(vecchio, 'ricette').filter((r) => typeof r.id === 'string' && !String(r.id).startsWith('sys:'));
  const idRicette = new Set<string>();
  let qbAggiunti = 0;
  for (const r of ricette) {
    const id = String(r.id);
    const titolo = testo(r.titolo);
    if (!titolo) {
      scarti.push({ cosa: 'Una ricetta senza titolo', motivo: 'il nuovo richiede un titolo' });
      continue;
    }
    const righe = lista(r.ingredienti).filter((g): g is Oggetto => !!g && typeof g === 'object');
    if (!righe.length) {
      scarti.push({ cosa: `Ricetta «${titolo}»`, motivo: 'non ha ingredienti' });
      continue;
    }
    idRicette.add(id);
    const minuti = numero(r.minuti);
    const porzioni = numero(r.porzioni_base);
    const diff = numero(r.difficolta);
    const derivata = testo(r.derivata_da);
    tabelle.ricetta.push({
      id,
      famiglia_id: fam,
      titolo: tronca(titolo, 120),
      descrizione: null,
      categoria: CATEGORIE_RICETTA.includes(String(r.portata)) ? String(r.portata) : 'piatto_unico',
      cucina: cucine.has(String(r.cucina)) ? String(r.cucina) : 'italiana',
      provenienza: testo(r.provenienza) ? tronca(testo(r.provenienza), 120) : null,
      porzioni: porzioni ? Math.min(50, Math.max(1, Math.round(porzioni))) : 4,
      minuti_preparazione: null,
      minuti_cottura: null,
      minuti_totali: minuti && minuti >= 1 ? Math.min(5760, Math.round(minuti)) : null,
      difficolta: diff && [1, 2, 3].includes(diff) ? diff : null,
      derivata_da: derivata && (ricetteSistema.has(derivata) || ricette.some((x) => x.id === derivata)) ? derivata : null,
      conservazione: regoleCotti.has(String(r.categoria_conservazione)) ? String(r.categoria_conservazione) : null,
      mesi: lista(r.mesi_stagione).filter((x) => Number.isInteger(x) && Number(x) >= 1 && Number(x) <= 12).length ? lista(r.mesi_stagione).filter((x) => Number.isInteger(x) && Number(x) >= 1 && Number(x) <= 12) : null,
      allergeni_dichiarati: lista(r.allergeni_dichiarati).filter((a) => ALLERGENI.includes(String(a))),
      archiviata: false,
    });
    righe.forEach((g, n) => {
      const nome = testo(g.testo);
      const quantita = numero(g.quantita);
      const unita = eUnita(g.unita) ? g.unita : null;
      const noto = trova(g.ingrediente_id, nome);
      const ingrediente = noto?.id ?? ingredienteNuovo(nome || 'Ingrediente', unita ? DIMENSIONE[unita] : 'massa');
      const base = noto ? UNITA_BASE[noto.dimensione] : unita ? unita : 'g';
      const valida = quantita !== null && quantita > 0 && quantita < 1_000_000 && unita === base;
      if (!valida && quantita !== null) qbAggiunti++;
      tabelle.ricetta_ingrediente.push({
        id: `${id}:riga:${n}`,
        famiglia_id: fam,
        ricetta_id: id,
        ingrediente_id: ingrediente,
        quantita: valida ? quantita : null,
        unita: base,
        qb: !valida,
        opzionale: g.opzionale === true,
        // Se la quantità del vecchio non si poteva tenere, resta scritta accanto per ricopiarla a mano.
        testo: !valida && quantita !== null ? tronca(`${nome || 'Ingrediente'} (era ${quantita} ${unita ?? ''})`.trim(), 200) : nome ? tronca(nome, 200) : null,
        ordine: n,
      });
    });
    lista(r.passaggi)
      .map(testo)
      .filter(Boolean)
      .forEach((p, n) => tabelle.ricetta_passo.push({ id: `${id}:passo:${n}`, famiglia_id: fam, ricetta_id: id, ordine: n, testo: tronca(p, 2000) }));
  }
  if (qbAggiunti) da_controllare.push(`${qbAggiunti} righe di ricetta con un’unità diversa da quella del nuovo: sono «q.b.» con la quantità vecchia scritta accanto.`);

  // ── Gusti: «gradito» e «sgradito» diventano «piace» e «non piace» ──
  for (const m of membri) {
    const id = String(m.id);
    const pref = (m.preferenze ?? {}) as Oggetto;
    const gusti = new Map<string, 'piace' | 'non_piace'>();
    for (const g of lista(pref.graditi)) gusti.set(String(g), 'piace');
    for (const g of lista(pref.sgraditi)) gusti.set(String(g), 'non_piace');
    for (const [ing, valore] of gusti) {
      const noto = trova(ing, '');
      if (!noto) {
        scarti.push({ cosa: `«${valore === 'piace' ? 'Piace' : 'Non piace'}» di ${testo(m.nome)} (${ing})`, motivo: 'ingrediente che il nuovo non conosce' });
        continue;
      }
      tabelle.gusto.push({ id: `${id}:gusto:${noto.id}`, famiglia_id: fam, membro_id: id, ingrediente_id: noto.id, ricetta_id: null, valore });
    }
  }
  if (vive(vecchio, 'ricette_meta').some((x) => x.preferita || x.voto)) {
    non_importato.push('Ricette preferite e voti: nel nuovo i gusti sono per persona. Segna «piace» dalla scheda della ricetta.');
  }

  // ── Casa: un lotto per articolo, con la quantità che c'è ora e la sua data ──
  let avanzi = 0;
  for (const a of vive(vecchio, 'inventario')) {
    const nome = testo(a.nome) || 'Articolo';
    const unita = eUnita(a.unita) ? a.unita : null;
    const quantita = arrotonda(lista(a.movimenti).reduce<number>((s, x) => s + (numero((x as Oggetto)?.delta) ?? 0), 0));
    if (quantita <= 0) continue; // finito: nel vecchio era già sparito dalla casa
    if (!unita) {
      scarti.push({ cosa: `${nome} in casa`, motivo: 'senza unità di misura' });
      continue;
    }
    const cotto = ['cotto', 'avanzato'].includes(String(a.stato_conservazione));
    let ingrediente: string;
    const noto = trova(a.ingrediente_id, cotto ? '' : nome);
    if (noto) {
      if (UNITA_BASE[noto.dimensione] !== unita) {
        scarti.push({ cosa: `${nome} in casa (${quantita} ${unita})`, motivo: `nel nuovo «${noto.nome}» si conta in ${UNITA_BASE[noto.dimensione]}: aggiungilo a mano` });
        continue;
      }
      ingrediente = noto.id;
    } else if (cotto && unita === 'pz') {
      ingrediente = 'ing:avanzo';
      avanzi++;
    } else {
      const p = prodotti.get(String(a.prodotto_id));
      ingrediente = ingredienteNuovo(cotto ? nome : testo(p?.nome) || nome, DIMENSIONE[unita], { reparto: p?.reparto, luogo: a.luogo, allergeni: p?.allergeni });
    }
    const primo = lista(a.movimenti).map((x) => testo((x as Oggetto)?.il)).filter(Boolean).sort()[0];
    const id = String(a.id);
    tabelle.lotto.push({
      id,
      famiglia_id: fam,
      ingrediente_id: ingrediente,
      nome: tronca(nome, 120),
      unita,
      luogo: LUOGHI.includes(String(a.luogo)) ? String(a.luogo) : 'dispensa',
      data_acquisto: primo ? primo.slice(0, 10) : null,
      ...dataLotto(a, o.adesso),
      origine: 'manuale',
      note: 'Dal vecchio Mastercook',
    });
    tabelle.movimento.push({ id: `${id}:carico`, famiglia_id: fam, lotto_id: id, variazione: quantita, causale: 'carico', comando_id: `importa:${id}`, nota: null });
  }
  if (avanzi) da_controllare.push(`${avanzi} avanzi cotti entrano come «Avanzo», senza il legame al pasto da cui vengono.`);

  // ── Menu: solo da oggi in poi; il passato resta nel vecchio ──
  const usate = new Set<string>();
  let passati = 0;
  let conPersone = 0;
  for (const p of vive(vecchio, 'piani').sort((x, y) => `${x.data}${x.tipo}`.localeCompare(`${y.data}${y.tipo}`))) {
    if (!eData(p.data) || !PASTI.includes(String(p.tipo))) continue;
    if (p.data < o.oggi) {
      passati++;
      continue;
    }
    lista(p.portate).forEach((x, n) => {
      const q = (x ?? {}) as Oggetto;
      const ricetta = testo(q.ricetta_id);
      const nota = ricetta && (ricetteSistema.has(ricetta) || idRicette.has(ricetta));
      const titolo = testo(q.titolo);
      if (!nota && !titolo) return;
      if (lista(q.membri).length && lista(q.membri).length < membri.filter((m) => m.attivo !== false).length) conPersone++;
      const porzioni = numero(q.porzioni_manuali);
      tabelle.portata.push({
        id: `${p.id}:${n}`,
        famiglia_id: fam,
        data: p.data,
        categoria: String(p.tipo),
        ricetta_id: nota ? ricetta : null,
        testo: nota ? null : tronca(titolo, 120),
        porzioni: porzioni && porzioni > 0 && porzioni <= 100 ? porzioni : null,
        origine: 'manuale',
        bloccata: false,
        ordine: n,
        note: null,
      });
      usate.add(String(p.tipo));
    });
  }
  // Colazione, pranzo e cena ci sono sempre; spuntino e merenda vanno accesi se il menu li usa.
  for (const chiave of ['spuntino', 'merenda'].filter((c) => usate.has(c))) {
    tabelle.categoria_pasto.push({ id: `categoria:${chiave}`, famiglia_id: fam, chiave, nome: null, emoji: null, ordine: PASTI.indexOf(chiave) + 1, attiva: true });
  }
  if (passati) non_importato.push(`${passati} pasti passati: restano consultabili nel vecchio Mastercook.`);
  if (conPersone) da_controllare.push(`${conPersone} piatti del menu erano solo per alcune persone: nel nuovo li mangiano tutti, segna chi non c’è.`);

  // ── Il resto ──
  const conta = (nome: string) => vive(vecchio, nome).length;
  if (conta('diete')) non_importato.push(`Diete del dietista (${conta('diete')}): ricaricale nel nuovo quando ci sarà la funzione.`);
  if (conta('liste')) non_importato.push('Lista della spesa: nel nuovo si ricalcola dal menu e da ciò che hai in casa.');
  if (conta('acquisti_in_corso')) non_importato.push('Spesa in corso: chiudila nel vecchio prima di importare, oppure rifalla nel nuovo.');
  if (conta('foto')) non_importato.push('Foto delle ricette: nel nuovo si aggiungono di nuovo dalla ricetta.');
  if (conta('eventi_ospiti')) non_importato.push('Ospiti dei pasti: nel nuovo non si salvano.');
  if (conta('scorte_minime')) non_importato.push('Scorte minime: il nuovo non le ha ancora.');
  non_importato.push('Storico di acquisti e consumi: resta nel vecchio.');

  tabelle.ingrediente.push(...nuovi.values());
  if (nuovi.size) da_controllare.push(`${nuovi.size} ingredienti che il nuovo catalogo non ha: li creo nella famiglia, con allergeni «da verificare».`);

  const meta = (vecchio.dati.meta ?? {}) as Collezione;
  const nome = tronca(testo(meta.nucleo?.nome) || 'Casa', 60);
  tabelle.famiglia.push({ id: fam, famiglia_id: fam, nome, impostazioni: {} });
  // Come in un'esportazione vera, ogni riga ha il suo ordine (i movimenti si rigiocano in quest'ordine).
  const righe = Object.fromEntries(TABELLE_ESPORTATE.map((t) => [t, tabelle[t].map((r, i) => ({ seq: i + 1, ...r }) as Riga)])) as FileEsportazione['tabelle'];
  const conteggi = Object.fromEntries(TABELLE_ESPORTATE.map((t) => [t, tabelle[t].length])) as FileEsportazione['conteggi'];
  return {
    file: { formato: FORMATO, versione_schema: VERSIONE_FILE, esportato_il: o.adesso.toISOString(), tabelle: righe, conteggi },
    rapporto: {
      nome,
      esportato_il: vecchio.esportato_il,
      entra: {
        persone: tabelle.membro.length,
        vincoli: tabelle.vincolo_alimentare.length,
        gusti: tabelle.gusto.length,
        ricette: tabelle.ricetta.length,
        ingredienti_nuovi: nuovi.size,
        lotti: tabelle.lotto.length,
        portate: tabelle.portata.length,
      },
      da_controllare,
      scarti,
      non_importato,
    },
  };
}

/**
 * La data di un lotto: quella della confezione (entro / preferibilmente), oppure il limite di conservazione
 * calcolato dal vecchio dopo l'apertura o la cottura, se arriva prima. Mai una data inventata.
 */
function dataLotto(a: Oggetto, adesso: Date): Oggetto {
  const scadenza = eData(a.data_scadenza) ? a.data_scadenza : null;
  const fino = eData(a.conservare_fino) ? a.conservare_fino : null;
  if (fino && (!scadenza || fino < scadenza)) {
    return { tipo_data: 'stimata', data_limite: fino, fonte_data: 'app', calcolata_il: adesso.toISOString(), affidabilita: 'bassa' };
  }
  if (!scadenza) return { tipo_data: 'sconosciuta', data_limite: null, fonte_data: null, calcolata_il: null, affidabilita: null };
  if (a.tipo_scadenza === 'stimata') return { tipo_data: 'stimata', data_limite: scadenza, fonte_data: 'app', calcolata_il: adesso.toISOString(), affidabilita: 'bassa' };
  return { tipo_data: a.tipo_scadenza === 'preferibilmente' ? 'tmc' : 'scadenza', data_limite: scadenza, fonte_data: 'utente', calcolata_il: null, affidabilita: null };
}
