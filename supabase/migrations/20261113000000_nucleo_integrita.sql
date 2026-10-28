-- Integrità del nucleo: casi in cui due telefoni, o due strade diverse, facevano contare due volte o perdere dati.
--
-- - Spesa: una voce già acquistata non si carica una seconda volta (due telefoni che confermano lo stesso
--   carrello, o carrello confermato dopo lo scontrino). Lo scontrino segna acquistate le voci nel carrello
--   che carica (se è di questi giorni). Lo stesso scontrino letto una volta con il QR e una volta senza è
--   riconosciuto.
-- - Ospiti: chi li segna senza aver visto quelli di un altro riceve un conflitto, invece di sovrascriverli.
-- - Menu: la lista non conta i pasti già confermati; un piatto confermato non si toglie dal menu.
-- - Conferme: correggere gli avanzi li sostituisce, «saltato» li toglie (solo quel che resta).
-- - Ricette: cambiare ingredienti o passaggi è una versione nuova (il «va bene» va richiesto di nuovo).
-- - Scarico: chi scrive fuori da un comando prende il lock della famiglia, così il cursore non salta righe.
--
-- Le funzioni dei comandi restano quelle di prima (rinominate *_base); le nuove fanno i controlli e le chiamano.

-- ───────────────────────── Spesa e scontrini ─────────────────────────

alter function interno.cmd_conferma_acquisto(uuid, jsonb, uuid) rename to cmd_conferma_acquisto_base;

