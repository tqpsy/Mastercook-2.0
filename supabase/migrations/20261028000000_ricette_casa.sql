-- Mastercook 2.0 · migrazione 3 (Fase 2): ingredienti, ricette, casa (lotti e movimenti).
--
-- Regole principali (docs/fase-0/03):
-- - le quantità sono numeri in unità base (g, ml, pz) compatibili con la dimensione dell'ingrediente,
--   oppure `NULL` dichiarato (q.b.); mai un numero inventato;
-- - ingredienti e ricette di sistema hanno famiglia_id NULL, sono uguali per tutti e non si modificano
--   dall'app: per cambiarne una la si duplica;
-- - un lotto non si cancella: la sua quantità è la somma dei movimenti, che non si modificano né si
--   cancellano; ogni movimento nasce da un comando e non può essere applicato due volte;
-- - una data letta dalla confezione non viene mai sostituita da una stima.

-- ───────────────────────── Registro dei tipi di comando ─────────────────────────
-- Al posto dell'elenco scritto dentro applica_comando: ogni fase aggiunge le sue righe.

create table interno.tipo_comando (
  tipo text primary key,
  funzione text not null,
  -- Ammesso anche a chi non è (ancora) membro della famiglia: crea e ripristina.
  senza_famiglia boolean not null default false
);
insert into interno.tipo_comando (tipo, funzione, senza_famiglia) values
  ('crea_famiglia', 'cmd_crea_famiglia', true),
  ('ripristina_famiglia', 'cmd_ripristina_famiglia', true),
  ('modifica_famiglia', 'cmd_modifica_famiglia', false),
  ('aggiungi_membro', 'cmd_aggiungi_membro', false),
  ('modifica_membro', 'cmd_modifica_membro', false),
  ('aggiungi_vincolo', 'cmd_aggiungi_vincolo', false),
  ('rimuovi_vincolo', 'cmd_rimuovi_vincolo', false),
  ('crea_invito', 'cmd_crea_invito', false),
  ('revoca_invito', 'cmd_revoca_invito', false),
  ('rimuovi_accesso', 'cmd_rimuovi_accesso', false);

create or replace function public.applica_comando(comando jsonb) returns jsonb
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
  v_tipo_comando interno.tipo_comando;
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

  select * into v_tipo_comando from interno.tipo_comando t where t.tipo = v_tipo;
  if not found then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'tipo_sconosciuto'));
  end if;

  if not v_tipo_comando.senza_famiglia and interno.ruolo_in(v_famiglia, v_utente) is null then
    return jsonb_build_object('id', v_id, 'esito', 'rifiutato', 'dettaglio', jsonb_build_object('motivo', 'non_autorizzato'));
  end if;

  return interno.esegui(v_id, v_famiglia, v_tipo, v_dati, v_utente, comando ->> 'dispositivo', v_versione_app, v_tipo_comando.funzione);
end $$;

-- L'id del comando in corso è disponibile alle funzioni di dominio (i movimenti lo registrano).
create or replace function interno.esegui(
  p_id uuid, p_famiglia uuid, p_tipo text, p_dati jsonb, p_utente uuid, p_dispositivo text, p_versione_app integer,
  p_funzione text
) returns jsonb
language plpgsql as $$
declare
  v_esito text := 'applicato';
  v_dettaglio jsonb;
  v_testo text;
begin
  perform set_config('mastercook.comando', p_id::text, true);
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
      or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value
      or invalid_datetime_format or datetime_field_overflow then
      get stacked diagnostics v_testo = constraint_name;
      v_esito := 'rifiutato';
      v_dettaglio := jsonb_build_object('motivo', 'dati_non_validi', 'vincolo', nullif(v_testo, ''));
  end;
  perform set_config('mastercook.comando', '', true);

  if exists (select 1 from public.famiglia where id = p_famiglia) then
    insert into public.comando (id, famiglia_id, tipo, dati, autore, dispositivo, versione_app, esito, dettaglio)
      values (p_id, p_famiglia, p_tipo, p_dati, p_utente, p_dispositivo, p_versione_app, v_esito, coalesce(v_dettaglio, '{}'));
  end if;

  return jsonb_build_object('id', p_id, 'esito', v_esito, 'dettaglio', coalesce(v_dettaglio, '{}'::jsonb));
end $$;

create function interno.comando_corrente() returns uuid
language sql stable as $$ select nullif(current_setting('mastercook.comando', true), '')::uuid $$;

-- ───────────────────────── Ingredienti ─────────────────────────

