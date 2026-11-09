-- Foto del frigo letta dal server anche a telefono in tasca.
--
-- Prima la richiesta a Gemini partiva dal telefono: passando a un'altra app il sistema sospendeva la pagina e la
-- lettura si interrompeva. Ora l'app manda la foto con un id, la funzione «foto-frigo» risponde subito e finisce il
-- lavoro da sola; l'app, quando torna, chiede com'è andata con `leggi_lettura_foto`.
-- Qui sta solo il risultato (gli alimenti riconosciuti, mai la foto) e si cancella dopo due giorni.
-- Non passa dai comandi: è un risultato temporaneo, non un dato della famiglia, e non finisce nella cronologia.

create table interno.lettura_foto (
  id uuid primary key,
  famiglia_id uuid not null references public.famiglia (id) on delete cascade,
  stato text not null default 'in_corso' check (stato in ('in_corso', 'pronta', 'errore')),
  risultato jsonb,
  creata_il timestamptz not null default now(),
  chiusa_il timestamptz
);
create index lettura_foto_creata_idx on interno.lettura_foto (creata_il);
revoke all on interno.lettura_foto from public, anon, authenticated;

-- Solo per la funzione sul server: apre la lettura. Ripetere lo stesso id non fa doppi effetti (restituisce false).
create function public.nuova_lettura_foto(p_id uuid, p_famiglia uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_nuova int;
begin
  delete from interno.lettura_foto where creata_il < now() - interval '2 days';
  insert into interno.lettura_foto (id, famiglia_id) values (p_id, p_famiglia) on conflict (id) do nothing;
  get diagnostics v_nuova = row_count;
  return v_nuova = 1;
end
$$;

-- Solo per la funzione sul server: chiude la lettura con gli alimenti trovati o con l'errore.
create function public.chiudi_lettura_foto(p_id uuid, p_stato text, p_risultato jsonb) returns void
language sql security definer set search_path = '' as $$
  update interno.lettura_foto
     set stato = p_stato, risultato = p_risultato, chiusa_il = now()
   where id = p_id and stato = 'in_corso' and p_stato in ('pronta', 'errore')
$$;

-- Per l'app: com'è andata la lettura. Solo i membri della famiglia la vedono. Una lettura rimasta «in corso» per più
-- di quattro minuti è andata persa (la funzione si è fermata): si dice come errore, così l'app non aspetta per sempre.
create function public.leggi_lettura_foto(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
           when l.stato = 'in_corso' and l.creata_il < now() - interval '4 minutes'
             then jsonb_build_object('stato', 'errore', 'risultato', jsonb_build_object('errore', 'gemini', 'dettaglio', 'lettura interrotta'))
           else jsonb_build_object('stato', l.stato, 'risultato', l.risultato)
         end
    from interno.lettura_foto l
   where l.id = p_id and interno.sono_membro(l.famiglia_id)
$$;

revoke all on function public.nuova_lettura_foto(uuid, uuid), public.chiudi_lettura_foto(uuid, text, jsonb), public.leggi_lettura_foto(uuid)
  from public, anon, authenticated;
grant execute on function public.nuova_lettura_foto(uuid, uuid), public.chiudi_lettura_foto(uuid, text, jsonb) to service_role;
grant execute on function public.leggi_lettura_foto(uuid) to authenticated;
