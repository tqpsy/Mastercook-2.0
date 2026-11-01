-- Pasti fissi («🔁 Ogni giorno da qui»): correzioni.
--
-- 1. Chi mangia: la regola ricorda chi NON mangia il piatto (eccezioni della portata da cui nasce) e le
--    portate dei giorni dopo nascono con le stesse eccezioni. Prima ogni giorno nuovo era «tutti a tavola».
--    Cambiare chi mangia in un giorno di una regola attiva vale da quel giorno in poi (comando
--    allinea_chi_mangia_fisso): la regola e i giorni dopo già creati, non confermati, si allineano.
-- 2. Una portata che passa a una regola nuova (da_portata) chiude la regola vecchia il giorno prima: la regola
--    vecchia non ricrea quel giorno.
-- Fermare la regola senza togliere il pasto del giorno lo fa l'app: chiede ferma_pasto_fisso dal giorno dopo.

alter table public.pasto_fisso add column eccezioni jsonb not null default '[]'::jsonb
  check (jsonb_typeof(eccezioni) = 'array');

-- Le eccezioni attive di una portata, nella forma salvata nella regola.
create function interno.eccezioni_portata(p_portata uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('membro_id', e.membro_id, 'tipo', e.tipo, 'ricetta_id', e.ricetta_id,
                                               'testo', e.testo, 'porzioni', e.porzioni) order by e.membro_id), '[]'::jsonb)
    from public.eccezione_membro e
   where e.portata_id = p_portata and e.eliminato_il is null
$$;

-- Dà alla portata le eccezioni della regola (solo persone ancora in famiglia e ricette ancora presenti).
-- Toglie quelle che la regola non ha, aggiorna quelle cambiate, aggiunge le mancanti.
create function interno.applica_eccezioni(p_famiglia uuid, p_portata uuid, p_eccezioni jsonb) returns void
language plpgsql as $$
declare
  v_e jsonb;
  v_attuale public.eccezione_membro;
begin
  update public.eccezione_membro e set eliminato_il = now()
   where e.portata_id = p_portata and e.eliminato_il is null
     and not exists (select 1 from jsonb_array_elements(p_eccezioni) x where (x ->> 'membro_id')::uuid = e.membro_id);
  for v_e in select * from jsonb_array_elements(p_eccezioni) loop
    continue when not exists (select 1 from public.membro m where m.id = (v_e ->> 'membro_id')::uuid and m.famiglia_id = p_famiglia
                                                              and m.eliminato_il is null);
    continue when v_e ->> 'ricetta_id' is not null
      and not exists (select 1 from public.ricetta r where r.id = v_e ->> 'ricetta_id' and r.eliminato_il is null);
    select * into v_attuale from public.eccezione_membro
     where portata_id = p_portata and membro_id = (v_e ->> 'membro_id')::uuid and eliminato_il is null;
    if v_attuale.id is null then
      insert into public.eccezione_membro (id, famiglia_id, portata_id, membro_id, tipo, ricetta_id, testo, porzioni)
        values (gen_random_uuid(), p_famiglia, p_portata, (v_e ->> 'membro_id')::uuid, v_e ->> 'tipo', v_e ->> 'ricetta_id',
                v_e ->> 'testo', (v_e ->> 'porzioni')::numeric);
    elsif v_attuale.tipo is distinct from v_e ->> 'tipo' or v_attuale.ricetta_id is distinct from v_e ->> 'ricetta_id'
       or v_attuale.testo is distinct from v_e ->> 'testo' or v_attuale.porzioni is distinct from (v_e ->> 'porzioni')::numeric then
      update public.eccezione_membro set tipo = v_e ->> 'tipo', ricetta_id = v_e ->> 'ricetta_id', testo = v_e ->> 'testo',
          porzioni = (v_e ->> 'porzioni')::numeric
       where id = v_attuale.id;
    end if;
  end loop;
end $$;

create or replace function interno.genera_fissi(p_famiglia uuid, p_fino date) returns integer
language plpgsql as $$
declare
  v_n integer := 0;
  v_r record;
