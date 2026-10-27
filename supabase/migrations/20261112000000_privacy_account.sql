-- Privacy: il consenso all'iscrizione e l'eliminazione del proprio account.
--
-- Consenso: chi entra accetta l'informativa (versione corrente) e dà il consenso esplicito per i dati sulla
-- salute (allergie, intolleranze, esigenze: art. 9 GDPR). Si registra versione e momento, nient'altro.
--
-- Eliminare il proprio account:
-- - le famiglie in cui si è l'unico account si cancellano per intero, come `elimina_famiglia`;
-- - dalle altre si esce: se si era l'unico amministratore, lo diventa l'account entrato prima; la scheda della
--   persona collegata resta alla famiglia (è la famiglia che cucina per lei), scollegata dall'account;
-- - infine si cancella l'utente di Supabase (accesso Google compreso).
-- Le foto delle famiglie che si cancellano le toglie prima l'app dal deposito, finché si è membri.

create table interno.consenso (
  utente_id uuid primary key references auth.users (id) on delete cascade,
  versione integer not null check (versione > 0),
  dato_il timestamptz not null default now()
);
revoke all on interno.consenso from public, anon, authenticated;

create function public.mio_consenso() returns integer
language sql stable security definer set search_path = '' as $$
  select versione from interno.consenso where utente_id = auth.uid()
$$;

create function public.registra_consenso(p_versione integer) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non autenticato' using errcode = '28000'; end if;
  if p_versione is null or p_versione < 1 or p_versione > 1000 then raise exception 'versione non valida' using errcode = '22023'; end if;
  insert into interno.consenso (utente_id, versione) values (auth.uid(), p_versione)
    on conflict (utente_id) do update set versione = excluded.versione, dato_il = now();
  return p_versione;
end $$;

-- Chi ha lasciato la famiglia resta visibile come uscito (riga eliminata) anche dopo che il suo utente non c'è più:
-- così gli altri dispositivi lo scaricano e lo tolgono dall'elenco.
alter table public.utente_famiglia alter column utente_id drop not null;
alter table public.utente_famiglia drop constraint utente_famiglia_utente_id_fkey;
alter table public.utente_famiglia add constraint utente_famiglia_utente_id_fkey
  foreign key (utente_id) references auth.users (id) on delete set null;

-- Cosa succede eliminando l'account: quali famiglie spariscono e da quali si esce soltanto.
create function public.anteprima_eliminazione_account() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cancellate', coalesce(jsonb_agg(jsonb_build_object('famiglia_id', f.id, 'nome', f.nome)) filter (where altri = 0), '[]'::jsonb),
    'lasciate', coalesce(jsonb_agg(jsonb_build_object('famiglia_id', f.id, 'nome', f.nome)) filter (where altri > 0), '[]'::jsonb))
  from (
    select uf.famiglia_id,
           (select count(*) from public.utente_famiglia o
             where o.famiglia_id = uf.famiglia_id and o.eliminato_il is null and o.utente_id <> uf.utente_id) as altri
      from public.utente_famiglia uf
     where uf.utente_id = auth.uid() and uf.eliminato_il is null
  ) x join public.famiglia f on f.id = x.famiglia_id
$$;

create function public.elimina_mio_account(p_conferma text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_riga record;
  v_cancellate integer := 0;
  v_lasciate integer := 0;
begin
  if v_utente is null then raise exception 'non autenticato' using errcode = '28000'; end if;
  if p_conferma is distinct from 'ELIMINA' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'conferma_mancante'));
  end if;
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

revoke all on function public.mio_consenso(), public.registra_consenso(integer), public.anteprima_eliminazione_account(),
  public.elimina_mio_account(text) from public, anon;
grant execute on function public.mio_consenso(), public.registra_consenso(integer), public.anteprima_eliminazione_account(),
  public.elimina_mio_account(text) to authenticated;
