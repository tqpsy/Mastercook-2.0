-- Fase 6: piatti proposti dall'app. Le proposte si calcolano sul dispositivo e entrano nel menu solo
-- quando la famiglia le conferma: arrivano con `aggiungi_portata` e origine «automatica», per sapere poi
-- che li ha suggeriti l'app. Non esiste un generatore che scrive nel menu da solo.

create or replace function interno.cmd_aggiungi_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if coalesce(d ->> 'origine', 'manuale') not in ('manuale', 'automatica') then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, note)
    values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'data')::date, d ->> 'categoria', d ->> 'ricetta_id',
            nullif(btrim(d ->> 'testo'), ''), (d ->> 'porzioni')::numeric, coalesce(d ->> 'origine', 'manuale'),
            coalesce((d ->> 'ordine')::numeric, 0), nullif(btrim(d ->> 'note'), ''));
  return '{}'::jsonb;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
