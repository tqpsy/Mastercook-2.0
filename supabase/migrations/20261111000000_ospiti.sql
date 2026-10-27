-- Ospiti a un pasto: quanti adulti e quanti bambini, e le loro allergie, intolleranze ed esigenze.
--
-- Privacy: niente nomi, solo numeri e codici (gli stessi dei vincoli: `all:arachidi`, `ing:lattosio`, `cls:vegano`).
-- Le esigenze si dimenticano appena il pasto è passato (restano solo i numeri, che servono a spesa e consumi):
-- a ogni scarico della famiglia, a ogni modifica degli ospiti e, dove c'è pg_cron, ogni notte.
--
-- Effetti: le porzioni automatiche di ogni piatto di quel pasto crescono (adulto 1, bambino 0,6), e quindi
-- spesa e previsto; il menu controlla i piatti anche per le esigenze degli ospiti. Il menu resta un'intenzione.
-- Gli ospiti non si esportano: sono di passaggio.

create function interno.oggetti_validi(p text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(o ~ '^(all|ing|cls|txt):[a-z0-9_]{1,60}$'), true) and coalesce(array_length(p, 1), 0) <= 30
    from unnest(p) o
$$;

create table public.ospiti_pasto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  data date not null,
  categoria text not null check (char_length(categoria) between 1 and 40),
  adulti integer not null default 0 check (adulti between 0 and 50),
  bambini integer not null default 0 check (bambini between 0 and 50),
  oggetti text[] not null default '{}' check (interno.oggetti_validi(oggetti)),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check (eliminato_il is not null or adulti + bambini > 0)
);
create unique index ospiti_pasto_unico on public.ospiti_pasto (famiglia_id, data, categoria) where eliminato_il is null;
create index ospiti_pasto_seq on public.ospiti_pasto (famiglia_id, seq);
create index ospiti_pasto_data on public.ospiti_pasto (famiglia_id, data) where oggetti <> '{}';

create trigger timbra before insert or update on public.ospiti_pasto for each row execute function interno.timbra();
create trigger controlla_riferimenti before insert or update of categoria on public.ospiti_pasto
  for each row execute function interno.controlla_riferimenti();

alter table public.ospiti_pasto enable row level security;
create policy lettura on public.ospiti_pasto for select to authenticated using (interno.sono_membro(famiglia_id));
revoke all on public.ospiti_pasto from anon, authenticated;
grant select on public.ospiti_pasto to authenticated;

-- Le esigenze degli ospiti dei pasti passati si cancellano (i numeri restano).
create function interno.dimentica_ospiti(p_famiglia uuid) returns void
language sql as $$
  update public.ospiti_pasto set oggetti = '{}'
   where (p_famiglia is null or famiglia_id = p_famiglia) and data < current_date and oggetti <> '{}'
$$;

-- Imposta gli ospiti di un pasto: {data, categoria, adulti, bambini, oggetti, versione_attesa?}.
-- Zero adulti e zero bambini = niente ospiti. Uno per pasto: l'id viene da famiglia, giorno e pasto.
create function interno.cmd_imposta_ospiti(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_data date := (d ->> 'data')::date;
  v_categoria text := d ->> 'categoria';
  v_adulti integer := coalesce((d ->> 'adulti')::integer, 0);
  v_bambini integer := coalesce((d ->> 'bambini')::integer, 0);
  v_oggetti text[] := coalesce(array(select distinct jsonb_array_elements_text(coalesce(d -> 'oggetti', '[]'::jsonb)) order by 1), '{}');
  v_id uuid := interno.nuovo_id(p_famiglia, 'ospiti:' || coalesce(d ->> 'data', '') || ':' || coalesce(v_categoria, ''));
  v_attuale public.ospiti_pasto;
begin
  if v_data is null or v_categoria is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  perform interno.dimentica_ospiti(p_famiglia);
  if v_data < current_date then v_oggetti := '{}'; end if;
  select * into v_attuale from public.ospiti_pasto where id = v_id;
  if found and v_attuale.eliminato_il is null and (d ->> 'versione_attesa') is not null
     and v_attuale.versione <> (d ->> 'versione_attesa')::integer then
    perform interno.conflitto(jsonb_build_object('motivo', 'ospiti_cambiati', 'attuale', to_jsonb(v_attuale)));
  end if;
  if v_adulti + v_bambini = 0 then
    update public.ospiti_pasto set eliminato_il = now() where id = v_id and eliminato_il is null;
    return jsonb_build_object('id', v_id);
  end if;
  insert into public.ospiti_pasto (id, famiglia_id, data, categoria, adulti, bambini, oggetti)
    values (v_id, p_famiglia, v_data, v_categoria, v_adulti, v_bambini, v_oggetti)
    on conflict (id) do update set adulti = excluded.adulti, bambini = excluded.bambini, oggetti = excluded.oggetti, eliminato_il = null;
  return jsonb_build_object('id', v_id);
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('imposta_ospiti', 'cmd_imposta_ospiti');

-- Le porzioni automatiche contano anche gli ospiti del pasto (adulto 1, bambino 0,6), come nell'app.
create or replace function interno.porzioni_portata(p_portata uuid) returns numeric
language sql stable as $$
  select coalesce(p.porzioni, round(2 * (coalesce((
           select sum(m.porzione) from public.membro m
            where m.famiglia_id = p.famiglia_id and m.eliminato_il is null and not m.archiviato
              and not exists (select 1 from public.eccezione_membro e
                              where e.portata_id = p.id and e.membro_id = m.id and e.eliminato_il is null)), 0)
         + coalesce((select o.adulti + 0.6 * o.bambini from public.ospiti_pasto o
                      where o.famiglia_id = p.famiglia_id and o.data = p.data and o.categoria = p.categoria
                        and o.eliminato_il is null), 0))) / 2)
    from public.portata p where p.id = p_portata
$$;

create or replace function public.scarica_modifiche(p_famiglia uuid, p_dopo bigint, p_limite integer default 500)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_righe jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 500), 1), 1000);
  v_amministratore boolean := interno.sono_amministratore(p_famiglia);