-- Le righe di voci già acquistate (da un'altra conferma o da uno scontrino) non caricano niente:
-- tornano in `gia_acquistate`. Se non resta nessuna riga non si crea nemmeno l'acquisto.
create function interno.cmd_conferma_acquisto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_tenute jsonb := '[]'::jsonb;
  v_saltate jsonb := '[]'::jsonb;
  v_r jsonb;
begin
  if exists (select 1 from public.acquisto where id = (d ->> 'id')::uuid) or jsonb_typeof(d -> 'righe') <> 'array' then
    return interno.cmd_conferma_acquisto_base(p_famiglia, d, p_utente);
  end if;
  for v_r in select * from jsonb_array_elements(d -> 'righe') loop
    if exists (select 1 from public.voce_spesa v
                where v.id = (v_r ->> 'voce_id')::uuid and v.famiglia_id = p_famiglia and v.stato = 'acquistata') then
      v_saltate := v_saltate || to_jsonb(v_r ->> 'voce_id');
    else
      v_tenute := v_tenute || jsonb_build_array(v_r);
    end if;
  end loop;
  if jsonb_array_length(v_saltate) = 0 then
    return interno.cmd_conferma_acquisto_base(p_famiglia, d, p_utente);
  end if;
  if jsonb_array_length(v_tenute) = 0 then
    return jsonb_build_object('righe', 0, 'lotti', 0, 'gia_acquistate', v_saltate);
  end if;
  return interno.cmd_conferma_acquisto_base(p_famiglia, jsonb_set(d, '{righe}', v_tenute), p_utente)
    || jsonb_build_object('gia_acquistate', v_saltate);
end $$;

alter function interno.cmd_importa_scontrino(uuid, jsonb, uuid) rename to cmd_importa_scontrino_base;

-- Impronta «dati» di uno scontrino già salvato, come interno.impronta_scontrino senza QR.
create function interno.impronta_dati_scontrino(s public.scontrino) returns text
language sql stable as $$
  select 'dati:' || md5(concat_ws('|', lower(regexp_replace(coalesce(s.negozio, ''), '[^[:alnum:]]', '', 'g')),
                                  s.data::text, coalesce(s.ora, ''), coalesce(to_char(s.totale, 'FM999999990.00'), '')))
$$;

create function interno.cmd_importa_scontrino(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_esistente uuid;
  v_esito jsonb;
  v_r record;
  v_voce uuid;
begin
  -- Con data e totale, lo stesso negozio, giorno, ora e totale è lo stesso scontrino se uno dei due non ha il QR.
  if (d ->> 'data') is not null and (d ->> 'totale') is not null then
    select s.id into v_esistente from public.scontrino s
     where s.famiglia_id = p_famiglia and s.data = (d ->> 'data')::date and s.totale is not null
       and interno.impronta_dati_scontrino(s) = interno.impronta_scontrino(d - 'qr')
       -- Due QR diversi sono due scontrini, anche con gli stessi dati (due caffè lo stesso giorno).
       and not (s.impronta like 'qr:%' and nullif(btrim(d ->> 'qr'), '') is not null)
     limit 1;
    if v_esistente is not null then
      return jsonb_build_object('gia_importato', v_esistente);
    end if;
  end if;

  v_esito := interno.cmd_importa_scontrino_base(p_famiglia, d, p_utente);
  if v_esito ? 'gia_importato' then
    return v_esito;
  end if;

  -- Ciò che lo scontrino ha messo in casa non resta nel carrello: la conferma del carrello non lo ricarica.
  -- Solo per uno scontrino di questi giorni (come l'abbinamento nell'app): uno vecchio non è la spesa di oggi.
  if abs((d ->> 'data')::date - current_date) > 3 then
    return v_esito;
  end if;
  for v_r in
    select r.id, r.ingrediente_id, r.unita from public.acquisto_riga r
     where r.acquisto_id = (d ->> 'acquisto_id')::uuid and r.famiglia_id = p_famiglia
       and r.ingrediente_id is not null and r.voce_id is null
  loop
    select v.id into v_voce from public.voce_spesa v
     where v.famiglia_id = p_famiglia and v.eliminato_il is null and v.stato = 'nel_carrello'
       and v.ingrediente_id = any (interno.antenati(v_r.ingrediente_id)) and (v.unita = v_r.unita or v.unita is null)
       and not exists (select 1 from public.acquisto_riga x where x.voce_id = v.id)
     order by v.ingrediente_id = v_r.ingrediente_id desc, v.creato_il, v.id limit 1;
    continue when v_voce is null;
    update public.acquisto_riga set voce_id = v_voce where id = v_r.id;
    update public.voce_spesa set stato = 'acquistata', non_piu_necessaria = false where id = v_voce;
  end loop;
  return v_esito;
end $$;

-- ───────────────────────── Ospiti ─────────────────────────

alter function interno.cmd_imposta_ospiti(uuid, jsonb, uuid) rename to cmd_imposta_ospiti_base;

-- Senza versione_attesa si dice «non ce n'erano»: se nel frattempo un altro telefono li ha segnati, è un conflitto.
-- `dispositivo` (facoltativo) è il telefono che scrive.
create function interno.cmd_imposta_ospiti(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_attuale public.ospiti_pasto;
  v_oggetti text[] := coalesce(array(select distinct jsonb_array_elements_text(coalesce(d -> 'oggetti', '[]'::jsonb)) order by 1), '{}');
begin
  if (d ->> 'versione_attesa') is null and (d ->> 'data') is not null and (d ->> 'categoria') is not null then
    select * into v_attuale from public.ospiti_pasto
     where id = interno.nuovo_id(p_famiglia, 'ospiti:' || (d ->> 'data') || ':' || (d ->> 'categoria')) and eliminato_il is null;
    -- Le modifiche dello stesso telefono che non ha ancora ricevuto la propria riga non sono un conflitto.
    if found and (d ->> 'dispositivo') is not null and (d ->> 'dispositivo') is not distinct from (
         select c.dispositivo from public.comando c
          where c.famiglia_id = p_famiglia and c.tipo = 'imposta_ospiti' and c.esito = 'applicato'
            and c.dati ->> 'data' = d ->> 'data' and c.dati ->> 'categoria' = d ->> 'categoria'
          order by c.seq desc limit 1) then
      found := false;
    end if;
    if found and not (v_attuale.adulti = coalesce((d ->> 'adulti')::integer, 0)
                      and v_attuale.bambini = coalesce((d ->> 'bambini')::integer, 0)
                      and (v_attuale.data < current_date or v_attuale.oggetti = v_oggetti)) then
      perform interno.conflitto(jsonb_build_object('motivo', 'ospiti_cambiati', 'attuale', to_jsonb(v_attuale)));
    end if;
  end if;
  return interno.cmd_imposta_ospiti_base(p_famiglia, d, p_utente);
end $$;

-- Pulire le esigenze dei pasti passati è una scrittura: prende il lock della famiglia come i comandi,
-- altrimenti una riga con seq più alto potrebbe essere scaricata prima di un comando ancora in corso.
create or replace function interno.dimentica_ospiti(p_famiglia uuid) returns void
language plpgsql as $$
declare
  v_famiglia uuid;
begin
  for v_famiglia in
    select distinct famiglia_id from public.ospiti_pasto
     where (p_famiglia is null or famiglia_id = p_famiglia) and data < current_date and oggetti <> '{}'
     order by famiglia_id
  loop
    perform pg_advisory_xact_lock(interno.chiave_lock(v_famiglia));
    update public.ospiti_pasto set oggetti = '{}'
     where famiglia_id = v_famiglia and data < current_date and oggetti <> '{}';
  end loop;
end $$;

-- ───────────────────────── Menu e conferme ─────────────────────────

-- Un pasto già confermato è già stato tolto dalla casa: la lista non lo conta più.
create or replace function interno.fabbisogno_menu(p_famiglia uuid, p_dal date, p_al date)
returns table (ingrediente_id text, unita text, quantita numeric)
language sql stable as $$
  with persone as (
    select id, porzione from public.membro where famiglia_id = p_famiglia and eliminato_il is null and not archiviato
  ), portate as (
    select p.id, p.ricetta_id,
      interno.porzioni_portata(p.id) + coalesce((
        select sum(interno.porzioni_portata(a.id)) from public.portata a
         where a.avanzo_di = p.id and a.eliminato_il is null), 0) as porzioni
      from public.portata p
     where p.famiglia_id = p_famiglia and p.eliminato_il is null and p.ricetta_id is not null and p.avanzo_di is null
       and p.data between p_dal and p_al
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
  ), alternative as (
    select e.ricetta_id, coalesce(e.porzioni, x.porzione) as porzioni
      from public.eccezione_membro e
      join public.portata p on p.id = e.portata_id and p.eliminato_il is null and p.data between p_dal and p_al
      join persone x on x.id = e.membro_id
     where e.famiglia_id = p_famiglia and e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
  ), piatti as (
    select ricetta_id, porzioni from portate union all select ricetta_id, porzioni from alternative
  )
  select g.ingrediente_id, g.unita, sum(g.quantita * pi.porzioni / r.porzioni)
    from piatti pi
    join public.ricetta r on r.id = pi.ricetta_id
    join public.ricetta_ingrediente g on g.ricetta_id = r.id and g.eliminato_il is null
    join public.ingrediente i on i.id = g.ingrediente_id
   where pi.porzioni > 0 and not g.qb and not g.opzionale and g.quantita is not null and not i.base
   group by g.ingrediente_id, g.unita
$$;

alter function interno.cmd_rimuovi_portata(uuid, jsonb, uuid) rename to cmd_rimuovi_portata_base;

-- Un piatto confermato è un fatto: per toglierlo prima si corregge la conferma in «saltato».
create function interno.cmd_rimuovi_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if exists (select 1 from public.conferma_pasto c join public.portata p on p.id = c.portata_id
              where c.portata_id = (d ->> 'id')::uuid and p.famiglia_id = p_famiglia and p.eliminato_il is null and c.attiva
                and c.esito <> 'saltato') then
    perform interno.rifiuta('portata_confermata');
  end if;
  return interno.cmd_rimuovi_portata_base(p_famiglia, d, p_utente);
end $$;

alter function interno.cmd_conferma_pasto(uuid, jsonb, uuid) rename to cmd_conferma_pasto_base;

-- Una correzione che indica gli avanzi li sostituisce; «saltato» li toglie. Quel che degli avanzi di prima si è
-- già mangiato resta mangiato: si toglie solo ciò che resta, e i nuovi avanzi si caricano al netto di quanto mangiato.
-- I controlli di revisione restano quelli della base: se falliscono, tutto il comando, compreso questo, non scrive nulla.
create function interno.cmd_conferma_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto record;
  v_mangiati numeric;
  v_avanzi jsonb := '[]'::jsonb;
  v_x jsonb;
  v_q numeric;
  v_tolgo numeric;
begin
  if (d ->> 'revisione_attesa') is not null and (jsonb_typeof(d -> 'avanzi') = 'array' or d ->> 'esito' = 'saltato') then
    -- Mangiato (o buttato) dagli avanzi di prima: tutto ciò che è uscito tranne gli annulli delle correzioni.
    select coalesce(-sum(m.variazione), 0) into v_mangiati
      from public.movimento m
      join public.lotto l on l.id = m.lotto_id
      join public.conferma_pasto c on c.id = l.conferma_id
      join public.portata p on p.id = c.portata_id
     where c.portata_id = (d ->> 'portata_id')::uuid and p.famiglia_id = p_famiglia
       and l.origine = 'avanzo' and m.causale not in ('carico', 'annullo');
    if jsonb_typeof(d -> 'avanzi') = 'array' and v_mangiati > 0 then
      for v_x in select * from jsonb_array_elements(d -> 'avanzi') loop
        v_q := (v_x ->> 'quantita')::numeric;
        if v_q > 0 then
          v_tolgo := least(v_q, v_mangiati);
          v_q := v_q - v_tolgo;
          v_mangiati := v_mangiati - v_tolgo;
          continue when v_q <= 0;
          v_x := jsonb_set(v_x, '{quantita}', to_jsonb(v_q));
        end if;
        v_avanzi := v_avanzi || jsonb_build_array(v_x);
      end loop;
      d := jsonb_set(d, '{avanzi}', v_avanzi);
    end if;
    for v_lotto in
      select l.id, l.quantita from public.lotto l
        join public.conferma_pasto c on c.id = l.conferma_id
        join public.portata p on p.id = c.portata_id
       where c.portata_id = (d ->> 'portata_id')::uuid and p.famiglia_id = p_famiglia
         and l.origine = 'avanzo' and l.eliminato_il is null and l.chiuso_il is null and l.quantita > 0
       for update of l
    loop
      perform interno.nuovo_movimento(p_famiglia, v_lotto.id, -v_lotto.quantita, 'annullo', 'avanzi corretti');
    end loop;
  end if;
  return interno.cmd_conferma_pasto_base(p_famiglia, d, p_utente);
end $$;

-- ───────────────────────── Ricette ─────────────────────────

alter function interno.cmd_salva_ricetta(uuid, jsonb, uuid) rename to cmd_salva_ricetta_base;

-- Cambiare solo ingredienti o passaggi lasciava la ricetta alla stessa versione: il «va bene» restava
-- valido su una ricetta diversa. Ora ogni salvataggio che cambia le righe è una versione nuova.
create function interno.cmd_salva_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_prima integer;
  v_dopo integer;
  v_esito jsonb;
begin
  select versione into v_prima from public.ricetta where id = d ->> 'id' and famiglia_id = p_famiglia;
  v_esito := interno.cmd_salva_ricetta_base(p_famiglia, d, p_utente);
  select versione into v_dopo from public.ricetta where id = d ->> 'id' and famiglia_id = p_famiglia;
  if v_prima is not null and v_dopo = v_prima
     and exists (select 1 from jsonb_each(coalesce(d -> 'ingredienti', '{}'::jsonb)) x
                  where jsonb_typeof(x.value) = 'array' and jsonb_array_length(x.value) > 0
                 union all
                 select 1 from jsonb_each(coalesce(d -> 'passi', '{}'::jsonb)) x
                  where jsonb_typeof(x.value) = 'array' and jsonb_array_length(x.value) > 0) then
    update public.ricetta set modificato_il = now() where id = d ->> 'id' and famiglia_id = p_famiglia;
  end if;
  return v_esito;
end $$;

-- ───────────────────────── Account ─────────────────────────

-- Come prima, ma uscire da una famiglia prende il suo lock: sono scritture fuori da un comando.
create or replace function public.elimina_mio_account(p_conferma text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_riga record;
  v_famiglia uuid;
  v_cancellate integer := 0;
  v_lasciate integer := 0;
begin
  if v_utente is null then raise exception 'non autenticato' using errcode = '28000'; end if;
  if p_conferma is distinct from 'ELIMINA' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'conferma_mancante'));
  end if;
  -- Prima i lock delle famiglie, poi le righe: lo stesso ordine dei comandi, così non ci si blocca a vicenda.
  for v_famiglia in
    select distinct uf.famiglia_id from public.utente_famiglia uf
     where uf.utente_id = v_utente and uf.eliminato_il is null order by uf.famiglia_id
  loop
    perform pg_advisory_xact_lock(interno.chiave_lock(v_famiglia));
  end loop;
  for v_riga in
    select uf.id, uf.famiglia_id, uf.ruolo from public.utente_famiglia uf
     where uf.utente_id = v_utente and uf.eliminato_il is null
     order by uf.famiglia_id
       for update
  loop
    perform 1 from public.famiglia where id = v_riga.famiglia_id for update;
    if not exists (select 1 from public.utente_famiglia o
                    where o.famiglia_id = v_riga.famiglia_id and o.eliminato_il is null and o.utente_id <> v_utente) then
      delete from public.famiglia where id = v_riga.famiglia_id;
      v_cancellate := v_cancellate + 1;
      continue;
    end if;
    if v_riga.ruolo = 'amministratore' and not exists (
         select 1 from public.utente_famiglia o where o.famiglia_id = v_riga.famiglia_id and o.eliminato_il is null
            and o.utente_id <> v_utente and o.ruolo = 'amministratore') then
      update public.utente_famiglia set ruolo = 'amministratore'
       where id = (select o.id from public.utente_famiglia o
                    where o.famiglia_id = v_riga.famiglia_id and o.eliminato_il is null and o.utente_id <> v_utente
                    order by o.creato_il, o.id limit 1);
    end if;
    update public.membro set utente_id = null where famiglia_id = v_riga.famiglia_id and utente_id = v_utente;
    update public.utente_famiglia set eliminato_il = now() where id = v_riga.id;
    v_lasciate := v_lasciate + 1;
  end loop;
  delete from interno.gemini_condivisa where utente_id = v_utente;
  delete from auth.users where id = v_utente;
  return jsonb_build_object('esito', 'applicato', 'dettaglio', jsonb_build_object('cancellate', v_cancellate, 'lasciate', v_lasciate));
end $$;

revoke all on function interno.cmd_conferma_acquisto(uuid, jsonb, uuid), interno.cmd_importa_scontrino(uuid, jsonb, uuid),
  interno.impronta_dati_scontrino(public.scontrino), interno.cmd_imposta_ospiti(uuid, jsonb, uuid), interno.dimentica_ospiti(uuid),
  interno.fabbisogno_menu(uuid, date, date), interno.cmd_rimuovi_portata(uuid, jsonb, uuid), interno.cmd_conferma_pasto(uuid, jsonb, uuid),
  interno.cmd_salva_ricetta(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.elimina_mio_account(text) from public, anon;
grant execute on function public.elimina_mio_account(text) to authenticated;
