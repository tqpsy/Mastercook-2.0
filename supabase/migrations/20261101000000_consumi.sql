-- Mastercook 2.0 · Fase 5: conferma dei pasti, consumi e avanzi.
--
-- - conferma_pasto: dopo un pasto, una persona dice com'è andata (come previsto, quantità diverse, altro piatto,
--   saltato) e se ci sono avanzi. Una sola conferma attiva per portata; correggerla crea una revisione nuova.
--   La portata del menu non cambia mai per somigliare al reale (R-CON-2).
-- - consumo_riga: per ogni ingrediente, quanto era previsto e quanto è stato usato (T-CON-5).
-- - consumo_lotto: quanto è stato preso (o restituito) da ogni lotto, per ingrediente. Da qui una correzione
--   calcola solo la differenza: 320 g → 200 g restituisce 120 g, senza togliere di nuovo (T-CON-4).
-- - Gli avanzi sono lotti con origine «avanzo» e ingrediente di sistema `ing:avanzo` (in porzioni), legati alla conferma.

insert into public.ingrediente (id, nome, sinonimi, reparto, sottocategoria, dimensione, luogo, giorni, allergeni, classi, base, emoji)
  values ('ing:avanzo', 'Avanzo', array['avanzi', 'piatto avanzato', 'porzione avanzata'], 'gastronomia', 'Avanzi', 'pezzi', 'frigo',
          2, '{}', '{}', false, '🥡')
  on conflict (id) do nothing;

create table public.conferma_pasto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  portata_id uuid not null references public.portata (id) on delete cascade,
  revisione integer not null check (revisione >= 1),
  esito text not null check (esito in ('come_previsto', 'quantita_diverse', 'altro_piatto', 'saltato')),
  -- Solo per «altro piatto»: cosa si è mangiato davvero, con quante porzioni.
  ricetta_id text references public.ricetta (id),
  testo text check (testo is null or char_length(btrim(testo)) between 1 and 120),
  porzioni numeric(5, 2) check (porzioni is null or porzioni > 0 and porzioni <= 100),
  attiva boolean not null default true,
  nota text check (nota is null or char_length(nota) <= 500),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  unique (portata_id, revisione),
  constraint altro_piatto_coerente check (esito = 'altro_piatto' or (ricetta_id is null and testo is null))
);
create unique index conferma_pasto_attiva on public.conferma_pasto (portata_id) where attiva;
create index conferma_pasto_seq on public.conferma_pasto (famiglia_id, seq);

create table public.consumo_riga (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  conferma_id uuid not null references public.conferma_pasto (id) on delete cascade,
  ingrediente_id text not null references public.ingrediente (id),
  unita text not null check (unita in ('g', 'ml', 'pz')),
  quantita_prevista numeric check (quantita_prevista is null or quantita_prevista >= 0),
  quantita_usata numeric not null check (quantita_usata >= 0),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  unique (conferma_id, ingrediente_id, unita)
);
create index consumo_riga_seq on public.consumo_riga (famiglia_id, seq);

create table public.consumo_lotto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  conferma_id uuid not null references public.conferma_pasto (id) on delete cascade,
  lotto_id uuid not null references public.lotto (id) on delete cascade,
  ingrediente_id text not null references public.ingrediente (id),
  unita text not null check (unita in ('g', 'ml', 'pz')),
  -- Positivo: preso dal lotto; negativo: restituito da una correzione.
  quantita numeric not null check (quantita <> 0),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create index consumo_lotto_conferma on public.consumo_lotto (conferma_id);
create index consumo_lotto_seq on public.consumo_lotto (famiglia_id, seq);

alter table public.lotto add column conferma_id uuid references public.conferma_pasto (id);

create trigger timbra before insert or update on public.conferma_pasto for each row execute function interno.timbra();
create trigger timbra before insert or update on public.consumo_riga for each row execute function interno.timbra();
create trigger timbra before insert or update on public.consumo_lotto for each row execute function interno.timbra();
create trigger controlla_riferimenti before insert or update of ricetta_id on public.conferma_pasto
  for each row execute function interno.controlla_riferimenti();
create trigger controlla_unita before insert or update of ingrediente_id, unita on public.consumo_riga
  for each row execute function interno.controlla_unita();

