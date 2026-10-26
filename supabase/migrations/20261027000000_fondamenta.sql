-- Mastercook 2.0 · migrazione 1: famiglia, persone, vincoli, inviti, comandi.
--
-- Regole generali (docs/fase-0/03 e 04):
-- - Le tabelle si leggono con le regole per riga (RLS) e non si scrivono mai direttamente:
--   ogni modifica passa da public.applica_comando o public.entra_con_invito.
-- - Ogni comando ha un id scelto dal dispositivo: applicarlo di nuovo restituisce l'esito già registrato.
-- - Le scritture di una famiglia sono serializzate da un lock: così il contatore `seq`
--   cresce nell'ordine in cui le transazioni si concludono e chi scarica non salta righe.

create schema if not exists interno;
revoke all on schema interno from public;

create sequence interno.seq_modifiche;

-- ───────────────────────── Tabelle ─────────────────────────

create table public.famiglia (
  id uuid primary key,
  famiglia_id uuid generated always as (id) stored,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  impostazioni jsonb not null default '{}'::jsonb check (jsonb_typeof(impostazioni) = 'object'),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);

create table public.utente_famiglia (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  utente_id uuid not null references auth.users (id) on delete cascade,
  ruolo text not null check (ruolo in ('amministratore', 'membro')),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create unique index utente_famiglia_attivo on public.utente_famiglia (famiglia_id, utente_id) where eliminato_il is null;
create index utente_famiglia_utente on public.utente_famiglia (utente_id) where eliminato_il is null;

create table public.membro (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  emoji text check (emoji is null or char_length(emoji) <= 16),
  -- Moltiplicatore della porzione: 1 = adulto, 0,6 = bambino.
  porzione numeric(4, 2) not null default 1 check (porzione > 0 and porzione <= 3),
  note text check (note is null or char_length(note) <= 1000),
  utente_id uuid references auth.users (id) on delete set null,
  archiviato boolean not null default false,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create unique index membro_utente on public.membro (famiglia_id, utente_id)
  where utente_id is not null and eliminato_il is null;

create table public.vincolo_alimentare (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  membro_id uuid not null references public.membro (id) on delete cascade,
  tipo text not null check (tipo in ('allergia', 'intolleranza', 'esigenza', 'indicazione_medica')),
  -- Codice dell'oggetto: allergene UE (`all:glutine`), ingrediente (`ing:latte`), classe (`cls:carne`).
  oggetto text not null check (oggetto ~ '^(all|ing|cls|txt):[a-z0-9_]{1,60}$'),
  severita text not null default 'evitare' check (severita in ('evitare', 'evitare_anche_tracce')),
  fonte text not null default 'dichiarato' check (fonte in ('dichiarato', 'medico', 'dietista')),
  testo text check (testo is null or char_length(testo) <= 2000),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create unique index vincolo_unico on public.vincolo_alimentare (membro_id, tipo, oggetto) where eliminato_il is null;

create table public.invito (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  codice text not null unique,
  scade_il timestamptz not null,
  usi_massimi integer not null check (usi_massimi between 1 and 20),
  usi integer not null default 0 check (usi >= 0 and usi <= usi_massimi),
  revocato boolean not null default false,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);

-- Registro dei comandi: protezione dai doppioni e cronologia leggibile.
create table public.comando (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  tipo text not null,
  dati jsonb not null,
  autore uuid not null,
  dispositivo text,
  versione_app integer not null,
  ricevuto_il timestamptz not null default now(),
  esito text not null check (esito in ('applicato', 'conflitto', 'rifiutato')),
  dettaglio jsonb not null default '{}'::jsonb,
  seq bigint not null default 0
);
create index comando_famiglia_seq on public.comando (famiglia_id, seq);

-- Versione minima dell'app che può scrivere (una sola riga).
create table public.compatibilita (
  id boolean primary key default true check (id),
  versione_minima_app integer not null
);
insert into public.compatibilita (versione_minima_app) values (1);

create index famiglia_seq on public.famiglia (famiglia_id, seq);
create index utente_famiglia_seq on public.utente_famiglia (famiglia_id, seq);
create index membro_seq on public.membro (famiglia_id, seq);
create index vincolo_seq on public.vincolo_alimentare (famiglia_id, seq);
create index invito_seq on public.invito (famiglia_id, seq);

-- ───────────────────────── Timbri automatici ─────────────────────────

create function interno.timbra() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('interno.seq_modifiche');
  new.modificato_il := now();
  new.modificato_da := coalesce(auth.uid(), new.modificato_da);
  if tg_op = 'INSERT' then
    new.versione := 1;
    new.creato_il := now();
    new.creato_da := coalesce(auth.uid(), new.creato_da);
  else
    new.versione := old.versione + 1;
    new.creato_il := old.creato_il;
    new.creato_da := old.creato_da;
  end if;
  return new;
end $$;

create function interno.timbra_comando() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('interno.seq_modifiche');
  return new;
end $$;

create trigger timbra before insert or update on public.famiglia for each row execute function interno.timbra();
create trigger timbra before insert or update on public.utente_famiglia for each row execute function interno.timbra();
create trigger timbra before insert or update on public.membro for each row execute function interno.timbra();
create trigger timbra before insert or update on public.vincolo_alimentare for each row execute function interno.timbra();
create trigger timbra before insert or update on public.invito for each row execute function interno.timbra();
create trigger timbra before insert on public.comando for each row execute function interno.timbra_comando();

-- ───────────────────────── Accesso ─────────────────────────

create function interno.ruolo_in(p_famiglia uuid, p_utente uuid) returns text
language sql stable security definer set search_path = '' as $$
  select uf.ruolo from public.utente_famiglia uf
  where uf.famiglia_id = p_famiglia and uf.utente_id = p_utente and uf.eliminato_il is null
$$;

create function interno.sono_membro(p_famiglia uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select interno.ruolo_in(p_famiglia, auth.uid()) is not null
$$;

create function interno.sono_amministratore(p_famiglia uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select interno.ruolo_in(p_famiglia, auth.uid()) = 'amministratore'
$$;

alter table public.famiglia enable row level security;
alter table public.utente_famiglia enable row level security;
alter table public.membro enable row level security;
alter table public.vincolo_alimentare enable row level security;
alter table public.invito enable row level security;
alter table public.comando enable row level security;
alter table public.compatibilita enable row level security;

create policy lettura on public.famiglia for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.utente_famiglia for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.membro for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.vincolo_alimentare for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.invito for select to authenticated using (interno.sono_amministratore(famiglia_id));
create policy lettura on public.comando for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.compatibilita for select to anon, authenticated using (true);

revoke all on public.famiglia, public.utente_famiglia, public.membro, public.vincolo_alimentare,
  public.invito, public.comando, public.compatibilita from anon, authenticated;
grant select on public.famiglia, public.utente_famiglia, public.membro, public.vincolo_alimentare,
  public.invito, public.comando to authenticated;
grant select on public.compatibilita to anon, authenticated;

-- ───────────────────────── Esiti ─────────────────────────
-- Un comando di dominio che non si può applicare solleva un'eccezione con codice:
--   MC409 conflitto (qualcun altro ha cambiato la stessa cosa), MC422 rifiutato (dati o stato non validi).
-- Il dettaglio è un JSON. applica_comando annulla le scritture parziali e registra l'esito.

create function interno.conflitto(p_dettaglio jsonb) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'MC409', message = 'conflitto', detail = p_dettaglio::text;
end $$;

create function interno.rifiuta(p_motivo text, p_extra jsonb default '{}'::jsonb) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'MC422', message = p_motivo,
    detail = (jsonb_build_object('motivo', p_motivo) || p_extra)::text;
end $$;

create function interno.richiedi_amministratore(p_famiglia uuid, p_utente uuid) returns void
language plpgsql as $$
begin
  if interno.ruolo_in(p_famiglia, p_utente) is distinct from 'amministratore' then
    perform interno.rifiuta('solo_amministratore');
  end if;
end $$;

-- ───────────────────────── Modifica per campi ─────────────────────────
-- Applica `campi` alla riga `p_id` se nessuno di quei campi è stato cambiato da altri dopo la
-- versione che il dispositivo aveva visto. Campi diversi si uniscono; lo stesso campo cambiato
-- da due dispositivi è un conflitto, salvo che il valore nuovo sia già quello attuale.

create function interno.aggiorna_campi(
  p_tabella text, p_id uuid, p_famiglia uuid, p_versione_attesa integer, p_campi jsonb, p_ammessi text[]
) returns jsonb
language plpgsql as $$
declare
  v_riga jsonb;
  v_campo text;
  v_conflitti jsonb := '[]'::jsonb;
  v_da_scrivere text[] := '{}';
  v_versioni jsonb := '{}'::jsonb;
  v_assegna text;
begin
  if p_campi is null or jsonb_typeof(p_campi) <> 'object' or p_campi = '{}'::jsonb then
    perform interno.rifiuta('nessun_campo');
  end if;
  if p_versione_attesa is null then
    perform interno.rifiuta('versione_attesa_mancante');
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 and famiglia_id = $2 for update', p_tabella)
    into v_riga using p_id, p_famiglia;
  if v_riga is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_riga ->> 'eliminato_il' is not null then
    perform interno.conflitto(jsonb_build_object('motivo', 'eliminato', 'modificato_da', v_riga -> 'modificato_da'));
  end if;

  for v_campo in select jsonb_object_keys(p_campi) loop
    if not v_campo = any (p_ammessi) then
      perform interno.rifiuta('campo_non_ammesso', jsonb_build_object('campo', v_campo));
    end if;
    if (v_riga -> v_campo) is not distinct from (p_campi -> v_campo) then
      continue;
    end if;
    if coalesce((v_riga -> 'versioni_campi' ->> v_campo)::integer, 0) > p_versione_attesa then
      v_conflitti := v_conflitti || jsonb_build_object(
        'campo', v_campo, 'valore_attuale', v_riga -> v_campo, 'modificato_da', v_riga -> 'modificato_da');
    else
      v_da_scrivere := v_da_scrivere || v_campo;
    end if;
  end loop;

  if jsonb_array_length(v_conflitti) > 0 then
    perform interno.conflitto(jsonb_build_object('motivo', 'stesso_campo', 'campi', v_conflitti));
  end if;
  if cardinality(v_da_scrivere) = 0 then
    return jsonb_build_object('cambiati', '[]'::jsonb);
  end if;

  select string_agg(format('%I = r.%I', c, c), ', '), jsonb_object_agg(c, (v_riga ->> 'versione')::integer + 1)
    into v_assegna, v_versioni
    from unnest(v_da_scrivere) c;

  execute format(
    'update public.%I t set %s, versioni_campi = t.versioni_campi || $3
       from jsonb_populate_record(null::public.%I, $4) r
      where t.id = $1 and t.famiglia_id = $2',
    p_tabella, v_assegna, p_tabella)
    using p_id, p_famiglia, v_versioni, p_campi;

  return jsonb_build_object('cambiati', to_jsonb(v_da_scrivere));
end $$;

-- ───────────────────────── Comandi di dominio ─────────────────────────

create function interno.cmd_crea_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_membro uuid := (d -> 'membro' ->> 'id')::uuid;
begin
  if exists (select 1 from public.famiglia where id = p_famiglia) then
    perform interno.rifiuta('famiglia_esistente');
  end if;
  if v_membro is null then
    perform interno.rifiuta('membro_mancante');
  end if;
  insert into public.famiglia (id, nome) values (p_famiglia, d ->> 'nome');
  insert into public.utente_famiglia (id, famiglia_id, utente_id, ruolo)
    values (gen_random_uuid(), p_famiglia, p_utente, 'amministratore');
  insert into public.membro (id, famiglia_id, nome, emoji, utente_id)
    values (v_membro, p_famiglia, d -> 'membro' ->> 'nome', d -> 'membro' ->> 'emoji', p_utente);
  return '{}'::jsonb;
end $$;

create function interno.cmd_modifica_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  perform interno.richiedi_amministratore(p_famiglia, p_utente);
  return interno.aggiorna_campi('famiglia', p_famiglia, p_famiglia, (d ->> 'versione_attesa')::integer,
    d -> 'campi', array['nome', 'impostazioni']);
end $$;

create function interno.cmd_aggiungi_membro(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  insert into public.membro (id, famiglia_id, nome, emoji, porzione, note)
    values ((d ->> 'id')::uuid, p_famiglia, d ->> 'nome', d ->> 'emoji',
            coalesce((d ->> 'porzione')::numeric, 1), d ->> 'note');
  return '{}'::jsonb;
end $$;

create function interno.cmd_modifica_membro(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  return interno.aggiorna_campi('membro', (d ->> 'id')::uuid, p_famiglia, (d ->> 'versione_attesa')::integer,
    d -> 'campi', array['nome', 'emoji', 'porzione', 'note', 'archiviato']);
end $$;

create function interno.cmd_aggiungi_vincolo(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_esistente uuid;
begin
  if not exists (select 1 from public.membro m where m.id = (d ->> 'membro_id')::uuid
                 and m.famiglia_id = p_famiglia and m.eliminato_il is null) then
    perform interno.rifiuta('membro_non_trovato');
  end if;
  -- Lo stesso vincolo aggiunto da due dispositivi resta uno solo: il secondo è già soddisfatto.
  select v.id into v_esistente from public.vincolo_alimentare v
   where v.membro_id = (d ->> 'membro_id')::uuid and v.tipo = d ->> 'tipo' and v.oggetto = d ->> 'oggetto'
     and v.eliminato_il is null;
  if v_esistente is not null then
    return jsonb_build_object('gia_presente', v_esistente);
  end if;
  insert into public.vincolo_alimentare (id, famiglia_id, membro_id, tipo, oggetto, severita, fonte, testo)
    values ((d ->> 'id')::uuid, p_famiglia, (d ->> 'membro_id')::uuid, d ->> 'tipo', d ->> 'oggetto',
            coalesce(d ->> 'severita', 'evitare'), coalesce(d ->> 'fonte', 'dichiarato'), d ->> 'testo');
  return '{}'::jsonb;
end $$;

create function interno.cmd_rimuovi_vincolo(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  update public.vincolo_alimentare set eliminato_il = now()
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and eliminato_il is null;
  if not found and not exists (select 1 from public.vincolo_alimentare
                               where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia) then
    perform interno.rifiuta('non_trovato');
  end if;
  return '{}'::jsonb;
end $$;

create function interno.cmd_crea_invito(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_codice text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_giorni integer := coalesce((d ->> 'giorni')::integer, 7);
begin
  perform interno.richiedi_amministratore(p_famiglia, p_utente);
  if v_giorni not between 1 and 30 then
    perform interno.rifiuta('durata_non_valida');
  end if;
  insert into public.invito (id, famiglia_id, codice, scade_il, usi_massimi)
    values ((d ->> 'id')::uuid, p_famiglia, v_codice, now() + make_interval(days => v_giorni),
            coalesce((d ->> 'usi_massimi')::integer, 5));
  return jsonb_build_object('codice', v_codice);
end $$;

create function interno.cmd_revoca_invito(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  perform interno.richiedi_amministratore(p_famiglia, p_utente);
  update public.invito set revocato = true
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia and not revocato;
  return '{}'::jsonb;
end $$;

create function interno.cmd_rimuovi_accesso(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_riga public.utente_famiglia;
begin
  perform interno.richiedi_amministratore(p_famiglia, p_utente);
  select * into v_riga from public.utente_famiglia
   where id = (d ->> 'id')::uuid and famiglia_id = p_famiglia for update;
  if v_riga.id is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_riga.eliminato_il is not null then
    return '{}'::jsonb;
  end if;
  if v_riga.ruolo = 'amministratore' and (select count(*) from public.utente_famiglia
      where famiglia_id = p_famiglia and ruolo = 'amministratore' and eliminato_il is null) = 1 then
    perform interno.rifiuta('ultimo_amministratore');
  end if;
  update public.utente_famiglia set eliminato_il = now() where id = v_riga.id;
  update public.membro set utente_id = null
   where famiglia_id = p_famiglia and utente_id = v_riga.utente_id;
  return '{}'::jsonb;
end $$;

-- ───────────────────────── Punto d'ingresso ─────────────────────────

create function interno.chiave_lock(p_famiglia uuid) returns bigint
language sql immutable as $$ select hashtextextended('famiglia:' || p_famiglia::text, 0) $$;

-- Esegue un comando già validato dentro un sottoblocco: un conflitto o un rifiuto annulla
-- le scritture parziali e diventa l'esito registrato.
create function interno.esegui(
  p_id uuid, p_famiglia uuid, p_tipo text, p_dati jsonb, p_utente uuid, p_dispositivo text, p_versione_app integer,
  p_funzione text
) returns jsonb
language plpgsql as $$
declare
  v_esito text := 'applicato';
  v_dettaglio jsonb;
  v_testo text;
begin
  begin
    execute format('select interno.%I($1, $2, $3)', p_funzione) into v_dettaglio using p_famiglia, p_dati, p_utente;
  exception
    when sqlstate 'MC409' then
      get stacked diagnostics v_testo = pg_exception_detail;
      v_esito := 'conflitto';
      v_dettaglio := v_testo::jsonb;
    when sqlstate 'MC422' then
      get stacked diagnostics v_testo = pg_exception_detail;
      v_esito := 'rifiutato';
      v_dettaglio := v_testo::jsonb;
    when check_violation or not_null_violation or unique_violation or foreign_key_violation
      or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      get stacked diagnostics v_testo = constraint_name;
      v_esito := 'rifiutato';
      v_dettaglio := jsonb_build_object('motivo', 'dati_non_validi', 'vincolo', nullif(v_testo, ''));
  end;

  -- Se la famiglia non esiste (crea_famiglia rifiutata) il comando non si può legare a nulla.
  if exists (select 1 from public.famiglia where id = p_famiglia) then
    insert into public.comando (id, famiglia_id, tipo, dati, autore, dispositivo, versione_app, esito, dettaglio)
      values (p_id, p_famiglia, p_tipo, p_dati, p_utente, p_dispositivo, p_versione_app, v_esito, coalesce(v_dettaglio, '{}'));
  end if;

  return jsonb_build_object('id', p_id, 'esito', v_esito, 'dettaglio', coalesce(v_dettaglio, '{}'::jsonb));
end $$;

create function public.applica_comando(comando jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_id uuid;
  v_famiglia uuid;
  v_tipo text := comando ->> 'tipo';
  v_dati jsonb := coalesce(comando -> 'dati', '{}'::jsonb);
  v_versione_app integer;
  v_minima integer;
  v_registrato public.comando;
  v_funzione text;
begin
  if v_utente is null then
    return jsonb_build_object('esito', 'rifiutato', 'transitorio', true, 'dettaglio', jsonb_build_object('motivo', 'non_autenticato'));
  end if;
  begin
    v_id := (comando ->> 'id')::uuid;
    v_famiglia := (comando ->> 'famiglia_id')::uuid;
    v_versione_app := (comando ->> 'versione_app')::integer;
  exception when others then
    v_id := null;
  end;
  if v_id is null or v_famiglia is null or v_tipo is null or jsonb_typeof(v_dati) <> 'object' then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'comando_malformato'));
  end if;

  select versione_minima_app into v_minima from public.compatibilita;
  if v_versione_app is null or v_versione_app < v_minima then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'transitorio', true,
      'dettaglio', jsonb_build_object('motivo', 'app_da_aggiornare', 'versione_minima', v_minima));
  end if;

  perform pg_advisory_xact_lock(interno.chiave_lock(v_famiglia));

  select * into v_registrato from public.comando c where c.id = v_id;
  if found then
    if v_registrato.autore <> v_utente or v_registrato.famiglia_id <> v_famiglia then
      return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'id_gia_usato'));
    end if;
    return jsonb_build_object('id', v_id, 'esito', v_registrato.esito, 'dettaglio', v_registrato.dettaglio, 'ripetuto', true);
  end if;

  v_funzione := case v_tipo
    when 'crea_famiglia' then 'cmd_crea_famiglia'
    when 'modifica_famiglia' then 'cmd_modifica_famiglia'
    when 'aggiungi_membro' then 'cmd_aggiungi_membro'
    when 'modifica_membro' then 'cmd_modifica_membro'
    when 'aggiungi_vincolo' then 'cmd_aggiungi_vincolo'
    when 'rimuovi_vincolo' then 'cmd_rimuovi_vincolo'
    when 'crea_invito' then 'cmd_crea_invito'
    when 'revoca_invito' then 'cmd_revoca_invito'
    when 'rimuovi_accesso' then 'cmd_rimuovi_accesso'
  end;
  if v_funzione is null then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'tipo_sconosciuto'));
  end if;

  if v_tipo <> 'crea_famiglia' and interno.ruolo_in(v_famiglia, v_utente) is null then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'non_autorizzato'));
  end if;

  return interno.esegui(v_id, v_famiglia, v_tipo, v_dati, v_utente, comando ->> 'dispositivo', v_versione_app, v_funzione);
end $$;

-- Entrare in una famiglia con il codice di un invito. Il dispositivo non conosce ancora la famiglia,
-- quindi è un punto d'ingresso a parte; resta idempotente tramite l'id del comando.
create function interno.cmd_entra(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_invito public.invito;
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
  insert into public.membro (id, famiglia_id, nome, emoji, utente_id)
    values ((d -> 'membro' ->> 'id')::uuid, p_famiglia, d -> 'membro' ->> 'nome', d -> 'membro' ->> 'emoji', p_utente);
  return '{}'::jsonb;
end $$;

create function public.entra_con_invito(comando jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_utente uuid := auth.uid();
  v_id uuid;
  v_famiglia uuid;
  v_versione_app integer;
  v_minima integer;
  v_registrato public.comando;
  v_ris jsonb;
begin
  if v_utente is null then
    return jsonb_build_object('esito', 'rifiutato', 'transitorio', true, 'dettaglio', jsonb_build_object('motivo', 'non_autenticato'));
  end if;
  begin
    v_id := (comando ->> 'id')::uuid;
    v_versione_app := (comando ->> 'versione_app')::integer;
  exception when others then
    v_id := null;
  end;
  if v_id is null then
    return jsonb_build_object('esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'comando_malformato'));
  end if;
  select versione_minima_app into v_minima from public.compatibilita;
  if v_versione_app is null or v_versione_app < v_minima then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'transitorio', true,
      'dettaglio', jsonb_build_object('motivo', 'app_da_aggiornare', 'versione_minima', v_minima));
  end if;

  select i.famiglia_id into v_famiglia from public.invito i where i.codice = comando -> 'dati' ->> 'codice';
  if v_famiglia is null then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'invito_sconosciuto'));
  end if;

  perform pg_advisory_xact_lock(interno.chiave_lock(v_famiglia));
  select * into v_registrato from public.comando c where c.id = v_id;
  if found then
    if v_registrato.autore <> v_utente then
      return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'id_gia_usato'));
    end if;
    return jsonb_build_object('id', v_id, 'esito', v_registrato.esito, 'dettaglio', v_registrato.dettaglio,
      'famiglia_id', v_famiglia, 'ripetuto', true);
  end if;

  v_ris := interno.esegui(v_id, v_famiglia, 'entra_con_invito', comando -> 'dati', v_utente,
    comando ->> 'dispositivo', v_versione_app, 'cmd_entra');
  return v_ris || jsonb_build_object('famiglia_id', v_famiglia);
end $$;

-- ───────────────────────── Scaricare le modifiche ─────────────────────────
-- Restituisce le righe della famiglia con seq > p_dopo, in ordine. Le scritture di una famiglia
-- sono serializzate dal lock in applica_comando, quindi un seq più basso non può comparire dopo.

create function public.scarica_modifiche(p_famiglia uuid, p_dopo bigint, p_limite integer default 500)
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

-- Le famiglie di chi è collegato, per scegliere quale aprire.
create function public.mie_famiglie() returns table (famiglia_id uuid, nome text, ruolo text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.nome, uf.ruolo from public.utente_famiglia uf
    join public.famiglia f on f.id = uf.famiglia_id
   where uf.utente_id = auth.uid() and uf.eliminato_il is null and f.eliminato_il is null
   order by f.creato_il
$$;

revoke all on function public.applica_comando(jsonb), public.entra_con_invito(jsonb),
  public.scarica_modifiche(uuid, bigint, integer), public.mie_famiglie() from public, anon;
grant execute on function public.applica_comando(jsonb), public.entra_con_invito(jsonb),
  public.scarica_modifiche(uuid, bigint, integer), public.mie_famiglie() to authenticated;

-- Le funzioni interne si eseguono solo dai punti d'ingresso; le regole per riga usano le due di controllo.
revoke all on all functions in schema interno from public;
grant usage on schema interno to authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;

-- Avvisi in tempo reale: ogni scrittura registra un comando, quindi basta pubblicare quella tabella.
-- La pubblicazione esiste solo su Supabase; nei test si salta.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.comando;
  end if;
end $$;
