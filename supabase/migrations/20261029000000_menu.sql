-- Mastercook 2.0 · Fase 3: menu della settimana.
--
-- Il menu è un'intenzione: aggiungere, cambiare, spostare o togliere portate non tocca mai la casa
-- (nessuna di queste funzioni scrive lotti o movimenti) e non tocca la spesa già fatta.
--
-- - portata: un piatto previsto in un giorno e in un pasto (colazione, pranzo, cena… o una categoria
--   della famiglia). Più portate per pasto; ognuna è una riga a sé, così due persone che aggiungono
--   piatti diversi alla stessa cena li ritrovano entrambi.
-- - porzioni NULL = automatiche: si calcolano da chi mangia (porzione di ogni persona, tolti i
--   «non mangia»). Un numero scritto da qualcuno resta quello.
-- - eccezione_membro: per una portata, una persona «non mangia» o mangia un'alternativa. Una sola
--   per persona e portata.
-- - gusto: cosa piace o non piace a una persona (ingrediente o ricetta). Dichiarato, mai dedotto.
-- - categoria_pasto: quali pasti la famiglia usa. Colazione, pranzo e cena sono attivi finché nessuno
--   li spegne; spuntino e merenda si accendono; la famiglia può aggiungerne di suoi.

-- ───────────────────────── Categorie di pasto ─────────────────────────

create table public.categoria_pasto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  -- Per le categorie standard; NULL per quelle create dalla famiglia, che hanno un nome.
  chiave text check (chiave in ('colazione', 'spuntino', 'pranzo', 'merenda', 'cena')),
  nome text check (nome is null or char_length(btrim(nome)) between 1 and 40),
  emoji text check (emoji is null or char_length(emoji) <= 16),
  ordine numeric not null default 99,
  attiva boolean not null default true,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check ((chiave is null) = (nome is not null))
);
create unique index categoria_pasto_chiave on public.categoria_pasto (famiglia_id, chiave) where chiave is not null;
create index categoria_pasto_seq on public.categoria_pasto (famiglia_id, seq);

-- ───────────────────────── Portate ─────────────────────────

create table public.portata (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  data date not null,
  -- Una chiave standard (colazione, pranzo…) o l'id di una categoria della famiglia.
  categoria text not null check (char_length(categoria) between 1 and 40),
  ricetta_id text references public.ricetta (id),
  testo text check (testo is null or char_length(btrim(testo)) between 1 and 120),
  porzioni numeric(5, 2) check (porzioni is null or porzioni > 0 and porzioni <= 100),
  origine text not null default 'manuale' check (origine in ('manuale', 'automatica', 'ripetuta')),
  -- Una portata bloccata non viene mai cambiata dalla pianificazione automatica (Fase 6).
  bloccata boolean not null default false,
  ordine numeric not null default 0,
  note text check (note is null or char_length(note) <= 500),
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
create index portata_giorni on public.portata (famiglia_id, data) where eliminato_il is null;
create index portata_seq on public.portata (famiglia_id, seq);
create index portata_ricetta on public.portata (ricetta_id) where eliminato_il is null;

create table public.eccezione_membro (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  portata_id uuid not null references public.portata (id) on delete cascade,
  membro_id uuid not null references public.membro (id) on delete cascade,
  tipo text not null check (tipo in ('non_mangia', 'alternativa')),
  ricetta_id text references public.ricetta (id),
  testo text check (testo is null or char_length(btrim(testo)) between 1 and 120),
  porzioni numeric(5, 2) check (porzioni is null or porzioni > 0 and porzioni <= 100),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  constraint eccezione_coerente check (case tipo
    when 'non_mangia' then ricetta_id is null and testo is null and porzioni is null
    else (ricetta_id is null) <> (testo is null) end)
);
create unique index eccezione_unica on public.eccezione_membro (portata_id, membro_id) where eliminato_il is null;
create index eccezione_seq on public.eccezione_membro (famiglia_id, seq);

create table public.gusto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  membro_id uuid not null references public.membro (id) on delete cascade,
  ingrediente_id text references public.ingrediente (id),
  ricetta_id text references public.ricetta (id),
  valore text not null check (valore in ('piace', 'non_piace')),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check ((ingrediente_id is null) <> (ricetta_id is null))
);
create unique index gusto_unico on public.gusto (membro_id, coalesce(ingrediente_id, ricetta_id)) where eliminato_il is null;
create index gusto_seq on public.gusto (famiglia_id, seq);

