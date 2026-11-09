-- Prodotti «a occhio» (richiesta di Luca del 9/11/2026): il formaggio, l'olio, il sale si usano senza pesare, quindi
-- non si può dire ogni volta quanti grammi restano. Un lotto può allora essere «a occhio»: si contano i pezzi (o le
-- confezioni) e si dice a parole quanto resta di quello in uso: tanto, metà, poco, sta per finire.
--
-- - Un lotto a occhio ha `livello` e unità «pz» (anche per un ingrediente che si pesa): la quantità è il numero di
--   pezzi, e resta la somma dei movimenti (un pezzo finito è un movimento di −1; a zero il lotto si chiude).
-- - Le ricette non tolgono grammi da questi lotti (cercano lotti in g o ml, come prima): l'app avvisa se resta poco.
-- - La lista della spesa: un prodotto a occhio basta per il menu, salvo «sta per finire» con un solo pezzo.
-- - Il ripristino da un file di copia riporta anche il livello.

alter table public.lotto add column livello text
  check (livello is null or livello in ('tanto', 'meta', 'poco', 'finendo'));
alter table public.lotto add constraint livello_coerente check (livello is null or unita = 'pz');

-- Unità «pz» ammessa per massa e volume solo nei lotti a occhio; le cose che si contano (uova) si contano e basta.
create or replace function interno.controlla_unita() returns trigger
language plpgsql as $$
declare
  v_dimensione text;
  v_unita text;
  v_a_occhio boolean := tg_table_name = 'lotto' and (to_jsonb(new) ->> 'livello') is not null;
begin
  select case dimensione when 'massa' then 'g' when 'volume' then 'ml' else 'pz' end, dimensione
    into v_unita, v_dimensione from public.ingrediente where id = new.ingrediente_id;
  if v_a_occhio and (v_dimensione is null or v_dimensione not in ('massa', 'volume')) then
    perform interno.rifiuta('livello_non_ammesso', jsonb_build_object('ingrediente', new.ingrediente_id));
  end if;
  if v_unita is not null and new.unita <> (case when v_a_occhio then 'pz' else v_unita end) then
    perform interno.rifiuta('unita_incompatibile', jsonb_build_object('ingrediente', new.ingrediente_id, 'unita', new.unita,
      'dimensione', v_dimensione));
  end if;
  -- Un ingrediente di un'altra famiglia non si può usare.
  if exists (select 1 from public.ingrediente i where i.id = new.ingrediente_id
             and i.famiglia_id is not null and i.famiglia_id is distinct from new.famiglia_id) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  return new;
end $$;
drop trigger controlla_unita on public.lotto;
create trigger controlla_unita before insert or update of unita, ingrediente_id, livello on public.lotto
  for each row execute function interno.controlla_unita();

-- Il numero di pezzi di un lotto a occhio: intero, da 1 a 99.
create function interno.pezzi_validi(p numeric) returns boolean
language sql immutable as $$ select p is not null and p >= 1 and p <= 99 and p = trunc(p) $$;

-- Aggiungi in casa, anche a occhio: { …come prima, livello?, quantita = pezzi, unita = 'pz' }.
create or replace function interno.cmd_aggiungi_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_quantita numeric := (d ->> 'quantita')::numeric;
  v_livello text := nullif(d ->> 'livello', '');
begin
  if v_quantita is null or v_quantita <= 0 or (v_livello is not null and not interno.pezzi_validi(v_quantita)) then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  if coalesce(d ->> 'origine', 'manuale') <> 'manuale' then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  if not exists (select 1 from public.ingrediente i where i.id = d ->> 'ingrediente_id'
                 and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, livello, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note, posto)
    values ((d ->> 'id')::uuid, p_famiglia, d ->> 'ingrediente_id', nullif(btrim(d ->> 'nome'), ''),
      case when v_livello is null then d ->> 'unita' else 'pz' end, v_livello,
      d ->> 'luogo', (d ->> 'data_acquisto')::date, (d ->> 'data_limite')::date, d ->> 'tipo_data', d ->> 'fonte_data',
      (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', 'manuale', nullif(btrim(d ->> 'note'), ''),
      case when d ->> 'luogo' = 'dispensa' then null else nullif(d ->> 'posto', '') end);
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'id')::uuid, v_quantita, 'carico', null);
  return '{}'::jsonb;
end $$;

-- «Quanto ne resta»: { lotto_id, livello, pezzi?, nuovo_id?, quantita?, unita? }
-- - Lotto già a occhio e livello: cambia il livello e, se c'è, il numero di pezzi (0 = finito, il lotto si chiude).
-- - Lotto misurato e livello: diventa a occhio. Il lotto in grammi si chiude e ne nasce uno a occhio (`nuovo_id`)
--   con le stesse date e lo stesso posto: la cronologia in grammi resta com'era.
-- - Lotto a occhio e livello null: torna misurato, con `quantita` e `unita` (g o ml), allo stesso modo.
-- Vince l'ultimo che tocca: è una stima a parole, non un conto.
create function interno.cmd_cambia_livello(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'lotto_id')::uuid);
  v_livello text := nullif(d ->> 'livello', '');
  v_pezzi numeric := (d ->> 'pezzi')::numeric;
  v_nuovo uuid := (d ->> 'nuovo_id')::uuid;
  v_quantita numeric;
  v_unita text;
