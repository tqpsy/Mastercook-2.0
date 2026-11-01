-- Piatto senza un ingrediente: una ricetta ⛔ per qualcuno solo per un ingrediente che si può togliere
-- (la panna per chi non tollera il lattosio) si può fare senza, solo per quella persona o per tutti.
-- Vale per quella portata: la ricetta non cambia.
--
--   portata.senza  [{ ingrediente_id, membro_id }]   membro_id null = tolto per tutti
--
-- Spesa e casa contano solo ciò che si usa davvero: un ingrediente tolto per tutti non serve; tolto solo a
-- qualcuno serve per le porzioni degli altri (la sua porzione si mette da parte prima di aggiungerlo).
-- Lo stesso calcolo è nell'app (src/dominio/senza.ts, `quotaSenza`).

alter table public.portata add column senza jsonb not null default '[]'::jsonb
  check (jsonb_typeof(senza) = 'array' and jsonb_array_length(senza) <= 20);

-- Ogni voce: un ingrediente della ricetta (del catalogo o della famiglia) e, se c'è, una persona della famiglia.
-- Cambiando ricetta, ciò che era tolto dalla vecchia non vale più per la nuova.
create function interno.controlla_senza() returns trigger
language plpgsql as $$
declare
  v_x jsonb;
begin
  if tg_op = 'UPDATE' and new.ricetta_id is distinct from old.ricetta_id and new.senza = old.senza then
    new.senza := '[]'::jsonb;
  end if;
  if new.senza <> '[]'::jsonb and new.ricetta_id is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  for v_x in select * from jsonb_array_elements(new.senza) loop
    if jsonb_typeof(v_x) <> 'object' or jsonb_typeof(v_x -> 'ingrediente_id') <> 'string'
       or (v_x ? 'membro_id' and jsonb_typeof(v_x -> 'membro_id') not in ('string', 'null')) then
      perform interno.rifiuta('dati_non_validi');
    end if;
    if not exists (select 1 from public.ricetta_ingrediente g
                    where g.ricetta_id = new.ricetta_id and g.ingrediente_id = v_x ->> 'ingrediente_id' and g.eliminato_il is null) then
      perform interno.rifiuta('ingrediente_non_trovato');
    end if;
    if v_x ->> 'membro_id' is not null and not exists (
        select 1 from public.membro m where m.id::text = v_x ->> 'membro_id' and m.famiglia_id = new.famiglia_id and m.eliminato_il is null) then
      perform interno.rifiuta('membro_non_trovato');
    end if;
  end loop;
  return new;
end $$;

create trigger controlla_senza before insert or update of senza, ricetta_id on public.portata
  for each row execute function interno.controlla_senza();

-- Quanta parte di un ingrediente della portata serve: 1 tutto, 0 tolto per tutti, in mezzo tolto solo a qualcuno
-- che mangia il piatto (chi non mangia o mangia altro non conta).
create function interno.quota_senza(p_portata uuid, p_ingrediente text) returns numeric
language sql stable as $$
  with p as (select * from public.portata where id = p_portata), voci as (
    select x ->> 'membro_id' as membro_id from p, jsonb_array_elements(p.senza) x where x ->> 'ingrediente_id' = p_ingrediente
  )
  select case
    when not exists (select 1 from voci) then 1
    when exists (select 1 from voci where membro_id is null) then 0
    else greatest(0, 1 - coalesce((
      select sum(m.porzione) from public.membro m, p
       where m.id::text in (select membro_id from voci) and m.famiglia_id = p.famiglia_id and m.eliminato_il is null and not m.archiviato
         and not exists (select 1 from public.eccezione_membro e where e.portata_id = p.id and e.membro_id = m.id and e.eliminato_il is null)
    ), 0) / nullif(interno.porzioni_portata(p_portata), 0))
  end
$$;

-- ───────────────────────── Comandi ─────────────────────────