create table public.ingrediente (
  -- Di sistema: `ing:<slug>`, uguale per tutti. Della famiglia: un UUID scelto dal dispositivo.
  id text primary key check (
    id ~ '^ing:[a-z0-9_]{1,60}$' or id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  famiglia_id uuid references public.famiglia (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  sinonimi text[] not null default '{}',
  reparto text not null check (reparto in ('frutta_verdura', 'pane_forno', 'gastronomia', 'carne', 'pesce', 'latticini',
    'pasta_riso', 'conserve', 'condimenti', 'colazione', 'surgelati', 'bevande', 'casa', 'altro')),
  sottocategoria text,
  dimensione text not null check (dimensione in ('massa', 'volume', 'pezzi')),
  luogo text not null default 'dispensa' check (luogo in ('frigo', 'freezer', 'dispensa')),
  -- Durata indicativa nel luogo abituale; NULL = nessuna regola, la data resta «sconosciuta».
  giorni integer check (giorni is null or giorni > 0),
  allergeni text[] not null default '{}' check (allergeni <@ array['glutine', 'crostacei', 'uova', 'pesce', 'arachidi',
    'soia', 'latte', 'frutta_a_guscio', 'sedano', 'senape', 'sesamo', 'solfiti', 'lupini', 'molluschi']),
  -- Falso quando chi l'ha inserito non sa quali allergeni contiene: le ricette diventano «da verificare».
  allergeni_noti boolean not null default true,
  classi text[] not null default '{}' check (classi <@ array['carne', 'maiale', 'pesce', 'latticini', 'uova', 'miele', 'alcol']),
  genitore text references public.ingrediente (id),
  base boolean not null default false,
  mesi integer[] check (mesi is null or mesi <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  peso_pz numeric check (peso_pz is null or peso_pz > 0),
  emoji text check (emoji is null or char_length(emoji) <= 16),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check ((famiglia_id is null) = (id like 'ing:%'))
);
create index ingrediente_seq on public.ingrediente (famiglia_id, seq);

-- ───────────────────────── Ricette ─────────────────────────

create table public.ricetta (
  -- Di sistema: `sys:<slug>`. Della famiglia: UUID.
  id text primary key check (
    id ~ '^sys:[a-z0-9_]{1,60}$' or id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  famiglia_id uuid references public.famiglia (id) on delete cascade,
  titolo text not null check (char_length(btrim(titolo)) between 1 and 120),
  descrizione text check (descrizione is null or char_length(descrizione) <= 2000),
  categoria text not null check (categoria in ('antipasto', 'primo', 'secondo', 'contorno', 'piatto_unico', 'dolce', 'colazione')),
  cucina text not null default 'italiana' check (char_length(cucina) between 1 and 40),
  provenienza text check (provenienza is null or char_length(provenienza) <= 120),
  porzioni integer not null check (porzioni between 1 and 50),
  minuti_preparazione integer check (minuti_preparazione is null or minuti_preparazione between 0 and 2880),
  minuti_cottura integer check (minuti_cottura is null or minuti_cottura between 0 and 2880),
  minuti_totali integer check (minuti_totali is null or minuti_totali between 1 and 5760),
  difficolta integer check (difficolta is null or difficolta between 1 and 3),
  derivata_da text references public.ricetta (id),
  -- Regola di conservazione dei cotti (id del catalogo), per gli avanzi.
  conservazione text check (conservazione is null or conservazione ~ '^[a-z_]{1,40}$'),
  mesi integer[] check (mesi is null or mesi <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  allergeni_dichiarati text[] not null default '{}' check (allergeni_dichiarati <@ array['glutine', 'crostacei', 'uova',
    'pesce', 'arachidi', 'soia', 'latte', 'frutta_a_guscio', 'sedano', 'senape', 'sesamo', 'solfiti', 'lupini', 'molluschi']),
  -- Percorso nel deposito delle foto: `<famiglia>/<uuid>.jpg`.
  foto text check (foto is null or foto ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  archiviata boolean not null default false,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check ((famiglia_id is null) = (id like 'sys:%')),
  check (foto is null or famiglia_id is not null and split_part(foto, '/', 1) = famiglia_id::text)
);
create index ricetta_seq on public.ricetta (famiglia_id, seq);

create table public.ricetta_ingrediente (
  id uuid primary key,
  famiglia_id uuid references public.famiglia (id) on delete cascade,
  ricetta_id text not null references public.ricetta (id) on delete cascade,
  ingrediente_id text not null references public.ingrediente (id),
  -- In unità base. NULL solo con q.b. dichiarato.
  quantita numeric check (quantita is null or quantita > 0 and quantita < 1000000),
  unita text not null check (unita in ('g', 'ml', 'pz')),
  qb boolean not null default false,
  opzionale boolean not null default false,
  testo text check (testo is null or char_length(testo) <= 200),
  ordine integer not null default 0,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check (qb = (quantita is null))
);
create index ricetta_ingrediente_ricetta on public.ricetta_ingrediente (ricetta_id);
create index ricetta_ingrediente_seq on public.ricetta_ingrediente (famiglia_id, seq);

create table public.ricetta_passo (
  id uuid primary key,
  famiglia_id uuid references public.famiglia (id) on delete cascade,
  ricetta_id text not null references public.ricetta (id) on delete cascade,
  ordine integer not null default 0,
  testo text not null check (char_length(btrim(testo)) between 1 and 2000),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create index ricetta_passo_ricetta on public.ricetta_passo (ricetta_id);
create index ricetta_passo_seq on public.ricetta_passo (famiglia_id, seq);

-- ───────────────────────── Casa: lotti e movimenti ─────────────────────────

create table public.lotto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  ingrediente_id text not null references public.ingrediente (id),
  -- Nome sulla confezione, facoltativo («Yogurt greco Fage»).
  nome text check (nome is null or char_length(btrim(nome)) between 1 and 120),
  -- Somma dei movimenti, tenuta allineata dal database: non si scrive mai direttamente.
  quantita numeric not null default 0 check (quantita >= 0),
  unita text not null check (unita in ('g', 'ml', 'pz')),
  luogo text not null check (luogo in ('frigo', 'freezer', 'dispensa')),
  data_acquisto date,
  data_limite date,
  tipo_data text not null check (tipo_data in ('scadenza', 'tmc', 'stimata', 'sconosciuta')),
  fonte_data text check (fonte_data is null or fonte_data in ('confezione', 'app', 'utente')),
  calcolata_il timestamptz,
  affidabilita text check (affidabilita is null or affidabilita in ('alta', 'media', 'bassa')),
  origine text not null check (origine in ('manuale', 'acquisto', 'scontrino', 'foto', 'avanzo')),
  note text check (note is null or char_length(note) <= 1000),
  chiuso_il timestamptz,
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  -- Le combinazioni ammesse tra tipo, data e fonte.
  constraint data_coerente check (case tipo_data
    when 'sconosciuta' then data_limite is null and fonte_data is null
    when 'stimata' then data_limite is not null and fonte_data = 'app' and calcolata_il is not null
    else data_limite is not null and fonte_data in ('confezione', 'utente') end)
);
create index lotto_seq on public.lotto (famiglia_id, seq);
create index lotto_aperti on public.lotto (famiglia_id, ingrediente_id) where chiuso_il is null;

create table public.movimento (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  lotto_id uuid not null references public.lotto (id) on delete cascade,
  variazione numeric not null check (variazione <> 0),
  causale text not null check (causale in ('carico', 'consumo', 'spreco', 'scaduto', 'correzione', 'annullo', 'spostamento')),
  comando_id uuid not null,
  nota text check (nota is null or char_length(nota) <= 500),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  unique (comando_id, lotto_id, causale)
);
create index movimento_lotto on public.movimento (lotto_id);
create index movimento_seq on public.movimento (famiglia_id, seq);

create trigger timbra before insert or update on public.ingrediente for each row execute function interno.timbra();
create trigger timbra before insert or update on public.ricetta for each row execute function interno.timbra();
create trigger timbra before insert or update on public.ricetta_ingrediente for each row execute function interno.timbra();
create trigger timbra before insert or update on public.ricetta_passo for each row execute function interno.timbra();
create trigger timbra before insert or update on public.lotto for each row execute function interno.timbra();
create trigger timbra before insert on public.movimento for each row execute function interno.timbra();

-- Unità compatibile con la dimensione dell'ingrediente, nelle righe delle ricette e nei lotti.
create function interno.controlla_unita() returns trigger
language plpgsql as $$
declare
  v_dimensione text;
  v_unita text;
begin
  select case dimensione when 'massa' then 'g' when 'volume' then 'ml' else 'pz' end, dimensione
    into v_unita, v_dimensione from public.ingrediente where id = new.ingrediente_id;
  if v_unita is not null and new.unita <> v_unita then
    perform interno.rifiuta('unita_incompatibile', jsonb_build_object('ingrediente', new.ingrediente_id, 'unita', new.unita,
      'dimensione', v_dimensione));
  end if;
  -- Un ingrediente di un'altra famiglia non si può usare.
  if exists (select 1 from public.ingrediente i where i.id = new.ingrediente_id
             and i.famiglia_id is not null and i.famiglia_id is distinct from new.famiglia_id) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  return new;
end $$;
create trigger controlla_unita before insert or update of unita, ingrediente_id on public.ricetta_ingrediente
  for each row execute function interno.controlla_unita();
create trigger controlla_unita before insert or update of unita, ingrediente_id on public.lotto
  for each row execute function interno.controlla_unita();

-- I movimenti non si modificano né si cancellano (salvo con la famiglia intera).
create function interno.movimento_immutabile() returns trigger
language plpgsql as $$
begin
  raise exception using errcode = 'MC422', message = 'movimento_immutabile',
    detail = jsonb_build_object('motivo', 'movimento_immutabile')::text;
end $$;
create trigger immutabile before update on public.movimento for each row execute function interno.movimento_immutabile();

-- La quantità del lotto segue i movimenti: non può scendere sotto zero; a zero il lotto si chiude.
create function interno.applica_movimento() returns trigger
language plpgsql as $$
declare
  v_lotto public.lotto;
begin
  select * into v_lotto from public.lotto where id = new.lotto_id and famiglia_id = new.famiglia_id for update;
  if v_lotto.id is null then
    perform interno.rifiuta('lotto_non_trovato');
  end if;
  if v_lotto.quantita + new.variazione < 0 then
    perform interno.rifiuta('quantita_insufficiente', jsonb_build_object('disponibile', v_lotto.quantita));
  end if;
  update public.lotto set
    quantita = v_lotto.quantita + new.variazione,
    chiuso_il = case when v_lotto.quantita + new.variazione = 0 then coalesce(v_lotto.chiuso_il, now()) end
   where id = new.lotto_id;
  return new;
end $$;
create trigger applica_movimento after insert on public.movimento for each row execute function interno.applica_movimento();

-- ───────────────────────── Accesso ─────────────────────────

alter table public.ingrediente enable row level security;
alter table public.ricetta enable row level security;
alter table public.ricetta_ingrediente enable row level security;
alter table public.ricetta_passo enable row level security;
alter table public.lotto enable row level security;
alter table public.movimento enable row level security;

create policy lettura on public.ingrediente for select to authenticated
  using (famiglia_id is null or interno.sono_membro(famiglia_id));
create policy lettura on public.ricetta for select to authenticated
  using (famiglia_id is null or interno.sono_membro(famiglia_id));
create policy lettura on public.ricetta_ingrediente for select to authenticated
  using (famiglia_id is null or interno.sono_membro(famiglia_id));
create policy lettura on public.ricetta_passo for select to authenticated
  using (famiglia_id is null or interno.sono_membro(famiglia_id));
create policy lettura on public.lotto for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.movimento for select to authenticated using (interno.sono_membro(famiglia_id));

revoke all on public.ingrediente, public.ricetta, public.ricetta_ingrediente, public.ricetta_passo,
  public.lotto, public.movimento from anon, authenticated;
grant select on public.ingrediente, public.ricetta, public.ricetta_ingrediente, public.ricetta_passo,
  public.lotto, public.movimento to authenticated;
revoke all on interno.tipo_comando from public, anon, authenticated;

-- ───────────────────────── Catalogo di sistema ─────────────────────────
-- Carica (o aggiorna) ingredienti e ricette di sistema dal JSON di src/catalogo/catalogo.json.
-- Le righe delle ricette di sistema hanno id deterministici, così un nuovo caricamento le sostituisce.

create function interno.carica_catalogo(c jsonb) returns void
language plpgsql as $$
declare
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_i jsonb;
  v_r jsonb;
  v_g jsonb;
  v_n integer;
begin
  -- Prima tutti gli ingredienti senza genitore, poi i genitori: l'ordine nel file non conta.
  for v_i in select * from jsonb_array_elements(c -> 'ingredienti') loop
    insert into public.ingrediente (id, nome, sinonimi, reparto, sottocategoria, dimensione, luogo, giorni, allergeni,
        classi, base, mesi, peso_pz, emoji)
      values (v_i ->> 'id', v_i ->> 'nome', array(select jsonb_array_elements_text(v_i -> 'sinonimi')), v_i ->> 'reparto',
        v_i ->> 'sottocategoria', v_i ->> 'dimensione', v_i ->> 'luogo', (v_i ->> 'giorni')::integer,
        array(select jsonb_array_elements_text(v_i -> 'allergeni')), array(select jsonb_array_elements_text(v_i -> 'classi')),
        (v_i ->> 'base')::boolean,
        case when jsonb_typeof(v_i -> 'mesi') = 'array' then array(select jsonb_array_elements_text(v_i -> 'mesi')::integer) end,
        (v_i ->> 'peso_pz')::numeric, v_i ->> 'emoji')
    on conflict (id) do update set nome = excluded.nome, sinonimi = excluded.sinonimi, reparto = excluded.reparto,
      sottocategoria = excluded.sottocategoria, luogo = excluded.luogo, giorni = excluded.giorni,
      allergeni = excluded.allergeni, classi = excluded.classi, base = excluded.base, mesi = excluded.mesi,
      peso_pz = excluded.peso_pz, emoji = excluded.emoji;
  end loop;
  for v_i in select * from jsonb_array_elements(c -> 'ingredienti') loop
    update public.ingrediente set genitore = v_i ->> 'genitore'
     where id = v_i ->> 'id' and genitore is distinct from v_i ->> 'genitore';
  end loop;

  for v_r in select * from jsonb_array_elements(c -> 'ricette') loop
    insert into public.ricetta (id, titolo, categoria, cucina, provenienza, porzioni, minuti_totali, difficolta,
        conservazione, mesi, allergeni_dichiarati)
      values (v_r ->> 'id', v_r ->> 'titolo', v_r ->> 'categoria', v_r ->> 'cucina', v_r ->> 'provenienza',
        (v_r ->> 'porzioni')::integer, (v_r ->> 'minuti_totali')::integer, (v_r ->> 'difficolta')::integer,
        v_r ->> 'conservazione',
        case when jsonb_typeof(v_r -> 'mesi') = 'array' then array(select jsonb_array_elements_text(v_r -> 'mesi')::integer) end,
        array(select jsonb_array_elements_text(v_r -> 'allergeni_dichiarati')))
    on conflict (id) do update set titolo = excluded.titolo, categoria = excluded.categoria, cucina = excluded.cucina,
      provenienza = excluded.provenienza, porzioni = excluded.porzioni, minuti_totali = excluded.minuti_totali,
      difficolta = excluded.difficolta, conservazione = excluded.conservazione, mesi = excluded.mesi,
      allergeni_dichiarati = excluded.allergeni_dichiarati;

    delete from public.ricetta_ingrediente where ricetta_id = v_r ->> 'id';
    delete from public.ricetta_passo where ricetta_id = v_r ->> 'id';
    v_n := 0;
    for v_g in select * from jsonb_array_elements(v_r -> 'ingredienti') loop
      v_n := v_n + 1;
      insert into public.ricetta_ingrediente (id, ricetta_id, ingrediente_id, quantita, unita, qb, opzionale, testo, ordine)
        values (interno.nuovo_id(v_zero, (v_r ->> 'id') || ':i:' || v_n), v_r ->> 'id', v_g ->> 'ingrediente_id',
          (v_g ->> 'quantita')::numeric, v_g ->> 'unita', (v_g ->> 'qb')::boolean, (v_g ->> 'opzionale')::boolean,
          v_g ->> 'testo', v_n);
    end loop;
    v_n := 0;
    for v_g in select * from jsonb_array_elements(v_r -> 'passi') loop
      v_n := v_n + 1;
      insert into public.ricetta_passo (id, ricetta_id, ordine, testo)
        values (interno.nuovo_id(v_zero, (v_r ->> 'id') || ':p:' || v_n), v_r ->> 'id', v_n, v_g #>> '{}');
    end loop;
  end loop;
end $$;

-- ───────────────────────── Comandi: ingredienti della famiglia ─────────────────────────

create function interno.cmd_crea_ingrediente(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  if d ->> 'genitore' is not null and not exists (select 1 from public.ingrediente i where i.id = d ->> 'genitore'
      and (i.famiglia_id is null or i.famiglia_id = p_famiglia)) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  insert into public.ingrediente (id, famiglia_id, nome, sinonimi, reparto, dimensione, luogo, giorni, allergeni,
      allergeni_noti, classi, genitore, emoji)
    values (d ->> 'id', p_famiglia, btrim(d ->> 'nome'), '{}', coalesce(d ->> 'reparto', 'altro'), d ->> 'dimensione',
      coalesce(d ->> 'luogo', 'dispensa'), null,
      coalesce(array(select jsonb_array_elements_text(d -> 'allergeni')), '{}'),
      coalesce((d ->> 'allergeni_noti')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(d -> 'classi')), '{}'), d ->> 'genitore', d ->> 'emoji');
  return '{}'::jsonb;
end $$;

create function interno.cmd_modifica_ingrediente(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_campi jsonb := d -> 'campi';
begin
  if not exists (select 1 from public.ingrediente where id = d ->> 'id' and famiglia_id = p_famiglia) then
    perform interno.rifiuta(case when d ->> 'id' like 'ing:%' then 'ingrediente_di_sistema' else 'non_trovato' end);
  end if;
  -- aggiorna_campi lavora con id uuid.
  return interno.aggiorna_campi('ingrediente', null, p_famiglia, (d ->> 'versione_attesa')::integer, v_campi,
    array['nome', 'reparto', 'luogo', 'allergeni', 'allergeni_noti', 'classi', 'emoji'], d ->> 'id');
end $$;

-- ───────────────────────── Comandi: ricette della famiglia ─────────────────────────

-- aggiorna_campi con id testuale (ingredienti e ricette): stessa logica, chiave diversa.
create function interno.aggiorna_campi(
  p_tabella text, p_id uuid, p_famiglia uuid, p_versione_attesa integer, p_campi jsonb, p_ammessi text[], p_id_testo text
) returns jsonb
language plpgsql as $$
declare
  v_riga jsonb;
  v_campo text;
  v_conflitti jsonb := '[]'::jsonb;
  v_da_scrivere text[] := '{}';
  v_versioni jsonb := '{}'::jsonb;
  v_assegna text;
  v_chiave text := coalesce(p_id_testo, p_id::text);
begin
  if p_campi is null or jsonb_typeof(p_campi) <> 'object' or p_campi = '{}'::jsonb then
    perform interno.rifiuta('nessun_campo');
  end if;
  if p_versione_attesa is null then
    perform interno.rifiuta('versione_attesa_mancante');
  end if;
  execute format('select to_jsonb(t) from public.%I t where id::text = $1 and famiglia_id = $2 for update', p_tabella)
    into v_riga using v_chiave, p_famiglia;
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
        'campo', v_campo, 'valore_attuale', v_riga -> v_campo, 'modificato_da', v_riga -> 'modificato_da', 'id', v_chiave);
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
      where t.id::text = $1 and t.famiglia_id = $2',
    p_tabella, v_assegna, p_tabella)
    using v_chiave, p_famiglia, v_versioni, p_campi;
  return jsonb_build_object('cambiati', to_jsonb(v_da_scrivere));
end $$;

create function interno.valida_ricetta_famiglia(p_famiglia uuid, p_id text) returns void
language plpgsql as $$
declare
  v_famiglia uuid;
  v_trovata boolean;
begin
  select true, famiglia_id into v_trovata, v_famiglia from public.ricetta where id = p_id;
  if v_trovata is null then
    perform interno.rifiuta('non_trovato');
  end if;
  if v_famiglia is null then
    perform interno.rifiuta('ricetta_di_sistema');
  end if;
  if v_famiglia <> p_famiglia then
    perform interno.rifiuta('non_trovato');
  end if;
end $$;

-- Salva una ricetta della famiglia: i campi della scheda e, riga per riga, ingredienti e passaggi.
-- Ogni riga ha la sua versione, quindi due persone che cambiano righe diverse non si pestano i piedi.
--   { id, nuova?, versione_attesa?, campi: {…},
--     ingredienti: { aggiungi: [riga], modifica: [{id, versione_attesa, campi}], rimuovi: [id] },
--     passi:       { aggiungi: [riga], modifica: [{id, versione_attesa, campi}], rimuovi: [id] } }
create function interno.cmd_salva_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id text := d ->> 'id';
  v_campi jsonb := coalesce(d -> 'campi', '{}'::jsonb);
  v_x jsonb;
  v_riga text;
  v_cambiati jsonb := '{}'::jsonb;
begin
  if coalesce((d ->> 'nuova')::boolean, false) then
    if v_campi ->> 'derivata_da' is not null and not exists (select 1 from public.ricetta r where r.id = v_campi ->> 'derivata_da'
        and (r.famiglia_id is null or r.famiglia_id = p_famiglia)) then
      perform interno.rifiuta('ricetta_non_trovata');
    end if;
    insert into public.ricetta (id, famiglia_id, titolo, descrizione, categoria, cucina, provenienza, porzioni,
        minuti_preparazione, minuti_cottura, minuti_totali, difficolta, derivata_da, conservazione, mesi,
        allergeni_dichiarati, foto)
      select v_id, p_famiglia, btrim(r.titolo), r.descrizione, r.categoria, coalesce(r.cucina, 'italiana'), r.provenienza,
        r.porzioni, r.minuti_preparazione, r.minuti_cottura, r.minuti_totali, r.difficolta, r.derivata_da,
        r.conservazione, r.mesi, coalesce(r.allergeni_dichiarati, '{}'), r.foto
      from jsonb_populate_record(null::public.ricetta, v_campi) r;
  else
    perform interno.valida_ricetta_famiglia(p_famiglia, v_id);
    if v_campi <> '{}'::jsonb then
      v_cambiati := interno.aggiorna_campi('ricetta', null, p_famiglia, (d ->> 'versione_attesa')::integer, v_campi,
        array['titolo', 'descrizione', 'categoria', 'cucina', 'provenienza', 'porzioni', 'minuti_preparazione',
              'minuti_cottura', 'minuti_totali', 'difficolta', 'conservazione', 'mesi', 'allergeni_dichiarati', 'foto',
              'archiviata'], v_id);
    end if;
  end if;

  -- Ingredienti.
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'ingredienti' -> 'aggiungi', '[]')) loop
    insert into public.ricetta_ingrediente (id, famiglia_id, ricetta_id, ingrediente_id, quantita, unita, qb, opzionale, testo, ordine)
      values ((v_x ->> 'id')::uuid, p_famiglia, v_id, v_x ->> 'ingrediente_id', (v_x ->> 'quantita')::numeric,
        v_x ->> 'unita', coalesce((v_x ->> 'qb')::boolean, false), coalesce((v_x ->> 'opzionale')::boolean, false),
        nullif(btrim(v_x ->> 'testo'), ''), coalesce((v_x ->> 'ordine')::integer, 0));
  end loop;
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'ingredienti' -> 'modifica', '[]')) loop
    if not exists (select 1 from public.ricetta_ingrediente where id = (v_x ->> 'id')::uuid and ricetta_id = v_id) then
      perform interno.rifiuta('non_trovato', jsonb_build_object('riga', v_x ->> 'id'));
    end if;
    perform interno.aggiorna_campi('ricetta_ingrediente', (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'versione_attesa')::integer,
      v_x -> 'campi', array['ingrediente_id', 'quantita', 'unita', 'qb', 'opzionale', 'testo', 'ordine']);
  end loop;
  for v_riga in select * from jsonb_array_elements_text(coalesce(d -> 'ingredienti' -> 'rimuovi', '[]')) loop
    update public.ricetta_ingrediente set eliminato_il = now()
     where id = v_riga::uuid and ricetta_id = v_id and famiglia_id = p_famiglia and eliminato_il is null;
  end loop;

  -- Passaggi.
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'passi' -> 'aggiungi', '[]')) loop
    insert into public.ricetta_passo (id, famiglia_id, ricetta_id, ordine, testo)
      values ((v_x ->> 'id')::uuid, p_famiglia, v_id, coalesce((v_x ->> 'ordine')::integer, 0), btrim(v_x ->> 'testo'));
  end loop;
  for v_x in select * from jsonb_array_elements(coalesce(d -> 'passi' -> 'modifica', '[]')) loop
    if not exists (select 1 from public.ricetta_passo where id = (v_x ->> 'id')::uuid and ricetta_id = v_id) then
      perform interno.rifiuta('non_trovato', jsonb_build_object('riga', v_x ->> 'id'));
    end if;
    perform interno.aggiorna_campi('ricetta_passo', (v_x ->> 'id')::uuid, p_famiglia, (v_x ->> 'versione_attesa')::integer,
      v_x -> 'campi', array['testo', 'ordine']);
  end loop;
  for v_riga in select * from jsonb_array_elements_text(coalesce(d -> 'passi' -> 'rimuovi', '[]')) loop
    update public.ricetta_passo set eliminato_il = now()
     where id = v_riga::uuid and ricetta_id = v_id and famiglia_id = p_famiglia and eliminato_il is null;
  end loop;

  -- Una ricetta resta sempre con almeno un ingrediente e un passaggio.
  if not exists (select 1 from public.ricetta_ingrediente where ricetta_id = v_id and eliminato_il is null) then
    perform interno.rifiuta('ricetta_senza_ingredienti');
  end if;
  if not exists (select 1 from public.ricetta_passo where ricetta_id = v_id and eliminato_il is null) then
    perform interno.rifiuta('ricetta_senza_passaggi');
  end if;
  return v_cambiati;