begin
  if v_lotto.eliminato_il is not null or v_lotto.chiuso_il is not null then
    perform interno.rifiuta('lotto_chiuso');
  end if;
  if v_livello is not null and v_livello not in ('tanto', 'meta', 'poco', 'finendo') then
    perform interno.rifiuta('livello_non_valido');
  end if;

  -- Resta a occhio: livello e pezzi.
  if v_lotto.livello is not null and v_livello is not null then
    if v_pezzi is not null and v_pezzi <> 0 and not interno.pezzi_validi(v_pezzi) then
      perform interno.rifiuta('quantita_non_valida');
    end if;
    if v_livello is distinct from v_lotto.livello then
      update public.lotto set livello = v_livello where id = v_lotto.id;
    end if;
    if v_pezzi is not null and v_pezzi <> v_lotto.quantita then
      perform interno.nuovo_movimento(p_famiglia, v_lotto.id, v_pezzi - v_lotto.quantita,
        case when v_pezzi < v_lotto.quantita then 'consumo' else 'correzione' end, null);
    end if;
    return '{}'::jsonb;
  end if;

  if v_livello is null and v_lotto.livello is null then
    perform interno.rifiuta('livello_non_valido');
  end if;
  if v_nuovo is null then
    perform interno.rifiuta('quantita_non_valida', jsonb_build_object('campo', 'nuovo_id'));
  end if;
  if v_livello is not null then
    v_quantita := coalesce(v_pezzi, 1);
    v_unita := 'pz';
    if not interno.pezzi_validi(v_quantita) then
      perform interno.rifiuta('quantita_non_valida');
    end if;
  else
    v_quantita := (d ->> 'quantita')::numeric;
    v_unita := d ->> 'unita';
    if v_quantita is null or v_quantita <= 0 then
      perform interno.rifiuta('quantita_non_valida');
    end if;
  end if;

  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, livello, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note, posto)
    values (v_nuovo, p_famiglia, v_lotto.ingrediente_id, v_lotto.nome, v_unita, v_livello, v_lotto.luogo, v_lotto.data_acquisto,
      v_lotto.data_limite, v_lotto.tipo_data, v_lotto.fonte_data, v_lotto.calcolata_il, v_lotto.affidabilita, v_lotto.origine,
      v_lotto.note, v_lotto.posto);
  perform interno.nuovo_movimento(p_famiglia, v_lotto.id, -v_lotto.quantita, 'correzione',
    case when v_livello is null then 'Ora si misura' else 'Ora a occhio' end);
  perform interno.nuovo_movimento(p_famiglia, v_nuovo, v_quantita, 'carico', null);
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('cambia_livello', 'cmd_cambia_livello');
revoke all on function interno.cmd_cambia_livello(uuid, jsonb, uuid), interno.pezzi_validi(numeric) from public, anon, authenticated;

-- Quanto copre la casa per un bisogno del menu: un prodotto a occhio basta, salvo «sta per finire» con un pezzo solo
-- (e nessun altro pezzo a occhio dello stesso ingrediente). I lotti misurati si contano come sempre.
create function interno.basta_a_occhio(p_famiglia uuid, p_ingrediente text) returns boolean
language sql stable as $$
  select coalesce(sum(l.quantita) > 1 or bool_or(l.livello <> 'finendo'), false)
    from public.lotto l
   where l.famiglia_id = p_famiglia and l.chiuso_il is null and l.eliminato_il is null and l.quantita > 0
     and l.livello is not null and p_ingrediente = any (interno.antenati(l.ingrediente_id))
$$;
revoke all on function interno.basta_a_occhio(uuid, text) from public, anon, authenticated;

-- Lista della spesa: come in 20261115001500, con i prodotti a occhio che coprono il bisogno.
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
         and l.livello is null
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

-- Ripristino: i lotti a occhio entrano prima con l'unità dell'ingrediente (il ripristino di prima non conosce il
-- livello), poi tornano a occhio con i loro pezzi.
alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_senza_livelli;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotti jsonb := d -> 'file' -> 'tabelle' -> 'lotto';
  v_ingredienti jsonb := coalesce(d -> 'file' -> 'tabelle' -> 'ingrediente', '[]'::jsonb);
  v_conta jsonb;
  v_r jsonb;
begin
  if jsonb_typeof(v_lotti) = 'array' and exists (select 1 from jsonb_array_elements(v_lotti) e where e ->> 'livello' is not null) then
    d := jsonb_set(d, '{file,tabelle,lotto}', (
      select jsonb_agg(case when e ->> 'livello' is null then e else e || jsonb_build_object('unita', coalesce((
          select case i.dimensione when 'volume' then 'ml' else 'g' end from public.ingrediente i
           where i.id = e ->> 'ingrediente_id' and i.famiglia_id is null), (
          select case x ->> 'dimensione' when 'volume' then 'ml' else 'g' end from jsonb_array_elements(v_ingredienti) x
           where x ->> 'id' = e ->> 'ingrediente_id' limit 1), 'g')) end order by n)
        from jsonb_array_elements(v_lotti) with ordinality as t(e, n)));
  end if;
  v_conta := interno.ripristina_senza_livelli(p_famiglia, d, p_utente);
  for v_r in select e from jsonb_array_elements(coalesce(v_lotti, '[]'::jsonb)) e where e ->> 'livello' is not null loop
    update public.lotto set unita = 'pz', livello = v_r ->> 'livello'
     where id = interno.nuovo_id(p_famiglia, v_r ->> 'id') and famiglia_id = p_famiglia;
  end loop;
  return v_conta;
end $$;

revoke all on function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid),
  interno.ripristina_senza_livelli(uuid, jsonb, uuid) from public, anon, authenticated;
