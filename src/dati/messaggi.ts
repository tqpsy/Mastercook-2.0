/** Spiegazioni in italiano degli esiti del server, per chi usa l'app. */
const MOTIVI: Record<string, string> = {
  stesso_campo: "Qualcun altro ha cambiato la stessa cosa nel frattempo.",
  eliminato: 'Nel frattempo è stato eliminato da un altro dispositivo.',
  non_trovato: 'Non esiste più.',
  dati_non_validi: 'Alcuni dati non sono validi.',
  nessun_campo: 'Non c’era niente da cambiare.',
  solo_amministratore: 'Solo chi amministra la famiglia può farlo.',
  ultimo_amministratore: 'Serve almeno un amministratore nella famiglia.',
  membro_non_trovato: 'La persona non esiste più.',
  famiglia_esistente: 'Questa famiglia esiste già.',
  invito_scaduto: 'L’invito è scaduto. Chiedine uno nuovo.',
  invito_esaurito: 'L’invito è già stato usato da tutte le persone previste. Chiedine uno nuovo.',
  invito_revocato: 'L’invito è stato annullato. Chiedine uno nuovo.',
  invito_sconosciuto: 'Questo invito non esiste. Controlla il link.',
  non_autorizzato: 'Non fai più parte di questa famiglia.',
  app_da_aggiornare: 'C’è una versione nuova dell’app: aggiornala per continuare a salvare.',
  non_autenticato: 'Accedi di nuovo per continuare a salvare.',
  tipo_sconosciuto: 'Questa versione dell’app non sa ancora fare questa operazione.',
  comando_malformato: 'Operazione non valida.',
  id_gia_usato: 'Operazione non valida.',
  unita_incompatibile: 'L’unità non va bene per questo ingrediente (per esempio grammi di uova).',
  ricetta_di_sistema: 'Le ricette del catalogo non si modificano: duplicala per farne una tua.',
  ingrediente_di_sistema: 'Gli ingredienti del catalogo non si modificano.',
  ricetta_non_trovata: 'La ricetta di partenza non esiste più.',
  ricetta_senza_ingredienti: 'Una ricetta ha bisogno di almeno un ingrediente.',
  ricetta_senza_passaggi: 'Una ricetta ha bisogno di almeno un passaggio.',
  ingrediente_non_trovato: 'L’ingrediente non esiste più.',
  lotto_non_trovato: 'Questo prodotto non è più in casa.',
  lotto_chiuso: 'Questo prodotto è già finito.',
  quantita_insufficiente: 'Ce n’è meno di quanto volevi togliere: qualcuno l’ha già usato.',
  quantita_non_valida: 'La quantità non è valida.',
  quantita_cambiata: 'Nel frattempo qualcuno ha cambiato la quantità.',
  causale_non_ammessa: 'Operazione non valida.',
  origine_non_ammessa: 'Operazione non valida.',
  data_confezione_protetta: 'La data letta sulla confezione non si sostituisce con una stima.',
  movimento_immutabile: 'La cronologia non si modifica.',
};

export function spiegaMotivo(motivo: string | undefined): string {
  return (motivo && MOTIVI[motivo]) || 'Non è stato possibile salvare questa modifica.';
}

const AZIONI: Record<string, string> = {
  aggiungi_membro: 'Aggiungere una persona',
  modifica_membro: 'Modificare una persona',
  aggiungi_vincolo: 'Aggiungere un’allergia o un’esigenza',
  rimuovi_vincolo: 'Togliere un’allergia o un’esigenza',
  modifica_famiglia: 'Rinominare la famiglia',
  crea_invito: 'Creare un invito',
  revoca_invito: 'Annullare un invito',
  rimuovi_accesso: 'Togliere un accesso',
  crea_ingrediente: 'Aggiungere un ingrediente',
  modifica_ingrediente: 'Modificare un ingrediente',
  salva_ricetta: 'Salvare una ricetta',
  elimina_ricetta: 'Eliminare una ricetta',
  aggiungi_lotto: 'Aggiungere un prodotto in casa',
  scarica_lotto: 'Segnare un prodotto usato o buttato',
  correggi_lotto: 'Correggere una quantità',
  sposta_lotto: 'Spostare un prodotto',
  modifica_lotto: 'Modificare un prodotto',
};

export function descriviAzione(tipo: string): string {
  return AZIONI[tipo] ?? tipo;
}
