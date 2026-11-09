-- La scheda del prodotto (valori nutrizionali, ingredienti, allergeni, formato) si ricorda insieme
-- al codice a barre: dalla seconda volta non serve più la rete e la scheda dell'ingrediente si compila da sola.
-- Il formato e il nome c'erano già; `scheda` è la lettura di Open Food Facts così come l'ha preparata l'app.

alter table public.prodotto
  add column scheda jsonb check (scheda is null or (jsonb_typeof(scheda) = 'object' and octet_length(scheda::text) <= 60000));

create or replace function interno.cmd_salva_prodotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid;
  v_scheda jsonb := case when jsonb_typeof(d -> 'scheda') = 'object' then d -> 'scheda' end;
begin
  select id into v_id from public.prodotto
   where famiglia_id = p_famiglia and codice = d ->> 'codice' and eliminato_il is null for update;
  if v_id is null then
    insert into public.prodotto (id, famiglia_id, codice, ingrediente_id, nome, quantita, unita, scheda)
      values ((d ->> 'id')::uuid, p_famiglia, d ->> 'codice', d ->> 'ingrediente_id', nullif(btrim(d ->> 'nome'), ''),
              (d ->> 'quantita')::numeric, d ->> 'unita', v_scheda);
    return '{}'::jsonb;
  end if;
  -- Una scheda già salvata non si perde se il comando non ne porta una nuova.
  update public.prodotto set ingrediente_id = d ->> 'ingrediente_id', nome = nullif(btrim(d ->> 'nome'), ''),
      quantita = (d ->> 'quantita')::numeric, unita = d ->> 'unita', scheda = coalesce(v_scheda, scheda)
   where id = v_id;
  return jsonb_build_object('aggiornato', v_id);
end $$;
