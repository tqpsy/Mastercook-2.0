-- Spesa e «Cucinato»: un piatto cucinato in anticipo ha già tolto dalla casa i suoi ingredienti (`cucina_portata`),
-- ma finché non si conferma il pasto la portata restava nel fabbisogno del menu, quindi la lista della spesa
-- chiedeva di nuovo gli stessi ingredienti. Ora una portata con il suo piatto pronto in casa (lotto legato con
-- `portata_id`, non eliminato) non conta più, come una portata già confermata; vale anche per le alternative di chi
-- mangia altro. Il resto della funzione è identico a 20261115001100_senza_ingrediente.sql.

create or replace function interno.fabbisogno_menu(p_famiglia uuid, p_dal date, p_al date, p_giorni date[] default null)
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
       and (p_giorni is null or p.data = any (p_giorni))
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
       and not exists (select 1 from public.lotto l where l.portata_id = p.id and l.eliminato_il is null)
  ), alternative as (
    select e.ricetta_id, coalesce(e.porzioni, x.porzione) as porzioni
      from public.eccezione_membro e
      join public.portata p on p.id = e.portata_id and p.eliminato_il is null and p.data between p_dal and p_al
       and (p_giorni is null or p.data = any (p_giorni))
      join persone x on x.id = e.membro_id
     where e.famiglia_id = p_famiglia and e.eliminato_il is null and e.tipo = 'alternativa' and e.ricetta_id is not null
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
       and not exists (select 1 from public.lotto l where l.portata_id = p.id and l.eliminato_il is null)
  ), piatti as (
    select id as portata_id, ricetta_id, porzioni from portate
    union all select null::uuid, ricetta_id, porzioni from alternative
  )
  select g.ingrediente_id, g.unita,
         sum(g.quantita * pi.porzioni / r.porzioni
             * case when pi.portata_id is null then 1 else interno.quota_senza(pi.portata_id, g.ingrediente_id) end)
    from piatti pi
    join public.ricetta r on r.id = pi.ricetta_id
    join public.ricetta_ingrediente g on g.ricetta_id = r.id and g.eliminato_il is null
    join public.ingrediente i on i.id = g.ingrediente_id
   where pi.porzioni > 0 and not g.qb and not g.opzionale and g.quantita is not null and not i.base
   group by g.ingrediente_id, g.unita
$$;

revoke all on function interno.fabbisogno_menu(uuid, date, date, date[]) from public, anon, authenticated;
