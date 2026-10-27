-- Piatti che durano più giorni (la torta di domenica, il ragù fatto per tre pasti).
--
-- - portata.avanzo_di: la portata da cui viene. Nel menu è lo stesso piatto, ma non si cucina di nuovo:
--   la spesa e il previsto contano tutte le porzioni sul giorno in cui si cucina, e il giorno dopo si mangia
--   l'avanzo (ing:avanzo, in porzioni) messo in casa dalla conferma del primo giorno.
-- - Confermare il primo giorno senza indicare avanzi mette in casa da solo le porzioni dei giorni dopo.
-- - Il menu resta un'intenzione: aggiungere o togliere avanzi non tocca la casa.

alter table public.portata add column avanzo_di uuid references public.portata (id);
create index portata_avanzo on public.portata (avanzo_di) where avanzo_di is not null;

-- Le porzioni di una portata: quelle scritte, o automatiche da chi mangia (al mezzo), come nell'app.
create function interno.porzioni_portata(p_portata uuid) returns numeric
language sql stable as $$
  select coalesce(p.porzioni, round(2 * coalesce((
           select sum(m.porzione) from public.membro m
            where m.famiglia_id = p.famiglia_id and m.eliminato_il is null and not m.archiviato
              and not exists (select 1 from public.eccezione_membro e
                              where e.portata_id = p.id and e.membro_id = m.id and e.eliminato_il is null)), 0)) / 2)
    from public.portata p where p.id = p_portata
$$;

-- Quanto serve per le portate tra due date: le portate-avanzo non si cucinano; le loro porzioni si
-- aggiungono al piatto da cui vengono (anche se questo cade prima del periodo, si comprano per quel giorno).
create or replace function interno.fabbisogno_menu(p_famiglia uuid, p_dal date, p_al date)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with persone as (
    select id, porzione from public.membro where famiglia_id = p_famiglia and eliminato_il is null and not archiviato
  ), portate as (
    select p.id, p.ricetta_id,
      interno.porzioni_portata(p.id) + coalesce((
        select sum(interno.porzioni_portata(a.id)) from public.portata a
         where a.avanzo_di = p.id and a.eliminato_il is null), 0) as porzioni
      from public.portata p
     where p.famiglia_id = p_famiglia and p.eliminato_il is null and p.ricetta_id is not null and p.avanzo_di is null
       and p.data between p_dal and p_al
  ), alternative as (
    select e.ricetta_id, coalesce(e.porzioni, x.porzione) as porzioni
      from public.eccezione_membro e
      join public.portata p on p.id = e.portata_id and p.eliminato_il is null and p.data between p_dal and p_al
      join persone x on x.id = e.membro_id
     where e.famiglia_id = p_famiglia and e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
  ), piatti as (
    select ricetta_id, porzioni from portate union all select ricetta_id, porzioni from alternative
  )
  select g.ingrediente_id, g.unita, sum(g.quantita * pi.porzioni / r.porzioni)
    from piatti pi
    join public.ricetta r on r.id = pi.ricetta_id
    join public.ricetta_ingrediente g on g.ricetta_id = r.id and g.eliminato_il is null
    join public.ingrediente i on i.id = g.ingrediente_id
   where pi.porzioni > 0 and not g.qb and not g.opzionale and g.quantita is not null and not i.base
   group by g.ingrediente_id, g.unita
$$;

-- Il previsto di una portata. Un avanzo: le sue porzioni di avanzo. Un piatto che dura più giorni: si
-- cucina tutto il primo giorno (le porzioni sue più quelle dei giorni dopo).
create or replace function interno.previsto_portata(p_portata uuid)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with p as (
    select * from public.portata where id = p_portata and eliminato_il is null
  ), persone as (
    select m.id, m.porzione from public.membro m join p on m.famiglia_id = p.famiglia_id
     where m.eliminato_il is null and not m.archiviato
  ), piatti as (
    select p.ricetta_id,
      interno.porzioni_portata(p.id) + coalesce((
        select sum(interno.porzioni_portata(a.id)) from public.portata a
         where a.avanzo_di = p.id and a.eliminato_il is null), 0) as porzioni
      from p where p.ricetta_id is not null and p.avanzo_di is null
    union all
    select e.ricetta_id, coalesce(e.porzioni, x.porzione)
      from public.eccezione_membro e join p on p.id = e.portata_id join persone x on x.id = e.membro_id
     where e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
  )
  select f.ingrediente_id, f.unita, sum(f.quantita)
    from piatti pi cross join lateral interno.ingredienti_piatto(pi.ricetta_id, pi.porzioni) f
   group by f.ingrediente_id, f.unita
  union all
  select 'ing:avanzo', 'pz', interno.porzioni_portata(p.id) from p where p.avanzo_di is not null and interno.porzioni_portata(p.id) > 0
$$;

-- ───────────────────────── Conferma del pasto ─────────────────────────

create or replace function interno.cmd_conferma_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
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
          coalesce(v_x ->> 'luogo', 'frigo'), v_portata.data, (v_x ->> 'data_limite')::date, coalesce(v_x ->> 'tipo_data', 'sconosciuta'),
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
          (select r.titolo from public.ricetta r where r.id = v_portata.ricetta_id), 'pz', 'frigo', v_portata.data, 'sconosciuta',
          'avanzo', (d ->> 'id')::uuid);
      perform interno.nuovo_movimento(p_famiglia, interno.nuovo_id((d ->> 'id')::uuid, 'avanzo'), v_prendo, 'carico', null);
    end if;
  end if;

  return jsonb_build_object('revisione', coalesce(v_attiva.revisione, 0) + 1, 'movimenti', v_n, 'mancanti', v_mancanti);
