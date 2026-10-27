-- Mastercook 2.0 · Fase 4, seconda parte: scontrini e prodotti con codice a barre.
--
-- - scontrino: letto dal telefono (foto o testo), rivisto da una persona, poi importato una volta sola.
--   L'impronta (negozio, data, ora, totale, oppure il contenuto del QR) è unica per famiglia:
--   lo stesso scontrino importato due volte viene riconosciuto (T-ACQ-5).
-- - scontrino_riga: una riga letta. Se corrisponde a una riga d'acquisto già confermata dal carrello
--   le dà il prezzo e basta, senza caricare di nuovo (T-ACQ-4); se è nuova diventa una riga di un
--   acquisto con fonte «scontrino», e se è un alimento entra in casa.
-- - prodotto: un codice a barre che la famiglia ha già associato a un ingrediente (con nome e formato),
--   così la volta dopo la scansione lo riconosce subito.

create table public.prodotto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  codice text not null check (codice ~ '^[0-9]{8,14}$'),
  ingrediente_id text not null references public.ingrediente (id),
  nome text check (nome is null or char_length(btrim(nome)) between 1 and 120),
  -- Formato della confezione, in unità base (500 g, 1000 ml, 6 pz).
  quantita numeric check (quantita is null or quantita > 0),
  unita text check (unita in ('g', 'ml', 'pz')),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0,
  check ((quantita is null) = (unita is null))
);
create unique index prodotto_codice on public.prodotto (famiglia_id, codice) where eliminato_il is null;
create index prodotto_seq on public.prodotto (famiglia_id, seq);