end $$;

-- Cancella una ricetta della famiglia. Dalla Fase 3, se è usata nel menu si archivia soltanto.
create function interno.cmd_elimina_ricetta(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
begin
  perform interno.valida_ricetta_famiglia(p_famiglia, d ->> 'id');
  update public.ricetta set eliminato_il = now() where id = d ->> 'id' and eliminato_il is null;
  return '{}'::jsonb;
end $$;

-- ───────────────────────── Comandi: casa ─────────────────────────

create function interno.lotto_della_famiglia(p_famiglia uuid, p_id uuid) returns public.lotto
language plpgsql as $$
declare
  v_lotto public.lotto;
begin
  select * into v_lotto from public.lotto where id = p_id and famiglia_id = p_famiglia for update;
  if v_lotto.id is null then
    perform interno.rifiuta('lotto_non_trovato');
  end if;
  return v_lotto;
end $$;

create function interno.nuovo_movimento(p_famiglia uuid, p_lotto uuid, p_variazione numeric, p_causale text, p_nota text)
returns void
language plpgsql as $$
begin
  insert into public.movimento (id, famiglia_id, lotto_id, variazione, causale, comando_id, nota)
    values (interno.nuovo_id(interno.comando_corrente(), p_lotto::text || ':' || p_causale), p_famiglia, p_lotto,
      p_variazione, p_causale, interno.comando_corrente(), nullif(btrim(p_nota), ''));
end $$;

-- Un lotto inserito a mano: la quantità la scrive qualcuno, mai l'app. Solo la conferma di un
-- acquisto (Fase 4) crea lotti con origine «acquisto».
create function interno.cmd_aggiungi_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_quantita numeric := (d ->> 'quantita')::numeric;
begin
  if v_quantita is null or v_quantita <= 0 then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  if coalesce(d ->> 'origine', 'manuale') <> 'manuale' then
    perform interno.rifiuta('origine_non_ammessa');
  end if;
  if not exists (select 1 from public.ingrediente i where i.id = d ->> 'ingrediente_id'
                 and (i.famiglia_id is null or i.famiglia_id = p_famiglia) and i.eliminato_il is null) then
    perform interno.rifiuta('ingrediente_non_trovato');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note)
    values ((d ->> 'id')::uuid, p_famiglia, d ->> 'ingrediente_id', nullif(btrim(d ->> 'nome'), ''), d ->> 'unita',
      d ->> 'luogo', (d ->> 'data_acquisto')::date, (d ->> 'data_limite')::date, d ->> 'tipo_data', d ->> 'fonte_data',
      (d ->> 'calcolata_il')::timestamptz, d ->> 'affidabilita', 'manuale', nullif(btrim(d ->> 'note'), ''));
  perform interno.nuovo_movimento(p_famiglia, (d ->> 'id')::uuid, v_quantita, 'carico', null);
  return '{}'::jsonb;