create trigger timbra before insert or update on public.categoria_pasto for each row execute function interno.timbra();
create trigger timbra before insert or update on public.portata for each row execute function interno.timbra();
create trigger timbra before insert or update on public.eccezione_membro for each row execute function interno.timbra();
create trigger timbra before insert or update on public.gusto for each row execute function interno.timbra();

-- ───────────────────────── Coerenza tra famiglie ─────────────────────────
-- Ricette, persone e categorie citate devono essere della stessa famiglia (o del catalogo di sistema).

create function interno.controlla_riferimenti() returns trigger
language plpgsql as $$
declare
  v jsonb := to_jsonb(new);
begin
  if v ? 'ricetta_id' and v ->> 'ricetta_id' is not null and not exists (
      select 1 from public.ricetta r where r.id = v ->> 'ricetta_id' and (r.famiglia_id is null or r.famiglia_id = new.famiglia_id)
        and r.eliminato_il is null) then
    perform interno.rifiuta('ricetta_non_trovata');
  end if;
  if v ? 'ingrediente_id' and v ->> 'ingrediente_id' is not null and not exists (
      select 1 from public.ingrediente i where i.id = v ->> 'ingrediente_id' and (i.famiglia_id is null or i.famiglia_id = new.famiglia_id)) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  if v ? 'membro_id' and not exists (
      select 1 from public.membro m where m.id = (v ->> 'membro_id')::uuid and m.famiglia_id = new.famiglia_id and m.eliminato_il is null) then
    perform interno.rifiuta('membro_non_trovato');
  end if;
  if v ? 'portata_id' and not exists (
      select 1 from public.portata p where p.id = (v ->> 'portata_id')::uuid and p.famiglia_id = new.famiglia_id) then
    perform interno.rifiuta('portata_non_trovata');
  end if;
  if v ? 'categoria' and v ->> 'categoria' not in ('colazione', 'spuntino', 'pranzo', 'merenda', 'cena')
     and not exists (select 1 from public.categoria_pasto c where c.id::text = v ->> 'categoria'
                     and c.famiglia_id = new.famiglia_id and c.chiave is null and c.eliminato_il is null) then
    perform interno.rifiuta('categoria_non_trovata');
  end if;
  return new;
end $$;

create trigger controlla_riferimenti before insert or update of ricetta_id, categoria on public.portata
  for each row execute function interno.controlla_riferimenti();
create trigger controlla_riferimenti before insert or update of ricetta_id, membro_id, portata_id on public.eccezione_membro
  for each row execute function interno.controlla_riferimenti();
create trigger controlla_riferimenti before insert or update of ricetta_id, ingrediente_id, membro_id on public.gusto
  for each row execute function interno.controlla_riferimenti();

-- ───────────────────────── Accesso ─────────────────────────

alter table public.categoria_pasto enable row level security;
alter table public.portata enable row level security;
alter table public.eccezione_membro enable row level security;
alter table public.gusto enable row level security;

create policy lettura on public.categoria_pasto for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.portata for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.eccezione_membro for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.gusto for select to authenticated using (interno.sono_membro(famiglia_id));

revoke all on public.categoria_pasto, public.portata, public.eccezione_membro, public.gusto from anon, authenticated;
grant select on public.categoria_pasto, public.portata, public.eccezione_membro, public.gusto to authenticated;

-- ───────────────────────── Comandi: categorie ─────────────────────────