alter table public.conferma_pasto enable row level security;
alter table public.consumo_riga enable row level security;
alter table public.consumo_lotto enable row level security;
create policy lettura on public.conferma_pasto for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.consumo_riga for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.consumo_lotto for select to authenticated using (interno.sono_membro(famiglia_id));
revoke all on public.conferma_pasto, public.consumo_riga, public.consumo_lotto from anon, authenticated;
grant select on public.conferma_pasto, public.consumo_riga, public.consumo_lotto to authenticated;

-- ───────────────────────── Previsto ─────────────────────────

-- Gli ingredienti di un piatto per un numero di porzioni: come la spesa, senza «q.b.», facoltativi e
-- ingredienti di base (sale, olio, pepe), che non si pesano.
create function interno.ingredienti_piatto(p_ricetta text, p_porzioni numeric)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  select g.ingrediente_id, g.unita, trim_scale(round(sum(g.quantita * p_porzioni / r.porzioni), 1))
    from public.ricetta r
    join public.ricetta_ingrediente g on g.ricetta_id = r.id and g.eliminato_il is null
    join public.ingrediente i on i.id = g.ingrediente_id
   where r.id = p_ricetta and p_porzioni > 0 and not g.qb and not g.opzionale and g.quantita is not null and not i.base
   group by g.ingrediente_id, g.unita
$$;

-- Il previsto di una portata: il piatto per le porzioni (indicate, o automatiche da chi mangia) più le
-- alternative di chi mangia altro. Stesso calcolo della lista della spesa.
create function interno.previsto_portata(p_portata uuid)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with p as (
    select * from public.portata where id = p_portata and eliminato_il is null
  ), persone as (
    select m.id, m.porzione from public.membro m join p on m.famiglia_id = p.famiglia_id
     where m.eliminato_il is null and not m.archiviato
  ), piatti as (
    select p.ricetta_id,
      coalesce(p.porzioni, round(2 * coalesce((
        select sum(x.porzione) from persone x
         where not exists (select 1 from public.eccezione_membro e
                           where e.portata_id = p.id and e.membro_id = x.id and e.eliminato_il is null)), 0)) / 2) as porzioni
      from p where p.ricetta_id is not null
    union all
    select e.ricetta_id, coalesce(e.porzioni, x.porzione)
      from public.eccezione_membro e join p on p.id = e.portata_id join persone x on x.id = e.membro_id
     where e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
  )
  select f.ingrediente_id, f.unita, sum(f.quantita)
    from piatti pi cross join lateral interno.ingredienti_piatto(pi.ricetta_id, pi.porzioni) f
   group by f.ingrediente_id, f.unita
$$;

-- ───────────────────────── Conferma del pasto ─────────────────────────

