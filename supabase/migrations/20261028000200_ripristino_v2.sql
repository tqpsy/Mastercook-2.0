-- Mastercook 2.0 · migrazione 5 (Fase 2): esportazioni con ricette e casa (versione_schema 2).
--
-- Un file della versione 1 (solo famiglia, membri, vincoli) si ripristina come prima.
-- Nella versione 2 ci sono anche ingredienti e ricette della famiglia, con righe e passaggi, e i lotti
-- con tutti i loro movimenti: la quantità di ogni lotto si ricostruisce rigiocando i movimenti in ordine.
-- Le foto non sono nel file: le ricette ripristinate restano senza foto.

create or replace function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_famiglia jsonb := v_tabelle -> 'famiglia' -> 0;
  v_versione integer;
  v_vecchia_famiglia uuid;
  v_r jsonb;
  v_conta jsonb := '{}'::jsonb;
  v_n integer;
  v_mio_membro uuid;
  v_tabella text;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' then
    perform interno.rifiuta('file_non_riconosciuto');
  end if;
  v_versione := (v_file ->> 'versione_schema')::integer;
  if v_versione is null or v_versione not in (1, 2) then
    perform interno.rifiuta('versione_file_non_supportata', jsonb_build_object('versione', v_file -> 'versione_schema'));
  end if;
  if v_famiglia is null or coalesce(jsonb_typeof(v_tabelle -> 'membro'), '') <> 'array' then
    perform interno.rifiuta('file_incompleto');
  end if;
  if v_versione = 2 then
    foreach v_tabella in array array['ingrediente', 'ricetta', 'ricetta_ingrediente', 'ricetta_passo', 'lotto', 'movimento'] loop
      if coalesce(jsonb_typeof(v_tabelle -> v_tabella), '') <> 'array' then
        perform interno.rifiuta('file_incompleto');
      end if;
    end loop;
  end if;
  if exists (select 1 from public.famiglia where id = p_famiglia) then
    perform interno.rifiuta('famiglia_esistente');
  end if;
  v_vecchia_famiglia := (v_famiglia ->> 'id')::uuid;

  -- Ogni riga deve appartenere alla famiglia del file.
  foreach v_tabella in array array['membro', 'vincolo_alimentare', 'ingrediente', 'ricetta', 'ricetta_ingrediente',
      'ricetta_passo', 'lotto', 'movimento'] loop
    if exists (select 1 from jsonb_array_elements(coalesce(v_tabelle -> v_tabella, '[]')) e
               where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia_famiglia) then
      perform interno.rifiuta('file_incoerente');
    end if;
  end loop;

  insert into public.famiglia (id, nome, impostazioni)
    values (p_famiglia, coalesce(d ->> 'nome', v_famiglia ->> 'nome'), coalesce(v_famiglia -> 'impostazioni', '{}'::jsonb));
  insert into public.utente_famiglia (id, famiglia_id, utente_id, ruolo)
    values (gen_random_uuid(), p_famiglia, p_utente, 'amministratore');

  -- Persone e vincoli.
  v_n := 0;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'membro') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.membro (id, famiglia_id, nome, emoji, porzione, note, archiviato, utente_id)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'nome', v_r ->> 'emoji',
              (v_r ->> 'porzione')::numeric, v_r ->> 'note', coalesce((v_r ->> 'archiviato')::boolean, false),
              case when (v_r ->> 'utente_id')::uuid = p_utente then p_utente end);
    v_n := v_n + 1;
  end loop;
  v_conta := v_conta || jsonb_build_object('membri', v_n);

  v_n := 0;
  for v_r in select * from jsonb_array_elements(coalesce(v_tabelle -> 'vincolo_alimentare', '[]'::jsonb)) loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.vincolo_alimentare (id, famiglia_id, membro_id, tipo, oggetto, severita, fonte, testo)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.nuovo_id(p_famiglia, v_r ->> 'membro_id'),
              v_r ->> 'tipo', v_r ->> 'oggetto', v_r ->> 'severita', v_r ->> 'fonte', v_r ->> 'testo');
    v_n := v_n + 1;
  end loop;
  v_conta := v_conta || jsonb_build_object('vincoli', v_n);

  if v_versione = 2 then
    -- Ingredienti della famiglia: prima le righe, poi i genitori (possono stare in qualsiasi ordine).
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ingrediente') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.ingrediente (id, famiglia_id, nome, sinonimi, reparto, sottocategoria, dimensione, luogo, giorni,
          allergeni, allergeni_noti, classi, emoji)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id')::text, p_famiglia, v_r ->> 'nome',
          coalesce(array(select jsonb_array_elements_text(v_r -> 'sinonimi')), '{}'), v_r ->> 'reparto', v_r ->> 'sottocategoria',
          v_r ->> 'dimensione', v_r ->> 'luogo', (v_r ->> 'giorni')::integer,
          coalesce(array(select jsonb_array_elements_text(v_r -> 'allergeni')), '{}'), (v_r ->> 'allergeni_noti')::boolean,
          coalesce(array(select jsonb_array_elements_text(v_r -> 'classi')), '{}'), v_r ->> 'emoji');
      v_n := v_n + 1;
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ingrediente') loop
      if v_r ->> 'eliminato_il' is not null or v_r ->> 'genitore' is null then continue; end if;
      update public.ingrediente set genitore = interno.id_ripristinato(p_famiglia, v_r ->> 'genitore')
       where id = interno.nuovo_id(p_famiglia, v_r ->> 'id')::text;
    end loop;
    v_conta := v_conta || jsonb_build_object('ingredienti', v_n);

    -- Ricette, poi le «derivate da», poi righe e passaggi.
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.ricetta (id, famiglia_id, titolo, descrizione, categoria, cucina, provenienza, porzioni,
          minuti_preparazione, minuti_cottura, minuti_totali, difficolta, conservazione, mesi, allergeni_dichiarati, archiviata)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id')::text, p_famiglia, x.titolo, x.descrizione, x.categoria, x.cucina,
          x.provenienza, x.porzioni, x.minuti_preparazione, x.minuti_cottura, x.minuti_totali, x.difficolta, x.conservazione,
          x.mesi, coalesce(x.allergeni_dichiarati, '{}'), coalesce(x.archiviata, false)
        from jsonb_populate_record(null::public.ricetta, v_r) x;
      v_n := v_n + 1;
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta') loop
      if v_r ->> 'eliminato_il' is not null or v_r ->> 'derivata_da' is null then continue; end if;
      update public.ricetta r set derivata_da = interno.id_ripristinato(p_famiglia, v_r ->> 'derivata_da')
       where r.id = interno.nuovo_id(p_famiglia, v_r ->> 'id')::text
         and exists (select 1 from public.ricetta o where o.id = interno.id_ripristinato(p_famiglia, v_r ->> 'derivata_da'));
    end loop;
    v_conta := v_conta || jsonb_build_object('ricette', v_n);

    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta_ingrediente') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      -- Le righe di una ricetta cancellata (assente dal file) si saltano.
      insert into public.ricetta_ingrediente (id, famiglia_id, ricetta_id, ingrediente_id, quantita, unita, qb, opzionale, testo, ordine)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, r.id,
          interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'), (v_r ->> 'quantita')::numeric, v_r ->> 'unita',
          (v_r ->> 'qb')::boolean, (v_r ->> 'opzionale')::boolean, v_r ->> 'testo', (v_r ->> 'ordine')::integer
        from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') and r.famiglia_id = p_famiglia;
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta_passo') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.ricetta_passo (id, famiglia_id, ricetta_id, ordine, testo)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, r.id, (v_r ->> 'ordine')::integer, v_r ->> 'testo'
        from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') and r.famiglia_id = p_famiglia;
    end loop;

    -- Casa: lotti vuoti, poi i movimenti in ordine; la quantità torna da sola.
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'lotto') loop
      insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
          fonte_data, calcolata_il, affidabilita, origine, note)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'),
          v_r ->> 'nome', v_r ->> 'unita', v_r ->> 'luogo', (v_r ->> 'data_acquisto')::date, (v_r ->> 'data_limite')::date,
          v_r ->> 'tipo_data', v_r ->> 'fonte_data', (v_r ->> 'calcolata_il')::timestamptz, v_r ->> 'affidabilita',
          v_r ->> 'origine', v_r ->> 'note');
      v_n := v_n + 1;
    end loop;
    v_conta := v_conta || jsonb_build_object('lotti', v_n);
    v_n := 0;
    for v_r in select e from jsonb_array_elements(v_tabelle -> 'movimento') e order by (e ->> 'seq')::bigint loop
      insert into public.movimento (id, famiglia_id, lotto_id, variazione, causale, comando_id, nota)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.nuovo_id(p_famiglia, v_r ->> 'lotto_id'),
          (v_r ->> 'variazione')::numeric, v_r ->> 'causale', interno.nuovo_id(p_famiglia, 'comando:' || (v_r ->> 'comando_id')),
          v_r ->> 'nota');
      v_n := v_n + 1;
    end loop;
    v_conta := v_conta || jsonb_build_object('movimenti', v_n);
  end if;

  select id into v_mio_membro from public.membro where famiglia_id = p_famiglia and utente_id = p_utente;
  if v_mio_membro is null then
    insert into public.membro (id, famiglia_id, nome, utente_id)
      values (interno.nuovo_id(p_famiglia, 'utente:' || p_utente::text), p_famiglia, coalesce(d ->> 'nome_utente', 'Io'), p_utente);
  end if;

  return v_conta;
end $$;

-- Id di una riga ripristinata: quelli del catalogo di sistema restano, quelli della famiglia si rigenerano.
create function interno.id_ripristinato(p_famiglia uuid, p_vecchio text) returns text
language sql immutable as $$
  select case when p_vecchio ~ '^(ing|sys):' then p_vecchio else interno.nuovo_id(p_famiglia, p_vecchio)::text end
$$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