-- Accende o spegne una categoria standard.
create function interno.cmd_imposta_categoria(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if d ->> 'chiave' is null or (d ->> 'attiva') is null then
    perform interno.rifiuta('dati_non_validi');
  end if;
  insert into public.categoria_pasto (id, famiglia_id, chiave, attiva, ordine)
    values (interno.nuovo_id(p_famiglia, 'categoria:' || (d ->> 'chiave')), p_famiglia, d ->> 'chiave', (d ->> 'attiva')::boolean,
            array_position(array['colazione', 'spuntino', 'pranzo', 'merenda', 'cena'], d ->> 'chiave'))
    on conflict (famiglia_id, chiave) where chiave is not null
    do update set attiva = excluded.attiva, eliminato_il = null;
  return '{}'::jsonb;
end $$;

create function interno.cmd_crea_categoria(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  insert into public.categoria_pasto (id, famiglia_id, nome, emoji, ordine)
    values ((d ->> 'id')::uuid, p_famiglia, btrim(d ->> 'nome'), d ->> 'emoji', coalesce((d ->> 'ordine')::numeric, 99));
  return '{}'::jsonb;
end $$;

create function interno.cmd_modifica_categoria(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if exists (select 1 from public.categoria_pasto where id = (d ->> 'id')::uuid and chiave is not null) then
    perform interno.rifiuta('categoria_standard');
  end if;
  return interno.aggiorna_campi('categoria_pasto', (d ->> 'id')::uuid, p_famiglia, (d ->> 'versione_attesa')::integer,
    d -> 'campi', array['nome', 'emoji', 'ordine', 'attiva']);
end $$;

-- ───────────────────────── Comandi: portate ─────────────────────────

create function interno.cmd_aggiungi_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  -- Dall'app arrivano solo portate scelte a mano; quelle automatiche nascono dal generatore (Fase 6).
  if coalesce(d ->> 'origine', 'manuale') <> 'manuale' then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, note)
    values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'data')::date, d ->> 'categoria', d ->> 'ricetta_id',
            nullif(btrim(d ->> 'testo'), ''), (d ->> 'porzioni')::numeric, 'manuale', coalesce((d ->> 'ordine')::numeric, 0),
            nullif(btrim(d ->> 'note'), ''));
  return '{}'::jsonb;
end $$;

-- Cambia ricetta, porzioni, giorno o pasto (spostare = cambiare data/categoria: stesso id, stesse eccezioni).
create function interno.cmd_modifica_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  return interno.aggiorna_campi('portata', (d ->> 'id')::uuid, p_famiglia, (d ->> 'versione_attesa')::integer, d -> 'campi',
    array['data', 'categoria', 'ricetta_id', 'testo', 'porzioni', 'bloccata', 'ordine', 'note']);
end $$;

create function interno.cmd_rimuovi_portata(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  update public.portata set eliminato_il = now()
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if not found and not exists (select 1 from public.portata where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia) then
    perform interno.rifiuta('non_trovato');
  end if;
  update public.eccezione_membro set eliminato_il = now()
   where portata_id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  return '{}'::jsonb;
end $$;

-- Copia le portate indicate (di solito una settimana) in altri giorni, con nuovi id scelti dal
-- dispositivo. Si copia com'è ora sul server; una portata tolta nel frattempo si salta.
--   { portate: [{da, id, data, categoria?}], eccezioni: [{da, id, portata_id}] }
create function interno.cmd_ripeti_portate(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_x jsonb;
  v_copiate integer := 0;
  v_saltate integer := 0;
begin
  if jsonb_array_length(coalesce(d -> 'portate', '[]')) = 0 or jsonb_array_length(d -> 'portate') > 200 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  for v_x in select * from jsonb_array_elements(d -> 'portate') loop
    insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, ordine, note)
      select (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'data')::date, coalesce(v_x ->> 'categoria', p.categoria), p.ricetta_id,
             p.testo, p.porzioni, 'ripetuta', p.ordine, p.note
        from public.portata p
       where p.id = (v_x ->> 'da')::uuid and p.famiglia_id = p_famiglia and p.eliminato_il is null
         and (p.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = p.ricetta_id and r.eliminato_il is null));
    if found then v_copiate := v_copiate + 1; else v_saltate := v_saltate + 1; end if;
  end loop;
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'eccezioni', '[]')) loop
    insert into public.eccezione_membro (id, famiglia_id, portata_id, membro_id, tipo, ricetta_id, testo, porzioni)
      select (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'portata_id')::uuid, e.membro_id, e.tipo, e.ricetta_id, e.testo, e.porzioni
        from public.eccezione_membro e
        join public.membro m on m.id = e.membro_id and m.eliminato_il is null
       where e.id = (v_x ->> 'da')::uuid and e.famiglia_id = p_famiglia and e.eliminato_il is null
         and exists (select 1 from public.portata p where p.id = (v_x ->> 'portata_id')::uuid and p.famiglia_id = p_famiglia)
         and (e.ricetta_id is null or exists (select 1 from public.ricetta r where r.id = e.ricetta_id and r.eliminato_il is null));
  end loop;
  return jsonb_build_object('copiate', v_copiate, 'saltate', v_saltate);
