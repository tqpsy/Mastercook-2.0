-- «Cucinato»: un piatto del menu preparato in anticipo.
--
-- - Cucinare toglie subito dalla casa gli ingredienti previsti (prima i lotti che scadono prima) e mette il
--   piatto pronto in casa come lotto in porzioni (ingrediente `ing:avanzo`), legato alla portata, con la data
--   scelta (stimata dall'app, modificabile) e il posto (frigo o freezer).
-- - Quando poi si segna «mangiato come previsto», gli ingredienti non si tolgono una seconda volta: dal piatto
--   pronto restano le porzioni avanzate indicate (le altre risultano mangiate). «Saltato» o «altro piatto»
--   lasciano il piatto pronto in casa.

alter table public.lotto add column portata_id uuid references public.portata (id) on delete set null;
create unique index lotto_cucinato on public.lotto (portata_id) where portata_id is not null and eliminato_il is null;

-- { id (del lotto), portata_id, nome, porzioni, luogo, data_limite?, tipo_data?, fonte_data?, calcolata_il?, affidabilita? }
create function interno.cmd_cucina_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_portata public.portata;
  v_porzioni numeric := (d ->> 'porzioni')::numeric;
  v_r record;
  v_q record;
  v_resta numeric;
  v_prendo numeric;
  v_lotti jsonb := '{}'::jsonb;
  v_mancanti jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  select * into v_portata from public.portata
   where id = (d ->> 'portata_id')::uuid and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_portata.id is null then
    perform interno.rifiuta('portata_non_trovata');
  end if;
  if v_portata.avanzo_di is not null then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'portata_id', 'motivo', 'avanzo'));
  end if;
  if exists (select 1 from public.conferma_pasto where portata_id = v_portata.id and attiva) then
    perform interno.rifiuta('gia_confermato');
  end if;
  if exists (select 1 from public.lotto where portata_id = v_portata.id and eliminato_il is null) then
    perform interno.rifiuta('gia_cucinato');
  end if;
  if v_porzioni is null or v_porzioni <= 0 or v_porzioni > 100 then
    perform interno.rifiuta('quantita_non_valida', jsonb_build_object('campo', 'porzioni'));
  end if;
  if coalesce(d ->> 'luogo', 'frigo') not in ('frigo', 'freezer') then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'luogo'));
  end if;

  -- Gli ingredienti previsti (anche per i giorni dopo, se il piatto dura più giorni), dai lotti che scadono prima.
  for v_q in select * from interno.previsto_portata(v_portata.id) order by ingrediente_id, unita loop
    v_resta := v_q.quantita;
    for v_r in
      select l.id, l.quantita + coalesce((v_lotti ->> l.id::text)::numeric, 0) as disponibile
        from public.lotto l
       where l.famiglia_id = p_famiglia and l.eliminato_il is null and l.chiuso_il is null and l.unita = v_q.unita
         and v_q.ingrediente_id = any (interno.antenati(l.ingrediente_id))
       order by l.data_limite nulls last, l.data_acquisto nulls last, l.creato_il, l.id
    loop
      exit when v_resta <= 0;
      v_prendo := least(v_resta, v_r.disponibile);
      continue when v_prendo <= 0;
      v_lotti := v_lotti || jsonb_build_object(v_r.id::text, coalesce((v_lotti ->> v_r.id::text)::numeric, 0) - v_prendo);
      v_resta := v_resta - v_prendo;
    end loop;
    if v_resta > 0 then
      v_mancanti := v_mancanti || jsonb_build_object('ingrediente_id', v_q.ingrediente_id, 'unita', v_q.unita, 'quantita', v_resta);
    end if;
  end loop;
  for v_r in select key::uuid as lotto, value::numeric as variazione from jsonb_each_text(v_lotti) loop
    continue when v_r.variazione = 0;
    perform interno.nuovo_movimento(p_famiglia, v_r.lotto, v_r.variazione, 'consumo', 'Cucinato per il ' || to_char(v_portata.data, 'DD/MM'));
    v_n := v_n + 1;
  end loop;

  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, portata_id)
    values ((d ->> 'id')::uuid, p_famiglia, 'ing:avanzo', nullif(left(btrim(d ->> 'nome'), 120), ''), 'pz',
      coalesce(d ->> 'luogo', 'frigo'), current_date, (d ->> 'data_limite')::date, coalesce(d ->> 'tipo_data', 'sconosciuta'),
      d ->> 'fonte_data', (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', 'avanzo', v_portata.id);
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'id')::uuid, v_porzioni, 'carico', 'Cucinato');

  return jsonb_build_object('movimenti', v_n, 'mancanti', v_mancanti);
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('cucina_portata', 'cmd_cucina_portata');

-- La conferma di un piatto già cucinato.
alter function interno.cmd_conferma_pasto(uuid, jsonb, uuid) rename to cmd_conferma_pasto_avanzi;

create function interno.cmd_conferma_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_pronto record;
  v_esito text := d ->> 'esito';
  v_resta numeric;
  v_data date;
  v_ris jsonb;
begin
  select l.id, l.quantita into v_pronto from public.lotto l
   where l.portata_id = (d ->> 'portata_id')::uuid and l.famiglia_id = p_famiglia and l.eliminato_il is null
   for update;
  if v_pronto.id is null then
    return interno.cmd_conferma_pasto_avanzi(p_famiglia, d, p_utente);
  end if;
  -- Gli ingredienti sono già usciti quando si è cucinato.
  if v_esito = 'come_previsto' then
    d := d || jsonb_build_object('righe', '[]'::jsonb);
  end if;
  -- Le porzioni avanzate restano nel piatto pronto: nessun lotto nuovo, né gli avanzi automatici dei giorni dopo.
  if jsonb_typeof(d -> 'avanzi') = 'array' and v_esito in ('come_previsto', 'quantita_diverse') then
    select coalesce(sum((x ->> 'quantita')::numeric), 0) into v_resta from jsonb_array_elements(d -> 'avanzi') x;
  end if;
  d := d || jsonb_build_object('avanzi', '[]'::jsonb);
  v_ris := interno.cmd_conferma_pasto_avanzi(p_famiglia, d, p_utente);
  if v_resta is not null and v_resta <> v_pronto.quantita then
    select data into v_data from public.portata where id = (d ->> 'portata_id')::uuid;
    perform interno.nuovo_movimento(p_famiglia, v_pronto.id, v_resta - v_pronto.quantita,
      case when v_resta < v_pronto.quantita then 'consumo' else 'correzione' end, 'Pasto del ' || to_char(v_data, 'DD/MM'));
  end if;
  return v_ris;
end $$;
