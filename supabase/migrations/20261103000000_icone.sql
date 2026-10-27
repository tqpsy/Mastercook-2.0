-- Fase 5, rifinitura: l'icona di una ricetta scelta dalla famiglia.
--
-- - icona_ricetta: per ogni ricetta (di Mastercook o della famiglia) al più un'icona scelta. Senza, l'app
--   usa quella dell'ingrediente principale. Togliere l'icona torna all'automatica.

create table public.icona_ricetta (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  ricetta_id text not null references public.ricetta (id),
  -- Un'emoji (anche composta): niente lettere, cifre o spazi.
  emoji text not null check (char_length(emoji) between 1 and 16 and emoji !~ '[[:alnum:][:space:]<>&]'),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create unique index icona_ricetta_unica on public.icona_ricetta (famiglia_id, ricetta_id) where eliminato_il is null;
create index icona_ricetta_seq on public.icona_ricetta (famiglia_id, seq);

create trigger timbra before insert or update on public.icona_ricetta for each row execute function interno.timbra();
create trigger controlla_riferimenti before insert or update of ricetta_id on public.icona_ricetta
  for each row execute function interno.controlla_riferimenti();

alter table public.icona_ricetta enable row level security;
create policy lettura on public.icona_ricetta for select to authenticated using (interno.sono_membro(famiglia_id));
revoke all on public.icona_ricetta from anon, authenticated;
grant select on public.icona_ricetta to authenticated;

-- ───────────────────────── Comandi ─────────────────────────

-- Sceglie l'icona di una ricetta per la famiglia; `emoji` null la toglie. Ripetuto, non cambia niente.
create function interno.cmd_scegli_icona(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid;
begin
  select id into v_id from public.icona_ricetta
   where famiglia_id = p_famiglia and ricetta_id = d ->> 'ricetta_id' and eliminato_il is null for update;
  if d ->> 'emoji' is null then
    if v_id is not null then
      update public.icona_ricetta set eliminato_il = now() where id = v_id;
    end if;
    return '{}'::jsonb;
  end if;
  if v_id is null then
    insert into public.icona_ricetta (id, famiglia_id, ricetta_id, emoji)
      values ((d ->> 'id')::uuid, p_famiglia, d ->> 'ricetta_id', d ->> 'emoji');
  else
    update public.icona_ricetta set emoji = d ->> 'emoji' where id = v_id and emoji is distinct from d ->> 'emoji';
  end if;
  return '{}'::jsonb;
end $$;

insert into interno.tipo_comando (tipo, funzione) values ('scegli_icona', 'cmd_scegli_icona');

-- ───────────────────────── Sincronizzazione ─────────────────────────

create or replace function public.scarica_modifiche(p_famiglia uuid, p_dopo bigint, p_limite integer default 500)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_righe jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 500), 1), 1000);
  v_amministratore boolean := interno.sono_amministratore(p_famiglia);
begin
  if auth.uid() is null or interno.ruolo_in(p_famiglia, auth.uid()) is null then
    return jsonb_build_object('errore', 'non_autorizzato');
  end if;

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

-- ───────────────────────── Ripristino: file della versione 7 ─────────────────────────

alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_fino_a_6;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_vecchia uuid := (v_tabelle -> 'famiglia' -> 0 ->> 'id')::uuid;
  v_conta jsonb;
  v_r jsonb;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' or (v_file ->> 'versione_schema') is distinct from '7' then
    return interno.ripristina_fino_a_6(p_famiglia, d, p_utente);
  end if;
  if coalesce(jsonb_typeof(v_tabelle -> 'icona_ricetta'), '') <> 'array' then
    perform interno.rifiuta('file_incompleto');
  end if;
  if exists (select 1 from jsonb_array_elements(v_tabelle -> 'icona_ricetta') e where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia) then
    perform interno.rifiuta('file_incoerente');
  end if;
  v_conta := interno.ripristina_fino_a_6(p_famiglia, jsonb_set(d, '{file,versione_schema}', '6'), p_utente);

  for v_r in select * from jsonb_array_elements(v_tabelle -> 'icona_ricetta') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.icona_ricetta (id, famiglia_id, ricetta_id, emoji)
      select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, r.id, v_r ->> 'emoji'
        from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id')
         and (r.famiglia_id is null or r.famiglia_id = p_famiglia) and r.eliminato_il is null;
  end loop;
  return v_conta;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
