-- «Sposta» dava errore per ogni prodotto con la data della confezione (es. dal frigo alla dispensa).
-- L'app manda sempre la chiave «stima», a null quando non ricalcola la data: `d -> 'stima'` è allora
-- il JSON null, che per SQL NON è null, e il comando rifiutava con «data_confezione_protetta»
-- (e per le date stimate cancellava la fonte della data). Ora il JSON null vale come «nessuna stima».
create or replace function interno.cmd_sposta_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'lotto_id')::uuid);
  v_quantita numeric := (d ->> 'quantita')::numeric;
  v_nuovo uuid := (d ->> 'nuovo_id')::uuid;
  v_stima jsonb := nullif(d -> 'stima', 'null'::jsonb);
begin
  if v_lotto.chiuso_il is not null then
    perform interno.rifiuta('lotto_chiuso');
  end if;
  if v_stima is not null and v_lotto.tipo_data not in ('stimata', 'sconosciuta') then
    perform interno.rifiuta('data_confezione_protetta');
  end if;
  if v_quantita is null or v_quantita >= v_lotto.quantita then
    update public.lotto set luogo = d ->> 'luogo',
      data_limite = coalesce((v_stima ->> 'data_limite')::date, data_limite),
      tipo_data = coalesce(v_stima ->> 'tipo_data', tipo_data),
      fonte_data = case when v_stima is null then fonte_data else v_stima ->> 'fonte_data' end,
      calcolata_il = coalesce((v_stima ->> 'calcolata_il')::timestamptz, calcolata_il)
     where id = v_lotto.id;
    return '{}'::jsonb;
  end if;
  if v_quantita <= 0 or v_nuovo is null then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note)
    values (v_nuovo, p_famiglia, v_lotto.ingrediente_id, v_lotto.nome, v_lotto.unita, d ->> 'luogo', v_lotto.data_acquisto,
      coalesce((v_stima ->> 'data_limite')::date, v_lotto.data_limite), coalesce(v_stima ->> 'tipo_data', v_lotto.tipo_data),
      case when v_stima is null then v_lotto.fonte_data else v_stima ->> 'fonte_data' end,
      coalesce((v_stima ->> 'calcolata_il')::timestamptz, v_lotto.calcolata_il), v_lotto.affidabilita, v_lotto.origine,
      v_lotto.note);
  perform interno.nuovo_movimento(p_famiglia, v_lotto.id, -v_quantita, 'spostamento', null);
  perform interno.nuovo_movimento(p_famiglia, v_nuovo, v_quantita, 'spostamento', null);
  return '{}'::jsonb;
end $$;
