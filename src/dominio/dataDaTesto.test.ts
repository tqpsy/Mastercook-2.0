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
  it('legge l’anno per primo (2026-03-15)', () => {
    expect(dateNelTesto('EXP 2027-03-15')).toEqual(['2027-03-15']);
    expect(dateNelTesto('2027.3.5')).toEqual(['2027-03-05']);
  });
  it('mesi attaccati ai numeri e mesi in inglese', () => {
    expect(dateNelTesto('12OTT2027')).toEqual(['2027-10-12']);
    expect(dateNelTesto('AGO2027')).toEqual(['2027-08-31']);
    expect(dateNelTesto('EXP 12 OCT 2027')).toEqual(['2027-10-12']);
    expect(dateNelTesto('DEC 2027')).toEqual(['2027-12-31']);
  });
  it('corregge la O letta al posto dello zero solo dentro i numeri', () => {
    expect(dateNelTesto('scad. 15/O3/2027')).toEqual(['2027-03-15']);
    expect(dateNelTesto('15/03/2O27')).toEqual(['2027-03-15']);
  });
  it('una parola prima della data non la fa perdere', () => {
    expect(dateNelTesto('LOTTO 5 SCAD 12/2027')).toEqual(['2027-12-31']);
    expect(dataDiScadenza('L 12 05 24 SCAD 10.2027')?.data).toBe('2027-10-31');
  });
  it('foto vere di confezioni', () => {
    // Tetrapak: data a puntini, poi l'ora.
    expect(dataDiScadenza('14:54(1)\n14.02.27E\nDa consumarsi preferibilmente entro il')).toEqual({ data: '2027-02-14', tipo: 'tmc' });
    // Lattina: i puntini a metà riga sono letti come «:».
    expect(dateNelTesto('31/12:27 RSJ02 1210.00 L 5330 001 32 16:45')).toEqual(['2027-12-31']);
    // Tappo: data, lotto e ora.
    expect(dateNelTesto('17/06/2027\nC53-26168-G-01:47-168')).toEqual(['2027-06-17']);
    // Barattolo di spezie: lotto, codice stampato e mese/anno.
    expect(dataDiScadenza('5001904/0924 LR6128A 05/2030 entro fine:')).toEqual({ data: '2030-05-31' });
  });
});