end $$;

-- Usato, buttato o scaduto: toglie una quantità dal lotto.
create function interno.cmd_scarica_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'lotto_id')::uuid);
  v_quantita numeric := (d ->> 'quantita')::numeric;
begin
  if d ->> 'causale' not in ('consumo', 'spreco', 'scaduto') then
    perform interno.rifiuta('causale_non_ammessa');
  end if;
  if v_quantita is null or v_quantita <= 0 then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  perform interno.nuovo_movimento(p_famiglia, v_lotto.id, -v_quantita, d ->> 'causale', d ->> 'nota');
  return jsonb_build_object('rimasto', v_lotto.quantita - v_quantita);
end $$;

-- «Ora ce ne sono X»: vale solo se la quantità è ancora quella che si vedeva sul dispositivo,
-- altrimenti è un conflitto da guardare (qualcuno l'ha già cambiata).
create function interno.cmd_correggi_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'lotto_id')::uuid);
  v_vista numeric := (d ->> 'quantita_vista')::numeric;
  v_nuova numeric := (d ->> 'quantita_nuova')::numeric;
begin
  if v_vista is null or v_nuova is null or v_nuova < 0 then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  if v_lotto.quantita <> v_vista then
    perform interno.conflitto(jsonb_build_object('motivo', 'quantita_cambiata', 'valore_attuale', v_lotto.quantita,
      'modificato_da', v_lotto.modificato_da));
  end if;
  if v_nuova <> v_vista then
    perform interno.nuovo_movimento(p_famiglia, v_lotto.id, v_nuova - v_vista, 'correzione', d ->> 'nota');
  end if;
  return '{}'::jsonb;
