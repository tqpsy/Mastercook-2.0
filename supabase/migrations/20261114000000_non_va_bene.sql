-- Ricette segnate «non va bene» (❌) per un membro, accanto al «va bene» (✅).
--
-- Tutti e due chiudono il «da verificare» della ricetta per quella persona e valgono finché la ricetta non
-- cambia. Il comando verifica_ricetta accetta `scelta`: 'va_bene', 'non_va_bene' o 'togli'. Senza `scelta`
-- vale il vecchio `va_bene` (vero = va bene, falso = togli), così le app non aggiornate continuano a funzionare.

alter table public.ricetta_verificata add column va_bene boolean not null default true;

create or replace function interno.cmd_verifica_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid;
  v_scelta text := coalesce(d ->> 'scelta', case when coalesce((d ->> 'va_bene')::boolean, false) then 'va_bene' else 'togli' end);
  v_va_bene boolean := v_scelta = 'va_bene';
begin
  if v_scelta not in ('va_bene', 'non_va_bene', 'togli') then
    perform interno.rifiuta('scelta_non_valida');
  end if;
  select id into v_id from public.ricetta_verificata
   where famiglia_id = p_famiglia and membro_id = (d ->> 'membro_id')::uuid and ricetta_id = d ->> 'ricetta_id'
     and eliminato_il is null for update;
  if v_scelta = 'togli' then
    if v_id is not null then
      update public.ricetta_verificata set eliminato_il = now() where id = v_id;
    end if;
    return '{}'::jsonb;
  end if;
  if v_id is null then
    insert into public.ricetta_verificata (id, famiglia_id, membro_id, ricetta_id, versione_ricetta, va_bene)
      values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'membro_id')::uuid, d ->> 'ricetta_id', (d ->> 'versione_ricetta')::integer, v_va_bene);
  else
    update public.ricetta_verificata set versione_ricetta = (d ->> 'versione_ricetta')::integer, va_bene = v_va_bene
     where id = v_id and (versione_ricetta is distinct from (d ->> 'versione_ricetta')::integer or va_bene is distinct from v_va_bene);
  end if;
  return '{}'::jsonb;
end $$;

-- Ripristino: il «non va bene» dei file nuovi torna com'era (i file vecchi non lo hanno: restano «va bene»).
alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_senza_non_va_bene;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_conta jsonb;
begin
  v_conta := interno.ripristina_senza_non_va_bene(p_famiglia, d, p_utente);
  if jsonb_typeof(d -> 'file' -> 'tabelle' -> 'ricetta_verificata') = 'array' then
    update public.ricetta_verificata v set va_bene = false
      from jsonb_array_elements(d -> 'file' -> 'tabelle' -> 'ricetta_verificata') x(e)
     where v.famiglia_id = p_famiglia and (x.e ->> 'va_bene')::boolean is false and x.e ->> 'eliminato_il' is null
       and v.id = interno.nuovo_id(p_famiglia, x.e ->> 'id');
  end if;
  return v_conta;
end $$;

revoke all on function interno.cmd_verifica_ricetta(uuid, jsonb, uuid), interno.cmd_ripristina_famiglia(uuid, jsonb, uuid),
  interno.ripristina_senza_non_va_bene(uuid, jsonb, uuid) from public, anon, authenticated;
