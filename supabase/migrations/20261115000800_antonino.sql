-- Antonino, il consigliere del menu: le sue regole e la sua memoria stanno nelle impostazioni della famiglia,
-- sotto la chiave `antonino`, senza tabelle nuove (si scaricano e si esportano con la famiglia).
--
--   antonino.regole   ciò che la famiglia gli ha insegnato (obiettivi della settimana, pesi): solo le differenze
--                     dalle regole di base, che stanno nell'app.
--   antonino.scartate { ricetta_id: { n, ultima } }  quante volte una proposta è stata scartata e quando l'ultima
--   antonino.scelte   { ricetta_id: { n, ultima } }  quante volte una proposta è stata scelta
--   antonino.mai_piu  [ ricetta_id ]                  ricette da non proporre più
--
-- Si scrive dentro il database, una chiave alla volta, così due telefoni che insegnano insieme non si cancellano.
-- Un comando ripetuto con lo stesso id non arriva qui due volte (lo ferma il registro dei comandi).

create function interno.cmd_antonino_impara(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_evento text := d ->> 'evento';
  v_ricetta text := d ->> 'ricetta_id';
  v_data text := coalesce(d ->> 'data', to_char(now() at time zone 'Europe/Rome', 'YYYY-MM-DD'));
  v_a jsonb;
  v_chiave text;
  v_ricordo jsonb;
begin
  if v_evento is null or v_evento not in ('scartata', 'scelta', 'mai_piu', 'riproponi', 'dimentica') then
    perform interno.rifiuta('dati_non_validi');
  end if;
  if v_data !~ '^\d{4}-\d{2}-\d{2}$' then
    perform interno.rifiuta('dati_non_validi');
  end if;
  if v_evento <> 'dimentica' and not exists (
      select 1 from public.ricetta r where r.id = v_ricetta and (r.famiglia_id is null or r.famiglia_id = p_famiglia)) then
    perform interno.rifiuta('ricetta_non_trovata');
  end if;
  select coalesce(impostazioni -> 'antonino', '{}'::jsonb) into v_a from public.famiglia where id = p_famiglia for update;
  if jsonb_typeof(v_a) <> 'object' then
    v_a := '{}'::jsonb;
  end if;

  if v_evento = 'dimentica' then
    -- Dimentica scarti, scelte e «mai più», non le regole insegnate.
    v_a := v_a - 'scartate' - 'scelte' - 'mai_piu';
  elsif v_evento in ('scartata', 'scelta') then
    v_chiave := case v_evento when 'scartata' then 'scartate' else 'scelte' end;
    if jsonb_typeof(v_a -> v_chiave) is distinct from 'object' then
      v_a := v_a || jsonb_build_object(v_chiave, '{}'::jsonb);
    end if;
    v_ricordo := v_a -> v_chiave -> v_ricetta;
    v_a := jsonb_set(v_a, array[v_chiave, v_ricetta], jsonb_build_object(
      'n', least(9, coalesce((v_ricordo ->> 'n')::int, 0) + 1),
      'ultima', greatest(coalesce(v_ricordo ->> 'ultima', ''), v_data)));
  else
    select coalesce(jsonb_agg(x order by n), '[]'::jsonb) into v_ricordo
      from jsonb_array_elements_text(case when jsonb_typeof(v_a -> 'mai_piu') = 'array' then v_a -> 'mai_piu' else '[]'::jsonb end)
        with ordinality as e(x, n) where x <> v_ricetta;
    if v_evento = 'mai_piu' then
      v_ricordo := v_ricordo || to_jsonb(v_ricetta);
    end if;
    v_a := v_a || jsonb_build_object('mai_piu', v_ricordo);
  end if;

  update public.famiglia set impostazioni = impostazioni || jsonb_build_object('antonino', v_a)
   where id = p_famiglia and impostazioni -> 'antonino' is distinct from v_a;
  return '{}'::jsonb;
end $$;

-- Le regole insegnate: un oggetto (solo ciò che cambia dalle regole di base) o null per tornare a quelle di base.
-- L'app controlla i valori; qui si limita la grandezza, perché non diventi un deposito di altro.
create function interno.cmd_antonino_regole(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_regole jsonb := d -> 'regole';
  v_a jsonb;
begin
  if v_regole is null or (jsonb_typeof(v_regole) <> 'object' and jsonb_typeof(v_regole) <> 'null') or length(v_regole::text) > 4000 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  select coalesce(impostazioni -> 'antonino', '{}'::jsonb) into v_a from public.famiglia where id = p_famiglia for update;
  if jsonb_typeof(v_a) <> 'object' then
    v_a := '{}'::jsonb;
  end if;
  if jsonb_typeof(v_regole) = 'null' or v_regole = '{}'::jsonb then
    v_a := v_a - 'regole';
  else
    v_a := v_a || jsonb_build_object('regole', v_regole);
  end if;
  update public.famiglia set impostazioni = impostazioni || jsonb_build_object('antonino', v_a)
   where id = p_famiglia and impostazioni -> 'antonino' is distinct from v_a;
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('antonino_impara', 'cmd_antonino_impara'), ('antonino_regole', 'cmd_antonino_regole');

revoke all on function interno.cmd_antonino_impara(uuid, jsonb, uuid), interno.cmd_antonino_regole(uuid, jsonb, uuid)
  from public, anon, authenticated;