end $$;

-- Sposta un lotto (tutto, o una parte in un lotto nuovo) in un altro luogo. Le date della
-- confezione restano; una stima può essere ricalcolata dal dispositivo per il nuovo luogo.
create function interno.cmd_sposta_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'lotto_id')::uuid);
  v_quantita numeric := (d ->> 'quantita')::numeric;
  v_nuovo uuid := (d ->> 'nuovo_id')::uuid;
  v_stima jsonb := d -> 'stima';
begin
  if v_lotto.chiuso_il is not null then
    perform interno.rifiuta('lotto_chiuso');
  end if;
  if v_stima is not null and v_lotto.tipo_data not in ('stimata', 'sconosciuta') then
    perform interno.rifiuta('data_confezione_protetta');
  end if;
  if v_quantita is null or v_quantita >= v_lotto.quantita then
    update public.lotto set luogo = d ->> 'luogo',
      data_limite = coalesce((v_stima ->> 'data_limite')::date, data_limite),
      tipo_data = coalesce(v_stima ->> 'tipo_data', tipo_data),
      fonte_data = case when v_stima is null then fonte_data else v_stima ->> 'fonte_data' end,
      calcolata_il = coalesce((v_stima ->> 'calcolata_il')::timestamptz, calcolata_il)
     where id = v_lotto.id;
    return '{}'::jsonb;
  end if;
  if v_quantita <= 0 or v_nuovo is null then
    perform interno.rifiuta('quantita_non_valida');
  end if;
  insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
      fonte_data, calcolata_il, affidabilita, origine, note)
    values (v_nuovo, p_famiglia, v_lotto.ingrediente_id, v_lotto.nome, v_lotto.unita, d ->> 'luogo', v_lotto.data_acquisto,
      coalesce((v_stima ->> 'data_limite')::date, v_lotto.data_limite), coalesce(v_stima ->> 'tipo_data', v_lotto.tipo_data),
      case when v_stima is null then v_lotto.fonte_data else v_stima ->> 'fonte_data' end,
      coalesce((v_stima ->> 'calcolata_il')::timestamptz, v_lotto.calcolata_il), v_lotto.affidabilita, v_lotto.origine,
      v_lotto.note);
  perform interno.nuovo_movimento(p_famiglia, v_lotto.id, -v_quantita, 'spostamento', null);
  perform interno.nuovo_movimento(p_famiglia, v_nuovo, v_quantita, 'spostamento', null);
  return '{}'::jsonb;
