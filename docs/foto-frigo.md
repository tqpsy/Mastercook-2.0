# Foto del frigo (Fase 6)

Con una foto di frigo, freezer o dispensa, Gemini di Google propone gli alimenti che vede. L'app li abbina al
catalogo e in casa entra solo ciò che la persona spunta e conferma, con le quantità scritte o corrette da lei.

## Come funziona

1. L'app riduce la foto (lato massimo come le altre foto, JPEG) e la manda alla Edge Function `foto-frigo`.
2. La funzione controlla che chi chiama faccia parte della famiglia: legge la riga `famiglia` con il token
   dell'utente, sotto RLS. Senza riga risponde `non_autorizzato`.
3. Sceglie la chiave (vedi sotto) e chiama Gemini: prova i modelli gratuiti in
   ordine (`MODELLI` in `supabase/functions/foto-frigo/nucleo.ts`) e passa al successivo quando la quota di uno è
   finita. Quando finiscono tutti risponde `quota`.
4. La risposta è una lista `{nome, quantita, unita}`; l'app la abbina al catalogo (`src/dominio/fotoFrigo.ts`).
   Ciò che non trova resta da aggiungere a mano.

## Quale chiave

- **La chiave della famiglia**, se c'è. Chi amministra la scrive in Impostazioni → Foto del frigo
  (`public.imposta_chiave_gemini`, migrazione `20261109000000_chiave_gemini_famiglia.sql`). Sta in
  `interno.chiave_gemini`, che i telefoni non possono leggere: si vedono solo le ultime 4 cifre
  (`public.stato_chiave_gemini`). La legge solo la funzione, con la chiave segreta del progetto
  (`public.chiave_gemini_per_foto`, eseguibile solo da `service_role`). Non passa dai comandi, quindi non è nella
  cronologia che i dispositivi scaricano.
- Altrimenti **la chiave del progetto** (`GEMINI_API_KEY`), ma solo per le famiglie amministrate da chi
  amministrava una famiglia quando è stata introdotta la chiave per famiglia (cioè chi gestisce l'app).
  Le famiglie degli amici usano la loro: sono autonome e non consumano la quota di nessun altro.
- Senza chiave la funzione risponde `non_configurata` e l'app dice di inserirla in Impostazioni.

## Privacy e costi

- Termini di Gemini (ai.google.dev/gemini-api/terms, letti il 27/10/2026): per chi è nello Spazio economico europeo,
  in Svizzera o nel Regno Unito valgono le regole dati del piano a pagamento anche sulla quota gratuita, quindi Google
  non usa foto e risposte per migliorare i suoi prodotti; le conserva per un periodo limitato per i controlli contro
  gli abusi. L'app lo dice prima del primo uso e chiede di non fotografare persone o documenti.
- Gli stessi termini chiedono il piano a pagamento quando un'app è offerta a utenti europei e richiedono utenti
  maggiorenni: in Impostazioni si consiglia di attivare la fatturazione sul progetto della chiave (pochi centesimi
  al mese con qualche foto al giorno).
- La foto non si salva: né nel database né nel deposito delle foto. Passa dalla funzione a Google e basta.
- Nessuna chiave arriva sui telefoni o nel codice.

## Pubblicazione

Il workflow «Pubblica» (job `funzioni`) pubblica la funzione e, se il segreto GitHub `GEMINI_API_KEY` c'è, lo copia
nei segreti di Supabase. Le chiavi delle famiglie invece stanno nel database e non servono nuove pubblicazioni.
