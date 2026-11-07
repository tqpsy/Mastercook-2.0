-- Verifica fotografica dell'inventario: si fotografano una o più zone del frigo, l'app confronta ciò che Gemini
-- vede con ciò che c'è in casa e mostra le differenze. Le foto e Gemini non cambiano mai la casa da soli: qui
-- arriva solo ciò che la persona ha controllato e confermato nel riepilogo.
--
-- In famiglia.impostazioni.verifica:
--   zone:     [{ id, nome, luogo, posti }] le zone da fotografare (senza: quelle ricavate dal frigo configurato);
--   memoria:  ciò che l'app impara dalle conferme, una chiave alla volta (due telefoni non si cancellano):
--             alias     { «nome visto da Gemini»: { i: ingrediente_id, d } }   correzioni del prodotto
--             errori    { «nome visto da Gemini»: { n, d } }                    visti ma non c'erano
--             posizioni { ingrediente_id: { z: zona, n, d } }                  dove sta di solito
--   ultime:   { zona: data } l'ultima verifica di ogni zona.
-- Ogni ricordo ha la data `d`: oltre il massimo si tengono i più recenti.

create function interno.cmd_imposta_zone_verifica(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_zone jsonb := d -> 'zone';
begin
  if v_zone is null or jsonb_typeof(v_zone) not in ('array', 'null') then
    perform interno.rifiuta('dati_non_validi');
  end if;
  if jsonb_typeof(v_zone) = 'array' and (
      jsonb_array_length(v_zone) not between 1 and 20
      or length(v_zone::text) > 4000
      or exists (
        select 1 from jsonb_array_elements(v_zone) z
         where jsonb_typeof(z) <> 'object'
            or coalesce(z ->> 'id', '') !~ '^[a-z0-9_-]{1,24}$'
            or char_length(btrim(coalesce(z ->> 'nome', ''))) not between 1 and 40
            or coalesce(z ->> 'luogo', '') not in ('frigo', 'freezer', 'dispensa')
            or (z ? 'posti' and (jsonb_typeof(z -> 'posti') <> 'array'
                or exists (select 1 from jsonb_array_elements(z -> 'posti') p where jsonb_typeof(p) <> 'string' or p #>> '{}' !~ '^[rcsf][1-9]$'))))
      or (select count(distinct z ->> 'id') from jsonb_array_elements(v_zone) z) <> jsonb_array_length(v_zone)) then
    perform interno.rifiuta('dati_non_validi');
  end if;
  perform 1 from public.famiglia where id = p_famiglia for update;
  if jsonb_typeof(v_zone) = 'null' then
    update public.famiglia set impostazioni = impostazioni #- '{verifica,zone}' where id = p_famiglia and impostazioni -> 'verifica' ? 'zone';
  else
    update public.famiglia
       set impostazioni = jsonb_set(impostazioni, '{verifica}',
             (case when jsonb_typeof(impostazioni -> 'verifica') = 'object' then impostazioni -> 'verifica' else '{}'::jsonb end)
             || jsonb_build_object('zone', v_zone))
     where id = p_famiglia;
  end if;
  return '{}'::jsonb;
end $$;

-- Tiene le voci di un ricordo più recenti (campo `d`) fino al massimo.
create function interno.verifica_tieni(p_oggetto jsonb, p_massimo integer) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(chiave, valore), '{}'::jsonb)
    from (select chiave, valore from jsonb_each(coalesce(p_oggetto, '{}'::jsonb)) as e(chiave, valore)
           order by valore ->> 'd' desc nulls last, chiave limit p_massimo) t
$$;

-- «3 pz», «250 g»: per scrivere nella cronologia del lotto com'era e com'è.
create function interno.verifica_quantita(p_valore numeric, p_unita text) returns text
language sql immutable as $$
  select replace(trim_scale(p_valore)::text, '.', ',') || ' ' || p_unita
$$;

create function interno.cmd_verifica_inventario(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_op jsonb;
  v_ops jsonb := coalesce(d -> 'operazioni', '[]'::jsonb);
  v_impara jsonb := coalesce(d -> 'impara', '{}'::jsonb);
  v_data text := coalesce(d ->> 'data', to_char(now() at time zone 'Europe/Rome', 'YYYY-MM-DD'));
  v_lotto public.lotto;
  v_nuova numeric;
  v_modifiche integer := 0;
  v_v jsonb;
  v_m jsonb;
  v_k text;
  v_x jsonb;
begin
  if jsonb_typeof(v_ops) <> 'array' or jsonb_array_length(v_ops) > 200 or jsonb_typeof(v_impara) <> 'object'
     or v_data !~ '^\d{4}-\d{2}-\d{2}$' or length(v_impara::text) > 20000 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  -- Un lotto una volta sola per verifica.
  if (select count(*) from jsonb_array_elements(v_ops) o where o ? 'lotto_id')
     <> (select count(distinct o ->> 'lotto_id') from jsonb_array_elements(v_ops) o where o ? 'lotto_id') then
    perform interno.rifiuta('dati_non_validi');
  end if;

  for v_op in select * from jsonb_array_elements(v_ops) loop
    case v_op ->> 'azione'
      when 'quantita' then
        -- Quanto ce n'è adesso, contato guardando il frigo: vale anche se nel frattempo qualcuno l'ha cambiato.
        v_lotto := interno.lotto_della_famiglia(p_famiglia, (v_op ->> 'lotto_id')::uuid);
        v_nuova := (v_op ->> 'quantita')::numeric;
        if v_nuova is null or v_nuova < 0 then
          perform interno.rifiuta('quantita_non_valida');
        end if;
        if v_lotto.chiuso_il is null and v_lotto.eliminato_il is null and v_nuova <> v_lotto.quantita then
          perform interno.nuovo_movimento(p_famiglia, v_lotto.id, v_nuova - v_lotto.quantita, 'correzione',
            'Verifica con foto: da ' || interno.verifica_quantita(v_lotto.quantita, v_lotto.unita)
              || ' a ' || interno.verifica_quantita(v_nuova, v_lotto.unita));
          v_modifiche := v_modifiche + 1;
        end if;
      when 'aggiungi' then
        v_nuova := (v_op ->> 'quantita')::numeric;
        if v_nuova is null or v_nuova <= 0 then
          perform interno.rifiuta('quantita_non_valida');
        end if;
        if not exists (select 1 from public.ingrediente i where i.id = v_op ->> 'ingrediente_id'
                       and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
          perform interno.rifiuta('ingrediente_non_trovato');
        end if;
        insert into public.lotto (id, famiglia_id, ingrediente_id, unita, luogo, data_limite, tipo_data, fonte_data,
            calcolata_il, affidabilita, origine, posto)
          values ((v_op ->> 'id')::uuid, p_famiglia, v_op ->> 'ingrediente_id', v_op ->> 'unita', v_op ->> 'luogo',
            (v_op ->> 'data_limite')::date, coalesce(v_op ->> 'tipo_data', 'sconosciuta'), v_op ->> 'fonte_data',
            (v_op ->> 'calcolata_il')::timestamptz, v_op ->> 'affidabilita', 'foto',
            case when v_op ->> 'luogo' = 'dispensa' then null else nullif(v_op ->> 'posto', '') end);
        perform interno.nuovo_movimento(p_famiglia, (v_op ->> 'id')::uuid, v_nuova, 'carico', 'Verifica con foto: aggiunto');
        v_modifiche := v_modifiche + 1;
      when 'presente', 'non_verificabile' then
        -- Nessun cambiamento in casa: resta scritto nel comando (la cronologia della verifica).
        if v_op ? 'lotto_id' then
          perform interno.lotto_della_famiglia(p_famiglia, (v_op ->> 'lotto_id')::uuid);
        end if;
      else
        perform interno.rifiuta('dati_non_validi');
    end case;
  end loop;

  -- Quello che l'app impara: alias, errori, posizioni abituali e date delle zone.
  select case when jsonb_typeof(impostazioni -> 'verifica') = 'object' then impostazioni -> 'verifica' else '{}'::jsonb end
    into v_v from public.famiglia where id = p_famiglia for update;
  v_m := case when jsonb_typeof(v_v -> 'memoria') = 'object' then v_v -> 'memoria' else '{}'::jsonb end;
  if jsonb_typeof(v_m -> 'alias') is distinct from 'object' then v_m := v_m || '{"alias":{}}'; end if;
  if jsonb_typeof(v_m -> 'errori') is distinct from 'object' then v_m := v_m || '{"errori":{}}'; end if;
  if jsonb_typeof(v_m -> 'posizioni') is distinct from 'object' then v_m := v_m || '{"posizioni":{}}'; end if;

  if jsonb_typeof(v_impara -> 'alias') = 'object' then
    for v_k, v_x in select * from jsonb_each(v_impara -> 'alias') loop
      if char_length(v_k) between 1 and 60 and jsonb_typeof(v_x) = 'string' then
        v_m := jsonb_set(v_m, array['alias', v_k], jsonb_build_object('i', v_x #>> '{}', 'd', v_data));
        -- Corretto: non è più un errore.
        v_m := v_m #- array['errori', v_k];
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_impara -> 'errori') = 'array' then
    for v_k in select jsonb_array_elements_text(v_impara -> 'errori') loop
      if char_length(v_k) between 1 and 60 then
        v_m := jsonb_set(v_m, array['errori', v_k], jsonb_build_object(
          'n', least(9, coalesce((v_m -> 'errori' -> v_k ->> 'n')::int, 0) + 1), 'd', v_data));
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_impara -> 'posizioni') = 'object' then
    for v_k, v_x in select * from jsonb_each(v_impara -> 'posizioni') loop
      if char_length(v_k) between 1 and 80 and jsonb_typeof(v_x) = 'string' and v_x #>> '{}' ~ '^[a-z0-9_-]{1,24}$' then
        v_m := jsonb_set(v_m, array['posizioni', v_k], jsonb_build_object(
          'z', v_x #>> '{}',
          'n', case when v_m -> 'posizioni' -> v_k ->> 'z' = v_x #>> '{}'
                    then least(9, coalesce((v_m -> 'posizioni' -> v_k ->> 'n')::int, 0) + 1) else 1 end,
          'd', v_data));
      end if;
    end loop;
  end if;
  v_m := jsonb_build_object(
    'alias', interno.verifica_tieni(v_m -> 'alias', 300),
    'errori', interno.verifica_tieni(v_m -> 'errori', 200),
    'posizioni', interno.verifica_tieni(v_m -> 'posizioni', 400));
  v_v := v_v || jsonb_build_object('memoria', v_m);

  if jsonb_typeof(d -> 'zone') = 'array' then
    v_x := case when jsonb_typeof(v_v -> 'ultime') = 'object' then v_v -> 'ultime' else '{}'::jsonb end;
    for v_k in select jsonb_array_elements_text(d -> 'zone') loop
      if v_k ~ '^[a-z0-9_-]{1,24}$' then
        v_x := v_x || jsonb_build_object(v_k, v_data);
      end if;
    end loop;
    v_v := v_v || jsonb_build_object('ultime', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from (select k, v from jsonb_each(v_x) e(k, v) order by v #>> '{}' desc limit 40) t));
  end if;

  update public.famiglia set impostazioni = jsonb_set(impostazioni, '{verifica}', v_v) where id = p_famiglia;
  return jsonb_build_object('modifiche', v_modifiche);
end $$;

insert into interno.tipo_comando (tipo, funzione) values
  ('imposta_zone_verifica', 'cmd_imposta_zone_verifica'),
  ('verifica_inventario', 'cmd_verifica_inventario');

revoke all on function interno.cmd_imposta_zone_verifica(uuid, jsonb, uuid), interno.cmd_verifica_inventario(uuid, jsonb, uuid),
  interno.verifica_tieni(jsonb, integer), interno.verifica_quantita(numeric, text)
  from public, anon, authenticated;
