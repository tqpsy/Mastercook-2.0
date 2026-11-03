-- Scontrino senza quantità: una riga riconosciuta ma senza quantità entra lo stesso nello scontrino e nella spesa,
-- «da completare». Non va in casa finché qualcuno non scrive quanto ne ha comprato (Casa › Da completare):
-- il comando completa_riga_acquisto crea allora il lotto con la data dello scontrino.

-- Con l'ingrediente: o quantità, unità e lotto, oppure niente quantità e niente lotto (da completare).
alter table public.acquisto_riga drop constraint riga_coerente;
alter table public.acquisto_riga add constraint riga_coerente check (
  (ingrediente_id is not null or nome is not null)
  and (ingrediente_id is not null or lotto_id is null)
  and (ingrediente_id is null
       or (quantita is not null and quantita > 0 and unita is not null and lotto_id is not null)
       or (quantita is null and lotto_id is null)));

-- Come prima, ma una riga nuova con l'ingrediente e senza quantità non crea il lotto.
create or replace function interno.cmd_importa_scontrino_base(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_impronta text := interno.impronta_scontrino(d);
  v_esistente uuid;
  v_r jsonb;
  v_nuova jsonb;
  v_acquisto uuid := (d ->> 'acquisto_id')::uuid;
  v_con_acquisto boolean := false;
  v_abbinate integer := 0;
  v_nuove integer := 0;
  v_da_completare integer := 0;
  v_in_casa boolean;
  v_riga public.acquisto_riga;
begin
  select id into v_esistente from public.scontrino where famiglia_id = p_famiglia and impronta = v_impronta;
  if v_esistente is not null then
    return jsonb_build_object('gia_importato', v_esistente);
  end if;
  if (d ->> 'data') is null or jsonb_typeof(d -> 'righe') <> 'array' or jsonb_array_length(d -> 'righe') > 300 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  insert into public.scontrino (id, famiglia_id, negozio, data, ora, totale, impronta, testo)
    values ((d ->> 'id')::uuid, p_famiglia, nullif(btrim(d ->> 'negozio'), ''), (d ->> 'data')::date, nullif(d ->> 'ora', ''),
            (d ->> 'totale')::numeric, v_impronta, left(d ->> 'testo', 20000));

  for v_r in select * from jsonb_array_elements(d -> 'righe') loop
    v_nuova := v_r -> 'nuova';
    if v_r ->> 'abbina' is not null then
      select r.* into v_riga from public.acquisto_riga r join public.acquisto a on a.id = r.acquisto_id
       where r.id = (v_r ->> 'abbina')::uuid and r.famiglia_id = p_famiglia and a.stato = 'confermato' for update of r;
      if v_riga.id is null then
        perform interno.rifiuta('riga_non_trovata', jsonb_build_object('riga', v_r ->> 'id'));
      end if;
      if exists (select 1 from public.scontrino_riga where acquisto_riga_id = v_riga.id) then
        perform interno.rifiuta('riga_gia_abbinata', jsonb_build_object('riga', v_r ->> 'id'));
      end if;
      update public.acquisto_riga set prezzo = coalesce((v_r ->> 'prezzo')::numeric, prezzo) where id = v_riga.id;
      update public.acquisto set scontrino_id = (d ->> 'id')::uuid where id = v_riga.acquisto_id and scontrino_id is null;
      v_abbinate := v_abbinate + 1;
    elsif v_nuova is not null then
      if v_acquisto is null then
        perform interno.rifiuta('dati_non_validi', jsonb_build_object('manca', 'acquisto_id'));
      end if;
      if not v_con_acquisto then
        insert into public.acquisto (id, famiglia_id, fonte, data, negozio, scontrino_id)
          values (v_acquisto, p_famiglia, 'scontrino', (d ->> 'data')::date, nullif(btrim(d ->> 'negozio'), ''), (d ->> 'id')::uuid);
        update public.scontrino set acquisto_id = v_acquisto where id = (d ->> 'id')::uuid;
        v_con_acquisto := true;
      end if;
      v_in_casa := v_nuova ->> 'ingrediente_id' is not null and v_nuova ->> 'quantita' is not null;
      if v_in_casa then
        if (v_nuova ->> 'quantita')::numeric <= 0 then
          perform interno.rifiuta('quantita_non_valida', jsonb_build_object('riga', v_r ->> 'id'));
        end if;
        insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
            fonte_data, calcolata_il, affidabilita, origine)
          values ((v_nuova ->> 'lotto_id')::uuid, p_famiglia, v_nuova ->> 'ingrediente_id', nullif(btrim(v_nuova ->> 'nome'), ''),
            v_nuova ->> 'unita', coalesce(v_nuova ->> 'luogo', 'dispensa'), (d ->> 'data')::date, (v_nuova ->> 'data_limite')::date,
            coalesce(v_nuova ->> 'tipo_data', 'sconosciuta'), v_nuova ->> 'fonte_data', (v_nuova ->> 'calcolata_il')::timestamptz,
            v_nuova ->> 'affidabilita', 'scontrino');
        perform interno.nuovo_movimento(p_famiglia, (v_nuova ->> 'lotto_id')::uuid, (v_nuova ->> 'quantita')::numeric, 'carico', null);
      elsif v_nuova ->> 'ingrediente_id' is not null then
        v_da_completare := v_da_completare + 1;
      end if;
      insert into public.acquisto_riga (id, famiglia_id, acquisto_id, ingrediente_id, nome, quantita, unita, prezzo, lotto_id)
        values ((v_nuova ->> 'id')::uuid, p_famiglia, v_acquisto, v_nuova ->> 'ingrediente_id',
          coalesce(nullif(btrim(v_nuova ->> 'nome'), ''), case when v_nuova ->> 'ingrediente_id' is null then btrim(v_r ->> 'descrizione') end),
          case when v_in_casa then (v_nuova ->> 'quantita')::numeric end,
          case when v_in_casa then v_nuova ->> 'unita' end,
          (v_r ->> 'prezzo')::numeric,
          case when v_in_casa then (v_nuova ->> 'lotto_id')::uuid end)
        returning * into v_riga;
      v_nuove := v_nuove + 1;
    else
      v_riga := null;
    end if;
    insert into public.scontrino_riga (id, famiglia_id, scontrino_id, descrizione, prezzo, acquisto_riga_id)
      values ((v_r ->> 'id')::uuid, p_famiglia, (d ->> 'id')::uuid, left(btrim(v_r ->> 'descrizione'), 120), (v_r ->> 'prezzo')::numeric,
              v_riga.id);
  end loop;
  return jsonb_build_object('abbinate', v_abbinate, 'nuove', v_nuove)
    || case when v_da_completare > 0 then jsonb_build_object('da_completare', v_da_completare) else '{}'::jsonb end;
