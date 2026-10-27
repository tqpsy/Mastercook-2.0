# Foto del frigo (Fase 6)

Con una foto di frigo, freezer o dispensa, Gemini di Google propone gli alimenti che vede. L'app li abbina al
catalogo e in casa entra solo ciò che la persona spunta e conferma, con le quantità scritte o corrette da lei.

## Come funziona

1. L'app riduce la foto (lato massimo come le altre foto, JPEG) e la manda alla Edge Function `foto-frigo`.
2. La funzione controlla che chi chiama faccia parte della famiglia: legge la riga `famiglia` con il token
   dell'utente, sotto RLS. Senza riga risponde `non_autorizzato`.
3. Chiama Gemini con la chiave della famiglia (`GEMINI_API_KEY`, segreto del server): prova i modelli gratuiti in
   ordine (`MODELLI` in `supabase/functions/foto-frigo/nucleo.ts`) e passa al successivo quando la quota di uno è
   finita. Quando finiscono tutti risponde `quota`.
4. La risposta è una lista `{nome, quantita, unita}`; l'app la abbina al catalogo (`src/dominio/fotoFrigo.ts`).
   Ciò che non trova resta da aggiungere a mano.

## Privacy e costi

- Costo: 0 €, chiave gratuita di Google AI Studio (scelta di Luca, 27/10/2026).
- Con il piano gratuito Google può usare foto e testi per migliorare i suoi servizi: l'app lo dice prima del primo
  uso e chiede di non fotografare persone o documenti.
- La foto non si salva: né nel database né nel deposito delle foto. Passa dalla funzione a Google e basta.
- La chiave non arriva mai sui telefoni e non è nel codice: è solo nei segreti di GitHub e del progetto Supabase.

## Pubblicazione

Il workflow «Pubblica» (job `funzioni`) pubblica la funzione e, se il segreto GitHub `GEMINI_API_KEY` c'è, lo copia
nei segreti di Supabase. Senza chiave la funzione risponde `non_configurata` e l'app spiega che la foto non è ancora attiva.
