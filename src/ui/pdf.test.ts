import { describe, expect, it } from 'vitest';
import { byteDelFile, ErrorePdf } from './pdf';

describe('byte di un PDF scelto sul telefono', () => {
  it('si leggono subito e tali e quali', async () => {
    const dati = await byteDelFile(new Blob([new Uint8Array([37, 80, 68, 70, 45])], { type: 'application/pdf' }));
    expect([...dati]).toEqual([37, 80, 68, 70, 45]);
  });

  it('un file che il telefono dà vuoto è un errore chiaro, di fase «file», con la dimensione dichiarata', async () => {
    const errore = await byteDelFile(new Blob([])).catch((e: unknown) => e);
    expect(errore).toBeInstanceOf(ErrorePdf);
    expect(errore).toMatchObject({ fase: 'file', message: expect.stringContaining('file vuoto') });
  });
});