-- Conferma (o corregge) un pasto.
--   { id, portata_id, esito, revisione_attesa?, ricetta_id?, testo?, porzioni?, nota?,
--     righe?: [{ ingrediente_id, unita, quantita }],          -- quanto è stato usato davvero
--     avanzi?: [{ lotto_id, nome, quantita, luogo, data_limite?, tipo_data?, fonte_data?, calcolata_il?, affidabilita? }] }
-- Senza revisione_attesa è la prima conferma: se un altro dispositivo ha già confermato risponde
-- `gia_confermato`. Con revisione_attesa è una correzione della revisione vista.
-- Lo scarico prende dai lotti che scadono prima (T-CON-8); una correzione sposta solo la differenza.
create function interno.cmd_conferma_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_portata public.portata;
  v_attiva public.conferma_pasto;
  v_esito text := d ->> 'esito';
  v_porzioni numeric := (d ->> 'porzioni')::numeric;
  v_ricetta text := nullif(d ->> 'ricetta_id', '');
  v_previsto jsonb := '{}'::jsonb;
  v_usato jsonb := '{}'::jsonb;
  v_r record;
  v_x jsonb;
  v_chiave text;
  v_ing text;
  v_unita text;
  v_preso numeric;
  v_resta numeric;
  v_prendo numeric;
  v_lotti jsonb := '{}'::jsonb;   -- lotto → variazione in questo comando
  v_mancanti jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  select * into v_portata from public.portata
   where id = (d ->> 'portata_id')::uuid and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_portata.id is null then
    perform interno.rifiuta('portata_non_trovata');
  end if;
  select * into v_attiva from public.conferma_pasto where portata_id = v_portata.id and attiva;
  if d ->> 'revisione_attesa' is null and v_attiva.id is not null then
    perform interno.conflitto(jsonb_build_object('motivo', 'gia_confermato', 'conferma', v_attiva.id, 'esito', v_attiva.esito,
      'revisione', v_attiva.revisione, 'modificato_da', v_attiva.creato_da));
  end if;
  if d ->> 'revisione_attesa' is not null and (d ->> 'revisione_attesa')::integer is distinct from v_attiva.revisione then
    perform interno.conflitto(jsonb_build_object('motivo', 'conferma_cambiata', 'revisione', v_attiva.revisione,
      'modificato_da', v_attiva.creato_da));
  end if;
  if v_esito is null or v_esito not in ('come_previsto', 'quantita_diverse', 'altro_piatto', 'saltato') then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'esito'));
  end if;
  if v_esito = 'altro_piatto' and v_ricetta is null and nullif(btrim(d ->> 'testo'), '') is null then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'ricetta_id'));
  end if;
  if v_ricetta is not null and not exists (select 1 from public.ricetta r where r.id = v_ricetta
                                            and (r.famiglia_id is null or r.famiglia_id = p_famiglia) and r.eliminato_il is null) then
    perform interno.rifiuta('ricetta_non_trovata');
  end if;

  for v_r in select * from interno.previsto_portata(v_portata.id) loop
    v_previsto := v_previsto || jsonb_build_object(v_r.ingrediente_id || '|' || v_r.unita, v_r.quantita);
  end loop;

  -- Quanto è stato usato: le righe scritte dalla persona valgono sempre; altrimenti dipende dall'esito.
  if jsonb_typeof(d -> 'righe') = 'array' then
    for v_x in select * from jsonb_array_elements(d -> 'righe') loop
      if (v_x ->> 'quantita')::numeric is null or (v_x ->> 'quantita')::numeric < 0 then
        perform interno.rifiuta('quantita_non_valida', jsonb_build_object('ingrediente', v_x ->> 'ingrediente_id'));
      end if;
      v_chiave := (v_x ->> 'ingrediente_id') || '|' || (v_x ->> 'unita');
      v_usato := v_usato || jsonb_build_object(v_chiave, coalesce((v_usato ->> v_chiave)::numeric, 0) + (v_x ->> 'quantita')::numeric);
    end loop;
  elsif v_esito = 'come_previsto' then
    v_usato := v_previsto;
  elsif v_esito = 'altro_piatto' and v_ricetta is not null then
    if v_porzioni is null then
      perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'porzioni'));
    end if;
    for v_r in select * from interno.ingredienti_piatto(v_ricetta, v_porzioni) loop
      v_usato := v_usato || jsonb_build_object(v_r.ingrediente_id || '|' || v_r.unita, v_r.quantita);
    end loop;
  elsif v_esito = 'quantita_diverse' then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'righe'));
  end if;

  if v_attiva.id is not null then
    update public.conferma_pasto set attiva = false where id = v_attiva.id;
  end if;
  insert into public.conferma_pasto (id, famiglia_id, portata_id, revisione, esito, ricetta_id, testo, porzioni, nota)
    values ((d ->> 'id')::uuid, p_famiglia, v_portata.id, coalesce(v_attiva.revisione, 0) + 1, v_esito,
      case when v_esito = 'altro_piatto' then v_ricetta end,
      case when v_esito = 'altro_piatto' and v_ricetta is null then nullif(btrim(d ->> 'testo'), '') end,
      case when v_esito = 'altro_piatto' then v_porzioni end, nullif(btrim(d ->> 'nota'), ''));

  for v_chiave in select k from jsonb_object_keys(v_previsto || v_usato) k order by k loop
    insert into public.consumo_riga (id, famiglia_id, conferma_id, ingrediente_id, unita, quantita_prevista, quantita_usata)
      values (interno.nuovo_id((d ->> 'id')::uuid, 'riga:' || v_chiave), p_famiglia, (d ->> 'id')::uuid, split_part(v_chiave, '|', 1),
        split_part(v_chiave, '|', 2), (v_previsto ->> v_chiave)::numeric, coalesce((v_usato ->> v_chiave)::numeric, 0));
  end loop;

  -- Per ogni ingrediente: quanto è già stato preso dalla casa per questa portata, e quanto va preso ora.
  for v_chiave in
    select k from (select jsonb_object_keys(v_usato) k
                   union select c.ingrediente_id || '|' || c.unita from public.consumo_lotto c
                     join public.conferma_pasto cp on cp.id = c.conferma_id where cp.portata_id = v_portata.id) s order by k
  loop
    v_ing := split_part(v_chiave, '|', 1);
    v_unita := split_part(v_chiave, '|', 2);
    select coalesce(sum(c.quantita), 0) into v_preso from public.consumo_lotto c
      join public.conferma_pasto cp on cp.id = c.conferma_id
     where cp.portata_id = v_portata.id and c.ingrediente_id = v_ing and c.unita = v_unita;
    v_resta := coalesce((v_usato ->> v_chiave)::numeric, 0) - v_preso;

    if v_resta > 0 then
      -- Dai lotti aperti che valgono come quell'ingrediente (gli spaghetti valgono come pasta), prima chi scade prima.
      for v_r in
        select l.id, l.quantita + coalesce((v_lotti ->> l.id::text)::numeric, 0) as disponibile
          from public.lotto l
         where l.famiglia_id = p_famiglia and l.eliminato_il is null and l.chiuso_il is null and l.unita = v_unita
           and v_ing = any (interno.antenati(l.ingrediente_id))
         order by l.data_limite nulls last, l.data_acquisto nulls last, l.creato_il, l.id
      loop
        exit when v_resta <= 0;
        v_prendo := least(v_resta, v_r.disponibile);
        continue when v_prendo <= 0;
        v_lotti := v_lotti || jsonb_build_object(v_r.id::text, coalesce((v_lotti ->> v_r.id::text)::numeric, 0) - v_prendo);
        insert into public.consumo_lotto (id, famiglia_id, conferma_id, lotto_id, ingrediente_id, unita, quantita)
          values (interno.nuovo_id((d ->> 'id')::uuid, 'lotto:' || v_r.id || ':' || v_chiave), p_famiglia, (d ->> 'id')::uuid,
                  v_r.id, v_ing, v_unita, v_prendo);
        v_resta := v_resta - v_prendo;
      end loop;
      if v_resta > 0 then
        v_mancanti := v_mancanti || jsonb_build_object('ingrediente_id', v_ing, 'unita', v_unita, 'quantita', v_resta);
      end if;
    elsif v_resta < 0 then
      -- Si restituisce ai lotti da cui si era preso, partendo dall'ultimo.
      for v_r in
        select c.lotto_id, sum(c.quantita) as preso, max(c.creato_il) as quando
          from public.consumo_lotto c join public.conferma_pasto cp on cp.id = c.conferma_id
         where cp.portata_id = v_portata.id and c.ingrediente_id = v_ing and c.unita = v_unita
         group by c.lotto_id having sum(c.quantita) > 0
         order by quando desc, c.lotto_id
      loop
        exit when v_resta >= 0;
        v_prendo := least(-v_resta, v_r.preso);
        v_lotti := v_lotti || jsonb_build_object(v_r.lotto_id::text, coalesce((v_lotti ->> v_r.lotto_id::text)::numeric, 0) + v_prendo);
        insert into public.consumo_lotto (id, famiglia_id, conferma_id, lotto_id, ingrediente_id, unita, quantita)
          values (interno.nuovo_id((d ->> 'id')::uuid, 'lotto:' || v_r.lotto_id || ':' || v_chiave), p_famiglia, (d ->> 'id')::uuid,
                  v_r.lotto_id, v_ing, v_unita, -v_prendo);
        v_resta := v_resta + v_prendo;
      end loop;
    end if;
  end loop;

  -- Un solo movimento per lotto: consumo se si toglie, correzione se si restituisce.
  for v_r in select key::uuid as lotto, value::numeric as variazione from jsonb_each_text(v_lotti) loop
    continue when v_r.variazione = 0;
    perform interno.nuovo_movimento(p_famiglia, v_r.lotto, v_r.variazione,
      case when v_r.variazione < 0 then 'consumo' else 'correzione' end, 'Pasto del ' || to_char(v_portata.data, 'DD/MM'));
    v_n := v_n + 1;
  end loop;

  -- Avanzi: lotti nuovi in porzioni, legati alla conferma.
  if jsonb_typeof(d -> 'avanzi') = 'array' then
    for v_x in select * from jsonb_array_elements(d -> 'avanzi') loop
      if (v_x ->> 'quantita')::numeric is null or (v_x ->> 'quantita')::numeric <= 0 then
        perform interno.rifiuta('quantita_non_valida', jsonb_build_object('avanzo', v_x ->> 'nome'));
      end if;
      insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
          fonte_data, calcolata_il, affidabilita, origine, conferma_id)
        values ((v_x ->> 'lotto_id')::uuid, p_famiglia, 'ing:avanzo', nullif(btrim(v_x ->> 'nome'), ''), 'pz',
          coalesce(v_x ->> 'luogo', 'frigo'), v_portata.data, (v_x ->> 'data_limite')::date, coalesce(v_x ->> 'tipo_data', 'sconosciuta'),
          v_x ->> 'fonte_data', (v_x ->> 'calcolata_il')::timestamptz, v_x ->> 'affidabilita', 'avanzo', (d ->> 'id')::uuid);
      perform interno.nuovo_movimento(p_famiglia, (v_x ->> 'lotto_id')::uuid, (v_x ->> 'quantita')::numeric, 'carico', null);
    end loop;
  end if;

  return jsonb_build_object('revisione', coalesce(v_attiva.revisione, 0) + 1, 'movimenti', v_n, 'mancanti', v_mancanti);
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('conferma_pasto', 'cmd_conferma_pasto');

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
    union all
    select 'prodotto', t.seq, to_jsonb(t) from public.prodotto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'scontrino', t.seq, to_jsonb(t) from public.scontrino t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'scontrino_riga', t.seq, to_jsonb(t) from public.scontrino_riga t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'conferma_pasto', t.seq, to_jsonb(t) from public.conferma_pasto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'consumo_riga', t.seq, to_jsonb(t) from public.consumo_riga t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'consumo_lotto', t.seq, to_jsonb(t) from public.consumo_lotto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
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

