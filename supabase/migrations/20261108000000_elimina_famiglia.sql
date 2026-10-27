-- Mastercook 2.0 · Fase 7: eliminare una famiglia.
--
-- Serve per tornare indietro dopo un'importazione dal vecchio Mastercook che non convince, e per cancellare
-- davvero i propri dati. Solo un amministratore, e solo riscrivendo il nome della famiglia: niente tocchi per sbaglio.
-- Si cancella tutto a cascata: persone, vincoli, ricette, casa, menu, spesa, scontrini, consumi, accessi, inviti
-- e la cronologia dei comandi. Il comando stesso non resta registrato (la famiglia non c'è più).
-- Le foto delle ricette le toglie prima l'app dal deposito, con i permessi di chi è ancora membro.

create function interno.cmd_elimina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_nome text;
begin
  perform interno.richiedi_amministratore(p_famiglia, p_utente);
  select nome into v_nome from public.famiglia where id = p_famiglia for update;
  if btrim(coalesce(d ->> 'nome', '')) is distinct from btrim(v_nome) then
    perform interno.rifiuta('nome_non_corrisponde');
  end if;
  delete from public.famiglia where id = p_famiglia;
  return jsonb_build_object('eliminata', true);
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('elimina_famiglia', 'cmd_elimina_famiglia');

revoke all on function interno.cmd_elimina_famiglia(uuid, jsonb, uuid) from public, anon, authenticated;