end $$;

-- ───────────────────────── Comandi: eccezioni e gusti ─────────────────────────
-- Una per persona e portata (o per persona e alimento). Chi la imposta senza sapere che un altro
-- ne ha appena scelta una diversa riceve un conflitto: nessuna scelta si perde in silenzio.

create function interno.cmd_imposta_eccezione(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_attuale public.eccezione_membro;
  v_nuova jsonb := jsonb_build_object('tipo', d ->> 'tipo', 'ricetta_id', d ->> 'ricetta_id',
    'testo', nullif(btrim(d ->> 'testo'), ''), 'porzioni', (d ->> 'porzioni')::numeric);
begin
  select * into v_attuale from public.eccezione_membro
   where portata_id = (d ->> 'portata_id')::uuid and membro_id = (d ->> 'membro_id')::uuid and eliminato_il is null
     and famiglia_id = p_famiglia for update;
  if v_attuale.id is null then
    insert into public.eccezione_membro (id, famiglia_id, portata_id, membro_id, tipo, ricetta_id, testo, porzioni)
      values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'portata_id')::uuid, (d ->> 'membro_id')::uuid, v_nuova ->> 'tipo',
              v_nuova ->> 'ricetta_id', v_nuova ->> 'testo', (v_nuova ->> 'porzioni')::numeric);
    return '{}'::jsonb;
  end if;
  if (to_jsonb(v_attuale) - array['id', 'famiglia_id', 'portata_id', 'membro_id', 'versione', 'versioni_campi', 'creato_il',
      'creato_da', 'modificato_il', 'modificato_da', 'eliminato_il', 'seq']) = v_nuova then
    return jsonb_build_object('gia_presente', v_attuale.id);
  end if;
  if (d ->> 'versione_attesa')::integer is distinct from v_attuale.versione then
    perform interno.conflitto(jsonb_build_object('motivo', 'eccezione_cambiata', 'valore_attuale', to_jsonb(v_attuale),
      'modificato_da', v_attuale.modificato_da));
  end if;
  update public.eccezione_membro set tipo = v_nuova ->> 'tipo', ricetta_id = v_nuova ->> 'ricetta_id',
      testo = v_nuova ->> 'testo', porzioni = (v_nuova ->> 'porzioni')::numeric
   where id = v_attuale.id;
  return '{}'::jsonb;
end $$;