begin
  if auth.uid() is null or interno.ruolo_in(p_famiglia, auth.uid()) is null then
    return jsonb_build_object('errore', 'non_autorizzato');
  end if;
  -- Privacy: le esigenze degli ospiti si dimenticano appena il pasto è passato.
  perform interno.dimentica_ospiti(p_famiglia);

  with tutte as (
    select 'famiglia' as tabella, t.seq, to_jsonb(t) as riga from public.famiglia t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'utente_famiglia', t.seq, to_jsonb(t) from public.utente_famiglia t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'membro', t.seq, to_jsonb(t) from public.membro t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'vincolo_alimentare', t.seq, to_jsonb(t) from public.vincolo_alimentare t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'invito', t.seq, case when v_amministratore then to_jsonb(t) else to_jsonb(t) - 'codice' end
      from public.invito t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'comando', t.seq, to_jsonb(t) from public.comando t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ingrediente', t.seq, to_jsonb(t) from public.ingrediente t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta', t.seq, to_jsonb(t) from public.ricetta t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta_ingrediente', t.seq, to_jsonb(t) from public.ricetta_ingrediente t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta_passo', t.seq, to_jsonb(t) from public.ricetta_passo t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'lotto', t.seq, to_jsonb(t) from public.lotto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'movimento', t.seq, to_jsonb(t) from public.movimento t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'categoria_pasto', t.seq, to_jsonb(t) from public.categoria_pasto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'portata', t.seq, to_jsonb(t) from public.portata t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'eccezione_membro', t.seq, to_jsonb(t) from public.eccezione_membro t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'gusto', t.seq, to_jsonb(t) from public.gusto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'voce_spesa', t.seq, to_jsonb(t) from public.voce_spesa t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'acquisto', t.seq, to_jsonb(t) from public.acquisto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'acquisto_riga', t.seq, to_jsonb(t) from public.acquisto_riga t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'prodotto', t.seq, to_jsonb(t) from public.prodotto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'scontrino', t.seq, to_jsonb(t) from public.scontrino t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'scontrino_riga', t.seq, to_jsonb(t) from public.scontrino_riga t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'conferma_pasto', t.seq, to_jsonb(t) from public.conferma_pasto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'consumo_riga', t.seq, to_jsonb(t) from public.consumo_riga t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'consumo_lotto', t.seq, to_jsonb(t) from public.consumo_lotto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'icona_ricetta', t.seq, to_jsonb(t) from public.icona_ricetta t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ricetta_verificata', t.seq, to_jsonb(t) from public.ricetta_verificata t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'pasto_fisso', t.seq, to_jsonb(t) from public.pasto_fisso t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'ospiti_pasto', t.seq, to_jsonb(t) from public.ospiti_pasto t where t.famiglia_id = p_famiglia and t.seq > p_dopo
  ), pagina as (
    select * from tutte order by seq limit v_limite + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('tabella', tabella, 'seq', seq, 'riga', riga) order by seq), '[]'::jsonb)
    into v_righe from pagina;

  return jsonb_build_object(
    'righe', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
               select e from jsonb_array_elements(v_righe) with ordinality as x(e, n) where n <= v_limite) s),
    'altre', jsonb_array_length(v_righe) > v_limite);
end $$;

revoke all on function interno.oggetti_validi(text[]), interno.dimentica_ospiti(uuid), interno.cmd_imposta_ospiti(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.scarica_modifiche(uuid, bigint, integer) to authenticated;

-- Dove c'è pg_cron (Supabase), anche ogni notte; altrove basta lo scarico.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('mastercook-dimentica-ospiti', '10 1 * * *', 'select interno.dimentica_ospiti(null)');
exception when others then
  raise notice 'pg_cron non disponibile: gli ospiti si dimenticano allo scarico';
end $$;
