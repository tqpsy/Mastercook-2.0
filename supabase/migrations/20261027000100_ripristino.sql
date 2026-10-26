-- Mastercook 2.0 · migrazione 2: ripristino di un'esportazione in una famiglia nuova.
--
-- L'esportazione (formato `mastercook-2`, docs/formato-esportazione.md) contiene le righe della famiglia.
-- Il ripristino crea sempre una famiglia nuova, mai sopra una esistente: gli id vengono rigenerati
-- in modo deterministico (stesso file + stessa famiglia nuova = stessi id), i riferimenti tra righe
-- seguono, e chi ripristina diventa l'unico amministratore. Inviti, accessi e cronologia non si ripristinano.
-- Ogni riga passa dagli stessi vincoli del database: un file non valido non scrive nulla.

create function interno.nuovo_id(p_famiglia uuid, p_vecchio text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select md5(p_famiglia::text || ':' || coalesce(p_vecchio, '')) as h) x
$$;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_famiglia jsonb := v_tabelle -> 'famiglia' -> 0;
  v_vecchia_famiglia uuid;
  v_r jsonb;
  v_membri integer := 0;
  v_vincoli integer := 0;
  v_mio_membro uuid;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' then
    perform interno.rifiuta('file_non_riconosciuto');
  end if;
  if (v_file ->> 'versione_schema')::integer is distinct from 1 then
    perform interno.rifiuta('versione_file_non_supportata', jsonb_build_object('versione', v_file -> 'versione_schema'));
  end if;
  if v_famiglia is null or coalesce(jsonb_typeof(v_tabelle -> 'membro'), '') <> 'array' then
    perform interno.rifiuta('file_incompleto');
  end if;
  if exists (select 1 from public.famiglia where id = p_famiglia) then
    perform interno.rifiuta('famiglia_esistente');
  end if;
  v_vecchia_famiglia := (v_famiglia ->> 'id')::uuid;

  insert into public.famiglia (id, nome, impostazioni)
    values (p_famiglia, coalesce(d ->> 'nome', v_famiglia ->> 'nome'), coalesce(v_famiglia -> 'impostazioni', '{}'::jsonb));
  insert into public.utente_famiglia (id, famiglia_id, utente_id, ruolo)
    values (gen_random_uuid(), p_famiglia, p_utente, 'amministratore');

  for v_r in select * from jsonb_array_elements(v_tabelle -> 'membro') loop
    if (v_r ->> 'famiglia_id')::uuid is distinct from v_vecchia_famiglia then
      perform interno.rifiuta('file_incoerente');
    end if;
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.membro (id, famiglia_id, nome, emoji, porzione, note, archiviato, utente_id)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'nome', v_r ->> 'emoji',
              (v_r ->> 'porzione')::numeric, v_r ->> 'note', coalesce((v_r ->> 'archiviato')::boolean, false),
              case when (v_r ->> 'utente_id')::uuid = p_utente then p_utente end);
    v_membri := v_membri + 1;
  end loop;

  for v_r in select * from jsonb_array_elements(coalesce(v_tabelle -> 'vincolo_alimentare', '[]'::jsonb)) loop
    if (v_r ->> 'famiglia_id')::uuid is distinct from v_vecchia_famiglia then
      perform interno.rifiuta('file_incoerente');
    end if;
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.vincolo_alimentare (id, famiglia_id, membro_id, tipo, oggetto, severita, fonte, testo)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.nuovo_id(p_famiglia, v_r ->> 'membro_id'),
              v_r ->> 'tipo', v_r ->> 'oggetto', v_r ->> 'severita', v_r ->> 'fonte', v_r ->> 'testo');
    v_vincoli := v_vincoli + 1;
  end loop;

  -- Chi ripristina ha sempre un profilo: se nel file non c'era il suo, se ne crea uno.
  select id into v_mio_membro from public.membro where famiglia_id = p_famiglia and utente_id = p_utente;
  if v_mio_membro is null then
    insert into public.membro (id, famiglia_id, nome, utente_id)
      values (interno.nuovo_id(p_famiglia, 'utente:' || p_utente::text), p_famiglia, coalesce(d ->> 'nome_utente', 'Io'), p_utente);
  end if;

  return jsonb_build_object('membri', v_membri, 'vincoli', v_vincoli);
end $$;

-- Il ripristino crea una famiglia nuova, come crea_famiglia: si aggiunge ai comandi che non richiedono di esserne già membri.
create or replace function public.applica_comando(comando jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_id uuid;
  v_famiglia uuid;
  v_tipo text := comando ->> 'tipo';
  v_dati jsonb := coalesce(comando -> 'dati', '{}'::jsonb);
  v_versione_app integer;
  v_minima integer;
  v_registrato public.comando;
  v_funzione text;
begin
  if v_utente is null then
    return jsonb_build_object('esito', 'rifiutato', 'transitorio', true, 'dettaglio', jsonb_build_object('motivo', 'non_autenticato'));
  end if;
  begin
    v_id := (comando ->> 'id')::uuid;
    v_famiglia := (comando ->> 'famiglia_id')::uuid;
    v_versione_app := (comando ->> 'versione_app')::integer;
  exception when others then
    v_id := null;
  end;
  if v_id is null or v_famiglia is null or v_tipo is null or jsonb_typeof(v_dati) <> 'object' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'comando_malformato'));
  end if;

  select versione_minima_app into v_minima from public.compatibilita;
  if v_versione_app is null or v_versione_app < v_minima then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'transitorio', true,
      'dettaglio', jsonb_build_object('motivo', 'app_da_aggiornare', 'versione_minima', v_minima));
  end if;

  perform pg_advisory_xact_lock(interno.chiave_lock(v_famiglia));

  select * into v_registrato from public.comando c where c.id = v_id;
  if found then
    if v_registrato.autore <> v_utente or v_registrato.famiglia_id <> v_famiglia then
      return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'id_gia_usato'));
    end if;
    return jsonb_build_object('id', v_id, 'esito', v_registrato.esito, 'dettaglio', v_registrato.dettaglio, 'ripetuto', true);
  end if;

  v_funzione := case v_tipo
    when 'crea_famiglia' then 'cmd_crea_famiglia'
    when 'ripristina_famiglia' then 'cmd_ripristina_famiglia'
    when 'modifica_famiglia' then 'cmd_modifica_famiglia'
    when 'aggiungi_membro' then 'cmd_aggiungi_membro'
    when 'modifica_membro' then 'cmd_modifica_membro'
    when 'aggiungi_vincolo' then 'cmd_aggiungi_vincolo'
    when 'rimuovi_vincolo' then 'cmd_rimuovi_vincolo'
    when 'crea_invito' then 'cmd_crea_invito'
    when 'revoca_invito' then 'cmd_revoca_invito'
    when 'rimuovi_accesso' then 'cmd_rimuovi_accesso'
  end;
  if v_funzione is null then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'tipo_sconosciuto'));
  end if;

  if v_tipo not in ('crea_famiglia', 'ripristina_famiglia') and interno.ruolo_in(v_famiglia, v_utente) is null then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'non_autorizzato'));
  end if;

  return interno.esegui(v_id, v_famiglia, v_tipo, v_dati, v_utente, comando ->> 'dispositivo', v_versione_app, v_funzione);
end $$;

revoke all on function interno.nuovo_id(uuid, text), interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.applica_comando(jsonb) from public, anon;
grant execute on function public.applica_comando(jsonb) to authenticated;