-- ───────────────────────── Ripristino: file della versione 6 ─────────────────────────

alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_fino_a_5;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_vecchia uuid := (v_tabelle -> 'famiglia' -> 0 ->> 'id')::uuid;
  v_conta jsonb;
  v_tabella text;
  v_r jsonb;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' or (v_file ->> 'versione_schema') is distinct from '6' then
    return interno.ripristina_fino_a_5(p_famiglia, d, p_utente);
  end if;
  foreach v_tabella in array array['conferma_pasto', 'consumo_riga', 'consumo_lotto'] loop
    if coalesce(jsonb_typeof(v_tabelle -> v_tabella), '') <> 'array' then
      perform interno.rifiuta('file_incompleto');
    end if;
    if exists (select 1 from jsonb_array_elements(v_tabelle -> v_tabella) e where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia) then
      perform interno.rifiuta('file_incoerente');
    end if;
  end loop;
  v_conta := interno.ripristina_fino_a_5(p_famiglia, jsonb_set(d, '{file,versione_schema}', '5'), p_utente);

  -- Prima le revisioni vecchie, poi l'attiva: l'indice unico vuole una sola attiva per portata.
  for v_r in select e from jsonb_array_elements(v_tabelle -> 'conferma_pasto') e order by (e ->> 'attiva')::boolean, (e ->> 'revisione')::integer loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.conferma_pasto (id, famiglia_id, portata_id, revisione, esito, ricetta_id, testo, porzioni, attiva, nota)
      select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, p.id, (v_r ->> 'revisione')::integer, v_r ->> 'esito',
        (select r.id from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id')),
        v_r ->> 'testo', (v_r ->> 'porzioni')::numeric, (v_r ->> 'attiva')::boolean, v_r ->> 'nota'
      from public.portata p where p.id = interno.nuovo_id(p_famiglia, v_r ->> 'portata_id');
  end loop;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'consumo_riga') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.consumo_riga (id, famiglia_id, conferma_id, ingrediente_id, unita, quantita_prevista, quantita_usata)
      select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, c.id, interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'),
        v_r ->> 'unita', (v_r ->> 'quantita_prevista')::numeric, (v_r ->> 'quantita_usata')::numeric
      from public.conferma_pasto c where c.id = interno.nuovo_id(p_famiglia, v_r ->> 'conferma_id');
  end loop;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'consumo_lotto') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.consumo_lotto (id, famiglia_id, conferma_id, lotto_id, ingrediente_id, unita, quantita)
      select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, c.id, l.id, interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'),
        v_r ->> 'unita', (v_r ->> 'quantita')::numeric
      from public.conferma_pasto c join public.lotto l on l.id = interno.nuovo_id(p_famiglia, v_r ->> 'lotto_id')
     where c.id = interno.nuovo_id(p_famiglia, v_r ->> 'conferma_id');
  end loop;
  update public.lotto l set conferma_id = c.id
    from jsonb_array_elements(v_tabelle -> 'lotto') x(e)
    join public.conferma_pasto c on c.id = interno.nuovo_id(p_famiglia, x.e ->> 'conferma_id')
   where x.e ->> 'conferma_id' is not null and l.id = interno.nuovo_id(p_famiglia, x.e ->> 'id');
  return v_conta;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
