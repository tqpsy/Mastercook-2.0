-- Pasti fissi: un piatto che si ripete ogni giorno nello stesso pasto (la colazione di sempre),
-- finché la famiglia non decide di cambiarlo da un certo giorno in poi.
--
-- - pasto_fisso: la regola (pasto, piatto, porzioni, dal… al). Le portate dei giorni nascono dal database,
--   con id deterministici (stessa regola e stesso giorno = stessa portata): più dispositivi che chiedono
--   di prolungare non creano doppioni.
-- - portata.fisso_id: la regola da cui viene la portata. Una portata tolta a mano resta tolta: il generatore
--   non ricrea un giorno che per quella regola esiste già, anche se eliminato.
-- - Il menu resta un'intenzione: queste funzioni non toccano la casa.

create table public.pasto_fisso (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  categoria text not null check (char_length(categoria) between 1 and 40),
  ricetta_id text references public.ricetta (id),
  testo text check (testo is null or char_length(btrim(testo)) between 1 and 120),
  porzioni numeric(5, 2) check (porzioni is null or porzioni > 0 and porzioni <= 100),
  ordine numeric not null default 0,
  dal date not null,
  -- Ultimo giorno compreso; NULL = senza fine. Un giorno prima di `dal` = regola mai partita.
  al date check (al is null or al >= dal - 1),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  constraint ricetta_o_testo check ((ricetta_id is null) <> (testo is null))
);
create index pasto_fisso_seq on public.pasto_fisso (famiglia_id, seq);

alter table public.portata add column fisso_id uuid references public.pasto_fisso (id);
create index portata_fisso on public.portata (fisso_id, data) where fisso_id is not null;
alter table public.portata drop constraint portata_origine_check;
alter table public.portata add constraint portata_origine_check check (origine in ('manuale', 'automatica', 'ripetuta', 'fissa'));

create trigger timbra before insert or update on public.pasto_fisso for each row execute function interno.timbra();
create trigger controlla_riferimenti before insert or update of ricetta_id, categoria on public.pasto_fisso
  for each row execute function interno.controlla_riferimenti();

alter table public.pasto_fisso enable row level security;
create policy lettura on public.pasto_fisso for select to authenticated using (interno.sono_membro(famiglia_id));
revoke all on public.pasto_fisso from anon, authenticated;
grant select on public.pasto_fisso to authenticated;

-- ───────────────────────── Generatore ─────────────────────────

-- Crea le portate mancanti delle regole attive, da oggi (o dal primo giorno della regola) fino a `p_fino`,
-- al massimo 60 giorni avanti. Restituisce quante ne ha create.
create function interno.genera_fissi(p_famiglia uuid, p_fino date) returns integer
language plpgsql as $$
declare
  v_n integer;
begin
  insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, fisso_id)
    select interno.nuovo_id(f.id, g::date::text), p_famiglia, g::date, f.categoria, f.ricetta_id, f.testo, f.porzioni, 'fissa', f.ordine, f.id
      from public.pasto_fisso f
      cross join lateral generate_series(greatest(f.dal, current_date),
                                         least(coalesce(f.al, p_fino), p_fino, current_date + 60), interval '1 day') g
     where f.famiglia_id = p_famiglia and f.eliminato_il is null
       and (f.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = f.ricetta_id and r.eliminato_il is null))
       and not exists (select 1 from public.portata p where p.fisso_id = f.id and p.data = g::date)
    on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── Comandi ─────────────────────────

-- Un piatto fisso da `dal` in poi. Con `da_portata`, quella portata diventa il primo giorno della regola
-- (non si duplica). Crea subito i giorni fino a `fino_a` (predefinito: due settimane).
create function interno.cmd_fissa_pasto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid := (d ->> 'id')::uuid;
begin
  if (d ->> 'dal') is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  insert into public.pasto_fisso (id, famiglia_id, categoria, ricetta_id, testo, porzioni, ordine, dal)
    values (v_id, p_famiglia, d ->> 'categoria', d ->> 'ricetta_id', nullif(btrim(d ->> 'testo'), ''), (d ->> 'porzioni')::numeric,
            coalesce((d ->> 'ordine')::numeric, 0), (d ->> 'dal')::date);
  if d ->> 'da_portata' is not null then
    update public.portata set fisso_id = v_id
     where id = (d ->> 'da_portata')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  end if;
  return jsonb_build_object('create', interno.genera_fissi(p_famiglia, coalesce((d ->> 'fino_a')::date, (d ->> 'dal')::date + 13)));
