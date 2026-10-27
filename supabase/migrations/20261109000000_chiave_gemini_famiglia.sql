-- Mastercook 2.0 · chiave Gemini della famiglia (foto del frigo).
--
-- Ogni famiglia può usare la sua chiave gratuita di Google AI Studio: chi amministra la scrive nelle
-- Impostazioni e da lì nessuno la rilegge, nemmeno chi l'ha scritta (si vedono solo le ultime 4 cifre).
-- La legge solo la funzione «foto-frigo» sul server, con la chiave di servizio. Non passa dai comandi,
-- così non finisce nella cronologia che i dispositivi scaricano.
--
-- La chiave del progetto (segreto GEMINI_API_KEY) resta per le famiglie amministrate da chi amministrava
-- una famiglia al momento di questa migrazione, cioè chi gestisce l'app (anche nelle famiglie che crea o
-- importa dopo). Le famiglie degli amici usano la loro.

create table interno.chiave_gemini (
  famiglia_id uuid primary key references public.famiglia (id) on delete cascade,
  chiave text not null check (chiave ~ '^[A-Za-z0-9_-]{20,100}$'),
  impostata_da uuid not null,
  impostata_il timestamptz not null default now()
);

create table interno.gemini_condivisa (
  utente_id uuid primary key
);
insert into interno.gemini_condivisa (utente_id)
  select distinct utente_id from public.utente_famiglia where ruolo = 'amministratore' and eliminato_il is null;

create function interno.usa_gemini_condivisa(p_famiglia uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.utente_famiglia uf join interno.gemini_condivisa g on g.utente_id = uf.utente_id
                 where uf.famiglia_id = p_famiglia and uf.ruolo = 'amministratore' and uf.eliminato_il is null)
$$;

-- Scrive o toglie la chiave (null o testo vuoto = toglie). Solo chi amministra.
create function public.imposta_chiave_gemini(p_famiglia uuid, p_chiave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_chiave text := nullif(btrim(coalesce(p_chiave, '')), '');
begin
  if auth.uid() is null or interno.ruolo_in(p_famiglia, auth.uid()) is distinct from 'amministratore' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'solo_amministratore'));
  end if;
  if v_chiave is null then
    delete from interno.chiave_gemini where famiglia_id = p_famiglia;
  elsif v_chiave !~ '^[A-Za-z0-9_-]{20,100}$' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'chiave_non_valida'));
  else
    insert into interno.chiave_gemini (famiglia_id, chiave, impostata_da) values (p_famiglia, v_chiave, auth.uid())
      on conflict (famiglia_id) do update set chiave = excluded.chiave, impostata_da = excluded.impostata_da, impostata_il = now();
  end if;
  return jsonb_build_object('esito', 'applicato', 'dettaglio', public.stato_chiave_gemini(p_famiglia));
end $$;

-- Cosa vede la famiglia: se c'è una chiave sua (con le ultime 4 cifre) o se usa quella del progetto.
create function public.stato_chiave_gemini(p_famiglia uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not interno.sono_membro(p_famiglia) then null else jsonb_build_object(
    'propria', c.chiave is not null,
    'finale', right(c.chiave, 4),
    'condivisa', interno.usa_gemini_condivisa(p_famiglia)
  ) end
  from (select 1) x left join interno.chiave_gemini c on c.famiglia_id = p_famiglia
$$;

-- Solo per la funzione sul server (chiave di servizio): la chiave da usare per questa famiglia.
create function public.chiave_gemini_per_foto(p_famiglia uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'chiave', (select chiave from interno.chiave_gemini where famiglia_id = p_famiglia),
    'condivisa', interno.usa_gemini_condivisa(p_famiglia))
$$;

revoke all on interno.chiave_gemini, interno.gemini_condivisa from public, anon, authenticated;
revoke all on function interno.usa_gemini_condivisa(uuid) from public, anon, authenticated;
revoke all on function public.imposta_chiave_gemini(uuid, text), public.stato_chiave_gemini(uuid), public.chiave_gemini_per_foto(uuid)
  from public, anon, authenticated;
grant execute on function public.imposta_chiave_gemini(uuid, text), public.stato_chiave_gemini(uuid) to authenticated;
grant execute on function public.chiave_gemini_per_foto(uuid) to service_role;