end $$;

-- «Erano 500 g»: la riga da completare prende quantità e lotto, e il lotto entra in casa con la data dell'acquisto.
--   { id: acquisto_riga_id, lotto_id, quantita, unita, luogo, posto?, data_limite?, tipo_data?, fonte_data?, calcolata_il?, affidabilita? }
create function interno.cmd_completa_riga_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_riga public.acquisto_riga;
  v_acquisto public.acquisto;
  v_quantita numeric := (d ->> 'quantita')::numeric;
begin
  select * into v_riga from public.acquisto_riga
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_riga.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_riga.ingrediente_id is null or v_riga.lotto_id is not null then
    -- Già completata (anche da un altro telefono): niente doppio carico.
    perform interno.conflitto(jsonb_build_object('motivo', 'riga_gia_completata', 'valore_attuale', v_riga.quantita,
      'modificato_da', v_riga.modificato_da));
  end if;
  select * into v_acquisto from public.acquisto where id = v_riga.acquisto_id;
  if v_acquisto.stato = 'annullato' then
    perform interno.rifiuta('acquisto_annullato');
  end if;
  if v_quantita is null or v_quantita <= 0 then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, unita, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, posto)
    values ((d ->> 'lotto_id')::uuid, p_famiglia, v_riga.ingrediente_id, d ->> 'unita', coalesce(d ->> 'luogo', 'dispensa'),
      v_acquisto.data, (d ->> 'data_limite')::date, coalesce(d ->> 'tipo_data', 'sconosciuta'), d ->> 'fonte_data',
      (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', case when v_acquisto.fonte = 'scontrino' then 'scontrino' else 'acquisto' end,
      case when d ->> 'luogo' = 'dispensa' then null else nullif(d ->> 'posto', '') end);
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'lotto_id')::uuid, v_quantita, 'carico', null);
  update public.acquisto_riga set quantita = v_quantita, unita = d ->> 'unita', lotto_id = (d ->> 'lotto_id')::uuid
   where id = v_riga.id;
  return '{}'::jsonb;
end $$;

revoke all on function interno.cmd_completa_riga_acquisto(uuid, jsonb, uuid) from public, anon, authenticated;

insert into interno.tipo_comando (tipo, funzione) values ('completa_riga_acquisto', 'cmd_completa_riga_acquisto');
