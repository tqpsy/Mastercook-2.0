-- Origine «foto» anche per i lotti aggiunti dalla foto del frigo (Casa › Foto del frigo): finora `aggiungi_lotto`
-- ammetteva solo «manuale», quindi quei lotti non si distinguevano da quelli scritti a mano, mentre quelli della
-- verifica con le foto avevano già `foto`. Il resto della funzione è identico a 20261115002300_livello_a_occhio.sql.

create or replace function interno.cmd_aggiungi_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_quantita numeric := (d ->> 'quantita')::numeric;
  v_livello text := nullif(d ->> 'livello', '');
  v_origine text := coalesce(d ->> 'origine', 'manuale');
begin
  if v_quantita is null or v_quantita <= 0 or (v_livello is not null and not interno.pezzi_validi(v_quantita)) then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  if v_origine not in ('manuale', 'foto') then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  if not exists (select 1 from public.ingrediente i where i.id = d ->> 'ingrediente_id'
                 and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, livello, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note, posto)
    values ((d ->> 'id')::uuid, p_famiglia, d ->> 'ingrediente_id', nullif(btrim(d ->> 'nome'), ''),
      case when v_livello is null then d ->> 'unita' else 'pz' end, v_livello,
      d ->> 'luogo', (d ->> 'data_acquisto')::date, (d ->> 'data_limite')::date, d ->> 'tipo_data', d ->> 'fonte_data',
      (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', v_origine, nullif(btrim(d ->> 'note'), ''),
      case when d ->> 'luogo' = 'dispensa' then null else nullif(d ->> 'posto', '') end);
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'id')::uuid, v_quantita, 'carico', null);
  return '{}'::jsonb;
end $$;

revoke all on function interno.cmd_aggiungi_lotto(uuid, jsonb, uuid) from public, anon, authenticated;
