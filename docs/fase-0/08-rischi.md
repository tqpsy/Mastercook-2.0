# 08 · Analisi dei rischi

Mastercook 2.0, Fase 0, 26 ottobre 2026.

Per ogni rischio: probabilità, impatto, cosa lo riduce.

---

1. **Supabase cambia le condizioni del piano gratuito o mette in pausa il progetto.**
   Probabilità media nel lungo periodo, impatto alto.
   Riduzione: uso quotidiano; controllo automatico settimanale dalla CI; esportazione mensile; schema Postgres standard, spostabile su un altro Postgres.

2. **L'offline con coda di comandi è più complesso del previsto.**
   Probabilità media, impatto alto.
   Riduzione: è la prima cosa che costruisco (Fase 1) con il simulatore di dispositivi e i test di concorrenza, prima di qualsiasi interfaccia ricca.

3. **Conflitti percepiti come fastidiosi dalla famiglia.**
   Probabilità media, impatto medio.
   Riduzione: unione automatica per campi diversi; conflitti solo sullo stesso campo; domande in italiano semplice; misura di quanti conflitti avvengono davvero.

4. **La famiglia non conferma acquisti e pasti, e la casa diventa imprecisa.**
   Probabilità alta, impatto alto. Vale per qualunque architettura.
   Riduzione: conferma con un tocco dalla schermata Oggi; promemoria dopo i pasti; correzioni facili; nessuna sottrazione automatica che finga precisione.

5. **Dati non cifrati end-to-end.**
   Certezza (è una scelta), impatto dipende dalla tua sensibilità.
   Riduzione: regione UE, accesso per famiglia verificato da test, dati minimi, chiave di servizio mai nel codice. Decisione D2.

6. **Lettura degli scontrini imprecisa.**
   Probabilità alta, impatto basso.
   Riduzione: schermata di revisione obbligatoria; abbinamenti ricordati; Gemini facoltativo.

7. **Riconoscimento del frigo da foto inaffidabile.**
   Probabilità alta, impatto basso.
   Riduzione: solo proposte da confermare; alternativa manuale completa; arriva in Fase 6.

8. **Stime di scadenza scambiate per garanzie di sicurezza.**
   Probabilità media, impatto alto (salute).
   Riduzione: etichetta «stima» sempre visibile; nessuna stima per i confezionati; testo esplicito sulla sicurezza; nessun «sicuro» oltre la data.

9. **Vincoli alimentari incompleti.**
   Probabilità media, impatto alto (salute).
   Riduzione: «da verificare» quando mancano dati; vincoli prima di tutto nel generatore; test dedicati.

10. **Limiti gratuiti di Gemini.**
    Probabilità media, impatto basso.
    Riduzione: usato solo per funzioni facoltative; contatore dell'uso; Tesseract come base.

11. **Rinnovo della sessione sul tablet.**
    Probabilità bassa con Supabase (rinnovo con token proprio), impatto medio.
    Riduzione: prova di 8 ore in Fase 1.

12. **Dispositivi non aggiornati.**
    Probabilità media, impatto basso.
    Riduzione: sola lettura automatica e invito ad aggiornare; aggiornamento automatico sul tablet.

13. **Tempi più lunghi delle stime.**
    Probabilità media, impatto medio.
    Riduzione: fasi piccole con revisione; la versione quotidiana arriva alla Fase 5, le funzioni intelligenti dopo.

14. **Due app in uso contemporaneamente durante la transizione.**
    Probabilità media, impatto medio.
    Riduzione: dati separati (il nuovo non legge né scrive il vecchio); migrazione solo in Fase 7; vecchio intatto come ripiego.

15. **Spazio delle foto.**
    Probabilità bassa, impatto medio.
    Riduzione: compressione; avviso all'80%; le foto del frigo non si conservano.
