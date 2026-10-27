-- Mastercook 2.0 · Fase 5, seconda parte: foto facoltativa del piatto dopo la conferma (R-CON-5).
--
-- La foto sta nel deposito «foto» come quelle delle ricette (`<famiglia>/<uuid>.jpg`, ridotta sul telefono);
-- la conferma ne tiene il percorso. Come le altre foto, non entra nel file di esportazione.

alter table public.conferma_pasto
  add column foto text check (foto is null or foto ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  add constraint foto_della_famiglia check (foto is null or split_part(foto, '/', 1) = famiglia_id::text);

-- { id: conferma, foto: percorso | null }. Non cambia la revisione: la foto non tocca la casa.
create function interno.cmd_foto_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid;
begin
  update public.conferma_pasto set foto = nullif(d ->> 'foto', '')
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia
  returning id into v_id;
  if v_id is null then
    perform interno.rifiuta('conferma_non_trovata');
  end if;
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('foto_pasto', 'cmd_foto_pasto');

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
