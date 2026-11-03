-- Lista della spesa: se la casa copre quasi tutto e manca meno di mezzo pezzo (ingredienti con peso_pz,
-- per esempio 80 g di patate da 180 g l'una), la voce non si crea: prima si segnava una patata intera.
-- Se in casa non c'è niente la voce resta, anche piccola. Il resto di cmd_ricalcola_spesa è invariato.

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
    -- Casa: lotti aperti dello stesso ingrediente o di un suo «figlio», prima quelli che scadono prima.
    for v_lotto in
      select l.id, l.quantita from public.lotto l
       where l.famiglia_id = p_famiglia and l.chiuso_il is null and l.eliminato_il is null and l.quantita > 0
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
