-- Ricette collegate (richiesta di Luca del 31/10/2026): una ricetta della famiglia può contenere una base
-- (la besciamella fatta in casa…). Il collegamento sta nelle righe stesse: gli ingredienti della base, moltiplicati
-- per le dosi, sono copiati come righe della ricetta con `da_ricetta_id` e `dosi`. Così spesa, consumi, allergie e
-- dispensa, che leggono le righe, funzionano senza cambiare. Quando la base cambia, le righe si ricalcolano.
-- Un solo livello: una base non contiene altre basi.

alter table public.ricetta_ingrediente
  add column da_ricetta_id text references public.ricetta (id) on delete cascade,
  add column dosi numeric check (dosi is null or dosi > 0 and dosi <= 20),
  add constraint ricetta_ingrediente_base_con_dosi check ((da_ricetta_id is null) = (dosi is null));
create index ricetta_ingrediente_da_ricetta on public.ricetta_ingrediente (da_ricetta_id) where da_ricetta_id is not null;

-- Scrive (o riscrive) nella ricetta le righe della base per le dosi date; dosi null toglie la base.
create function interno.espandi_base(p_famiglia uuid, p_ricetta text, p_base text, p_dosi numeric) returns void
language plpgsql as $$
declare
  v_n integer := 0;
  v_g record;
  v_ordine integer;
begin
  update public.ricetta_ingrediente set eliminato_il = now()
   where ricetta_id = p_ricetta and famiglia_id = p_famiglia and da_ricetta_id = p_base and eliminato_il is null;
  if p_dosi is null then return; end if;
  select coalesce(max(ordine), 0) into v_ordine from public.ricetta_ingrediente where ricetta_id = p_ricetta and eliminato_il is null;
  for v_g in
    select g.* from public.ricetta_ingrediente g where g.ricetta_id = p_base and g.eliminato_il is null order by g.ordine, g.id
  loop
    v_n := v_n + 1;
    insert into public.ricetta_ingrediente (id, famiglia_id, ricetta_id, ingrediente_id, quantita, unita, qb, opzionale, testo,
        ordine, da_ricetta_id, dosi)
      values (interno.nuovo_id(coalesce(interno.comando_corrente(), gen_random_uuid()), p_ricetta || ':base:' || p_base || ':' || v_n),
        p_famiglia, p_ricetta, v_g.ingrediente_id,
        case when v_g.quantita is null then null else round(v_g.quantita * p_dosi, 2) end,
        v_g.unita, v_g.qb, v_g.opzionale, v_g.testo, v_ordine + v_n, p_base, p_dosi);
  end loop;
end $$;

-- Ricalcola le ricette che usano questa base, dopo che la base è cambiata.
create function interno.riespandi_base(p_base text) returns void
language plpgsql as $$
declare
  v_x record;
begin
  for v_x in
    select distinct g.famiglia_id, g.ricetta_id, g.dosi from public.ricetta_ingrediente g
     where g.da_ricetta_id = p_base and g.eliminato_il is null
  loop
    perform interno.espandi_base(v_x.famiglia_id, v_x.ricetta_id, p_base, v_x.dosi);
    update public.ricetta set modificato_il = now() where id = v_x.ricetta_id;
  end loop;
end $$;

alter function interno.cmd_salva_ricetta(uuid, jsonb, uuid) rename to cmd_salva_ricetta_senza_basi;

-- `basi`: { "imposta": [{ "ricetta_id": "sys:besciamella", "dosi": 0.5 }], "rimuovi": ["sys:besciamella"] }.
create function interno.cmd_salva_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id text := d ->> 'id';
  v_esito jsonb;
  v_x jsonb;
  v_base public.ricetta;
  v_dosi numeric;
  v_cambiate boolean := false;
begin
  v_esito := interno.cmd_salva_ricetta_senza_basi(p_famiglia, d, p_utente);

  for v_x in select * from jsonb_array_elements(coalesce(d -> 'basi' -> 'imposta', '[]')) loop
    select * into v_base from public.ricetta r where r.id = v_x ->> 'ricetta_id'
       and (r.famiglia_id is null or r.famiglia_id = p_famiglia) and r.eliminato_il is null;
    v_dosi := (v_x ->> 'dosi')::numeric;
    if v_base.id is null then
      perform interno.rifiuta('ricetta_non_trovata');
    end if;
    if v_base.categoria <> 'base' or v_base.id = v_id
       or exists (select 1 from public.ricetta_ingrediente g where g.ricetta_id = v_base.id and g.da_ricetta_id is not null and g.eliminato_il is null) then
      perform interno.rifiuta('base_non_valida');
    end if;
    if v_dosi is null or v_dosi <= 0 or v_dosi > 20 then
      perform interno.rifiuta('quantita_non_valida');
    end if;
    perform interno.espandi_base(p_famiglia, v_id, v_base.id, v_dosi);
    v_cambiate := true;
  end loop;
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'basi' -> 'rimuovi', '[]')) loop
    perform interno.espandi_base(p_famiglia, v_id, v_x #>> '{}', null);
    v_cambiate := true;
  end loop;

  -- Un solo livello: una ricetta usata come base da altre non può contenere basi.
  if exists (select 1 from public.ricetta_ingrediente g where g.ricetta_id = v_id and g.da_ricetta_id is not null and g.eliminato_il is null)
     and exists (select 1 from public.ricetta_ingrediente g where g.da_ricetta_id = v_id and g.eliminato_il is null) then
    perform interno.rifiuta('base_non_valida');
  end if;
  if v_cambiate then
    update public.ricetta set modificato_il = now() where id = v_id and famiglia_id = p_famiglia;
  end if;
  -- Se questa ricetta è una base usata da altre, le altre si aggiornano.
  perform interno.riespandi_base(v_id);
  return v_esito;
end $$;

revoke all on function interno.cmd_salva_ricetta(uuid, jsonb, uuid), interno.espandi_base(uuid, text, text, numeric),
  interno.riespandi_base(text) from public, anon, authenticated;
