-- La chiave Gemini si salvava solo con lettere, cifre, «-» e «_» fino a 100 caratteri: le chiavi nuove di
-- Google AI Studio possono avere anche punti e altri segni ed essere più lunghe, e venivano rifiutate.
-- Ora si tolgono tutti gli spazi e gli a capo (copiando dal telefono capitano) e si accetta ogni carattere
-- visibile di una chiave, da 20 a 400. Se la chiave è sbagliata lo dirà Google alla prima foto.
alter table interno.chiave_gemini drop constraint chiave_gemini_chiave_check;
alter table interno.chiave_gemini add constraint chiave_gemini_chiave_check
  check (chiave ~ '^[A-Za-z0-9._~+/=:-]{20,}$' and length(chiave) <= 400);

create or replace function public.imposta_chiave_gemini(p_famiglia uuid, p_chiave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_chiave text := nullif(regexp_replace(coalesce(p_chiave, ''), '\s+', '', 'g'), '');
begin
  if auth.uid() is null or interno.ruolo_in(p_famiglia, auth.uid()) is distinct from 'amministratore' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'solo_amministratore'));
  end if;
  if v_chiave is null then
    delete from interno.chiave_gemini where famiglia_id = p_famiglia;
  elsif v_chiave !~ '^[A-Za-z0-9._~+/=:-]{20,}$' or length(v_chiave) > 400 then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'chiave_non_valida'));
  else
    insert into interno.chiave_gemini (famiglia_id, chiave, impostata_da) values (p_famiglia, v_chiave, auth.uid())
      on conflict (famiglia_id) do update set chiave = excluded.chiave, impostata_da = excluded.impostata_da, impostata_il = now();
  end if;
  return jsonb_build_object('esito', 'applicato', 'dettaglio', public.stato_chiave_gemini(p_famiglia));
end $$;