create table public.scontrino (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  negozio text check (negozio is null or char_length(btrim(negozio)) between 1 and 80),
  data date not null,
  ora text check (ora is null or ora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  totale numeric(9, 2) check (totale is null or totale >= 0),
  impronta text not null,
  -- Il testo letto (o incollato), per poter ricontrollare; la foto resta sul telefono.
  testo text check (testo is null or char_length(testo) <= 20000),
  acquisto_id uuid references public.acquisto (id),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create unique index scontrino_impronta on public.scontrino (famiglia_id, impronta);
create index scontrino_seq on public.scontrino (famiglia_id, seq);

create table public.scontrino_riga (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  scontrino_id uuid not null references public.scontrino (id) on delete cascade,
  descrizione text not null check (char_length(btrim(descrizione)) between 1 and 120),
  prezzo numeric(9, 2) check (prezzo is null or prezzo >= 0),
  -- Al più una riga di scontrino per riga d'acquisto, e viceversa.
  acquisto_riga_id uuid references public.acquisto_riga (id),
  versione integer not null default 1,
  versioni_campi jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(),
  creato_da uuid,
  modificato_il timestamptz not null default now(),
  modificato_da uuid,
  eliminato_il timestamptz,
  seq bigint not null default 0
);
create unique index scontrino_riga_abbinata on public.scontrino_riga (acquisto_riga_id) where acquisto_riga_id is not null;
create index scontrino_riga_scontrino on public.scontrino_riga (scontrino_id);
create index scontrino_riga_seq on public.scontrino_riga (famiglia_id, seq);

alter table public.acquisto add column scontrino_id uuid references public.scontrino (id);

create trigger timbra before insert or update on public.prodotto for each row execute function interno.timbra();
create trigger timbra before insert or update on public.scontrino for each row execute function interno.timbra();
create trigger timbra before insert or update on public.scontrino_riga for each row execute function interno.timbra();
create trigger controlla_riferimenti before insert or update of ingrediente_id on public.prodotto
  for each row execute function interno.controlla_riferimenti();
create trigger controlla_unita before insert or update of ingrediente_id, unita on public.prodotto
  for each row when (new.unita is not null) execute function interno.controlla_unita();

alter table public.prodotto enable row level security;
alter table public.scontrino enable row level security;
alter table public.scontrino_riga enable row level security;
create policy lettura on public.prodotto for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.scontrino for select to authenticated using (interno.sono_membro(famiglia_id));
create policy lettura on public.scontrino_riga for select to authenticated using (interno.sono_membro(famiglia_id));
revoke all on public.prodotto, public.scontrino, public.scontrino_riga from anon, authenticated;
grant select on public.prodotto, public.scontrino, public.scontrino_riga to authenticated;

-- ───────────────────────── Comandi ─────────────────────────

-- Un codice a barre associato a un ingrediente. Lo stesso codice si aggiorna (uno per famiglia).
create function interno.cmd_salva_prodotto(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_id uuid;
begin
  select id into v_id from public.prodotto
   where famiglia_id = p_famiglia and codice = d ->> 'codice' and eliminato_il is null for update;
  if v_id is null then
    insert into public.prodotto (id, famiglia_id, codice, ingrediente_id, nome, quantita, unita)
      values ((d ->> 'id')::uuid, p_famiglia, d ->> 'codice', d ->> 'ingrediente_id', nullif(btrim(d ->> 'nome'), ''),
              (d ->> 'quantita')::numeric, d ->> 'unita');
    return '{}'::jsonb;
  end if;
  update public.prodotto set ingrediente_id = d ->> 'ingrediente_id', nome = nullif(btrim(d ->> 'nome'), ''),
      quantita = (d ->> 'quantita')::numeric, unita = d ->> 'unita'
   where id = v_id;
  return jsonb_build_object('aggiornato', v_id);
end $$;

-- L'impronta di uno scontrino: il contenuto del QR se c'è, altrimenti negozio, data, ora e totale.
create function interno.impronta_scontrino(d jsonb) returns text
language sql immutable as $$
  select case when nullif(btrim(d ->> 'qr'), '') is not null then 'qr:' || md5(btrim(d ->> 'qr'))
    else 'dati:' || md5(concat_ws('|', lower(regexp_replace(coalesce(d ->> 'negozio', ''), '[^[:alnum:]]', '', 'g')),
                                  d ->> 'data', coalesce(d ->> 'ora', ''), coalesce(to_char((d ->> 'totale')::numeric, 'FM999999990.00'), '')))
  end
$$;

-- Importa uno scontrino già rivisto da una persona.
--   { id, negozio?, data, ora?, totale?, qr?, testo?, acquisto_id?, righe: [{ id, descrizione, prezzo?,
--     abbina?: acquisto_riga_id,                     -- riga già confermata dal carrello: solo il prezzo
--     nuova?: { id, ingrediente_id?, nome?, quantita?, unita?, lotto_id?, luogo?, tipo_data?, ... } }] }
-- Le righe né abbinate né nuove restano solo sullo scontrino (sconti, sacchetti, righe illeggibili).
create function interno.cmd_importa_scontrino(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_impronta text := interno.impronta_scontrino(d);
  v_esistente uuid;
  v_r jsonb;
  v_nuova jsonb;
  v_acquisto uuid := (d ->> 'acquisto_id')::uuid;
  v_con_acquisto boolean := false;
  v_abbinate integer := 0;
  v_nuove integer := 0;
  v_riga public.acquisto_riga;
begin
  select id into v_esistente from public.scontrino where famiglia_id = p_famiglia and impronta = v_impronta;
  if v_esistente is not null then
    return jsonb_build_object('gia_importato', v_esistente);
  end if;
  if (d ->> 'data') is null or jsonb_typeof(d -> 'righe') <> 'array' or jsonb_array_length(d -> 'righe') > 300 then
    perform interno.rifiuta('dati_non_validi');
  end if;
  insert into public.scontrino (id, famiglia_id, negozio, data, ora, totale, impronta, testo)
    values ((d ->> 'id')::uuid, p_famiglia, nullif(btrim(d ->> 'negozio'), ''), (d ->> 'data')::date, nullif(d ->> 'ora', ''),
            (d ->> 'totale')::numeric, v_impronta, left(d ->> 'testo', 20000));

  for v_r in select * from jsonb_array_elements(d -> 'righe') loop
    v_nuova := v_r -> 'nuova';
    if v_r ->> 'abbina' is not null then
      select r.* into v_riga from public.acquisto_riga r join public.acquisto a on a.id = r.acquisto_id
       where r.id = (v_r ->> 'abbina')::uuid and r.famiglia_id = p_famiglia and a.stato = 'confermato' for update of r;
      if v_riga.id is null then
        perform interno.rifiuta('riga_non_trovata', jsonb_build_object('riga', v_r ->> 'id'));
      end if;
      if exists (select 1 from public.scontrino_riga where acquisto_riga_id = v_riga.id) then
        perform interno.rifiuta('riga_gia_abbinata', jsonb_build_object('riga', v_r ->> 'id'));
      end if;
      update public.acquisto_riga set prezzo = coalesce((v_r ->> 'prezzo')::numeric, prezzo) where id = v_riga.id;
      update public.acquisto set scontrino_id = (d ->> 'id')::uuid where id = v_riga.acquisto_id and scontrino_id is null;
      v_abbinate := v_abbinate + 1;
    elsif v_nuova is not null then
      if v_acquisto is null then
        perform interno.rifiuta('dati_non_validi', jsonb_build_object('manca', 'acquisto_id'));
      end if;
      if not v_con_acquisto then
        insert into public.acquisto (id, famiglia_id, fonte, data, negozio, scontrino_id)
          values (v_acquisto, p_famiglia, 'scontrino', (d ->> 'data')::date, nullif(btrim(d ->> 'negozio'), ''), (d ->> 'id')::uuid);
        update public.scontrino set acquisto_id = v_acquisto where id = (d ->> 'id')::uuid;
        v_con_acquisto := true;
      end if;
      if v_nuova ->> 'ingrediente_id' is not null then
        if (v_nuova ->> 'quantita')::numeric is null or (v_nuova ->> 'quantita')::numeric <= 0 then
          perform interno.rifiuta('quantita_non_valida', jsonb_build_object('riga', v_r ->> 'id'));
        end if;
        insert into public.lotto (id, famiglia_id, ingrediente_id, nome, unita, luogo, data_acquisto, data_limite, tipo_data,
            fonte_data, calcolata_il, affidabilita, origine)
          values ((v_nuova ->> 'lotto_id')::uuid, p_famiglia, v_nuova ->> 'ingrediente_id', nullif(btrim(v_nuova ->> 'nome'), ''),
            v_nuova ->> 'unita', coalesce(v_nuova ->> 'luogo', 'dispensa'), (d ->> 'data')::date, (v_nuova ->> 'data_limite')::date,
            coalesce(v_nuova ->> 'tipo_data', 'sconosciuta'), v_nuova ->> 'fonte_data', (v_nuova ->> 'calcolata_il')::timestamptz,
            v_nuova ->> 'affidabilita', 'scontrino');
        perform interno.nuovo_movimento(p_famiglia, (v_nuova ->> 'lotto_id')::uuid, (v_nuova ->> 'quantita')::numeric, 'carico', null);
      end if;
      insert into public.acquisto_riga (id, famiglia_id, acquisto_id, ingrediente_id, nome, quantita, unita, prezzo, lotto_id)
        values ((v_nuova ->> 'id')::uuid, p_famiglia, v_acquisto, v_nuova ->> 'ingrediente_id',
          coalesce(nullif(btrim(v_nuova ->> 'nome'), ''), case when v_nuova ->> 'ingrediente_id' is null then btrim(v_r ->> 'descrizione') end),
          (v_nuova ->> 'quantita')::numeric, v_nuova ->> 'unita', (v_r ->> 'prezzo')::numeric,
          case when v_nuova ->> 'ingrediente_id' is not null then (v_nuova ->> 'lotto_id')::uuid end)
        returning * into v_riga;
      v_nuove := v_nuove + 1;
    else
      v_riga := null;
    end if;
    insert into public.scontrino_riga (id, famiglia_id, scontrino_id, descrizione, prezzo, acquisto_riga_id)
      values ((v_r ->> 'id')::uuid, p_famiglia, (d ->> 'id')::uuid, left(btrim(v_r ->> 'descrizione'), 120), (v_r ->> 'prezzo')::numeric,
              v_riga.id);
  end loop;
  return jsonb_build_object('abbinate', v_abbinate, 'nuove', v_nuove);
end $$;

insert into interno.tipo_comando (tipo, funzione) values
  ('salva_prodotto', 'cmd_salva_prodotto'),
  ('importa_scontrino', 'cmd_importa_scontrino');

-- Solo la conferma d'acquisto e l'importazione di uno scontrino creano lotti comprati: la conferma
-- normale non può dichiararsi «scontrino».
-- (cmd_conferma_acquisto accetta già solo le fonti carrello e manuale.)

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

-- ───────────────────────── Ripristino: file della versione 5 ─────────────────────────

alter function interno.cmd_ripristina_famiglia(uuid, jsonb, uuid) rename to ripristina_fino_a_4;

create function interno.cmd_ripristina_famiglia(p_famiglia uuid, d jsonb, p_utente uuid) returns jsonb
language plpgsql as $$
declare
  v_file jsonb := d -> 'file';
  v_tabelle jsonb := v_file -> 'tabelle';
  v_vecchia uuid := (v_tabelle -> 'famiglia' -> 0 ->> 'id')::uuid;
  v_conta jsonb;
  v_tabella text;
  v_r jsonb;
begin
  if v_file ->> 'formato' is distinct from 'mastercook-2' or (v_file ->> 'versione_schema') is distinct from '5' then
    return interno.ripristina_fino_a_4(p_famiglia, d, p_utente);
  end if;
  foreach v_tabella in array array['prodotto', 'scontrino', 'scontrino_riga'] loop
    if coalesce(jsonb_typeof(v_tabelle -> v_tabella), '') <> 'array' then
      perform interno.rifiuta('file_incompleto');
    end if;
    if exists (select 1 from jsonb_array_elements(v_tabelle -> v_tabella) e where (e ->> 'famiglia_id')::uuid is distinct from v_vecchia) then
      perform interno.rifiuta('file_incoerente');
    end if;
  end loop;
  v_conta := interno.ripristina_fino_a_4(p_famiglia, jsonb_set(d, '{file,versione_schema}', '4'), p_utente);

  for v_r in select * from jsonb_array_elements(v_tabelle -> 'prodotto') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.prodotto (id, famiglia_id, codice, ingrediente_id, nome, quantita, unita)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'codice',
        interno.id_ripristinato(p_famiglia, v_r ->> 'ingrediente_id'), v_r ->> 'nome', (v_r ->> 'quantita')::numeric, v_r ->> 'unita');
  end loop;
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'scontrino') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.scontrino (id, famiglia_id, negozio, data, ora, totale, impronta, testo, acquisto_id)
      values (interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, v_r ->> 'negozio', (v_r ->> 'data')::date, v_r ->> 'ora',
        (v_r ->> 'totale')::numeric, v_r ->> 'impronta', v_r ->> 'testo',
        (select a.id from public.acquisto a where a.id = interno.nuovo_id(p_famiglia, v_r ->> 'acquisto_id')));
  end loop;
  update public.acquisto a set scontrino_id = s.id
    from jsonb_array_elements(v_tabelle -> 'acquisto') x(e)
    join public.scontrino s on s.id = interno.nuovo_id(p_famiglia, x.e ->> 'scontrino_id')
   where x.e ->> 'scontrino_id' is not null and a.id = interno.nuovo_id(p_famiglia, x.e ->> 'id');
  for v_r in select * from jsonb_array_elements(v_tabelle -> 'scontrino_riga') loop
    if v_r ->> 'eliminato_il' is not null then continue; end if;
    insert into public.scontrino_riga (id, famiglia_id, scontrino_id, descrizione, prezzo, acquisto_riga_id)
      select interno.nuovo_id(p_famiglia, v_r ->> 'id'), p_famiglia, s.id, v_r ->> 'descrizione', (v_r ->> 'prezzo')::numeric,
        (select r.id from public.acquisto_riga r where r.id = interno.nuovo_id(p_famiglia, v_r ->> 'acquisto_riga_id'))
      from public.scontrino s where s.id = interno.nuovo_id(p_famiglia, v_r ->> 'scontrino_id');
  end loop;
  return v_conta;
end $$;

revoke all on all functions in schema interno from public, anon, authenticated;
grant execute on function interno.sono_membro(uuid), interno.sono_amministratore(uuid) to authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;
revoke all on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) from public, anon;
grant execute on function public.applica_comando(jsonb), public.scarica_modifiche(uuid, bigint, integer) to authenticated;
