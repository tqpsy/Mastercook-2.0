/** Il database sul dispositivo gira in un worker, così l'app resta fluida mentre lavora. */
import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';

void worker({
  init: (opzioni) => PGlite.create({ dataDir: opzioni.dataDir, relaxedDurability: true }),
});
