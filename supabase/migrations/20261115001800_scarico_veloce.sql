-- Scarico più veloce, senza cambiare cosa arriva al telefono (a parte i comandi, vedi sotto).
--
-- 1. Prima ogni pagina trasformava in jsonb e ordinava TUTTE le righe dopo il cursore, per poi tenerne 500: il primo
--    scarico di una famiglia con un anno di dati (~60.000 righe, ~120 pagine) ripeteva il lavoro a ogni pagina.
--    Ora ogni tabella dà al più una pagina (+1) in ordine di seq, con l'indice (famiglia_id, seq) che c'è già:
--    l'unione da ordinare resta piccola. Le righe scelte sono le stesse: le prime per seq.
-- 2. La tabella `comando` non si scarica più: l'app non la legge mai, ma la teneva sul dispositivo (un quarto delle
--    righe dopo un anno). Il server la tiene come prima; l'avviso «c'è un comando nuovo» (Realtime) non cambia.
--
-- Il resto della funzione (accesso, oblio degli ospiti, formato della risposta) è identico a 20261111000000_ospiti.sql.

create or replace function public.scarica_modifiche(p_famiglia uuid, p_dopo bigint, p_limite integer default 500)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_righe jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 500), 1), 1000);
  v_amministratore boolean := interno.sono_amministratore(p_famiglia);
begin
  if auth.uid() is null or interno.ruolo_in(p_famiglia, auth.uid()) is null then
    return jsonb_build_object('errore', 'non_autorizzato');
  end if;
  -- Privacy: le esigenze degli ospiti si dimenticano appena il pasto è passato.
  perform interno.dimentica_ospiti(p_famiglia);

  with tutte as (
    (select 'famiglia' as tabella, t.seq, to_jsonb(t) as riga from public.famiglia t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'utente_famiglia' as tabella, t.seq, to_jsonb(t) as riga from public.utente_famiglia t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'membro' as tabella, t.seq, to_jsonb(t) as riga from public.membro t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'vincolo_alimentare' as tabella, t.seq, to_jsonb(t) as riga from public.vincolo_alimentare t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'invito' as tabella, t.seq, case when v_amministratore then to_jsonb(t) else to_jsonb(t) - 'codice' end as riga from public.invito t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'ingrediente' as tabella, t.seq, to_jsonb(t) as riga from public.ingrediente t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'ricetta' as tabella, t.seq, to_jsonb(t) as riga from public.ricetta t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'ricetta_ingrediente' as tabella, t.seq, to_jsonb(t) as riga from public.ricetta_ingrediente t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'ricetta_passo' as tabella, t.seq, to_jsonb(t) as riga from public.ricetta_passo t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'lotto' as tabella, t.seq, to_jsonb(t) as riga from public.lotto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'movimento' as tabella, t.seq, to_jsonb(t) as riga from public.movimento t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'categoria_pasto' as tabella, t.seq, to_jsonb(t) as riga from public.categoria_pasto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'portata' as tabella, t.seq, to_jsonb(t) as riga from public.portata t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'eccezione_membro' as tabella, t.seq, to_jsonb(t) as riga from public.eccezione_membro t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'gusto' as tabella, t.seq, to_jsonb(t) as riga from public.gusto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'voce_spesa' as tabella, t.seq, to_jsonb(t) as riga from public.voce_spesa t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'acquisto' as tabella, t.seq, to_jsonb(t) as riga from public.acquisto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'acquisto_riga' as tabella, t.seq, to_jsonb(t) as riga from public.acquisto_riga t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'prodotto' as tabella, t.seq, to_jsonb(t) as riga from public.prodotto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'scontrino' as tabella, t.seq, to_jsonb(t) as riga from public.scontrino t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'scontrino_riga' as tabella, t.seq, to_jsonb(t) as riga from public.scontrino_riga t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'conferma_pasto' as tabella, t.seq, to_jsonb(t) as riga from public.conferma_pasto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'consumo_riga' as tabella, t.seq, to_jsonb(t) as riga from public.consumo_riga t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'consumo_lotto' as tabella, t.seq, to_jsonb(t) as riga from public.consumo_lotto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'icona_ricetta' as tabella, t.seq, to_jsonb(t) as riga from public.icona_ricetta t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'ricetta_verificata' as tabella, t.seq, to_jsonb(t) as riga from public.ricetta_verificata t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'pasto_fisso' as tabella, t.seq, to_jsonb(t) as riga from public.pasto_fisso t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
    union all
    (select 'ospiti_pasto' as tabella, t.seq, to_jsonb(t) as riga from public.ospiti_pasto t
      where t.famiglia_id = p_famiglia and t.seq > p_dopo order by t.seq limit v_limite + 1)
  ), pagina as (
    select * from tutte order by seq limit v_limite + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('tabella', tabella, 'seq', seq, 'riga', riga) order by seq), '[]'::jsonb)
    into v_righe from pagina;

  return jsonb_build_object(
    'righe', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
               select e from jsonb_array_elements(v_righe) with ordinality as x(e, n) where n <= v_limite) s),
    'altre', jsonb_array_length(v_righe) > v_limite);
end $$;

revoke all on function public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.scarica_modifiche(uuid, bigint, integer) to authenticated;
