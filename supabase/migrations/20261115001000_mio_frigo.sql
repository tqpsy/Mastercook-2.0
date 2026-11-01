-- «Il mio frigorifero»: com'è fatto il frigo di casa e dove sta ogni cosa.
--
-- - Il frigo configurato sta nelle impostazioni della famiglia, sotto la chiave `frigo`
--   ({ ripiani, cassetti, balconcini, sportello, litri, freezer: { posizione, parti, tipo, litri } }).
--   L'app controlla i valori (src/dominio/frigo.ts); qui si limita forma e grandezza.
-- - Ogni lotto può ricordare il suo posto nel frigo o nel freezer (`posto`): r1… ripiani, c1… cassetti,
--   s1… balconcini dello sportello, f1… freezer. Lo scrive la foto del frigo o chi aggiunge a mano.

alter table public.lotto add column posto text check (posto is null or posto ~ '^[rcsf][1-9]$');

create function interno.cmd_imposta_frigo(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_frigo jsonb := d -> 'frigo';
begin
  if v_frigo is null or (jsonb_typeof(v_frigo) <> 'object' and jsonb_typeof(v_frigo) <> 'null') or length(v_frigo::text) > 1000 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  if jsonb_typeof(v_frigo) = 'null' then
    update public.famiglia set impostazioni = impostazioni - 'frigo' where id = p_famiglia and impostazioni ? 'frigo';
  else
    update public.famiglia set impostazioni = impostazioni || jsonb_build_object('frigo', v_frigo)
     where id = p_famiglia and impostazioni -> 'frigo' is distinct from v_frigo;
  end if;
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('imposta_frigo', 'cmd_imposta_frigo');
revoke all on function interno.cmd_imposta_frigo(uuid, jsonb, uuid) from public, anon, authenticated;

-- Aggiungere a mano: come prima, più il posto facoltativo.
create or replace function interno.cmd_aggiungi_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_quantita numeric := (d ->> 'quantita')::numeric;
begin
  if v_quantita is null or v_quantita <= 0 then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  if coalesce(d ->> 'origine', 'manuale') <> 'manuale' then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  if not exists (select 1 from public.ingrediente i where i.id = d ->> 'ingrediente_id'
                 and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note, posto)
    values ((d ->> 'id')::uuid, p_famiglia, d ->> 'ingrediente_id', nullif(btrim(d ->> 'nome'), ''), d ->> 'unita',
      d ->> 'luogo', (d ->> 'data_acquisto')::date, (d ->> 'data_limite')::date, d ->> 'tipo_data', d ->> 'fonte_data',
      (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', 'manuale', nullif(btrim(d ->> 'note'), ''),
      case when d ->> 'luogo' = 'dispensa' then null else nullif(d ->> 'posto', '') end);
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'id')::uuid, v_quantita, 'carico', null);
  return '{}'::jsonb;
end $$;

-- Il posto si cambia come gli altri campi del lotto.
create or replace function interno.cmd_modifica_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'id')::uuid);
begin
  if v_lotto.fonte_data = 'confezione' and d -> 'campi' ->> 'fonte_data' = 'app' then
    perform interno.rifiuta('data_confezione_protetta');
  end if;
  return interno.aggiorna_campi('lotto', v_lotto.id, p_famiglia, (d ->> 'versione_attesa')::integer, d -> 'campi',
    array['nome', 'note', 'data_acquisto', 'data_limite', 'tipo_data', 'fonte_data', 'calcolata_il', 'affidabilita', 'posto']);
end $$;