create or replace function interno.cmd_aggiungi_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if coalesce(d ->> 'origine', 'manuale') not in ('manuale', 'automatica') then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  if d ? 'senza' and jsonb_typeof(d -> 'senza') <> 'array' then
    perform interno.rifiuta('dati_non_validi');
  end if;
  insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, note, senza)
    values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'data')::date, d ->> 'categoria', d ->> 'ricetta_id',
            nullif(btrim(d ->> 'testo'), ''), (d ->> 'porzioni')::numeric, coalesce(d ->> 'origine', 'manuale'),
            coalesce((d ->> 'ordine')::numeric, 0), nullif(btrim(d ->> 'note'), ''), coalesce(d -> 'senza', '[]'::jsonb));
  return '{}'::jsonb;
end $$;

create or replace function interno.cmd_modifica_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if d -> 'campi' ? 'senza' and jsonb_typeof(d -> 'campi' -> 'senza') <> 'array' then
    perform interno.rifiuta('dati_non_validi');
  end if;
  return interno.aggiorna_campi('portata', (d ->> 'id')::uuid, p_famiglia, (d ->> 'versione_attesa')::integer, d -> 'campi',
    array['data', 'categoria', 'ricetta_id', 'testo', 'porzioni', 'bloccata', 'ordine', 'note', 'senza']);
end $$;

-- Ripetere una settimana copia anche ciò che era tolto dai piatti.
create or replace function interno.cmd_ripeti_portate(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_x jsonb;
  v_copiate integer := 0;
  v_saltate integer := 0;
begin
  if jsonb_array_length(coalesce(d -> 'portate', '[]')) = 0 or jsonb_array_length(d -> 'portate') > 200 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  for v_x in select * from jsonb_array_elements(d -> 'portate') loop
    insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, note, senza)
      select (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'data')::date, coalesce(v_x ->> 'categoria', p.categoria), p.ricetta_id,
             p.testo, p.porzioni, 'ripetuta', p.ordine, p.note,
             -- Una persona tolta dalla famiglia nel frattempo non conta più.
             coalesce((select jsonb_agg(s) from jsonb_array_elements(p.senza) s
                        where s ->> 'membro_id' is null or exists (
                          select 1 from public.membro m where m.id::text = s ->> 'membro_id' and m.famiglia_id = p_famiglia
                             and m.eliminato_il is null)), '[]'::jsonb)
        from public.portata p
       where p.id = (v_x ->> 'da')::uuid and p.famiglia_id = p_famiglia and p.eliminato_il is null
         and (p.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = p.ricetta_id and r.eliminato_il is null));
    if found then v_copiate := v_copiate + 1; else v_saltate := v_saltate + 1; end if;
  end loop;
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'eccezioni', '[]')) loop
    insert into public.eccezione_membro (id, famiglia_id, portata_id, membro_id, tipo, ricetta_id, testo, porzioni)
      select (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'portata_id')::uuid, e.membro_id, e.tipo, e.ricetta_id, e.testo, e.porzioni
        from public.eccezione_membro e
        join public.membro m on m.id = e.membro_id and m.eliminato_il is null
       where e.id = (v_x ->> 'da')::uuid and e.famiglia_id = p_famiglia and e.eliminato_il is null
         and exists (select 1 from public.portata p where p.id = (v_x ->> 'portata_id')::uuid and p.famiglia_id = p_famiglia)
         and (e.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = e.ricetta_id and r.eliminato_il is null));
  end loop;
  -- Un avanzo copiato insieme al suo piatto resta il suo avanzo; senza il piatto diventa un piatto normale.
  update public.portata c set avanzo_di = (y.e ->> 'id')::uuid
    from jsonb_array_elements(d -> 'portate') x(e)
    join public.portata s on s.id = (x.e ->> 'da')::uuid and s.avanzo_di is not null
    join jsonb_array_elements(d -> 'portate') y(e) on (y.e ->> 'da')::uuid = s.avanzo_di
   where c.id = (x.e ->> 'id')::uuid and c.famiglia_id = p_famiglia and c.avanzo_di is null
     and exists (select 1 from public.portata o where o.id = (y.e ->> 'id')::uuid and o.famiglia_id = p_famiglia
                   and o.eliminato_il is null and o.data < c.data);
  return jsonb_build_object('copiate', v_copiate, 'saltate', v_saltate);
end $$;

-- ───────────────────────── Spesa e casa ─────────────────────────

