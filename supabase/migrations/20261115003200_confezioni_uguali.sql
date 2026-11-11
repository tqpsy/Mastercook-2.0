-- Confezioni uguali in una riga (richiesta di Luca dell'11/11/2026): «Pasta 500 g × 2», non due righe da 500 g.
-- Un lotto ricorda quanto contiene una confezione (`confezione`, nell'unità del lotto). La quantità resta il totale
-- (somma dei movimenti), così ricette, spesa e consumi contano come prima; l'app mostra «500 g × 2» e, quando una
-- confezione è stata usata in parte, «500 g × 1 + 300 g aperta».
--
-- Ogni comando che crea un lotto accetta `confezione` accanto all'id del lotto (aggiungi_lotto, conferma_acquisto,
-- importa_scontrino, completa_riga_acquisto, il ripristino da file…), senza riscrivere quei comandi: il comando in
-- corso è leggibile durante la sua esecuzione e un trigger prende la confezione dall'oggetto che nomina il lotto
-- (`id`, `lotto_id` o `nuovo_id`). Spostando una parte di un lotto, il lotto nuovo tiene la confezione di quello di
-- partenza. I lotti a occhio (pezzi + livello) non hanno confezione: contano già i pezzi.
-- La confezione si può cambiare dopo con `modifica_lotto`.

alter table public.lotto add column confezione numeric
  check (confezione is null or (confezione > 0 and confezione <= 1000000));

-- Come prima, e in più i dati del comando in corso restano leggibili (interno.dati_comando) finché si esegue.
create or replace function interno.esegui(
  p_id uuid, p_famiglia uuid, p_tipo text, p_dati jsonb, p_utente uuid, p_dispositivo text, p_versione_app integer,
  p_funzione text
) returns jsonb
language plpgsql as $$
declare
  v_esito text := 'applicato';
  v_dettaglio jsonb;
  v_testo text;
begin
  perform set_config('mastercook.comando', p_id::text, true);
  perform set_config('mastercook.dati', coalesce(p_dati::text, ''), true);
  begin
    execute format('select interno.%I($1, $2, $3)', p_funzione) into v_dettaglio using p_famiglia, p_dati, p_utente;
  exception
    when sqlstate 'MC409' then
      get stacked diagnostics v_testo = pg_exception_detail;
      v_esito := 'conflitto';
      v_dettaglio := v_testo::jsonb;
    when sqlstate 'MC422' then
      get stacked diagnostics v_testo = pg_exception_detail;
      v_esito := 'rifiutato';
      v_dettaglio := v_testo::jsonb;
    when check_violation or not_null_violation or unique_violation or foreign_key_violation
      or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value
      or invalid_datetime_format or datetime_field_overflow then
      get stacked diagnostics v_testo = constraint_name;
      v_esito := 'rifiutato';
      v_dettaglio := jsonb_build_object('motivo', 'dati_non_validi', 'vincolo', nullif(v_testo, ''));
  end;
  perform set_config('mastercook.comando', '', true);
  perform set_config('mastercook.dati', '', true);

  if exists (select 1 from public.famiglia where id = p_famiglia) then
    insert into public.comando (id, famiglia_id, tipo, dati, autore, dispositivo, versione_app, esito, dettaglio)
      values (p_id, p_famiglia, p_tipo, p_dati, p_utente, p_dispositivo, p_versione_app, v_esito, coalesce(v_dettaglio, '{}'));
  end if;

  return jsonb_build_object('id', p_id, 'esito', v_esito, 'dettaglio', coalesce(v_dettaglio, '{}'::jsonb));
end $$;

create function interno.dati_comando() returns jsonb
language sql stable as $$ select nullif(current_setting('mastercook.dati', true), '')::jsonb $$;

-- La confezione di un lotto che nasce: dall'oggetto del comando che lo nomina, oppure (una parte spostata, un lotto
-- rifatto) dal lotto da cui viene. Mai per i lotti a occhio.
create function interno.confezione_del_lotto() returns trigger
language plpgsql as $$
declare
  v_dati jsonb := interno.dati_comando();
begin
  if new.livello is not null then
    new.confezione := null;
    return new;
  end if;
  if new.confezione is not null or v_dati is null then
    return new;
  end if;
  -- Solo se il comando parla di confezioni (la gran parte no): l'oggetto che nomina il lotto.
  if position('"confezione"' in v_dati::text) > 0 then
    new.confezione := (jsonb_path_query_first(v_dati,
      '$.** ? (@.type() == "object" && (@.id == $id || @.lotto_id == $id || @.nuovo_id == $id)).confezione',
      jsonb_build_object('id', new.id::text)) #>> '{}')::numeric;
  end if;
  -- Una parte spostata, un lotto rifatto: la confezione del lotto da cui viene.
  if new.confezione is null and v_dati ->> 'nuovo_id' = new.id::text then
    select l.confezione into new.confezione from public.lotto l
     where l.id = (v_dati ->> 'lotto_id')::uuid and l.famiglia_id = new.famiglia_id;
  end if;
  return new;
end $$;

create trigger confezione_del_lotto before insert on public.lotto
  for each row execute function interno.confezione_del_lotto();

-- Un lotto che diventa a occhio perde la confezione (conta i pezzi).
create function interno.confezione_a_occhio() returns trigger
language plpgsql as $$
begin
  if new.livello is not null then
    new.confezione := null;
  end if;
  return new;
end $$;

create trigger confezione_a_occhio before update of livello, confezione on public.lotto
  for each row execute function interno.confezione_a_occhio();

-- Modifica di un lotto: anche la confezione («sono 2 da 200 g»).
create or replace function interno.cmd_modifica_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'id')::uuid);
begin
  if v_lotto.fonte_data = 'confezione' and d -> 'campi' ->> 'fonte_data' = 'app' then
    perform interno.rifiuta('data_confezione_protetta');
  end if;
  return interno.aggiorna_campi('lotto', v_lotto.id, p_famiglia, (d ->> 'versione_attesa')::integer, d -> 'campi',
    array['nome', 'note', 'data_acquisto', 'data_limite', 'tipo_data', 'fonte_data', 'calcolata_il', 'affidabilita', 'posto',
      'confezione']);
end $$;

-- Ripristino da un file di copia: i lotti tornano con la loro confezione (gli id cambiano, come per il livello).
alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_senza_confezioni;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_conta jsonb;
  v_r jsonb;
begin
  -- Il file può essere grande: il trigger non ci cerca dentro, le confezioni si mettono dopo.
  perform set_config('mastercook.dati', '', true);
  v_conta := interno.ripristina_senza_confezioni(p_famiglia, d, p_utente);
  for v_r in select e from jsonb_array_elements(coalesce(d -> 'file' -> 'tabelle' -> 'lotto', '[]'::jsonb)) e
              where e ->> 'confezione' is not null and e ->> 'livello' is null loop
    update public.lotto set confezione = (v_r ->> 'confezione')::numeric
     where id = interno.nuovo_id(p_famiglia, v_r ->> 'id') and famiglia_id = p_famiglia;
  end loop;
  return v_conta;
end $$;

revoke all on function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid),
  interno.ripristina_senza_confezioni(uuid, jsonb, uuid) from public, anon, authenticated;

revoke all on function interno.esegui(uuid, uuid, text, jsonb, uuid, text, integer, text), interno.dati_comando(),
  interno.confezione_del_lotto(), interno.confezione_a_occhio(), interno.cmd_modifica_lotto(uuid, jsonb, uuid)
  from public, anon, authenticated;
