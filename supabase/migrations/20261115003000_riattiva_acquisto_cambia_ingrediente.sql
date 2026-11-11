-- Due correzioni dopo l'acquisto (richiesta di Luca del 10/11/2026):
--
-- 1. Riattivare un acquisto annullato. Annullare toglie dalla casa le quantità (un movimento «annullo» per lotto) e
--    lo scontrino non si può importare di nuovo (l'impronta è unica): se l'annullo è stato un errore, si torna indietro.
--    La riattivazione rimette in casa, lotto per lotto, quanto l'annullo aveva tolto (non di più: se qualcosa era già
--    stato usato prima, non c'è altro da rimettere).
--
-- 2. Cambiare l'alimento di una riga dopo la conferma. La lettura dello scontrino può abbinare la riga all'ingrediente
--    sbagliato: invece di annullare tutto, si sceglie quello giusto. Il lotto resta lo stesso (movimenti, quantità e date
--    non cambiano): cambia solo l'ingrediente, a patto che l'unità sia compatibile (un lotto in grammi non diventa «a pezzi»).

-- { id }  →  { rimessi: [{ riga, ingrediente_id, quantita }] } oppure { gia_attivo }
create function interno.cmd_riattiva_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_acquisto public.acquisto;
  v_riga record;
  v_rimette numeric;
  v_rimessi jsonb := '[]'::jsonb;
begin
  select * into v_acquisto from public.acquisto where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia for update;
  if v_acquisto.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_acquisto.stato <> 'annullato' then
    -- Già riattivato (anche da un altro telefono): niente doppio carico.
    return jsonb_build_object('gia_attivo', v_acquisto.id);
  end if;
  for v_riga in
    select r.id, r.ingrediente_id, r.lotto_id
      from public.acquisto_riga r join public.lotto l on l.id = r.lotto_id and l.eliminato_il is null
     where r.acquisto_id = v_acquisto.id and r.eliminato_il is null
     for update of l
  loop
    -- Quanto l'annullo (e le riattivazioni di prima) hanno lasciato fuori dal lotto.
    select coalesce(-sum(m.variazione), 0) into v_rimette
      from public.movimento m
     where m.lotto_id = v_riga.lotto_id and m.eliminato_il is null
       and ((m.causale = 'annullo' and m.nota = 'acquisto annullato') or (m.causale = 'carico' and m.nota = 'acquisto riattivato'));
    if v_rimette > 0 then
      perform interno.nuovo_movimento(p_famiglia, v_riga.lotto_id, v_rimette, 'carico', 'acquisto riattivato');
      v_rimessi := v_rimessi || jsonb_build_object('riga', v_riga.id, 'ingrediente_id', v_riga.ingrediente_id, 'quantita', v_rimette);
    end if;
  end loop;
  update public.acquisto set stato = 'confermato', annullato_il = null where id = v_acquisto.id;
  -- Le voci della lista che l'annullo aveva rimesso da comprare tornano acquistate (solo se nessuno le ha toccate).
  update public.voce_spesa v set stato = 'acquistata'
   where v.id in (select r.voce_id from public.acquisto_riga r where r.acquisto_id = v_acquisto.id)
     and v.stato = 'da_acquistare' and v.tipo = 'manuale';
  return jsonb_build_object('rimessi', v_rimessi);
end $$;

-- { id: acquisto_riga_id, ingrediente_id, ingrediente_visto? }
-- `ingrediente_visto` è l'ingrediente che chi corregge vedeva: se nel frattempo è cambiato (anche da un altro telefono)
-- è un conflitto.
create function interno.cmd_cambia_ingrediente_riga(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_riga public.acquisto_riga;
  v_acquisto public.acquisto;
  v_nuovo text := d ->> 'ingrediente_id';
begin
  select * into v_riga from public.acquisto_riga
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_riga.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  select * into v_acquisto from public.acquisto where id = v_riga.acquisto_id;
  if v_acquisto.stato = 'annullato' then
    perform interno.rifiuta('acquisto_annullato');
  end if;
  -- Una riga che non è un alimento (detersivo, pile…) non ha un ingrediente da correggere.
  if v_riga.ingrediente_id is null then
    perform interno.rifiuta('riga_senza_ingrediente');
  end if;
  if d ? 'ingrediente_visto' and v_riga.ingrediente_id is distinct from d ->> 'ingrediente_visto' then
    perform interno.conflitto(jsonb_build_object('motivo', 'ingrediente_cambiato', 'valore_attuale', v_riga.ingrediente_id,
      'modificato_da', v_riga.modificato_da));
  end if;
  if v_nuovo is null or not exists (select 1 from public.ingrediente i where i.id = v_nuovo
                                    and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  if v_nuovo = v_riga.ingrediente_id then
    return '{}'::jsonb;
  end if;
  -- Il lotto cambia ingrediente: il trigger controlla che l'unità sia compatibile (altrimenti «unita_incompatibile»).
  if v_riga.lotto_id is not null then
    update public.lotto set ingrediente_id = v_nuovo where id = v_riga.lotto_id and famiglia_id = p_famiglia;
  end if;
  update public.acquisto_riga set ingrediente_id = v_nuovo where id = v_riga.id;
  return jsonb_build_object('prima', v_riga.ingrediente_id);
end $$;

revoke all on function interno.cmd_riattiva_acquisto(uuid, jsonb, uuid), interno.cmd_cambia_ingrediente_riga(uuid, jsonb, uuid)
  from public, anon, authenticated;

insert into interno.tipo_comando (tipo, funzione) values
  ('riattiva_acquisto', 'cmd_riattiva_acquisto'),
  ('cambia_ingrediente_riga', 'cmd_cambia_ingrediente_riga');