end $$;

-- Nome, note e date. Una data letta dalla confezione non viene mai sostituita da una stima.
create function interno.cmd_modifica_lotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_lotto public.lotto := interno.lotto_della_famiglia(p_famiglia, (d ->> 'id')::uuid);
begin
  if v_lotto.fonte_data = 'confezione' and d -> 'campi' ->> 'fonte_data' = 'app' then
    perform interno.rifiuta('data_confezione_protetta');
  end if;
  return interno.aggiorna_campi('lotto', v_lotto.id, p_famiglia, (d ->> 'versione_attesa')::integer, d -> 'campi',
    array['nome', 'note', 'data_acquisto', 'data_limite', 'tipo_data', 'fonte_data', 'calcolata_il', 'affidabilita']);
end $$;

insert into interno.tipo_comando (tipo, funzione) values
  ('crea_ingrediente', 'cmd_crea_ingrediente'),
  ('modifica_ingrediente', 'cmd_modifica_ingrediente'),
  ('salva_ricetta', 'cmd_salva_ricetta'),
  ('elimina_ricetta', 'cmd_elimina_ricetta'),
  ('aggiungi_lotto', 'cmd_aggiungi_lotto'),
  ('scarica_lotto', 'cmd_scarica_lotto'),
  ('correggi_lotto', 'cmd_correggi_lotto'),
  ('sposta_lotto', 'cmd_sposta_lotto'),
  ('modifica_lotto', 'cmd_modifica_lotto');

-- ───────────────────────── Scaricare le modifiche ─────────────────────────
-- Come prima, con le tabelle nuove. Il catalogo di sistema non passa di qui: è nell'app.

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

-- Le funzioni interne si eseguono solo dai punti d'ingresso.
revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
