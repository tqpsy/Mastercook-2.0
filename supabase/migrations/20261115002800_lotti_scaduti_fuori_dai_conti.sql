-- Un lotto con la scadenza vera passata non conta più come disponibile.
--
-- Finora la data serviva solo a mostrare «scaduto»: il lotto restava nelle quantità. Il latte scaduto da quattro
-- giorni copriva comunque il bisogno del menu (il latte non finiva in lista) e «Mangiato» lo scalava per primo,
-- perché si toglie «prima ciò che scade prima». Ora, finché qualcuno non lo scarica:
--   - la lista della spesa non lo conta (nemmeno come prodotto a occhio);
--   - lo scarico di «Mangiato», «Cucinato» e «Hai finito di cucinare» non lo tocca.
-- Non si cancella niente: il lotto resta in casa, con il suo stato «scaduto», e si scarica a mano.
-- Vale solo per `tipo_data = 'scadenza'` (la data scritta sulla confezione): «preferibilmente entro» (tmc) non dice
-- che il cibo sia da buttare, una data stimata dall'app può sbagliare, e una data sconosciuta non è una data.
-- Un lotto che scade oggi si può ancora usare. Il giorno è quello di Roma, come nella verifica con le foto.
-- Funzioni come in 20261115002300 (spesa, a occhio) e 20261115002600 (scegli_lotti), con questa sola condizione in più.

create function interno.lotto_scaduto(p_tipo text, p_data date) returns boolean
language sql stable as $$
  select p_tipo = 'scadenza' and p_data is not null and p_data < (now() at time zone 'Europe/Rome')::date
$$;

create or replace function interno.scegli_lotti(p_famiglia uuid, p_ingrediente text, p_unita text, p_quantita numeric, p_gia jsonb,
                                     p_avanzo_di uuid default null)
returns table (r_lotto uuid, r_preso numeric)
language plpgsql stable as $$
declare
  v_l record;
  v_resta numeric := p_quantita;
  v_prendo numeric;
begin
  for v_l in
    select l.id, l.quantita + coalesce((p_gia ->> l.id::text)::numeric, 0) as disponibile
      from public.lotto l
     where l.famiglia_id = p_famiglia and l.eliminato_il is null and l.chiuso_il is null and l.unita = p_unita
       and not interno.lotto_scaduto(l.tipo_data, l.data_limite)
       and p_ingrediente = any (interno.antenati(l.ingrediente_id))
       and (p_avanzo_di is null or l.conferma_id in (select cp.id from public.conferma_pasto cp where cp.portata_id = p_avanzo_di))
     order by l.data_limite nulls last, l.data_acquisto nulls last, l.creato_il, l.id
  loop
    exit when v_resta <= 0;
    v_prendo := least(v_resta, v_l.disponibile);
    continue when v_prendo <= 0;
    r_lotto := v_l.id;
    r_preso := v_prendo;
    v_resta := v_resta - v_prendo;
    return next;
  end loop;
end $$;

create or replace function interno.basta_a_occhio(p_famiglia uuid, p_ingrediente text) returns boolean
language sql stable as $$
  select coalesce(sum(l.quantita) > 1 or bool_or(l.livello <> 'finendo'), false)
    from public.lotto l
   where l.famiglia_id = p_famiglia and l.chiuso_il is null and l.eliminato_il is null and l.quantita > 0
     and l.livello is not null and not interno.lotto_scaduto(l.tipo_data, l.data_limite) and p_ingrediente = any (interno.antenati(l.ingrediente_id))
$$;