end $$;

-- ───────────────────────── Comandi ─────────────────────────

-- Mette l'avanzo di una portata in un altro giorno (dopo) e pasto: { id, avanzo_di, data, categoria, porzioni?, ordine? }.
create function interno.cmd_aggiungi_avanzo(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_origine public.portata;
begin
  select * into v_origine from public.portata
   where id = (d ->> 'avanzo_di')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if v_origine.id is null then
    perform interno.rifiuta('portata_non_trovata');
  end if;
  if v_origine.ricetta_id is null or v_origine.avanzo_di is not null then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'avanzo_di'));
  end if;
  if (d ->> 'data')::date is null or (d ->> 'data')::date <= v_origine.data then
    perform interno.rifiuta('dati_non_validi', jsonb_build_object('campo', 'data'));
  end if;
  insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, porzioni, origine, ordine, avanzo_di)
    values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'data')::date, d ->> 'categoria', v_origine.ricetta_id,
            (d ->> 'porzioni')::numeric, 'manuale', coalesce((d ->> 'ordine')::numeric, 0), v_origine.id);
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('aggiungi_avanzo', 'cmd_aggiungi_avanzo');

-- Togliere un piatto toglie anche i suoi avanzi nei giorni dopo, se non sono già stati confermati.
create or replace function interno.cmd_rimuovi_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  update public.portata set eliminato_il = now()
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if not found and not exists (select 1 from public.portata where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia) then
    perform interno.rifiuta('non_trovato');
  end if;
  update public.portata a set eliminato_il = now()
   where a.avanzo_di = (d ->> 'id')::uuid and a.famiglia_id = p_famiglia and a.eliminato_il is null
     and not exists (select 1 from public.conferma_pasto c where c.portata_id = a.id and c.attiva);
  update public.eccezione_membro e set eliminato_il = now()
   where e.famiglia_id = p_famiglia and e.eliminato_il is null
     and e.portata_id in (select p.id from public.portata p
                           where p.famiglia_id = p_famiglia and p.eliminato_il is not null
                             and (p.id = (d ->> 'id')::uuid or p.avanzo_di = (d ->> 'id')::uuid));
  return '{}'::jsonb;
end $$;

-- Ripetere la settimana porta con sé il legame tra piatto e avanzi.
create or replace function interno.cmd_ripeti_portate(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_x jsonb;
  v_copiate integer := 0;
  v_saltate integer := 0;
begin
  if jsonb_array_length(coalesce(d -> 'portate', '[]')) = 0 or jsonb_array_length(d -> 'portate') > 200 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  for v_x in select * from jsonb_array_elements(d -> 'portate') loop
    insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, note)
      select (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'data')::date, coalesce(v_x ->> 'categoria', p.categoria), p.ricetta_id,
             p.testo, p.porzioni, 'ripetuta', p.ordine, p.note
        from public.portata p
       where p.id = (v_x ->> 'da')::uuid and p.famiglia_id = p_famiglia and p.eliminato_il is null
         and (p.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = p.ricetta_id and r.eliminato_il is null));
    if found then v_copiate := v_copiate + 1; else v_saltate := v_saltate + 1; end if;
  end loop;
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'eccezioni', '[]')) loop
    insert into public.eccezione_membro (id, famiglia_id, portata_id, membro_id, tipo, ricetta_id, testo, porzioni)
      select (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'portata_id')::uuid, e.membro_id, e.tipo, e.ricetta_id, e.testo, e.porzioni
        from public.eccezione_membro e
        join public.membro m on m.id = e.membro_id and m.eliminato_il is null
       where e.id = (v_x ->> 'da')::uuid and e.famiglia_id = p_famiglia and e.eliminato_il is null
         and exists (select 1 from public.portata p where p.id = (v_x ->> 'portata_id')::uuid and p.famiglia_id = p_famiglia)
         and (e.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = e.ricetta_id and r.eliminato_il is null));
  end loop;
  -- Un avanzo copiato insieme al suo piatto resta il suo avanzo; senza il piatto diventa un piatto normale.
  update public.portata c set avanzo_di = (y.e ->> 'id')::uuid
    from jsonb_array_elements(d -> 'portate') x(e)
    join public.portata s on s.id = (x.e ->> 'da')::uuid and s.avanzo_di is not null
    join jsonb_array_elements(d -> 'portate') y(e) on (y.e ->> 'da')::uuid = s.avanzo_di
   where c.id = (x.e ->> 'id')::uuid and c.famiglia_id = p_famiglia and c.avanzo_di is null
     and exists (select 1 from public.portata o where o.id = (y.e ->> 'id')::uuid and o.famiglia_id = p_famiglia
                   and o.eliminato_il is null and o.data < c.data);
  return jsonb_build_object('copiate', v_copiate, 'saltate', v_saltate);
end $$;

-- ───────────────────────── Ripristino: file della versione 10 ─────────────────────────

alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_fino_a_9;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_conta jsonb;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' or (v_file ->> 'versione_schema') is distinct from '10' then
    return interno.ripristina_fino_a_9(p_famiglia, d, p_utente);
  end if;
  v_conta := interno.ripristina_fino_a_9(p_famiglia, jsonb_set(d, '{file,versione_schema}', '9'), p_utente);
  update public.portata p set avanzo_di = o.id
    from jsonb_array_elements(v_file -> 'tabelle' -> 'portata') x(e)
    join public.portata o on o.id = interno.nuovo_id(p_famiglia, x.e ->> 'avanzo_di')
   where x.e ->> 'avanzo_di' is not null and p.id = interno.nuovo_id(p_famiglia, x.e ->> 'id');
  return v_conta;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
