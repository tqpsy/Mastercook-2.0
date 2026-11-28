-- Raccolta differenziata: i giorni della settimana in cui passa ogni tipo di raccolta
-- (organico, carta, plastica, vetro, indifferenziato), per il promemoria in Oggi.
-- Sta nelle impostazioni della famiglia, sotto la chiave `raccolta`: un oggetto con, per ogni tipo
-- attivo, i giorni della settimana in cui passa (0 = domenica … 6 = sabato, come src/dominio/raccolta.ts).

create function interno.cmd_imposta_raccolta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_raccolta jsonb := d -> 'raccolta';
  v_chiave text;
  v_giorni jsonb;
  v_giorno jsonb;
begin
  if v_raccolta is not null and jsonb_typeof(v_raccolta) <> 'null' then
    if jsonb_typeof(v_raccolta) <> 'object' or length(v_raccolta::text) > 500 then
      perform interno.rifiuta('dati_non_validi');
    end if;
    for v_chiave, v_giorni in select * from jsonb_each(v_raccolta) loop
      if v_chiave not in ('organico', 'carta', 'plastica', 'vetro', 'indifferenziato') or jsonb_typeof(v_giorni) <> 'array' then
        perform interno.rifiuta('dati_non_validi');
      end if;
      for v_giorno in select * from jsonb_array_elements(v_giorni) loop
        if jsonb_typeof(v_giorno) <> 'number' or (v_giorno::text)::numeric <> trunc((v_giorno::text)::numeric)
           or (v_giorno::text)::numeric < 0 or (v_giorno::text)::numeric > 6 then
          perform interno.rifiuta('dati_non_validi');
        end if;
      end loop;
    end loop;
  end if;
  if v_raccolta is null or jsonb_typeof(v_raccolta) = 'null' then
    update public.famiglia set impostazioni = impostazioni - 'raccolta' where id = p_famiglia and impostazioni ? 'raccolta';
  else
    update public.famiglia set impostazioni = impostazioni || jsonb_build_object('raccolta', v_raccolta)
     where id = p_famiglia and impostazioni -> 'raccolta' is distinct from v_raccolta;
  end if;
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('imposta_raccolta', 'cmd_imposta_raccolta');
revoke all on function interno.cmd_imposta_raccolta(uuid, jsonb, uuid) from public, anon, authenticated;
