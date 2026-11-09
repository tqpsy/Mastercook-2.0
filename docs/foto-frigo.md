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

## Lettura in background

La foto singola non si legge più dal telefono (che passando a un'altra app viene sospeso e interrompe la richiesta):

1. L'app (`src/piattaforma/letturaFoto.ts`) manda la foto con un id (`lettura_id`). La funzione apre la lettura
   (`public.nuova_lettura_foto`, solo `service_role`), risponde subito `202` e continua da sola
   (`EdgeRuntime.waitUntil`). Mandare lo stesso id due volte non fa doppi effetti.
2. Alla fine scrive gli alimenti (mai la foto) in `interno.lettura_foto` (`public.chiudi_lettura_foto`). Si cancellano
   dopo due giorni. Una lettura rimasta «in corso» più di quattro minuti risulta errore.
3. L'app chiede com'è andata con `public.leggi_lettura_foto(id)` (solo i membri della famiglia) ogni pochi secondi e
   subito appena torna in primo piano. Se la foto non risulta arrivata (telefono in tasca durante l'invio) la rimanda
   con lo stesso id. L'id si ricorda sul dispositivo: riaprendo l'app il risultato si ritrova.
4. Lo stato vive fuori dal foglio: si può chiudere, cambiare scheda o usare l'app. In alto compare un avviso
   (`AvvisoLetturaFoto`) che riporta al risultato.

Famiglia «solo su questo telefono»: non c'è un server che lavori al posto del telefono. La lettura continua mentre
si naviga nell'app (e lo schermo resta acceso), ma non con l'app in secondo piano; se si interrompe si riprova con
la stessa foto.

Per essere esatta la lettura usa i modelli pieni (`MODELLI`), la foto a 1536 px e `mediaResolution` alta, con
ragionamento libero; è più lenta, e per questo sta in background.

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

## Verifica dell'inventario con le foto

Casa › «Verifica con le foto»: non serve a riempire la casa da zero ma a controllarla.

1. Si scelgono le zone (ripiani, cassetto, porta… modificabili: `imposta_zone_verifica`) e si scattano una o più
   foto per zona (al più 4, anche da angolazioni diverse), in modo guidato (una zona dopo l'altra) o libero.
2. Per ogni zona l'app manda alla funzione (`tipo: 'verifica'`) le foto e un contesto testuale
   (`contestoPerGemini` in `src/dominio/verifica.ts`): prodotti registrati con un codice, dove stanno di solito,
   ingredienti del menu dei prossimi giorni (detti esplicitamente «non è una prova»), correzioni ed errori ricorrenti
   della famiglia. Gemini risponde `{nome, codice, quantita, unita, certezza}` con certezza sicuro/probabile/incerto.
3. `confronta` mette insieme le zone: non visti (solo per le zone fotografate: un alimento non visto non è per forza
   finito), quantità diverse, nuovi, incerti, coerenti. La verifica rapida mostra solo le anomalie, la completa tutto.
4. Per ogni riga la persona decide (presente, terminato, quantità, prodotto giusto, non verificabile, non c'è) e vede
   un riepilogo. Solo dopo «Conferma» parte il comando `verifica_inventario`: correzioni con nota
   «Verifica con foto: da X a Y» nella cronologia del lotto, alimenti nuovi con origine `foto`.

**Posto sbagliato (igiene)**: per ciò che si vede in una zona legata a una parte del frigo, `controllaPosto`
(`src/dominio/verifica.ts`) usa le regole del configuratore (`postoIngrediente` in `src/dominio/frigo.ts`). Gravi, anche
nella verifica rapida («Al posto sbagliato»): carne e pesce crudi fuori dal ripiano più basso (gocciolando contaminano
cibi pronti, frutta e verdura), latte, uova e latticini nello sportello (sbalzi di temperatura). Gli altri sono consigli,
solo nella completa. «L'ho spostato» manda `posto` con l'operazione (migrazione `20261115002100_verifica_posto.sql`);
nessuno spostamento è automatico.

Cosa impara (in `famiglia.impostazioni.verifica.memoria`, uguale su tutti i dispositivi): il prodotto giusto per un
nome visto (alias), i nomi visti per errore (dopo due volte la certezza scende), dove sta di solito ogni alimento.
**Non c'è nessun addestramento del modello**: le foto non si salvano e non si usano per addestrare niente. Migliorare
il modello con immagini verificate richiederebbe di conservarle e il consenso esplicito della famiglia: non è fatto.
