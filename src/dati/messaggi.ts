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
};

export function descriviAzione(tipo: string): string {
  return AZIONI[tipo] ?? tipo;
}
