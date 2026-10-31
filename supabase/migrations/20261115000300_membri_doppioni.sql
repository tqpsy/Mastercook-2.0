-- La stessa persona comparsa più volte in famiglia («Raffaella, Raffaella»).
--
-- Causa: entrare con un invito creava sempre una persona nuova, anche quando chi invita l'aveva già
-- aggiunta a mano (con allergie e gusti) o quando la persona rientrava dopo essere uscita
-- (togli accesso o elimina account lasciano la persona scollegata, che non veniva più ritrovata).
--
-- 1. interno.unisci_membro: porta tutto da una copia all'altra (vincoli, «chi mangia», gusti,
--    «va bene»/«non va bene», account) e poi toglie la copia.
-- 2. Entrare con un invito ritrova la persona con lo stesso nome non ancora collegata e la collega.
-- 3. Comando unisci_membri (solo amministratori) per unire a mano due persone.
-- 4. Pulizia una tantum: in ogni famiglia unisce le persone attive con lo stesso nome e la stessa
--    porzione, se al massimo una è collegata a un account.

create function interno.nome_persona(p_nome text) returns text
language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g')) $$;

-- Unisce p_toglie in p_tiene (stessa famiglia). Chi mangia: basta che una delle copie mangi
-- (un'alternativa vale più del mangiare normale, che vale più del «non mangia»).
create function interno.unisci_membro(p_famiglia uuid, p_tiene uuid, p_toglie uuid) returns void
language plpgsql as $$
declare
  v_tiene public.membro;
  v_toglie public.membro;
  v_e record;
  v_mia public.eccezione_membro;
begin
  select * into v_tiene from public.membro
   where id = p_tiene and famiglia_id = p_famiglia and eliminato_il is null for update;
  select * into v_toglie from public.membro
   where id = p_toglie and famiglia_id = p_famiglia and eliminato_il is null for update;
  if v_tiene.id is null or v_toglie.id is null or p_tiene = p_toglie then
    perform interno.rifiuta('membro_non_trovato');
  end if;
  if v_tiene.utente_id is not null and v_toglie.utente_id is not null and v_tiene.utente_id <> v_toglie.utente_id then
    perform interno.rifiuta('due_account');
  end if;

  -- Allergie, intolleranze, esigenze: tutte, la più severa se doppia.
  for v_e in select * from public.vincolo_alimentare where membro_id = p_toglie and eliminato_il is null loop
    if exists (select 1 from public.vincolo_alimentare where membro_id = p_tiene and tipo = v_e.tipo
               and oggetto = v_e.oggetto and eliminato_il is null) then
      if v_e.severita = 'evitare_anche_tracce' then
        update public.vincolo_alimentare set severita = 'evitare_anche_tracce'
         where membro_id = p_tiene and tipo = v_e.tipo and oggetto = v_e.oggetto and eliminato_il is null
           and severita <> 'evitare_anche_tracce';
      end if;
      update public.vincolo_alimentare set eliminato_il = now() where id = v_e.id;
    else
      update public.vincolo_alimentare set membro_id = p_tiene where id = v_e.id;
    end if;
  end loop;

  -- Chi mangia ogni piatto.
  for v_e in select * from public.eccezione_membro where membro_id = p_toglie and eliminato_il is null loop
    select * into v_mia from public.eccezione_membro
     where membro_id = p_tiene and portata_id = v_e.portata_id and eliminato_il is null;
    if v_e.tipo = 'alternativa' and (v_mia.id is null or v_mia.tipo = 'non_mangia') then
      if v_mia.id is not null then
        update public.eccezione_membro set eliminato_il = now() where id = v_mia.id;
      end if;
      update public.eccezione_membro set membro_id = p_tiene where id = v_e.id;
    else
      update public.eccezione_membro set eliminato_il = now() where id = v_e.id;
    end if;
  end loop;
  -- Dove la copia mangiava normalmente, mangia anche la persona che resta.
  update public.eccezione_membro e set eliminato_il = now()
   where e.membro_id = p_tiene and e.tipo = 'non_mangia' and e.eliminato_il is null
     and not exists (select 1 from public.eccezione_membro x where x.membro_id = p_toglie
                     and x.portata_id = e.portata_id and x.eliminato_il is null)
     and not exists (select 1 from public.portata p where p.id = e.portata_id and p.data < v_toglie.creato_il::date);

  -- Gusti e ricette segnate: vince quello della persona che resta.
  update public.gusto g set eliminato_il = now()
   where g.membro_id = p_toglie and g.eliminato_il is null
     and exists (select 1 from public.gusto x where x.membro_id = p_tiene and x.eliminato_il is null
                 and coalesce(x.ingrediente_id, x.ricetta_id) = coalesce(g.ingrediente_id, g.ricetta_id));
  update public.gusto set membro_id = p_tiene where membro_id = p_toglie and eliminato_il is null;
  update public.ricetta_verificata v set eliminato_il = now()
   where v.membro_id = p_toglie and v.eliminato_il is null
     and exists (select 1 from public.ricetta_verificata x where x.membro_id = p_tiene and x.eliminato_il is null
                 and x.ricetta_id = v.ricetta_id);
  update public.ricetta_verificata set membro_id = p_tiene where membro_id = p_toglie and eliminato_il is null;

  -- Via la copia, poi l'account (uno per famiglia) e ciò che mancava passano a chi resta.
  update public.membro set eliminato_il = now(), utente_id = null where id = p_toglie;
  update public.membro set
      utente_id = coalesce(v_tiene.utente_id, v_toglie.utente_id),
      emoji = coalesce(v_tiene.emoji, v_toglie.emoji),
      note = case when v_tiene.note is null then v_toglie.note
                  when v_toglie.note is null or v_toglie.note = v_tiene.note then v_tiene.note
                  else left(v_tiene.note || E'\n' || v_toglie.note, 1000) end,
      archiviato = false
   where id = p_tiene
     and (utente_id is distinct from coalesce(v_tiene.utente_id, v_toglie.utente_id)
          or emoji is distinct from coalesce(v_tiene.emoji, v_toglie.emoji)
          or v_toglie.note is not null or archiviato);
end $$;

-- Unire a mano due persone: { tiene, toglie }.
create function interno.cmd_unisci_membri(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  perform interno.richiedi_amministratore(p_famiglia, p_utente);
  perform interno.unisci_membro(p_famiglia, (d ->> 'tiene')::uuid, (d ->> 'toglie')::uuid);
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('unisci_membri', 'cmd_unisci_membri');

-- Entrare con un invito: se in famiglia c'è già una persona con lo stesso nome non collegata a un
-- account, è lei (aggiunta a mano da chi invita, o uscita e rientrata): la si collega invece di crearne un'altra.
create or replace function interno.cmd_entra(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_invito public.invito;
  v_esistente uuid;
begin
  select * into v_invito from public.invito where codice = d ->> 'codice' for update;
  if interno.ruolo_in(p_famiglia, p_utente) is not null then
    return jsonb_build_object('gia_membro', true);
  end if;
  if v_invito.revocato then
    perform interno.rifiuta('invito_revocato');
  end if;
  if v_invito.scade_il < now() then
    perform interno.rifiuta('invito_scaduto');
  end if;
  if v_invito.usi >= v_invito.usi_massimi then
    perform interno.rifiuta('invito_esaurito');
  end if;
  update public.invito set usi = usi + 1 where id = v_invito.id;
  insert into public.utente_famiglia (id, famiglia_id, utente_id, ruolo)
    values (gen_random_uuid(), p_famiglia, p_utente, 'membro');

  select id into v_esistente from public.membro
   where famiglia_id = p_famiglia and eliminato_il is null and utente_id = p_utente;
  if v_esistente is null then
    select id into v_esistente from public.membro
     where famiglia_id = p_famiglia and eliminato_il is null and utente_id is null
       and interno.nome_persona(nome) = interno.nome_persona(d -> 'membro' ->> 'nome')
     order by archiviato, creato_il
     limit 1
     for update;
    if v_esistente is not null then
      update public.membro set utente_id = p_utente, archiviato = false where id = v_esistente;
    end if;
  end if;
  if v_esistente is null then
    insert into public.membro (id, famiglia_id, nome, emoji, utente_id)
      values ((d -> 'membro' ->> 'id')::uuid, p_famiglia, d -> 'membro' ->> 'nome', d -> 'membro' ->> 'emoji', p_utente);
  end if;
  return '{}'::jsonb;
end $$;

-- Pulizia dei doppioni già presenti: resta la persona aggiunta per prima.
create function interno.unisci_doppioni() returns integer
language plpgsql as $$
declare
  v_g record;
  v_altro uuid;
  v_n integer := 0;
begin
  for v_g in
    select famiglia_id, array_agg(id order by creato_il, id) as ids
      from public.membro
     where eliminato_il is null and not archiviato
     group by famiglia_id, interno.nome_persona(nome), porzione
    having count(*) > 1 and count(utente_id) <= 1
  loop
    foreach v_altro in array v_g.ids[2:] loop
      perform interno.unisci_membro(v_g.famiglia_id, v_g.ids[1], v_altro);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

select interno.unisci_doppioni();

revoke all on function interno.nome_persona(text), interno.unisci_membro(uuid, uuid, uuid),
  interno.cmd_unisci_membri(uuid, jsonb, uuid), interno.cmd_entra(uuid, jsonb, uuid),
  interno.unisci_doppioni() from public, anon, authenticated;