create or replace function interno.fabbisogno_menu(p_famiglia uuid, p_dal date, p_al date, p_giorni date[] default null)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with persone as (
    select id, porzione from public.membro where famiglia_id = p_famiglia and eliminato_il is null and not archiviato
  ), portate as (
    select p.id, p.ricetta_id,
      interno.porzioni_portata(p.id) + coalesce((
        select sum(interno.porzioni_portata(a.id)) from public.portata a
         where a.avanzo_di = p.id and a.eliminato_il is null), 0) as porzioni
      from public.portata p
     where p.famiglia_id = p_famiglia and p.eliminato_il is null and p.ricetta_id is not null and p.avanzo_di is null
       and p.data between p_dal and p_al
       and (p_giorni is null or p.data = any (p_giorni))
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
  ), alternative as (
    select e.ricetta_id, coalesce(e.porzioni, x.porzione) as porzioni
      from public.eccezione_membro e
      join public.portata p on p.id = e.portata_id and p.eliminato_il is null and p.data between p_dal and p_al
       and (p_giorni is null or p.data = any (p_giorni))
      join persone x on x.id = e.membro_id
     where e.famiglia_id = p_famiglia and e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
  ), piatti as (
    select id as portata_id, ricetta_id, porzioni from portate
    union all select null::uuid, ricetta_id, porzioni from alternative
  )
  select g.ingrediente_id, g.unita,
         sum(g.quantita * pi.porzioni / r.porzioni
             * case when pi.portata_id is null then 1 else interno.quota_senza(pi.portata_id, g.ingrediente_id) end)
    from piatti pi
    join public.ricetta r on r.id = pi.ricetta_id
    join public.ricetta_ingrediente g on g.ricetta_id = r.id and g.eliminato_il is null
    join public.ingrediente i on i.id = g.ingrediente_id
   where pi.porzioni > 0 and not g.qb and not g.opzionale and g.quantita is not null and not i.base
   group by g.ingrediente_id, g.unita
$$;

-- Il previsto di una portata (per «Mangiato» e «Cucinato»): il piatto senza ciò che è stato tolto.
create or replace function interno.previsto_portata(p_portata uuid)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with p as (
    select * from public.portata where id = p_portata and eliminato_il is null
  ), persone as (
    select m.id, m.porzione from public.membro m join p on m.famiglia_id = p.famiglia_id
     where m.eliminato_il is null and not m.archiviato
  ), piatti as (
    select p.id as portata_id, p.ricetta_id,
      interno.porzioni_portata(p.id) + coalesce((
        select sum(interno.porzioni_portata(a.id)) from public.portata a
         where a.avanzo_di = p.id and a.eliminato_il is null), 0) as porzioni
      from p where p.ricetta_id is not null and p.avanzo_di is null
    union all
    select null::uuid, e.ricetta_id, coalesce(e.porzioni, x.porzione)
      from public.eccezione_membro e join p on p.id = e.portata_id join persone x on x.id = e.membro_id
     where e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
  ), righe as (
    select f.ingrediente_id, f.unita,
           case when pi.portata_id is null then f.quantita
                else trim_scale(round(f.quantita * interno.quota_senza(pi.portata_id, f.ingrediente_id), 1)) end as quantita
      from piatti pi cross join lateral interno.ingredienti_piatto(pi.ricetta_id, pi.porzioni) f
  )
  select r.ingrediente_id, r.unita, sum(r.quantita) from righe r where r.quantita > 0
   group by r.ingrediente_id, r.unita
  union all
  select 'ing:avanzo', 'pz', interno.porzioni_portata(p.id) from p where p.avanzo_di is not null and interno.porzioni_portata(p.id) > 0
$$;

revoke all on function interno.controlla_senza(), interno.quota_senza(uuid, text), interno.cmd_aggiungi_portata(uuid, jsonb, uuid),
  interno.cmd_modifica_portata(uuid, jsonb, uuid), interno.cmd_ripeti_portate(uuid, jsonb, uuid),
  interno.fabbisogno_menu(uuid, date, date, date[]), interno.previsto_portata(uuid)
  from public, anon, authenticated;
