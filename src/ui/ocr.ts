/**
 * Lettura del testo di una foto, sul telefono, con Tesseract (italiano). La libreria si carica solo
 * alla prima foto e scarica una volta il suo motore e il vocabolario italiano: la foto non esce mai
 * dal dispositivo.
 */
export async function leggiTestoDaFoto(foto: Blob, avanzamento: (frazione: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const lettore = await createWorker('ita', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') avanzamento(m.progress);
    },
  });
  try {
    const { data } = await lettore.recognize(foto);
    return data.text;
  } finally {
    await lettore.terminate();
  }
}
