-- Mastercook 2.0 · Fase 4: lista della spesa e acquisti.
--
-- Tre livelli separati: la lista è un'intenzione, l'acquisto confermato è un fatto, la casa è lo
-- stato che ne deriva.
-- - voce_spesa: una riga della lista. Le voci «derivate» nascono dal fabbisogno del menu e hanno
--   una chiave (ingrediente, unità) unica finché sono da comprare: ricalcolare non crea doppioni.
--   Le voci «manuali» le scrive qualcuno e nessun ricalcolo le tocca.
--   Stati: da_acquistare → nel_carrello (preso in negozio, da confermare) → acquistata; oppure rimossa.
-- - acquisto + acquisto_riga: solo la conferma di un acquisto crea lotti (origine «acquisto»).
--   Annullare o correggere scrive movimenti opposti o di differenza, mai cancellazioni.
-- - I prezzi non hanno una tabella: sono le righe d'acquisto con un prezzo (si calcola, non si copia).

-- ───────────────────────── Tabelle ─────────────────────────

create table public.voce_spesa (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  tipo text not null check (tipo in ('derivata', 'manuale')),
  ingrediente_id text references public.ingrediente (id),
  -- Per le voci a mano senza ingrediente («detersivo») o come nome più preciso.
  testo text check (testo is null or char_length(btrim(testo)) between 1 and 120),
  unita text check (unita in ('g', 'ml', 'pz')),
  -- Per le derivate la scrive il ricalcolo; per le manuali chi la aggiunge (può mancare: «un po' di frutta»).
  quantita_richiesta numeric check (quantita_richiesta is null or quantita_richiesta >= 0),
  -- Se qualcuno sceglie una quantità diversa, vale quella.
  quantita_scelta numeric check (quantita_scelta is null or quantita_scelta > 0),
  stato text not null default 'da_acquistare' check (stato in ('da_acquistare', 'nel_carrello', 'acquistata', 'rimossa')),
  -- Il menu è cambiato e non serve più, ma la voce era già nel carrello o scelta a mano: decide la persona.
  non_piu_necessaria boolean not null default false,
  nota text check (nota is null or char_length(nota) <= 300),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  constraint voce_coerente check (case tipo
    when 'derivata' then ingrediente_id is not null and unita is not null and quantita_richiesta is not null
    else ingrediente_id is not null or testo is not null end),
  constraint quantita_con_unita check ((quantita_richiesta is null and quantita_scelta is null) or unita is not null)
);
create unique index voce_derivata_unica on public.voce_spesa (famiglia_id, ingrediente_id, unita)
  where tipo = 'derivata' and stato = 'da_acquistare' and eliminato_il is null;
create index voce_spesa_seq on public.voce_spesa (famiglia_id, seq);

create table public.acquisto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  fonte text not null check (fonte in ('carrello', 'scontrino', 'manuale')),
  data date not null,
  negozio text check (negozio is null or char_length(btrim(negozio)) between 1 and 80),
  stato text not null default 'confermato' check (stato in ('confermato', 'annullato')),
  annullato_il timestamptz,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create index acquisto_seq on public.acquisto (famiglia_id, seq);

create table public.acquisto_riga (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  acquisto_id uuid not null references public.acquisto (id) on delete cascade,
  voce_id uuid references public.voce_spesa (id),
  -- Senza ingrediente la riga non va in casa (detersivo, pile…): resta solo per la spesa e il prezzo.
  ingrediente_id text references public.ingrediente (id),
  nome text check (nome is null or char_length(btrim(nome)) between 1 and 120),
  quantita numeric check (quantita is null or quantita >= 0),
  unita text check (unita in ('g', 'ml', 'pz')),
  -- Prezzo pagato per la riga, in euro (dallo scontrino o scritto da chi conferma).
  prezzo numeric(9, 2) check (prezzo is null or prezzo >= 0),
  lotto_id uuid references public.lotto (id),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  constraint riga_coerente check (
    (ingrediente_id is null or (quantita is not null and quantita > 0 and unita is not null))
    and (ingrediente_id is not null or nome is not null)
    and ((lotto_id is null) = (ingrediente_id is null)))
);
create index acquisto_riga_acquisto on public.acquisto_riga (acquisto_id);
create index acquisto_riga_ingrediente on public.acquisto_riga (famiglia_id, ingrediente_id) where prezzo is not null;
create index acquisto_riga_seq on public.acquisto_riga (famiglia_id, seq);

create trigger timbra before insert or update on public.voce_spesa for each row execute function interno.timbra();
create trigger timbra before insert or update on public.acquisto for each row execute function interno.timbra();
create trigger timbra before insert or update on public.acquisto_riga for each row execute function interno.timbra();

create trigger controlla_riferimenti before insert or update of ingrediente_id on public.voce_spesa
  for each row execute function interno.controlla_riferimenti();
create trigger controlla_riferimenti before insert or update of ingrediente_id on public.acquisto_riga
  for each row execute function interno.controlla_riferimenti();

-- Le unità devono essere quelle dell'ingrediente (come per ricette e lotti).
create trigger controlla_unita before insert or update of ingrediente_id, unita on public.voce_spesa
  for each row when (new.ingrediente_id is not null and new.unita is not null) execute function interno.controlla_unita();
create trigger controlla_unita before insert or update of ingrediente_id, unita on public.acquisto_riga
  for each row when (new.ingrediente_id is not null) execute function interno.controlla_unita();

-- ───────────────────────── Accesso ─────────────────────────

alter table public.voce_spesa enable row level security;
alter table public.acquisto enable row level security;
alter table public.acquisto_riga enable row level security;

create policy lettura on public.voce_spesa for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.acquisto for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.acquisto_riga for select to authenticated using (interno.sono_membro(famiglia_id));

revoke all on public.voce_spesa, public.acquisto, public.acquisto_riga from anon, authenticated;
grant select on public.voce_spesa, public.acquisto, public.acquisto_riga to authenticated;

-- ───────────────────────── Fabbisogno ─────────────────────────

-- L'ingrediente e i suoi genitori: gli spaghetti valgono anche come «pasta», non il contrario.
create function interno.antenati(p_ingrediente text) returns text[]
language plpgsql stable as $$
declare
  v_catena text[] := '{}';
  v_x text := p_ingrediente;
begin
  while v_x is not null and not v_x = any (v_catena) loop
    v_catena := v_catena || v_x;
    select genitore into v_x from public.ingrediente where id = v_x;
  end loop;
  return v_catena;
end $$;

-- Quanto serve per le portate tra due date, prima di guardare casa e carrello. Funzione pura sui dati:
-- porzioni automatiche come nell'app (somma delle porzioni di chi mangia, al mezzo), alternative con
-- le loro ricette, esclusi «q.b.», facoltativi e ingredienti di base (sale, olio, acqua…) che si danno per presenti.
create function interno.fabbisogno_menu(p_famiglia uuid, p_dal date, p_al date)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with persone as (
    select id, porzione from public.membro where famiglia_id = p_famiglia and eliminato_il is null and not archiviato
  ), portate as (
    select p.id, p.ricetta_id,
      coalesce(p.porzioni, round(2 * coalesce((
        select sum(x.porzione) from persone x
         where not exists (select 1 from public.eccezione_membro e
                           where e.portata_id = p.id and e.membro_id = x.id and e.eliminato_il is null)), 0)) / 2) as porzioni
      from public.portata p
     where p.famiglia_id = p_famiglia and p.eliminato_il is null and p.ricetta_id is not null and p.data between p_dal and p_al
  ), alternative as (
    select e.ricetta_id, coalesce(e.porzioni, x.porzione) as porzioni
      from public.eccezione_membro e
      join public.portata p on p.id = e.portata_id and p.eliminato_il is null and p.data between p_dal and p_al
      join persone x on x.id = e.membro_id
     where e.famiglia_id = p_famiglia and e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
  ), piatti as (
    select ricetta_id, porzioni from portate union all select ricetta_id, porzioni from alternative
  )
  select g.ingrediente_id, g.unita, sum(g.quantita * pi.porzioni / r.porzioni)
    from piatti pi
    join public.ricetta r on r.id = pi.ricetta_id
    join public.ricetta_ingrediente g on g.ricetta_id = r.id and g.eliminato_il is null
    join public.ingrediente i on i.id = g.ingrediente_id
   where pi.porzioni > 0 and not g.qb and not g.opzionale and g.quantita is not null and not i.base
   group by g.ingrediente_id, g.unita
$$;

-- Ricalcola le voci derivate per le portate tra «dal» e «al»:
--   da comprare = fabbisogno − casa − ciò che è già nel carrello o in lista a mano.
-- La casa copre prima gli ingredienti più specifici (spaghetti), poi quelli generici (pasta).
-- Scrive solo voci derivate da comprare; quelle nel carrello o oltre non si toccano, se non per
-- segnarle «non più necessarie». Ripeterlo dà sempre lo stesso risultato.
create function interno.cmd_ricalcola_spesa(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_dal date := (d ->> 'dal')::date;
  v_al date := (d ->> 'al')::date;
  v_bisogno record;
  v_lotto record;
  v_usato jsonb := '{}'::jsonb;
  v_resta numeric;
  v_prendo numeric;
  v_in_arrivo numeric;
  v_chiavi text[] := '{}';
  v_nuove integer := 0;
  v_aggiornate integer := 0;
  v_tolte integer := 0;
  v_voce public.voce_spesa;
begin
  if v_dal is null or v_al is null or v_al < v_dal or v_al - v_dal > 31 then
    perform interno.rifiuta('periodo_non_valido');
  end if;

  for v_bisogno in
    select f.ingrediente_id, f.unita, f.quantita, cardinality(interno.antenati(f.ingrediente_id)) as profondita
      from interno.fabbisogno_menu(p_famiglia, v_dal, v_al) f
     where f.quantita > 0
     order by 4 desc, 1
  loop
    v_resta := v_bisogno.quantita;
    -- Casa: lotti aperti dello stesso ingrediente o di un suo «figlio», prima quelli che scadono prima.
    for v_lotto in
      select l.id, l.quantita from public.lotto l
       where l.famiglia_id = p_famiglia and l.chiuso_il is null and l.eliminato_il is null and l.quantita > 0
         and l.unita = v_bisogno.unita and v_bisogno.ingrediente_id = any (interno.antenati(l.ingrediente_id))
       order by l.data_limite nulls last, l.creato_il
    loop
      exit when v_resta <= 0;
      v_prendo := least(v_resta, v_lotto.quantita - coalesce((v_usato ->> v_lotto.id::text)::numeric, 0));
      if v_prendo > 0 then
        v_usato := v_usato || jsonb_build_object(v_lotto.id::text, coalesce((v_usato ->> v_lotto.id::text)::numeric, 0) + v_prendo);
        v_resta := v_resta - v_prendo;
      end if;
    end loop;

    -- Voci nel carrello di questo ingrediente: servono ancora?
    update public.voce_spesa set non_piu_necessaria = (v_resta <= 0)
     where famiglia_id = p_famiglia and eliminato_il is null and stato = 'nel_carrello' and tipo = 'derivata'
       and ingrediente_id = v_bisogno.ingrediente_id and unita = v_bisogno.unita
       and non_piu_necessaria is distinct from (v_resta <= 0);

    -- Già in arrivo: nel carrello, o in lista a mano.
    select coalesce(sum(coalesce(v.quantita_scelta, v.quantita_richiesta)), 0) into v_in_arrivo
      from public.voce_spesa v
     where v.famiglia_id = p_famiglia and v.eliminato_il is null and v.ingrediente_id = v_bisogno.ingrediente_id
       and v.unita = v_bisogno.unita
       and (v.stato = 'nel_carrello' or (v.stato = 'da_acquistare' and v.tipo = 'manuale'));
    v_resta := v_resta - v_in_arrivo;

    if v_resta > 0 then
      v_chiavi := v_chiavi || (v_bisogno.ingrediente_id || '|' || v_bisogno.unita);
      v_resta := round(v_resta, 1);
      select * into v_voce from public.voce_spesa
       where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'da_acquistare' and eliminato_il is null
         and ingrediente_id = v_bisogno.ingrediente_id and unita = v_bisogno.unita for update;
      if v_voce.id is null then
        insert into public.voce_spesa (id, famiglia_id, tipo, ingrediente_id, unita, quantita_richiesta)
          values (interno.nuovo_id(interno.comando_corrente(), v_bisogno.ingrediente_id || '|' || v_bisogno.unita),
                  p_famiglia, 'derivata', v_bisogno.ingrediente_id, v_bisogno.unita, v_resta);
        v_nuove := v_nuove + 1;
      elsif v_voce.quantita_richiesta <> v_resta or v_voce.non_piu_necessaria then
        update public.voce_spesa set quantita_richiesta = v_resta, non_piu_necessaria = false where id = v_voce.id;
        v_aggiornate := v_aggiornate + 1;
      end if;
    end if;
  end loop;

  -- Derivate da comprare che non servono più: se nessuno le ha toccate spariscono, altrimenti restano segnate.
  for v_voce in
    select * from public.voce_spesa
     where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'da_acquistare' and eliminato_il is null
       and not (ingrediente_id || '|' || unita) = any (v_chiavi)
     for update
  loop
    if v_voce.quantita_scelta is null and v_voce.nota is null then
      update public.voce_spesa set eliminato_il = now() where id = v_voce.id;
    elsif not v_voce.non_piu_necessaria then
      update public.voce_spesa set non_piu_necessaria = true where id = v_voce.id;
    end if;
    v_tolte := v_tolte + 1;
  end loop;
  -- Nel carrello, ingredienti che il menu non chiede più affatto.
  update public.voce_spesa set non_piu_necessaria = true
   where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'nel_carrello' and eliminato_il is null
     and not non_piu_necessaria
     and not exists (select 1 from interno.fabbisogno_menu(p_famiglia, v_dal, v_al) f
                     where f.ingrediente_id = voce_spesa.ingrediente_id and f.unita = voce_spesa.unita and f.quantita > 0);

  return jsonb_build_object('nuove', v_nuove, 'aggiornate', v_aggiornate, 'non_piu_necessarie', v_tolte);
end $$;

-- ───────────────────────── Comandi: lista ─────────────────────────

create function interno.cmd_aggiungi_voce(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  insert into public.voce_spesa (id, famiglia_id, tipo, ingrediente_id, testo, unita, quantita_richiesta, nota)
    values ((d ->> 'id')::uuid, p_famiglia, 'manuale', d ->> 'ingrediente_id', nullif(btrim(d ->> 'testo'), ''), d ->> 'unita',
            (d ->> 'quantita')::numeric, nullif(btrim(d ->> 'nota'), ''));
  return '{}'::jsonb;
end $$;

create function interno.cmd_modifica_voce(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  -- La quantità richiesta di una derivata la decide il menu: chi vuole altro sceglie la sua.
  if d -> 'campi' ? 'quantita_richiesta' and exists (
      select 1 from public.voce_spesa where id = (d ->> 'id')::uuid and tipo = 'derivata') then
    perform interno.rifiuta('campo_non_ammesso', jsonb_build_object('campo', 'quantita_richiesta'));
  end if;
  return interno.aggiorna_campi('voce_spesa', (d ->> 'id')::uuid, p_famiglia, (d ->> 'versione_attesa')::integer, d -> 'campi',
    array['quantita_richiesta', 'quantita_scelta', 'unita', 'testo', 'nota', 'non_piu_necessaria']);
end $$;

-- Spuntare in negozio (nel carrello), togliere la spunta, o togliere dalla lista. Chi spunta la stessa
-- voce da due telefoni ottiene lo stesso risultato; una voce già acquistata non torna indietro.
create function interno.cmd_imposta_stato_voce(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_voce public.voce_spesa;
  v_stato text := d ->> 'stato';
begin
  if v_stato not in ('da_acquistare', 'nel_carrello', 'rimossa') then
    perform interno.rifiuta('stato_non_ammesso');
  end if;
  select * into v_voce from public.voce_spesa where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia for update;
  if v_voce.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_voce.stato = 'acquistata' then
    perform interno.conflitto(jsonb_build_object('motivo', 'gia_acquistata', 'modificato_da', v_voce.modificato_da));
  end if;
  if v_voce.stato = v_stato or v_voce.eliminato_il is not null then
    return '{}'::jsonb;
  end if;
  -- Una derivata rimessa da comprare si fonde con quella che il ricalcolo avesse già creato nel frattempo.
  if v_stato = 'da_acquistare' and v_voce.tipo = 'derivata' and exists (
      select 1 from public.voce_spesa where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'da_acquistare'
         and eliminato_il is null and ingrediente_id = v_voce.ingrediente_id and unita = v_voce.unita) then
    update public.voce_spesa set eliminato_il = now() where id = v_voce.id;
    return jsonb_build_object('unita_a', v_voce.ingrediente_id);
  end if;
  update public.voce_spesa set stato = v_stato, non_piu_necessaria = case when v_stato = 'rimossa' then false else non_piu_necessaria end
   where id = v_voce.id;
  return '{}'::jsonb;
end $$;

-- ───────────────────────── Comandi: acquisti ─────────────────────────

-- Conferma della spesa: crea l'acquisto, le righe, un lotto per ogni riga con ingrediente e il suo
-- carico. È l'unico modo in cui un acquisto entra in casa. Lo stesso acquisto confermato due volte
-- (anche con un altro comando) non carica di nuovo.
--   { id, fonte?, data, negozio?, righe: [{ id, voce_id?, ingrediente_id?, nome?, quantita?, unita?, prezzo?,
--     lotto_id?, luogo?, data_limite?, tipo_data?, fonte_data?, calcolata_il? }] }
create function interno.cmd_conferma_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_r jsonb;
  v_n integer := 0;
  v_lotti integer := 0;
begin
  if exists (select 1 from public.acquisto where id = (d ->> 'id')::uuid) then
    if not exists (select 1 from public.acquisto where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia) then
      perform interno.rifiuta('non_trovato');
    end if;
    return jsonb_build_object('gia_confermato', d ->> 'id');
  end if;
  if coalesce(d ->> 'fonte', 'carrello') not in ('carrello', 'manuale') then
    perform interno.rifiuta('fonte_non_ammessa');
  end if;
  if jsonb_typeof(d -> 'righe') <> 'array' or jsonb_array_length(d -> 'righe') = 0 or jsonb_array_length(d -> 'righe') > 200 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  insert into public.acquisto (id, famiglia_id, fonte, data, negozio)
    values ((d ->> 'id')::uuid, p_famiglia, coalesce(d ->> 'fonte', 'carrello'), coalesce((d ->> 'data')::date, current_date),
            nullif(btrim(d ->> 'negozio'), ''));

  for v_r in select * from jsonb_array_elements(d -> 'righe') loop
    if v_r ->> 'ingrediente_id' is not null then
      if (v_r ->> 'quantita')::numeric is null or (v_r ->> 'quantita')::numeric <= 0 then
        perform interno.rifiuta('quantita_non_valida', jsonb_build_object('riga', v_r ->> 'id'));
      end if;
      insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
          fonte_data, calcolata_il, affidabilita, origine)
        values ((v_r ->> 'lotto_id')::uuid, p_famiglia, v_r ->> 'ingrediente_id', nullif(btrim(v_r ->> 'nome'), ''), v_r ->> 'unita',
          coalesce(v_r ->> 'luogo', 'dispensa'), coalesce((d ->> 'data')::date, current_date), (v_r ->> 'data_limite')::date,
          coalesce(v_r ->> 'tipo_data', 'sconosciuta'), v_r ->> 'fonte_data', (v_r ->> 'calcolata_il')::timestamptz,
          v_r ->> 'affidabilita', 'acquisto');
      perform interno.nuovo_movimento(p_famiglia, (v_r ->> 'lotto_id')::uuid, (v_r ->> 'quantita')::numeric, 'carico', null);
      v_lotti := v_lotti + 1;
    end if;
    insert into public.acquisto_riga (id, famiglia_id, acquisto_id, voce_id, ingrediente_id, nome, quantita, unita, prezzo, lotto_id)
      values ((v_r ->> 'id')::uuid, p_famiglia, (d ->> 'id')::uuid,
        (select v.id from public.voce_spesa v where v.id = (v_r ->> 'voce_id')::uuid and v.famiglia_id = p_famiglia),
        v_r ->> 'ingrediente_id', nullif(btrim(v_r ->> 'nome'), ''), (v_r ->> 'quantita')::numeric, v_r ->> 'unita',
        (v_r ->> 'prezzo')::numeric, case when v_r ->> 'ingrediente_id' is not null then (v_r ->> 'lotto_id')::uuid end);
    update public.voce_spesa set stato = 'acquistata', non_piu_necessaria = false
     where id = (v_r ->> 'voce_id')::uuid and famiglia_id = p_famiglia and eliminato_il is null and stato <> 'acquistata';
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('righe', v_n, 'lotti', v_lotti);
end $$;

-- Annullare un acquisto: un movimento «annullo» opposto per ogni lotto. Se una parte è già stata
-- usata si toglie solo quel che resta, e lo si dice: il lotto non va mai sotto zero.
create function interno.cmd_annulla_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_acquisto public.acquisto;
  v_riga record;
  v_toglie numeric;
  v_gia_usati jsonb := '[]'::jsonb;
begin
  select * into v_acquisto from public.acquisto where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia for update;
  if v_acquisto.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_acquisto.stato = 'annullato' then
    return jsonb_build_object('gia_annullato', v_acquisto.id);
  end if;
  for v_riga in
    select r.id, r.nome, r.ingrediente_id, r.quantita, l.id as lotto_id, l.quantita as in_casa
      from public.acquisto_riga r join public.lotto l on l.id = r.lotto_id
     where r.acquisto_id = v_acquisto.id and r.eliminato_il is null
     for update of l
  loop
    v_toglie := least(v_riga.quantita, v_riga.in_casa);
    if v_toglie < v_riga.quantita then
      v_gia_usati := v_gia_usati || jsonb_build_object('riga', v_riga.id, 'ingrediente_id', v_riga.ingrediente_id,
        'acquistato', v_riga.quantita, 'tolto', v_toglie);
    end if;
    if v_toglie > 0 then
      perform interno.nuovo_movimento(p_famiglia, v_riga.lotto_id, -v_toglie, 'annullo', 'acquisto annullato');
    end if;
  end loop;
  update public.acquisto set stato = 'annullato', annullato_il = now() where id = v_acquisto.id;
  -- Le voci della lista tornano da comprare: il prossimo ricalcolo deciderà se servono ancora.
  update public.voce_spesa v set stato = 'da_acquistare'
   where v.id in (select r.voce_id from public.acquisto_riga r where r.acquisto_id = v_acquisto.id)
     and v.stato = 'acquistata' and v.tipo = 'manuale';
  return jsonb_build_object('gia_usati', v_gia_usati);
end $$;

-- «Erano 1 l, non 2»: un solo movimento di differenza sul lotto, e la riga che dice la quantità giusta.
-- Vale solo se la quantità era ancora quella vista; il prezzo si può aggiungere o correggere qui.
create function interno.cmd_correggi_riga_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_riga public.acquisto_riga;
  v_acquisto public.acquisto;
  v_nuova numeric := (d ->> 'quantita_nuova')::numeric;
  v_lotto public.lotto;
begin
  select * into v_riga from public.acquisto_riga where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia for update;
  if v_riga.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  select * into v_acquisto from public.acquisto where id = v_riga.acquisto_id;
  if v_acquisto.stato = 'annullato' then
    perform interno.rifiuta('acquisto_annullato');
  end if;
  if d ? 'prezzo' then
    update public.acquisto_riga set prezzo = (d ->> 'prezzo')::numeric where id = v_riga.id;
  end if;
  if v_nuova is null then
    return '{}'::jsonb;
  end if;
  if v_riga.ingrediente_id is null or v_nuova <= 0 then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  if v_riga.quantita <> (d ->> 'quantita_vista')::numeric then
    perform interno.conflitto(jsonb_build_object('motivo', 'quantita_cambiata', 'valore_attuale', v_riga.quantita,
      'modificato_da', v_riga.modificato_da));
  end if;
  if v_nuova <> v_riga.quantita then
    v_lotto := interno.lotto_della_famiglia(p_famiglia, v_riga.lotto_id);
    if v_lotto.quantita + (v_nuova - v_riga.quantita) < 0 then
      perform interno.rifiuta('quantita_insufficiente', jsonb_build_object('disponibile', v_lotto.quantita));
    end if;
    perform interno.nuovo_movimento(p_famiglia, v_riga.lotto_id, v_nuova - v_riga.quantita, 'correzione', 'acquisto corretto');
    update public.acquisto_riga set quantita = v_nuova where id = v_riga.id;
  end if;
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values
  ('ricalcola_spesa', 'cmd_ricalcola_spesa'),
  ('aggiungi_voce', 'cmd_aggiungi_voce'),
  ('modifica_voce', 'cmd_modifica_voce'),
  ('imposta_stato_voce', 'cmd_imposta_stato_voce'),
  ('conferma_acquisto', 'cmd_conferma_acquisto'),
  ('annulla_acquisto', 'cmd_annulla_acquisto'),
  ('correggi_riga_acquisto', 'cmd_correggi_riga_acquisto');

-- ───────────────────────── Scaricare le modifiche ─────────────────────────

create or replace function public.scarica_modifiche(p_famiglia uuid, p_dopo bigint, p_limite integer default 500)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_righe jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 500), 1), 1000);
  v_amministratore boolean := interno.sono_amministratore(p_famiglia);
begin
  if auth.uid() is null or interno.ruolo_in(p_famiglia, auth.uid()) is null then
    return jsonb_build_object('errore', 'non_autorizzato');
  end if;

  with tutte as (
    select 'famiglia' as tabella, t.seq, to_jsonb(t) as riga from public.famiglia t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'utente_famiglia', t.seq, to_jsonb(t) from public.utente_famiglia t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'membro', t.seq, to_jsonb(t) from public.membro t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'vincolo_alimentare', t.seq, to_jsonb(t) from public.vincolo_alimentare t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'invito', t.seq, case when v_amministratore then to_jsonb(t) else to_jsonb(t) - 'codice' end
      from public.invito t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'comando', t.seq, to_jsonb(t) from public.comando t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ingrediente', t.seq, to_jsonb(t) from public.ingrediente t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta', t.seq, to_jsonb(t) from public.ricetta t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta_ingrediente', t.seq, to_jsonb(t) from public.ricetta_ingrediente t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta_passo', t.seq, to_jsonb(t) from public.ricetta_passo t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'lotto', t.seq, to_jsonb(t) from public.lotto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'movimento', t.seq, to_jsonb(t) from public.movimento t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'categoria_pasto', t.seq, to_jsonb(t) from public.categoria_pasto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'portata', t.seq, to_jsonb(t) from public.portata t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'eccezione_membro', t.seq, to_jsonb(t) from public.eccezione_membro t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'gusto', t.seq, to_jsonb(t) from public.gusto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'voce_spesa', t.seq, to_jsonb(t) from public.voce_spesa t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'acquisto', t.seq, to_jsonb(t) from public.acquisto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'acquisto_riga', t.seq, to_jsonb(t) from public.acquisto_riga t where t.famiglia_id = p_famiglia and t.seq > p_dopo
  ), pagina as (
    select * from tutte order by seq limit v_limite + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('tabella', tabella, 'seq', seq, 'riga', riga) order by seq), '[]'::jsonb)
    into v_righe from pagina;

  return jsonb_build_object(
    'righe', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
               select e from jsonb_array_elements(v_righe) with ordinality as x(e, n) where n <= v_limite) s),
    'altre', jsonb_array_length(v_righe) > v_limite);