begin
  for v_r in
    insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, fisso_id)
      select interno.nuovo_id(f.id, g::date::text), p_famiglia, g::date, f.categoria, f.ricetta_id, f.testo, f.porzioni, 'fissa', f.ordine, f.id
        from public.pasto_fisso f
        cross join lateral generate_series(greatest(f.dal, current_date),
                                           least(coalesce(f.al, p_fino), p_fino, current_date + 60), interval '1 day') g
       where f.famiglia_id = p_famiglia and f.eliminato_il is null
         and (f.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = f.ricetta_id and r.eliminato_il is null))
         and not exists (select 1 from public.portata p where p.fisso_id = f.id and p.data = g::date)
      on conflict (id) do nothing
      returning id, fisso_id
  loop
    v_n := v_n + 1;
    perform interno.applica_eccezioni(p_famiglia, v_r.id, (select f.eccezioni from public.pasto_fisso f where f.id = v_r.fisso_id));
  end loop;
  return v_n;
end $$;

create or replace function interno.cmd_fissa_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid := (d ->> 'id')::uuid;
  v_dal date := (d ->> 'dal')::date;
  v_da public.portata;
begin
  if v_dal is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  if d ->> 'da_portata' is not null then
    select * into v_da from public.portata
     where id = (d ->> 'da_portata')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  end if;
  insert into public.pasto_fisso (id, famiglia_id, categoria, ricetta_id, testo, porzioni, ordine, dal, eccezioni)
    values (v_id, p_famiglia, d ->> 'categoria', d ->> 'ricetta_id', nullif(btrim(d ->> 'testo'), ''), (d ->> 'porzioni')::numeric,
            coalesce((d ->> 'ordine')::numeric, 0), v_dal,
            case when v_da.id is not null then interno.eccezioni_portata(v_da.id) else '[]'::jsonb end);
  if v_da.id is not null then
    -- La regola di prima (se c'era) finisce il giorno prima: non ricrea questo giorno.
    if v_da.fisso_id is not null and v_da.fisso_id <> v_id then
      update public.pasto_fisso set al = least(coalesce(al, v_dal - 1), v_dal - 1)
       where id = v_da.fisso_id and famiglia_id = p_famiglia and dal <= v_dal;
    end if;
    update public.portata set fisso_id = v_id where id = v_da.id;
  end if;
  return jsonb_build_object('create', interno.genera_fissi(p_famiglia, coalesce((d ->> 'fino_a')::date, v_dal + 13)));
end $$;

-- Chi mangia cambiato in un giorno di una regola: vale da quel giorno in poi.
create function interno.cmd_allinea_chi_mangia_fisso(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_p public.portata;
  v_f public.pasto_fisso;
  v_eccezioni jsonb;
  v_q record;
  v_n integer := 0;
begin
  select * into v_p from public.portata where id = (d ->> 'portata_id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if v_p.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  select * into v_f from public.pasto_fisso where id = v_p.fisso_id and famiglia_id = p_famiglia and eliminato_il is null for update;
  -- Portata senza regola, o regola già finita quel giorno: vale solo per quel giorno.
  if v_f.id is null or (v_f.al is not null and v_f.al <= v_p.data) then
    return jsonb_build_object('allineate', 0);
  end if;
  v_eccezioni := interno.eccezioni_portata(v_p.id);
  update public.pasto_fisso set eccezioni = v_eccezioni where id = v_f.id and eccezioni is distinct from v_eccezioni;
  for v_q in
    select q.id from public.portata q
     where q.fisso_id = v_f.id and q.famiglia_id = p_famiglia and q.data > v_p.data and q.eliminato_il is null
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = q.id and c.attiva)
  loop
    perform interno.applica_eccezioni(p_famiglia, v_q.id, v_eccezioni);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('allineate', v_n);
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('allinea_chi_mangia_fisso', 'cmd_allinea_chi_mangia_fisso');

revoke all on function interno.eccezioni_portata(uuid), interno.applica_eccezioni(uuid, uuid, jsonb), interno.genera_fissi(uuid, date),
  interno.cmd_fissa_pasto(uuid, jsonb, uuid), interno.cmd_allinea_chi_mangia_fisso(uuid, jsonb, uuid)
  from public, anon, authenticated;