create function interno.cmd_rimuovi_eccezione(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  update public.eccezione_membro set eliminato_il = now()
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  return '{}'::jsonb;
end $$;

create function interno.cmd_imposta_gusto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_attuale public.gusto;
begin
  select * into v_attuale from public.gusto
   where membro_id = (d ->> 'membro_id')::uuid and coalesce(ingrediente_id, ricetta_id) = coalesce(d ->> 'ingrediente_id', d ->> 'ricetta_id')
     and eliminato_il is null and famiglia_id = p_famiglia for update;
  if v_attuale.id is null then
    insert into public.gusto (id, famiglia_id, membro_id, ingrediente_id, ricetta_id, valore)
      values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'membro_id')::uuid, d ->> 'ingrediente_id', d ->> 'ricetta_id', d ->> 'valore');
  elsif v_attuale.valore <> d ->> 'valore' then
    if (d ->> 'versione_attesa')::integer is distinct from v_attuale.versione then
      perform interno.conflitto(jsonb_build_object('motivo', 'gusto_cambiato', 'valore_attuale', v_attuale.valore,
        'modificato_da', v_attuale.modificato_da));
    end if;
    update public.gusto set valore = d ->> 'valore' where id = v_attuale.id;
  end if;
  return '{}'::jsonb;
end $$;

create function interno.cmd_rimuovi_gusto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  update public.gusto set eliminato_il = now()
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  return '{}'::jsonb;
end $$;

-- ───────────────────────── Ricette nel menu ─────────────────────────
-- Una ricetta che compare nel menu non si cancella: si archivia (resta leggibile nei giorni passati).

create or replace function interno.cmd_elimina_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  perform interno.valida_ricetta_famiglia(p_famiglia, d ->> 'id');
  if exists (select 1 from public.portata where ricetta_id = d ->> 'id' and eliminato_il is null)
     or exists (select 1 from public.eccezione_membro where ricetta_id = d ->> 'id' and eliminato_il is null) then
    perform interno.rifiuta('ricetta_nel_menu');
  end if;
  update public.ricetta set eliminato_il = now() where id = d ->> 'id' and eliminato_il is null;
  return '{}'::jsonb;
end $$;

-- Una persona tolta dalla famiglia esce anche da eccezioni e gusti (le portate restano).
create function interno.togli_membro_dal_menu() returns trigger
language plpgsql as $$
begin
  if new.eliminato_il is not null and old.eliminato_il is null then
    update public.eccezione_membro set eliminato_il = now() where membro_id = new.id and eliminato_il is null;
    update public.gusto set eliminato_il = now() where membro_id = new.id and eliminato_il is null;
  end if;
  return new;
end $$;
create trigger togli_dal_menu after update of eliminato_il on public.membro
  for each row execute function interno.togli_membro_dal_menu();

insert into interno.tipo_comando (tipo, funzione) values
  ('imposta_categoria', 'cmd_imposta_categoria'),
  ('crea_categoria', 'cmd_crea_categoria'),
  ('modifica_categoria', 'cmd_modifica_categoria'),
  ('aggiungi_portata', 'cmd_aggiungi_portata'),
  ('modifica_portata', 'cmd_modifica_portata'),
  ('rimuovi_portata', 'cmd_rimuovi_portata'),
  ('ripeti_portate', 'cmd_ripeti_portate'),
  ('imposta_eccezione', 'cmd_imposta_eccezione'),
  ('rimuovi_eccezione', 'cmd_rimuovi_eccezione'),
  ('imposta_gusto', 'cmd_imposta_gusto'),
  ('rimuovi_gusto', 'cmd_rimuovi_gusto');

-- ───────────────────────── Scaricare le modifiche ─────────────────────────

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

-- ───────────────────────── Ripristino: file della versione 3 (con il menu) ─────────────────────────