end $$;

-- ───────────────────────── Ripristino: file della versione 4 (con spesa e acquisti) ─────────────────────────
-- Il ripristino delle versioni 1–3 resta com'è; per la 4 si ripristina prima tutto il resto (come una 3)
-- e poi lista e acquisti, con gli id tradotti allo stesso modo.

alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_fino_a_3;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_vecchia uuid := (v_tabelle -> 'famiglia' -> 0 ->> 'id')::uuid;
  v_conta jsonb;
  v_tabella text;
  v_r jsonb;
  v_n integer := 0;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' or (v_file ->> 'versione_schema') is distinct from '4' then
    return interno.ripristina_fino_a_3(p_famiglia, d, p_utente);
  end if;
  foreach v_tabella in array array['voce_spesa', 'acquisto', 'acquisto_riga'] loop
    if coalesce(jsonb_typeof(v_tabelle -> v_tabella), '') <> 'array' then
      perform interno.rifiuta('file_incompleto');
    end if;
    if exists (select 1 from jsonb_array_elements(v_tabelle -> v_tabella) e where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia) then
      perform interno.rifiuta('file_incoerente');
    end if;
  end loop;
  v_conta := interno.ripristina_fino_a_3(p_famiglia, jsonb_set(d, '{file,versione_schema}', '3'), p_utente);

  for v_r in select * from jsonb_array_elements(v_tabelle -> 'voce_spesa') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.voce_spesa (id, famiglia_id, tipo, ingrediente_id, testo, unita, quantita_richiesta, quantita_scelta,
        stato, non_piu_necessaria, nota)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'tipo',
        case when v_r ->> 'ingrediente_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id') end,
        v_r ->> 'testo', v_r ->> 'unita', (v_r ->> 'quantita_richiesta')::numeric, (v_r ->> 'quantita_scelta')::numeric,
        v_r ->> 'stato', coalesce((v_r ->> 'non_piu_necessaria')::boolean, false), v_r ->> 'nota');
  end loop;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'acquisto') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.acquisto (id, famiglia_id, fonte, data, negozio, stato, annullato_il)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'fonte', (v_r ->> 'data')::date, v_r ->> 'negozio',
        v_r ->> 'stato', (v_r ->> 'annullato_il')::timestamptz);
    v_n := v_n + 1;
  end loop;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'acquisto_riga') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.acquisto_riga (id, famiglia_id, acquisto_id, voce_id, ingrediente_id, nome, quantita, unita, prezzo, lotto_id)
      select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, a.id,
        (select v.id from public.voce_spesa v where v.id = interno.nuovo_id(p_famiglia, v_r ->> 'voce_id')),
        case when v_r ->> 'ingrediente_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id') end,
        v_r ->> 'nome', (v_r ->> 'quantita')::numeric, v_r ->> 'unita', (v_r ->> 'prezzo')::numeric,
        (select l.id from public.lotto l where l.id = interno.nuovo_id(p_famiglia, v_r ->> 'lotto_id'))
      from public.acquisto a where a.id = interno.nuovo_id(p_famiglia, v_r ->> 'acquisto_id');
  end loop;
  return v_conta || jsonb_build_object('acquisti', v_n);
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
