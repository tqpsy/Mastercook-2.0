-- Avanzi: il tempo in frigo parte da quando si segnano e si mettono in frigo, non dal giorno del pasto.
-- Un pasto di ieri segnato oggi mette gli avanzi in casa con data di oggi (data_acquisto = il giorno in cui
-- sono stati messi via, o quello che manda l'app). La data limite stimata la calcola l'app dallo stesso momento.
-- Stessa funzione di 20261106000000_avanzi_programmati.sql (rinominata «_base» in 20261113000000), cambia solo
-- la data degli avanzi.

create or replace function interno.cmd_conferma_pasto_base(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_portata public.portata;
  v_attiva public.conferma_pasto;
  v_esito text := d ->> 'esito';
  v_porzioni numeric := (d ->> 'porzioni')::numeric;
  v_ricetta text := nullif(d ->> 'ricetta_id', '');
  v_previsto jsonb := '{}'::jsonb;
  v_usato jsonb := '{}'::jsonb;
  v_r record;
  v_x jsonb;
  v_chiave text;
  v_ing text;
  v_unita text;
  v_preso numeric;
  v_resta numeric;
  v_prendo numeric;
  v_lotti jsonb := '{}'::jsonb;   -- lotto → variazione in questo comando
  v_mancanti jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  select * into v_portata from public.portata
   where id = (d ->> 'portata_id')::uuid and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_portata.id is null then
    perform interno.rifiuta('portata_non_trovata');
  end if;
  select * into v_attiva from public.conferma_pasto where portata_id = v_portata.id and attiva;
  if d ->> 'revisione_attesa' is null and v_attiva.id is not null then
    perform interno.conflitto(jsonb_build_object('motivo', 'gia_confermato', 'conferma', v_attiva.id, 'esito', v_attiva.esito,
      'revisione', v_attiva.revisione, 'modificato_da', v_attiva.creato_da));
  end if;
  if d ->> 'revisione_attesa' is not null and (d ->> 'revisione_attesa')::integer is distinct from v_attiva.revisione then
    perform interno.conflitto(jsonb_build_object('motivo', 'conferma_cambiata', 'revisione', v_attiva.revisione,
      'modificato_da', v_attiva.creato_da));
  end if;
  if v_esito is null or v_esito not in ('come_previsto', 'quantita_diverse', 'altro_piatto', 'saltato') then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'esito'));
  end if;
  if v_esito = 'altro_piatto' and v_ricetta is null and nullif(btrim(d ->> 'testo'), '') is null then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'ricetta_id'));
  end if;
  if v_ricetta is not null and not exists (select 1 from public.ricetta r where r.id = v_ricetta
                                            and (r.famiglia_id is null or r.famiglia_id = p_famiglia) and r.eliminato_il is null) then
    perform interno.rifiuta('ricetta_non_trovata');
  end if;

  for v_r in select * from interno.previsto_portata(v_portata.id) loop
    v_previsto := v_previsto || jsonb_build_object(v_r.ingrediente_id || '|' || v_r.unita, v_r.quantita);
  end loop;

  -- Quanto è stato usato: le righe scritte dalla persona valgono sempre; altrimenti dipende dall'esito.
  if jsonb_typeof(d -> 'righe') = 'array' then
    for v_x in select * from jsonb_array_elements(d -> 'righe') loop
      if (v_x ->> 'quantita')::numeric is null or (v_x ->> 'quantita')::numeric < 0 then
        perform interno.rifiuta('quantita_non_valida', jsonb_build_object('ingrediente', v_x ->> 'ingrediente_id'));
      end if;
      v_chiave := (v_x ->> 'ingrediente_id') || '|' || (v_x ->> 'unita');
      v_usato := v_usato || jsonb_build_object(v_chiave, coalesce((v_usato ->> v_chiave)::numeric, 0) + (v_x ->> 'quantita')::numeric);
    end loop;
  elsif v_esito = 'come_previsto' then
    v_usato := v_previsto;
  elsif v_esito = 'altro_piatto' and v_ricetta is not null then
    if v_porzioni is null then
      perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'porzioni'));
    end if;
    for v_r in select * from interno.ingredienti_piatto(v_ricetta, v_porzioni) loop
      v_usato := v_usato || jsonb_build_object(v_r.ingrediente_id || '|' || v_r.unita, v_r.quantita);
    end loop;
  elsif v_esito = 'quantita_diverse' then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'righe'));
  end if;

  if v_attiva.id is not null then
    update public.conferma_pasto set attiva = false where id = v_attiva.id;
  end if;
  insert into public.conferma_pasto (id, famiglia_id, portata_id, revisione, esito, ricetta_id, testo, porzioni, nota)
    values ((d ->> 'id')::uuid, p_famiglia, v_portata.id, coalesce(v_attiva.revisione, 0) + 1, v_esito,
      case when v_esito = 'altro_piatto' then v_ricetta end,
      case when v_esito = 'altro_piatto' and v_ricetta is null then nullif(btrim(d ->> 'testo'), '') end,
      case when v_esito = 'altro_piatto' then v_porzioni end, nullif(btrim(d ->> 'nota'), ''));

  for v_chiave in select k from jsonb_object_keys(v_previsto || v_usato) k order by k loop
    insert into public.consumo_riga (id, famiglia_id, conferma_id, ingrediente_id, unita, quantita_prevista, quantita_usata)
      values (interno.nuovo_id((d ->> 'id')::uuid, 'riga:' || v_chiave), p_famiglia, (d ->> 'id')::uuid, split_part(v_chiave, '|', 1),
        split_part(v_chiave, '|', 2), (v_previsto ->> v_chiave)::numeric, coalesce((v_usato ->> v_chiave)::numeric, 0));
  end loop;

  -- Per ogni ingrediente: quanto è già stato preso dalla casa per questa portata, e quanto va preso ora.
  for v_chiave in
    select k from (select jsonb_object_keys(v_usato) k
                   union select c.ingrediente_id || '|' || c.unita from public.consumo_lotto c
                     join public.conferma_pasto cp on cp.id = c.conferma_id where cp.portata_id = v_portata.id) s order by k
  loop
    v_ing := split_part(v_chiave, '|', 1);
    v_unita := split_part(v_chiave, '|', 2);
    select coalesce(sum(c.quantita), 0) into v_preso from public.consumo_lotto c
      join public.conferma_pasto cp on cp.id = c.conferma_id
     where cp.portata_id = v_portata.id and c.ingrediente_id = v_ing and c.unita = v_unita;
    v_resta := coalesce((v_usato ->> v_chiave)::numeric, 0) - v_preso;

    if v_resta > 0 then
      -- Dai lotti aperti che valgono come quell'ingrediente (gli spaghetti valgono come pasta), prima chi scade prima.
      for v_r in
        select l.id, l.quantita + coalesce((v_lotti ->> l.id::text)::numeric, 0) as disponibile
          from public.lotto l
         where l.famiglia_id = p_famiglia and l.eliminato_il is null and l.chiuso_il is null and l.unita = v_unita
           and v_ing = any (interno.antenati(l.ingrediente_id))
           -- L'avanzo programmato si prende solo da ciò che è avanzato dal piatto da cui viene.
           and (v_portata.avanzo_di is null or v_ing <> 'ing:avanzo' or l.conferma_id in (
                 select cp.id from public.conferma_pasto cp where cp.portata_id = v_portata.avanzo_di))
         order by l.data_limite nulls last, l.data_acquisto nulls last, l.creato_il, l.id
      loop
        exit when v_resta <= 0;
        v_prendo := least(v_resta, v_r.disponibile);
        continue when v_prendo <= 0;
        v_lotti := v_lotti || jsonb_build_object(v_r.id::text, coalesce((v_lotti ->> v_r.id::text)::numeric, 0) - v_prendo);
        insert into public.consumo_lotto (id, famiglia_id, conferma_id, lotto_id, ingrediente_id, unita, quantita)
          values (interno.nuovo_id((d ->> 'id')::uuid, 'lotto:' || v_r.id || ':' || v_chiave), p_famiglia, (d ->> 'id')::uuid,
                  v_r.id, v_ing, v_unita, v_prendo);
        v_resta := v_resta - v_prendo;
      end loop;
      if v_resta > 0 then
        v_mancanti := v_mancanti || jsonb_build_object('ingrediente_id', v_ing, 'unita', v_unita, 'quantita', v_resta);
      end if;
    elsif v_resta < 0 then
      -- Si restituisce ai lotti da cui si era preso, partendo dall'ultimo.
      for v_r in
        select c.lotto_id, sum(c.quantita) as preso, max(c.creato_il) as quando
          from public.consumo_lotto c join public.conferma_pasto cp on cp.id = c.conferma_id
         where cp.portata_id = v_portata.id and c.ingrediente_id = v_ing and c.unita = v_unita
         group by c.lotto_id having sum(c.quantita) > 0
         order by quando desc, c.lotto_id
      loop
        exit when v_resta >= 0;
        v_prendo := least(-v_resta, v_r.preso);
        v_lotti := v_lotti || jsonb_build_object(v_r.lotto_id::text, coalesce((v_lotti ->> v_r.lotto_id::text)::numeric, 0) + v_prendo);
        insert into public.consumo_lotto (id, famiglia_id, conferma_id, lotto_id, ingrediente_id, unita, quantita)
          values (interno.nuovo_id((d ->> 'id')::uuid, 'lotto:' || v_r.lotto_id || ':' || v_chiave), p_famiglia, (d ->> 'id')::uuid,
                  v_r.lotto_id, v_ing, v_unita, -v_prendo);
        v_resta := v_resta + v_prendo;
      end loop;
    end if;
  end loop;

  -- Un solo movimento per lotto: consumo se si toglie, correzione se si restituisce.
  for v_r in select key::uuid as lotto, value::numeric as variazione from jsonb_each_text(v_lotti) loop
    continue when v_r.variazione = 0;
    perform interno.nuovo_movimento(p_famiglia, v_r.lotto, v_r.variazione,
      case when v_r.variazione < 0 then 'consumo' else 'correzione' end, 'Pasto del ' || to_char(v_portata.data, 'DD/MM'));
    v_n := v_n + 1;
  end loop;

  -- Avanzi: lotti nuovi in porzioni, legati alla conferma.
  if jsonb_typeof(d -> 'avanzi') = 'array' then
    for v_x in select * from jsonb_array_elements(d -> 'avanzi') loop
      if (v_x ->> 'quantita')::numeric is null or (v_x ->> 'quantita')::numeric <= 0 then
        perform interno.rifiuta('quantita_non_valida', jsonb_build_object('avanzo', v_x ->> 'nome'));
      end if;
      insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
          fonte_data, calcolata_il, affidabilita, origine, conferma_id)
        values ((v_x ->> 'lotto_id')::uuid, p_famiglia, 'ing:avanzo', nullif(btrim(v_x ->> 'nome'), ''), 'pz',
          coalesce(v_x ->> 'luogo', 'frigo'), coalesce((v_x ->> 'data_acquisto')::date, current_date), (v_x ->> 'data_limite')::date, coalesce(v_x ->> 'tipo_data', 'sconosciuta'),
          v_x ->> 'fonte_data', (v_x ->> 'calcolata_il')::timestamptz, v_x ->> 'affidabilita', 'avanzo', (d ->> 'id')::uuid);
      perform interno.nuovo_movimento(p_famiglia, (v_x ->> 'lotto_id')::uuid, (v_x ->> 'quantita')::numeric, 'carico', null);
    end loop;
  end if;

  -- Piatto che dura più giorni, confermato senza dire gli avanzi: si mettono in casa le porzioni dei giorni dopo,
  -- una volta sola per portata (una correzione non le aggiunge di nuovo).
  if jsonb_typeof(d -> 'avanzi') is distinct from 'array' and v_esito in ('come_previsto', 'quantita_diverse')
     and not exists (select 1 from public.lotto l join public.conferma_pasto cp on cp.id = l.conferma_id
                      where cp.portata_id = v_portata.id) then
    select coalesce(sum(interno.porzioni_portata(a.id)), 0) into v_prendo
      from public.portata a where a.avanzo_di = v_portata.id and a.eliminato_il is null;
    if v_prendo > 0 then
      insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, tipo_data, origine, conferma_id)
        values (interno.nuovo_id((d ->> 'id')::uuid, 'avanzo'), p_famiglia, 'ing:avanzo',
          (select r.titolo from public.ricetta r where r.id = v_portata.ricetta_id), 'pz', 'frigo', current_date, 'sconosciuta',
          'avanzo', (d ->> 'id')::uuid);
      perform interno.nuovo_movimento(p_famiglia, interno.nuovo_id((d ->> 'id')::uuid, 'avanzo'), v_prendo, 'carico', null);
    end if;
  end if;

  return jsonb_build_object('revisione', coalesce(v_attiva.revisione, 0) + 1, 'movimenti', v_n, 'mancanti', v_mancanti);
end $$;
