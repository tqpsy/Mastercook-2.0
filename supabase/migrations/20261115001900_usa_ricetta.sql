-- «Cucina passo passo» fino a «Fine» (richiesta di Luca del 7/11/2026: dopo aver cucinato gli ingredienti restavano
-- in casa). Se il piatto è nel menu l'app chiede «Mangiato» o «Cucinato» come sempre; se è una ricetta cucinata
-- fuori dal menu, questo comando toglie dalla casa i suoi ingredienti per le porzioni scelte, dai lotti che scadono
-- prima (stesso criterio di «Mangiato» e «Cucinato»: gli spaghetti valgono come pasta, non il contrario).
-- Non resta nessuna riga oltre ai movimenti (che portano l'id del comando): ripetere il comando non toglie due volte.

-- { ricetta_id, porzioni }
create function interno.cmd_usa_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_ricetta public.ricetta;
  v_porzioni numeric := (d ->> 'porzioni')::numeric;
  v_q record;
  v_r record;
  v_resta numeric;
  v_prendo numeric;
  v_lotti jsonb := '{}'::jsonb;
  v_mancanti jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  select * into v_ricetta from public.ricetta r
   where r.id = d ->> 'ricetta_id' and (r.famiglia_id is null or r.famiglia_id = p_famiglia) and r.eliminato_il is null;
  if v_ricetta.id is null then
    perform interno.rifiuta('ricetta_non_trovata');
  end if;
  if v_porzioni is null or v_porzioni <= 0 or v_porzioni > 100 then
    perform interno.rifiuta('quantita_non_valida', jsonb_build_object('campo', 'porzioni'));
  end if;

  for v_q in select * from interno.ingredienti_piatto(v_ricetta.id, v_porzioni) order by ingrediente_id, unita loop
    v_resta := v_q.quantita;
    for v_r in
      select l.id, l.quantita + coalesce((v_lotti ->> l.id::text)::numeric, 0) as disponibile
        from public.lotto l
       where l.famiglia_id = p_famiglia and l.eliminato_il is null and l.chiuso_il is null and l.unita = v_q.unita
         and v_q.ingrediente_id = any (interno.antenati(l.ingrediente_id))
       order by l.data_limite nulls last, l.data_acquisto nulls last, l.creato_il, l.id
    loop
      exit when v_resta <= 0;
      v_prendo := least(v_resta, v_r.disponibile);
      continue when v_prendo <= 0;
      v_lotti := v_lotti || jsonb_build_object(v_r.id::text, coalesce((v_lotti ->> v_r.id::text)::numeric, 0) - v_prendo);
      v_resta := v_resta - v_prendo;
    end loop;
    if v_resta > 0 then
      v_mancanti := v_mancanti || jsonb_build_object('ingrediente_id', v_q.ingrediente_id, 'unita', v_q.unita, 'quantita', v_resta);
    end if;
  end loop;
  for v_r in select key::uuid as lotto, value::numeric as variazione from jsonb_each_text(v_lotti) loop
    continue when v_r.variazione = 0;
    perform interno.nuovo_movimento(p_famiglia, v_r.lotto, v_r.variazione, 'consumo', left('Cucinato: ' || v_ricetta.titolo, 200));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('movimenti', v_n, 'mancanti', v_mancanti);
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('usa_ricetta', 'cmd_usa_ricetta');

revoke all on function interno.cmd_usa_ricetta(uuid, jsonb, uuid) from public, anon, authenticated;
