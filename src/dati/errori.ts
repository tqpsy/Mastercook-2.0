/**
 * Che cosa vuol dire un errore della chiamata al server.
 * - Rete assente, server che non risponde, troppe richieste, errori 5xx: transitorio, il comando si ripresenta dopo.
 * - Il server ha risposto e ha detto no (dati rifiutati, permesso negato): ripresentarlo non servirebbe mai, quindi il
 *   comando va in «da sistemare» invece di restare per sempre in coda come se mancasse la rete.
 * Il 404 non è tra questi: durante un aggiornamento l'app può essere più nuova del database, e un comando perso lì
 * sarebbe un dato perso.
 */
const RIFIUTI_DEL_SERVER = new Set([400, 403, 409, 413, 422]);

export function eRifiutoDelServer(stato: number | undefined): boolean {
  return stato !== undefined && RIFIUTI_DEL_SERVER.has(stato);
}