create or replace function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_famiglia jsonb := v_tabelle -> 'famiglia' -> 0;
  v_versione integer;
  v_vecchia_famiglia uuid;
  v_r jsonb;
  v_conta jsonb := '{}'::jsonb;
  v_n integer;
  v_mio_membro uuid;
  v_tabella text;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' then
    perform interno.rifiuta('file_non_riconosciuto');
  end if;
  v_versione := (v_file ->> 'versione_schema')::integer;
  if v_versione is null or v_versione not in (1, 2, 3) then
    perform interno.rifiuta('versione_file_non_supportata', jsonb_build_object('versione', v_file -> 'versione_schema'));
  end if;
  if v_famiglia is null or coalesce(jsonb_typeof(v_tabelle -> 'membro'), '') <> 'array' then
    perform interno.rifiuta('file_incompleto');
  end if;
  if v_versione >= 2 then
    foreach v_tabella in array array['ingrediente', 'ricetta', 'ricetta_ingrediente', 'ricetta_passo', 'lotto', 'movimento'] loop
      if coalesce(jsonb_typeof(v_tabelle -> v_tabella), '') <> 'array' then
        perform interno.rifiuta('file_incompleto');
      end if;
    end loop;
  end if;
  if v_versione >= 3 then
    foreach v_tabella in array array['categoria_pasto', 'portata', 'eccezione_membro', 'gusto'] loop
      if coalesce(jsonb_typeof(v_tabelle -> v_tabella), '') <> 'array' then
        perform interno.rifiuta('file_incompleto');
      end if;
    end loop;
  end if;
  if exists (select 1 from public.famiglia where id = p_famiglia) then
    perform interno.rifiuta('famiglia_esistente');
  end if;
  v_vecchia_famiglia := (v_famiglia ->> 'id')::uuid;

  -- Ogni riga deve appartenere alla famiglia del file.
  foreach v_tabella in array array['membro', 'vincolo_alimentare', 'ingrediente', 'ricetta', 'ricetta_ingrediente',
      'ricetta_passo', 'lotto', 'movimento', 'categoria_pasto', 'portata', 'eccezione_membro', 'gusto'] loop
    if exists (select 1 from jsonb_array_elements(coalesce(v_tabelle -> v_tabella, '[]')) e
               where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia_famiglia) then
      perform interno.rifiuta('file_incoerente');
    end if;
  end loop;

  insert into public.famiglia (id, nome, impostazioni)
    values (p_famiglia, coalesce(d ->> 'nome', v_famiglia ->> 'nome'), coalesce(v_famiglia -> 'impostazioni', '{}'::jsonb));
  insert into public.utente_famiglia (id, famiglia_id, utente_id, ruolo)
    values (gen_random_uuid(), p_famiglia, p_utente, 'amministratore');

  -- Persone e vincoli.
  v_n := 0;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'membro') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.membro (id, famiglia_id, nome, emoji, porzione, note, archiviato, utente_id)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'nome', v_r ->> 'emoji',
              (v_r ->> 'porzione')::numeric, v_r ->> 'note', coalesce((v_r ->> 'archiviato')::boolean, false),
              case when (v_r ->> 'utente_id')::uuid = p_utente then p_utente end);
    v_n := v_n + 1;
  end loop;
  v_conta := v_conta || jsonb_build_object('membri', v_n);

  v_n := 0;
  for v_r in select * from jsonb_array_elements(coalesce(v_tabelle -> 'vincolo_alimentare', '[]'::jsonb)) loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.vincolo_alimentare (id, famiglia_id, membro_id, tipo, oggetto, severita, fonte, testo)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.nuovo_id(p_famiglia, v_r ->> 'membro_id'),
              v_r ->> 'tipo', v_r ->> 'oggetto', v_r ->> 'severita', v_r ->> 'fonte', v_r ->> 'testo');
    v_n := v_n + 1;
  end loop;
  v_conta := v_conta || jsonb_build_object('vincoli', v_n);

  if v_versione >= 2 then
    -- Ingredienti della famiglia: prima le righe, poi i genitori (possono stare in qualsiasi ordine).
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ingrediente') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.ingrediente (id, famiglia_id, nome, sinonimi, reparto, sottocategoria, dimensione, luogo, giorni,
          allergeni, allergeni_noti, classi, emoji)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id')::text, p_famiglia, v_r ->> 'nome',
          coalesce(array(select jsonb_array_elements_text(v_r -> 'sinonimi')), '{}'), v_r ->> 'reparto', v_r ->> 'sottocategoria',
          v_r ->> 'dimensione', v_r ->> 'luogo', (v_r ->> 'giorni')::integer,
          coalesce(array(select jsonb_array_elements_text(v_r -> 'allergeni')), '{}'), (v_r ->> 'allergeni_noti')::boolean,
          coalesce(array(select jsonb_array_elements_text(v_r -> 'classi')), '{}'), v_r ->> 'emoji');
      v_n := v_n + 1;
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ingrediente') loop
      if v_r ->> 'eliminato_il' is not null or v_r ->> 'genitore' is null then continue; end if;
      update public.ingrediente set genitore = interno.id_ripristinato(p_famiglia, v_r ->> 'genitore')
       where id = interno.nuovo_id(p_famiglia, v_r ->> 'id')::text;
    end loop;
    v_conta := v_conta || jsonb_build_object('ingredienti', v_n);

    -- Ricette, poi le «derivate da», poi righe e passaggi.
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.ricetta (id, famiglia_id, titolo, descrizione, categoria, cucina, provenienza, porzioni,
          minuti_preparazione, minuti_cottura, minuti_totali, difficolta, conservazione, mesi, allergeni_dichiarati, archiviata)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id')::text, p_famiglia, x.titolo, x.descrizione, x.categoria, x.cucina,
          x.provenienza, x.porzioni, x.minuti_preparazione, x.minuti_cottura, x.minuti_totali, x.difficolta, x.conservazione,
          x.mesi, coalesce(x.allergeni_dichiarati, '{}'), coalesce(x.archiviata, false)
        from jsonb_populate_record(null::public.ricetta, v_r) x;
      v_n := v_n + 1;
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta') loop
      if v_r ->> 'eliminato_il' is not null or v_r ->> 'derivata_da' is null then continue; end if;
      update public.ricetta r set derivata_da = interno.id_ripristinato(p_famiglia, v_r ->> 'derivata_da')
       where r.id = interno.nuovo_id(p_famiglia, v_r ->> 'id')::text
         and exists (select 1 from public.ricetta o where o.id = interno.id_ripristinato(p_famiglia, v_r ->> 'derivata_da'));
    end loop;
    v_conta := v_conta || jsonb_build_object('ricette', v_n);

    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta_ingrediente') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      -- Le righe di una ricetta cancellata (assente dal file) si saltano.
      insert into public.ricetta_ingrediente (id, famiglia_id, ricetta_id, ingrediente_id, quantita, unita, qb, opzionale, testo, ordine)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, r.id,
          interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'), (v_r ->> 'quantita')::numeric, v_r ->> 'unita',
          (v_r ->> 'qb')::boolean, (v_r ->> 'opzionale')::boolean, v_r ->> 'testo', (v_r ->> 'ordine')::integer
        from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') and r.famiglia_id = p_famiglia;
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'ricetta_passo') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.ricetta_passo (id, famiglia_id, ricetta_id, ordine, testo)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, r.id, (v_r ->> 'ordine')::integer, v_r ->> 'testo'
        from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') and r.famiglia_id = p_famiglia;
    end loop;

    -- Casa: lotti vuoti, poi i movimenti in ordine; la quantità torna da sola.
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'lotto') loop
      insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
          fonte_data, calcolata_il, affidabilita, origine, note)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'),
          v_r ->> 'nome', v_r ->> 'unita', v_r ->> 'luogo', (v_r ->> 'data_acquisto')::date, (v_r ->> 'data_limite')::date,
          v_r ->> 'tipo_data', v_r ->> 'fonte_data', (v_r ->> 'calcolata_il')::timestamptz, v_r ->> 'affidabilita',
          v_r ->> 'origine', v_r ->> 'note');
      v_n := v_n + 1;
    end loop;
    v_conta := v_conta || jsonb_build_object('lotti', v_n);
    v_n := 0;
    for v_r in select e from jsonb_array_elements(v_tabelle -> 'movimento') e order by (e ->> 'seq')::bigint loop
      insert into public.movimento (id, famiglia_id, lotto_id, variazione, causale, comando_id, nota)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, interno.nuovo_id(p_famiglia, v_r ->> 'lotto_id'),
          (v_r ->> 'variazione')::numeric, v_r ->> 'causale', interno.nuovo_id(p_famiglia, 'comando:' || (v_r ->> 'comando_id')),
          v_r ->> 'nota');
      v_n := v_n + 1;
    end loop;
    v_conta := v_conta || jsonb_build_object('movimenti', v_n);
  end if;

  if v_versione >= 3 then
    -- Menu: categorie, portate (anche quelle di ricette che non ci sono più si saltano), eccezioni, gusti.
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'categoria_pasto') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.categoria_pasto (id, famiglia_id, chiave, nome, emoji, ordine, attiva)
        values (interno.nuovo_id(p_famiglia, case when v_r ->> 'chiave' is not null then 'categoria:' || (v_r ->> 'chiave') else v_r ->> 'id' end),
          p_famiglia, v_r ->> 'chiave', v_r ->> 'nome', v_r ->> 'emoji',
          coalesce((v_r ->> 'ordine')::numeric, 99), coalesce((v_r ->> 'attiva')::boolean, true));
    end loop;
    v_n := 0;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'portata') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      if v_r ->> 'ricetta_id' is not null and not exists (
          select 1 from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id')) then
        continue;
      end if;
      insert into public.portata (id, famiglia_id, data, categoria, ricetta_id, testo, porzioni, origine, bloccata, ordine, note)
        values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, (v_r ->> 'data')::date,
          case when v_r ->> 'categoria' in ('colazione', 'spuntino', 'pranzo', 'merenda', 'cena') then v_r ->> 'categoria'
               else interno.nuovo_id(p_famiglia, v_r ->> 'categoria')::text end,
          case when v_r ->> 'ricetta_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') end,
          v_r ->> 'testo', (v_r ->> 'porzioni')::numeric, v_r ->> 'origine', coalesce((v_r ->> 'bloccata')::boolean, false),
          coalesce((v_r ->> 'ordine')::numeric, 0), v_r ->> 'note');
      v_n := v_n + 1;
    end loop;
    v_conta := v_conta || jsonb_build_object('portate', v_n);
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'eccezione_membro') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.eccezione_membro (id, famiglia_id, portata_id, membro_id, tipo, ricetta_id, testo, porzioni)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, p.id, m.id, v_r ->> 'tipo',
          case when v_r ->> 'ricetta_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') end,
          v_r ->> 'testo', (v_r ->> 'porzioni')::numeric
        from public.portata p, public.membro m
        where p.id = interno.nuovo_id(p_famiglia, v_r ->> 'portata_id') and m.id = interno.nuovo_id(p_famiglia, v_r ->> 'membro_id')
          and (v_r ->> 'ricetta_id' is null or exists (
            select 1 from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id')));
    end loop;
    for v_r in select * from jsonb_array_elements(v_tabelle -> 'gusto') loop
      if v_r ->> 'eliminato_il' is not null then continue; end if;
      insert into public.gusto (id, famiglia_id, membro_id, ingrediente_id, ricetta_id, valore)
        select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, m.id,
          case when v_r ->> 'ingrediente_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id') end,
          case when v_r ->> 'ricetta_id' is not null then interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id') end,
          v_r ->> 'valore'
        from public.membro m
        where m.id = interno.nuovo_id(p_famiglia, v_r ->> 'membro_id')
          and (v_r ->> 'ingrediente_id' is null or exists (
            select 1 from public.ingrediente i where i.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id')))
          and (v_r ->> 'ricetta_id' is null or exists (
            select 1 from public.ricetta r where r.id = interno.id_ripristinato(p_famiglia, v_r ->> 'ricetta_id')));
    end loop;
  end if;

  select id into v_mio_membro from public.membro where famiglia_id = p_famiglia and utente_id = p_utente;
  if v_mio_membro is null then
    insert into public.membro (id, famiglia_id, nome, utente_id)
      values (interno.nuovo_id(p_famiglia, 'utente:' || p_utente::text), p_famiglia, coalesce(d ->> 'nome_utente', 'Io'), p_utente);
  end if;

  return v_conta;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
