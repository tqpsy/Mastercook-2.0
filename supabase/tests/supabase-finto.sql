-- Solo per i test: riproduce la parte di Supabase che lo schema usa (ruoli, auth.users, auth.uid()).
-- Su Supabase vero questi oggetti esistono già e il file non si applica.
-- I file di test girano in parallelo e i ruoli sono comuni a tutti i database: chi arriva secondo
-- trova il ruolo già creato e va avanti.
do $$ begin
  begin create role anon nologin; exception when duplicate_object or unique_violation then null; end;
  begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end;
  begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end;
end $$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