create or replace function interno.cmd_ricalcola_spesa(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_dal date := (d ->> 'dal')::date;
  v_al date := (d ->> 'al')::date;
  v_bisogno record;
  v_lotto record;
  v_usato jsonb := '{}'::jsonb;
  v_resta numeric;
  v_prendo numeric;
  v_in_arrivo numeric;
  v_peso_pz numeric;
  v_chiavi text[] := '{}';
  v_nuove integer := 0;
  v_aggiornate integer := 0;
  v_tolte integer := 0;
  v_voce public.voce_spesa;
  v_giorni date[];
begin
  -- Giorni scelti (facoltativi): solo i piatti di quei giorni, tutti dentro il periodo.
  if jsonb_typeof(d -> 'giorni') = 'array' then
    select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_giorni from jsonb_array_elements_text(d -> 'giorni') x;
  end if;
  if v_dal is null or v_al is null or v_al < v_dal or v_al - v_dal > 31 then
    perform interno.rifiuta('periodo_non_valido');
  end if;
  if v_giorni is not null and (cardinality(v_giorni) = 0 or v_giorni[1] < v_dal or v_giorni[cardinality(v_giorni)] > v_al) then
    perform interno.rifiuta('periodo_non_valido');
  end if;
  -- La scelta vale per tutta la famiglia: chi apre la lista dopo ritrova gli stessi giorni.
  update public.famiglia
     set impostazioni = case when v_giorni is null then impostazioni - 'spesa_giorni'
                             else impostazioni || jsonb_build_object('spesa_giorni', to_jsonb(v_giorni)) end
   where id = p_famiglia
     and impostazioni -> 'spesa_giorni' is distinct from (case when v_giorni is null then null else to_jsonb(v_giorni) end);

  for v_bisogno in
    select f.ingrediente_id, f.unita, f.quantita, cardinality(interno.antenati(f.ingrediente_id)) as profondita
      from interno.fabbisogno_menu(p_famiglia, v_dal, v_al, v_giorni) f
     where f.quantita > 0
     order by 4 desc, 1
  loop
    v_resta := v_bisogno.quantita;
    -- A occhio: se ce n'è abbastanza, il bisogno è coperto.
    if v_bisogno.unita <> 'pz' and interno.basta_a_occhio(p_famiglia, v_bisogno.ingrediente_id) then
      v_resta := 0;
    end if;
    -- Casa: lotti aperti dello stesso ingrediente o di un suo «figlio», prima quelli che scadono prima.
    for v_lotto in
      select l.id, l.quantita from public.lotto l
       where l.famiglia_id = p_famiglia and l.chiuso_il is null and l.eliminato_il is null and l.quantita > 0
         and l.livello is null and not interno.lotto_scaduto(l.tipo_data, l.data_limite)
         and l.unita = v_bisogno.unita and v_bisogno.ingrediente_id = any (interno.antenati(l.ingrediente_id))
       order by l.data_limite nulls last, l.creato_il
    loop
      exit when v_resta <= 0;
      v_prendo := least(v_resta, v_lotto.quantita - coalesce((v_usato ->> v_lotto.id::text)::numeric, 0));
      if v_prendo > 0 then
        v_usato := v_usato || jsonb_build_object(v_lotto.id::text, coalesce((v_usato ->> v_lotto.id::text)::numeric, 0) + v_prendo);
        v_resta := v_resta - v_prendo;
      end if;
    end loop;

    -- Voci nel carrello di questo ingrediente: servono ancora?
    update public.voce_spesa set non_piu_necessaria = (v_resta <= 0)
     where famiglia_id = p_famiglia and eliminato_il is null and stato = 'nel_carrello' and tipo = 'derivata'
       and ingrediente_id = v_bisogno.ingrediente_id and unita = v_bisogno.unita
       and non_piu_necessaria is distinct from (v_resta <= 0);

    -- Già in arrivo: nel carrello, o in lista a mano.
    select coalesce(sum(coalesce(v.quantita_scelta, v.quantita_richiesta)), 0) into v_in_arrivo
      from public.voce_spesa v
     where v.famiglia_id = p_famiglia and v.eliminato_il is null and v.ingrediente_id = v_bisogno.ingrediente_id
       and v.unita = v_bisogno.unita
       and (v.stato = 'nel_carrello' or (v.stato = 'da_acquistare' and v.tipo = 'manuale'));
    v_resta := v_resta - v_in_arrivo;

    -- La casa ne ha quasi abbastanza: meno di mezzo pezzo che manca (80 g di patate) non si compra.
    if v_resta > 0 and v_resta < v_bisogno.quantita and v_bisogno.unita = 'g' then
      select i.peso_pz into v_peso_pz from public.ingrediente i where i.id = v_bisogno.ingrediente_id;
      if v_peso_pz is not null and v_resta < v_peso_pz / 2 then
        v_resta := 0;
      end if;
    end if;

    if v_resta > 0 then
      v_chiavi := v_chiavi || (v_bisogno.ingrediente_id || '|' || v_bisogno.unita);
      v_resta := round(v_resta, 1);
      select * into v_voce from public.voce_spesa
       where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'da_acquistare' and eliminato_il is null
         and ingrediente_id = v_bisogno.ingrediente_id and unita = v_bisogno.unita for update;
      if v_voce.id is null then
        insert into public.voce_spesa (id, famiglia_id, tipo, ingrediente_id, unita, quantita_richiesta)
          values (interno.nuovo_id(interno.comando_corrente(), v_bisogno.ingrediente_id || '|' || v_bisogno.unita),
                  p_famiglia, 'derivata', v_bisogno.ingrediente_id, v_bisogno.unita, v_resta);
        v_nuove := v_nuove + 1;
      elsif v_voce.quantita_richiesta <> v_resta or v_voce.non_piu_necessaria then
        update public.voce_spesa set quantita_richiesta = v_resta, non_piu_necessaria = false where id = v_voce.id;
        v_aggiornate := v_aggiornate + 1;
      end if;
    end if;
  end loop;

  -- Derivate da comprare che non servono più: se nessuno le ha toccate spariscono, altrimenti restano segnate.
  for v_voce in
    select * from public.voce_spesa
     where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'da_acquistare' and eliminato_il is null
       and not (ingrediente_id || '|' || unita) = any (v_chiavi)
     for update
  loop
    if v_voce.quantita_scelta is null and v_voce.nota is null then
      update public.voce_spesa set eliminato_il = now() where id = v_voce.id;
    elsif not v_voce.non_piu_necessaria then
      update public.voce_spesa set non_piu_necessaria = true where id = v_voce.id;
    end if;
    v_tolte := v_tolte + 1;
  end loop;
  -- Nel carrello, ingredienti che il menu non chiede più affatto.
  update public.voce_spesa set non_piu_necessaria = true
   where famiglia_id = p_famiglia and tipo = 'derivata' and stato = 'nel_carrello' and eliminato_il is null
     and not non_piu_necessaria
     and not exists (select 1 from interno.fabbisogno_menu(p_famiglia, v_dal, v_al, v_giorni) f
                     where f.ingrediente_id = voce_spesa.ingrediente_id and f.unita = voce_spesa.unita and f.quantita > 0);

  return jsonb_build_object('nuove', v_nuove, 'aggiornate', v_aggiornate, 'non_piu_necessarie', v_tolte);
end $$;

revoke all on function interno.lotto_scaduto(text, date), interno.scegli_lotti(uuid, text, text, numeric, jsonb, uuid),
  interno.basta_a_occhio(uuid, text), interno.cmd_ricalcola_spesa(uuid, jsonb, uuid) from public, anon, authenticated;
