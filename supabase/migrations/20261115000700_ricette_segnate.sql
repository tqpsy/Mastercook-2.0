-- Ricette segnate dalla famiglia: ⭐ preferite e 💫 da fare agli ospiti.
--
-- Sono due elenchi di id di ricetta nelle impostazioni della famiglia (`preferite`, `per_ospiti`): si scaricano
-- e si esportano con la famiglia, senza tabelle nuove. Il comando aggiunge o toglie un solo id alla volta,
-- dentro il database, così due persone che segnano insieme non si cancellano a vicenda. Ripetuto, non cambia niente.

create function interno.cmd_segna_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_chiave text := case d ->> 'segno' when 'preferita' then 'preferite' when 'ospiti' then 'per_ospiti' end;
  v_ricetta text := d ->> 'ricetta_id';
  v_attivo boolean := coalesce((d ->> 'attivo')::boolean, true);
  v_elenco jsonb;
  v_nuovo jsonb;
begin
  if v_chiave is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  if v_attivo and not exists (
      select 1 from public.ricetta r where r.id = v_ricetta and (r.famiglia_id is null or r.famiglia_id = p_famiglia)
        and r.eliminato_il is null) then
    perform interno.rifiuta('ricetta_non_trovata');
  end if;
  select coalesce(impostazioni -> v_chiave, '[]'::jsonb) into v_elenco from public.famiglia where id = p_famiglia for update;
  if jsonb_typeof(v_elenco) <> 'array' then
    v_elenco := '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(x order by n), '[]'::jsonb) into v_nuovo
    from jsonb_array_elements_text(v_elenco) with ordinality as e(x, n) where x <> v_ricetta;
  if v_attivo then
    v_nuovo := v_nuovo || to_jsonb(v_ricetta);
  end if;
  update public.famiglia set impostazioni = impostazioni || jsonb_build_object(v_chiave, v_nuovo)
   where id = p_famiglia and impostazioni -> v_chiave is distinct from v_nuovo
     and not (v_nuovo = '[]'::jsonb and impostazioni -> v_chiave is null);
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('segna_ricetta', 'cmd_segna_ricetta');

-- Ripristino: le ricette della famiglia cambiano id, quindi anche i segni vanno riscritti con gli id nuovi.
alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_senza_segni;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_conta jsonb;
  v_chiave text;
  v_elenco jsonb;
begin
  v_conta := interno.ripristina_senza_segni(p_famiglia, d, p_utente);
  foreach v_chiave in array array['preferite', 'per_ospiti'] loop
    select impostazioni -> v_chiave into v_elenco from public.famiglia where id = p_famiglia;
    continue when v_elenco is null or jsonb_typeof(v_elenco) <> 'array';
    update public.famiglia set impostazioni = impostazioni || jsonb_build_object(v_chiave, coalesce((
      select jsonb_agg(r.id order by e.n)
        from jsonb_array_elements_text(v_elenco) with ordinality as e(x, n)
        join public.ricetta r on r.id = interno.id_ripristinato(p_famiglia, e.x)
         and (r.famiglia_id is null or r.famiglia_id = p_famiglia) and r.eliminato_il is null), '[]'::jsonb))
     where id = p_famiglia;
  end loop;
  return v_conta;
end $$;

revoke all on function interno.cmd_segna_ricetta(uuid, jsonb, uuid), interno.cmd_ripristina_famiglia(uuid, jsonb, uuid),
  interno.ripristina_senza_segni(uuid, jsonb, uuid) from public, anon, authenticated;
