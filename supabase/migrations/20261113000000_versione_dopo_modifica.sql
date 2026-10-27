-- Mastercook 2.0 · la modifica per campi dice anche la versione della riga prima e dopo.
--
-- Il telefono vede la versione nuova solo quando scarica le righe. Se intanto la stessa persona
-- cambia di nuovo lo stesso campo (porzione 1 → 2 → 1), il secondo comando parte con la versione
-- vecchia e il server lo prendeva per la modifica di qualcun altro: «da sistemare» senza motivo.
-- Con versione_prima e versione il dispositivo aggiorna la versione attesa dei comandi suoi ancora
-- in coda sulla stessa riga (vedi src/dati/sincronizzatore.ts). Il controllo dei conflitti non cambia.

create or replace function interno.aggiorna_campi(
  p_tabella text, p_id uuid, p_famiglia uuid, p_versione_attesa integer, p_campi jsonb, p_ammessi text[]
) returns jsonb
language plpgsql as $$
declare
  v_riga jsonb;
  v_campo text;
  v_conflitti jsonb := '[]'::jsonb;
  v_da_scrivere text[] := '{}';
  v_versioni jsonb := '{}'::jsonb;
  v_assegna text;
begin
  if p_campi is null or jsonb_typeof(p_campi) <> 'object' or p_campi = '{}'::jsonb then
    perform interno.rifiuta('nessun_campo');
  end if;
  if p_versione_attesa is null then
    perform interno.rifiuta('versione_attesa_mancante');
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 and famiglia_id = $2 for update', p_tabella)
    into v_riga using p_id, p_famiglia;
  if v_riga is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_riga ->> 'eliminato_il' is not null then
    perform interno.conflitto(jsonb_build_object('motivo', 'eliminato', 'modificato_da', v_riga -> 'modificato_da'));
  end if;

  for v_campo in select jsonb_object_keys(p_campi) loop
    if not v_campo = any (p_ammessi) then
      perform interno.rifiuta('campo_non_ammesso', jsonb_build_object('campo', v_campo));
    end if;
    if (v_riga -> v_campo) is not distinct from (p_campi -> v_campo) then
      continue;
    end if;
    if coalesce((v_riga -> 'versioni_campi' ->> v_campo)::integer, 0) > p_versione_attesa then
      v_conflitti := v_conflitti || jsonb_build_object(
        'campo', v_campo, 'valore_attuale', v_riga -> v_campo, 'modificato_da', v_riga -> 'modificato_da');
    else
      v_da_scrivere := v_da_scrivere || v_campo;
    end if;
  end loop;

  if jsonb_array_length(v_conflitti) > 0 then
    perform interno.conflitto(jsonb_build_object('motivo', 'stesso_campo', 'campi', v_conflitti));
  end if;
  if cardinality(v_da_scrivere) = 0 then
    return jsonb_build_object('cambiati', '[]'::jsonb,
      'versione_prima', (v_riga ->> 'versione')::integer, 'versione', (v_riga ->> 'versione')::integer);
  end if;

  select string_agg(format('%I = r.%I', c, c), ', '), jsonb_object_agg(c, (v_riga ->> 'versione')::integer + 1)
    into v_assegna, v_versioni
    from unnest(v_da_scrivere) c;

  execute format(
    'update public.%I t set %s, versioni_campi = t.versioni_campi || $3
       from jsonb_populate_record(null::public.%I, $4) r
      where t.id = $1 and t.famiglia_id = $2',
    p_tabella, v_assegna, p_tabella)
    using p_id, p_famiglia, v_versioni, p_campi;

  return jsonb_build_object('cambiati', to_jsonb(v_da_scrivere),
    'versione_prima', (v_riga ->> 'versione')::integer, 'versione', (v_riga ->> 'versione')::integer + 1);
end $$;

create or replace function interno.aggiorna_campi(
  p_tabella text, p_id uuid, p_famiglia uuid, p_versione_attesa integer, p_campi jsonb, p_ammessi text[], p_id_testo text
) returns jsonb
language plpgsql as $$
declare
  v_riga jsonb;
  v_campo text;
  v_conflitti jsonb := '[]'::jsonb;
  v_da_scrivere text[] := '{}';
  v_versioni jsonb := '{}'::jsonb;
  v_assegna text;
  v_chiave text := coalesce(p_id_testo, p_id::text);
begin
  if p_campi is null or jsonb_typeof(p_campi) <> 'object' or p_campi = '{}'::jsonb then
    perform interno.rifiuta('nessun_campo');
  end if;
  if p_versione_attesa is null then
    perform interno.rifiuta('versione_attesa_mancante');
  end if;
  execute format('select to_jsonb(t) from public.%I t where id::text = $1 and famiglia_id = $2 for update', p_tabella)
    into v_riga using v_chiave, p_famiglia;
  if v_riga is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_riga ->> 'eliminato_il' is not null then
    perform interno.conflitto(jsonb_build_object('motivo', 'eliminato', 'modificato_da', v_riga -> 'modificato_da'));
  end if;
  for v_campo in select jsonb_object_keys(p_campi) loop
    if not v_campo = any (p_ammessi) then
      perform interno.rifiuta('campo_non_ammesso', jsonb_build_object('campo', v_campo));
    end if;
    if (v_riga -> v_campo) is not distinct from (p_campi -> v_campo) then
      continue;
    end if;
    if coalesce((v_riga -> 'versioni_campi' ->> v_campo)::integer, 0) > p_versione_attesa then
      v_conflitti := v_conflitti || jsonb_build_object(
        'campo', v_campo, 'valore_attuale', v_riga -> v_campo, 'modificato_da', v_riga -> 'modificato_da', 'id', v_chiave);
    else
      v_da_scrivere := v_da_scrivere || v_campo;
    end if;
  end loop;
  if jsonb_array_length(v_conflitti) > 0 then
    perform interno.conflitto(jsonb_build_object('motivo', 'stesso_campo', 'campi', v_conflitti));
  end if;
  if cardinality(v_da_scrivere) = 0 then
    return jsonb_build_object('cambiati', '[]'::jsonb,
      'versione_prima', (v_riga ->> 'versione')::integer, 'versione', (v_riga ->> 'versione')::integer);
  end if;
  select string_agg(format('%I = r.%I', c, c), ', '), jsonb_object_agg(c, (v_riga ->> 'versione')::integer + 1)
    into v_assegna, v_versioni
    from unnest(v_da_scrivere) c;
  execute format(
    'update public.%I t set %s, versioni_campi = t.versioni_campi || $3
       from jsonb_populate_record(null::public.%I, $4) r
      where t.id::text = $1 and t.famiglia_id = $2',
    p_tabella, v_assegna, p_tabella)
    using v_chiave, p_famiglia, v_versioni, p_campi;
  return jsonb_build_object('cambiati', to_jsonb(v_da_scrivere),
    'versione_prima', (v_riga ->> 'versione')::integer, 'versione', (v_riga ->> 'versione')::integer + 1);
end $$;
