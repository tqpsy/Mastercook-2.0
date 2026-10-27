-- Fase 2 · Foto delle ricette della famiglia.
--
-- Deposito privato «foto» di Supabase Storage: una cartella per famiglia (`<famiglia>/<uuid>.jpg`).
-- Leggono e scrivono solo i membri di quella famiglia; i file sono al massimo 2 MB, JPEG o WebP
-- (l'app li riduce a 1280 px prima di caricarli). Il percorso si salva nella ricetta con
-- salva_ricetta, dopo che il file è stato caricato.
--
-- Le foto non entrano nel file di esportazione: restano nel deposito finché la famiglia esiste.
-- Una foto sostituita non si cancella subito (resta possibile tornare indietro); la pulizia dei file
-- non più usati è prevista più avanti.

create function interno.famiglia_della_foto(p_nome text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_nome, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end $$;

revoke all on function interno.famiglia_della_foto(text) from public, anon, authenticated;
grant execute on function interno.famiglia_della_foto(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('foto', 'foto', false, 2097152, array['image/jpeg', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy foto_leggi on storage.objects for select to authenticated
  using (bucket_id = 'foto' and interno.sono_membro(interno.famiglia_della_foto(name)));

create policy foto_carica on storage.objects for insert to authenticated
  with check (bucket_id = 'foto' and interno.sono_membro(interno.famiglia_della_foto(name))
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$');

create policy foto_sostituisci on storage.objects for update to authenticated
  using (bucket_id = 'foto' and interno.sono_membro(interno.famiglia_della_foto(name)))
  with check (bucket_id = 'foto' and interno.sono_membro(interno.famiglia_della_foto(name)));

create policy foto_cancella on storage.objects for delete to authenticated
  using (bucket_id = 'foto' and interno.sono_membro(interno.famiglia_della_foto(name)));
