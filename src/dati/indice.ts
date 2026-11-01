/**
 * L'indice di ingredienti e ricette per l'interfaccia: il catalogo di sistema (caricato a parte, così
 * la prima schermata resta leggera) più ingredienti e ricette della famiglia dalla copia locale.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Catalogo } from '../catalogo/tipi';
import { Indice, ingredienteDellaFamiglia, ricetteDellaFamiglia } from '../dominio/ricette';
import { segniDa } from '../dominio/suggerimenti';
import type { Vista } from './contesto';

let caricato: Catalogo | null = null;
const promessa: Promise<Catalogo> = import('../catalogo/catalogo.json').then((m) => (caricato = m.default as Catalogo));

export function useCatalogo(): Catalogo | null {
  const [c, setC] = useState<Catalogo | null>(caricato);
  useEffect(() => {
    if (c) return;
    let valido = true;
    void promessa.then((x) => valido && setC(x));
    return () => {
      valido = false;
    };
  }, [c]);
  return c;
}

export function useIndice(vista: Vista): Indice | null {
  const catalogo = useCatalogo();
  const { ingrediente, ricetta, ricetta_ingrediente, ricetta_passo, famiglia } = vista.righe;
  const modificate = JSON.stringify((attiveDi(famiglia)[0]?.impostazioni as Record<string, unknown> | undefined)?.modificate ?? []);
  return useMemo(() => {
    if (!catalogo) return null;
    const ing = attiveDi(ingrediente).map(ingredienteDellaFamiglia);
    const ric = ricetteDellaFamiglia(attiveDi(ricetta), attiveDi(ricetta_ingrediente), attiveDi(ricetta_passo));
    return new Indice(catalogo, ing, ric, segniDa({ modificate: JSON.parse(modificate) }).modificate);
  }, [catalogo, ingrediente, ricetta, ricetta_ingrediente, ricetta_passo, modificate]);
}

function attiveDi<T extends { eliminato_il?: unknown }>(righe: T[] | undefined): T[] {
  return (righe ?? []).filter((r) => !r.eliminato_il);
}

