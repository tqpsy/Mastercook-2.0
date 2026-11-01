-- Ricette di Mastercook modificate dalla famiglia.
--
-- «Modifica» su una ricetta di Mastercook crea una ricetta della famiglia tratta dall'originale
-- (`derivata_da`) e ne mette l'id nell'elenco `modificate` delle impostazioni della famiglia: per quella
-- famiglia la versione modificata prende il posto dell'originale (che resta intatto per tutti gli altri).
-- Si usa lo stesso comando dei segni ⭐ e 💫, con il segno «modificata». «Duplica» invece non sostituisce nulla.

create or replace function interno.cmd_segna_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_chiave text := case d ->> 'segno' when 'preferita' then 'preferite' when 'ospiti' then 'per_ospiti'
                                       when 'modificata' then 'modificate' end;
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
  -- Solo una ricetta della famiglia tratta da un'altra può prenderne il posto.
  if v_attivo and v_chiave = 'modificate' and not exists (
      select 1 from public.ricetta r where r.id = v_ricetta and r.famiglia_id = p_famiglia and r.derivata_da is not null) then
    perform interno.rifiuta('dati_non_validi');
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

-- Ripristino: anche l'elenco delle ricette modificate va riscritto con gli id nuovi.
create or replace function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_conta jsonb;
  v_chiave text;
  v_elenco jsonb;
begin
  v_conta := interno.ripristina_senza_segni(p_famiglia, d, p_utente);
  foreach v_chiave in array array['preferite', 'per_ospiti', 'modificate'] loop
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

revoke all on function interno.cmd_segna_ricetta(uuid, jsonb, uuid), interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) from public, anon, authenticated;
