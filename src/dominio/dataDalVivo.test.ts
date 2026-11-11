import { describe, expect, it } from 'vitest';
import { nuovaConferma } from './dataDalVivo';

describe('conferma della data dal vivo', () => {
  it('serve la stessa data due volte', () => {
    const c = nuovaConferma();
    expect(c.registra({ data: '2027-02-14' })).toBeNull();
    expect(c.registra({ data: '2027-02-14', tipo: 'tmc' })).toEqual({ data: '2027-02-14', tipo: 'tmc' });
  });
  it('una lettura storta non conferma nulla', () => {
    const c = nuovaConferma();
    expect(c.registra({ data: '2027-02-14' })).toBeNull();
    expect(c.registra({ data: '2027-02-11' })).toBeNull();
    expect(c.registra({ data: '2029-12-31' })).toBeNull();
  });
  it('i fotogrammi senza data non azzerano ma contano nella finestra', () => {
    const c = nuovaConferma(3);
    expect(c.registra({ data: '2027-02-14' })).toBeNull();
    expect(c.registra(null)).toBeNull();
    expect(c.registra({ data: '2027-02-14' })).toEqual({ data: '2027-02-14' });
    const d = nuovaConferma(3);
    d.registra({ data: '2027-02-14' });
    d.registra(null);
    d.registra(null);
    expect(d.registra({ data: '2027-02-14' })).toBeNull();
  });
});
