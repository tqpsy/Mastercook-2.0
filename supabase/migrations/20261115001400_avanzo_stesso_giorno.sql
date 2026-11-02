-- Avanzi in casa da «Aggiungi»: l'avanzo del pranzo si mangia anche a cena dello stesso giorno.
-- Prima l'avanzo doveva stare in un giorno dopo il piatto d'origine; ora basta un pasto diverso
-- (lo stesso giorno o dopo). L'app propone solo i pasti che vengono dopo quello d'origine.

create or replace function interno.cmd_aggiungi_avanzo(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_origine public.portata;
begin
  select * into v_origine from public.portata
   where id = (d ->> 'avanzo_di')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if v_origine.id is null then
    perform interno.rifiuta('portata_non_trovata');
  end if;
  if v_origine.ricetta_id is null or v_origine.avanzo_di is not null then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'avanzo_di'));
  end if;
  if (d ->> 'data')::date is null or (d ->> 'data')::date < v_origine.data
     or ((d ->> 'data')::date = v_origine.data and d ->> 'categoria' is not distinct from v_origine.categoria) then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'data'));
  end if;
  insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, porzioni, origine, ordine, avanzo_di)
    values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'data')::date, d ->> 'categoria', v_origine.ricetta_id,
            (d ->> 'porzioni')::numeric, 'manuale', coalesce((d ->> 'ordine')::numeric, 0), v_origine.id);
  return '{}'::jsonb;
end $$;
