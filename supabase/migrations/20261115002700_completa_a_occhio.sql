-- «Da completare» anche a occhio (richiesta di Luca del 9/11/2026): una cosa comprata con lo scontrino senza quantità,
-- come il formaggio, entra in casa con i pezzi e quanto ne resta invece dei grammi.
-- La riga dell'acquisto resta senza quantità (non si sa quanto pesava) ma è legata al lotto: è completata, e senza
-- quantità non entra nei prezzi per grammo. Annullando l'acquisto si toglie tutto il lotto.

alter table public.acquisto_riga drop constraint riga_coerente;
alter table public.acquisto_riga add constraint riga_coerente check (
  (ingrediente_id is not null or nome is not null)
  and (ingrediente_id is not null or lotto_id is null)
  and (ingrediente_id is null
       or (quantita is not null and quantita > 0 and unita is not null and lotto_id is not null)
       or quantita is null));

-- { id, lotto_id, quantita, unita, luogo, posto?, date…, livello?, pezzi? }
create or replace function interno.cmd_completa_riga_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_riga public.acquisto_riga;
  v_acquisto public.acquisto;
  v_livello text := nullif(d ->> 'livello', '');
  v_quantita numeric := case when nullif(d ->> 'livello', '') is null then (d ->> 'quantita')::numeric
                             else coalesce((d ->> 'pezzi')::numeric, 1) end;
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
  if v_quantita is null or v_quantita <= 0 or (v_livello is not null and not interno.pezzi_validi(v_quantita)) then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, unita, livello, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, posto)
    values ((d ->> 'lotto_id')::uuid, p_famiglia, v_riga.ingrediente_id, case when v_livello is null then d ->> 'unita' else 'pz' end,
      v_livello, coalesce(d ->> 'luogo', 'dispensa'),
      v_acquisto.data, (d ->> 'data_limite')::date, coalesce(d ->> 'tipo_data', 'sconosciuta'), d ->> 'fonte_data',
      (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', case when v_acquisto.fonte = 'scontrino' then 'scontrino' else 'acquisto' end,
      case when d ->> 'luogo' = 'dispensa' then null else nullif(d ->> 'posto', '') end);
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'lotto_id')::uuid, v_quantita, 'carico', null);
  if v_livello is null then
    update public.acquisto_riga set quantita = v_quantita, unita = d ->> 'unita', lotto_id = (d ->> 'lotto_id')::uuid
     where id = v_riga.id;
  else
    update public.acquisto_riga set lotto_id = (d ->> 'lotto_id')::uuid where id = v_riga.id;
  end if;
  return '{}'::jsonb;
end $$;
