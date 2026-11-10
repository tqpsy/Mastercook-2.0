import { describe, expect, it } from 'vitest';
import { dataDiScadenza, dateNelTesto } from './dataDaTesto';

describe('dataDiScadenza', () => {
  it('legge giorno, mese e anno con vari separatori', () => {
    expect(dateNelTesto('SCAD 12/05/2027')).toEqual(['2027-05-12']);
    expect(dateNelTesto('12.05.27')).toEqual(['2027-05-12']);
    expect(dateNelTesto('12-5-2027')).toEqual(['2027-05-12']);
  });
  it('legge il mese scritto a lettere', () => {
    expect(dateNelTesto('12 MAG 2027')).toEqual(['2027-05-12']);
    expect(dateNelTesto('12MAG27')).toEqual(['2027-05-12']);
  });
  it('con solo mese e anno usa l’ultimo giorno del mese', () => {
    expect(dateNelTesto('TMC 02/2028')).toEqual(['2028-02-29']);
  });
  it('scarta le date impossibili', () => {
    expect(dateNelTesto('31/02/2027 45/13/2027')).toEqual([]);
  });
  it('sceglie la più lontana e riconosce il tipo', () => {
    expect(dataDiScadenza('Prod. 01/03/2026 Da consumarsi entro 15/09/2026')).toEqual({ data: '2026-09-15', tipo: 'scadenza' });
    expect(dataDiScadenza('Da consumarsi preferibilmente entro fine: 10/2027')).toEqual({ data: '2027-10-31', tipo: 'tmc' });
    expect(dataDiScadenza('nessuna data')).toBeNull();
  });
});
