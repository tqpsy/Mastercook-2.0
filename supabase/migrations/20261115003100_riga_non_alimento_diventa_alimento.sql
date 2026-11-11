-- Una riga segnata «non è un alimento» (sullo scontrino, per errore) si può riportare tra gli alimenti
-- (richiesta di Luca dell'11/11/2026). `cambia_ingrediente_riga` accettava solo righe che un alimento già ce l'avevano:
-- ora a una riga senza ingrediente se ne dà uno, e la riga resta «da completare» (senza quantità e senza lotto): la
-- quantità, il luogo e la data si scrivono poi in Casa, come per ogni cosa comprata con lo scontrino senza quantità
-- (`completa_riga_acquisto`). Niente entra in casa finché non si scrive quanto.
-- Per le righe che l'alimento ce l'avevano già non cambia niente.

-- { id: acquisto_riga_id, ingrediente_id, ingrediente_visto? }
create or replace function interno.cmd_cambia_ingrediente_riga(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_riga public.acquisto_riga;
  v_acquisto public.acquisto;
  v_nuovo text := d ->> 'ingrediente_id';
begin
  select * into v_riga from public.acquisto_riga
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_riga.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  select * into v_acquisto from public.acquisto where id = v_riga.acquisto_id;
  if v_acquisto.stato = 'annullato' then
    perform interno.rifiuta('acquisto_annullato');
  end if;
  -- `ingrediente_visto` è l'ingrediente che chi corregge vedeva (anche «nessuno»): se nel frattempo è cambiato, conflitto.
  if d ? 'ingrediente_visto' and v_riga.ingrediente_id is distinct from nullif(d ->> 'ingrediente_visto', '') then
    perform interno.conflitto(jsonb_build_object('motivo', 'ingrediente_cambiato', 'valore_attuale', v_riga.ingrediente_id,
      'modificato_da', v_riga.modificato_da));
  end if;
  if v_nuovo is null or not exists (select 1 from public.ingrediente i where i.id = v_nuovo
                                    and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  if v_nuovo = v_riga.ingrediente_id then
    return '{}'::jsonb;
  end if;
  if v_riga.ingrediente_id is null then
    -- Era «non un alimento»: ora lo è, ma non è in casa (non c'è lotto) e la quantità va ancora scritta.
    update public.acquisto_riga set ingrediente_id = v_nuovo, quantita = null, unita = null where id = v_riga.id;
    return jsonb_build_object('prima', null, 'da_completare', true);
  end if;
  -- Il lotto cambia ingrediente: il trigger controlla che l'unità sia compatibile (altrimenti «unita_incompatibile»).
  if v_riga.lotto_id is not null then
    update public.lotto set ingrediente_id = v_nuovo where id = v_riga.lotto_id and famiglia_id = p_famiglia;
  end if;
  update public.acquisto_riga set ingrediente_id = v_nuovo where id = v_riga.id;
  return jsonb_build_object('prima', v_riga.ingrediente_id);
end $$;