end $$;

-- Prolunga tutte le regole fino a `fino_a`. Ripetuto non crea niente di nuovo.
create function interno.cmd_prolunga_pasti_fissi(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if (d ->> 'fino_a') is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  return jsonb_build_object('create', interno.genera_fissi(p_famiglia, (d ->> 'fino_a')::date));
end $$;

-- Ferma una regola da `dal` (compreso): toglie i giorni già creati da lì in poi, tranne quelli già
-- confermati e la portata `tieni` (quella da cui si cambia il piatto).
create function interno.cmd_ferma_pasto_fisso(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_dal date := (d ->> 'dal')::date;
  v_tolte integer;
begin
  update public.pasto_fisso set al = least(coalesce(al, v_dal - 1), v_dal - 1)
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if not found then
    perform interno.rifiuta('non_trovato');
  end if;
  with tolte as (
    update public.portata p set eliminato_il = now()
     where p.fisso_id = (d ->> 'id')::uuid and p.famiglia_id = p_famiglia and p.data >= v_dal and p.eliminato_il is null
       and p.id is distinct from (d ->> 'tieni')::uuid
       and not exists (select 1 from public.conferma_pasto c where c.portata_id = p.id and c.attiva)
    returning p.id
  ), eccezioni as (
    update public.eccezione_membro e set eliminato_il = now() from tolte t where e.portata_id = t.id and e.eliminato_il is null
  )
  select count(*) into v_tolte from tolte;
  return jsonb_build_object('tolte', v_tolte);
end $$;

insert into interno.tipo_comando (tipo, funzione) values
  ('fissa_pasto', 'cmd_fissa_pasto'),
  ('prolunga_pasti_fissi', 'cmd_prolunga_pasti_fissi'),
  ('ferma_pasto_fisso', 'cmd_ferma_pasto_fisso');

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
    union all
    select 'ricetta_verificata', t.seq, to_jsonb(t) from public.ricetta_verificata t where t.famiglia_id = p_famiglia and t.seq > p_dopo
    union all
    select 'pasto_fisso', t.seq, to_jsonb(t) from public.pasto_fisso t where t.famiglia_id = p_famiglia and t.seq > p_dopo
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

-- ───────────────────────── Ripristino: file della versione 9 ─────────────────────────

alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_fino_a_8;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_vecchia uuid := (v_tabelle -> 'famiglia' -> 0 ->> 'id')::uuid;
  v_conta jsonb;
  v_r jsonb;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' or (v_file ->> 'versione_schema') is distinct from '9' then
    return interno.ripristina_fino_a_8(p_famiglia, d, p_utente);
  end if;
  if coalesce(jsonb_typeof(v_tabelle -> 'pasto_fisso'), '') <> 'array' then
    perform interno.rifiuta('file_incompleto');
  end if;
  if exists (select 1 from jsonb_array_elements(v_tabelle -> 'pasto_fisso') e where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia) then
    perform interno.rifiuta('file_incoerente');
  end if;
  v_conta := interno.ripristina_fino_a_8(p_famiglia, jsonb_set(d, '{file,versione_schema}', '8'), p_utente);

  for v_r in select * from jsonb_array_elements(v_tabelle -> 'pasto_fisso') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    if v_r ->> 'ricetta_id' is not null and not exists (
        select 1 from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id')) then
      continue;
    end if;
    insert into public.pasto_fisso (id, famiglia_id, categoria, ricetta_id, testo, porzioni, ordine, dal, al)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia,
        case when v_r ->> 'categoria' in ('colazione', 'spuntino', 'pranzo', 'merenda', 'cena') then v_r ->> 'categoria'
             else interno.nuovo_id(p_famiglia, v_r ->> 'categoria')::text end,
        case when v_r ->> 'ricetta_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') end,
        v_r ->> 'testo', (v_r ->> 'porzioni')::numeric, coalesce((v_r ->> 'ordine')::numeric, 0), (v_r ->> 'dal')::date, (v_r ->> 'al')::date);
  end loop;
  update public.portata p set fisso_id = f.id
    from jsonb_array_elements(v_tabelle -> 'portata') x(e)
    join public.pasto_fisso f on f.id = interno.nuovo_id(p_famiglia, x.e ->> 'fisso_id')
   where x.e ->> 'fisso_id' is not null and p.id = interno.nuovo_id(p_famiglia, x.e ->> 'id');
  return v_conta;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
