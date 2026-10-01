// Calendario della liquidazione: giorni TARGET (T2) e passaggio a T+1 dall'11/10/2027.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { day, fmt, addBusinessDays, isTargetDay, settlementLag } from '../src/core/dates.js';

test('T+2 sul calendario TARGET', () => {
  assert.equal(fmt(addBusinessDays(day(2026, 9, 30), 2)), '02/10/2026', 'dati STFI del 30/09/2026');
  assert.equal(fmt(addBusinessDays(day(2026, 12, 23), 2)), '28/12/2026', 'Natale e Santo Stefano chiusi');
  assert.equal(fmt(addBusinessDays(day(2027, 3, 24), 2)), '30/03/2027', 'Venerdì Santo e Lunedì dell\'Angelo 2027');
  assert.equal(fmt(addBusinessDays(day(2026, 12, 30), 2)), '04/01/2027', 'Capodanno');
});

test('giorni TARGET: chiusure di T2, non quelle di Borsa', () => {
  assert.equal(isTargetDay(day(2026, 4, 3)), false, 'Venerdì Santo 2026');
  assert.equal(isTargetDay(day(2026, 4, 6)), false, 'Lunedì dell\'Angelo 2026');
  assert.equal(isTargetDay(day(2026, 12, 24)), true, 'la Borsa chiude, T2 no');
  assert.equal(isTargetDay(day(2026, 12, 31)), true, 'la Borsa chiude, T2 no');
  assert.equal(isTargetDay(day(2025, 8, 15)), true, 'Ferragosto: T2 aperto');
});

test('ciclo di liquidazione: T+1 dall\'11/10/2027', () => {
  assert.equal(settlementLag(day(2027, 10, 8)), 2);
  assert.equal(settlementLag(day(2027, 10, 11)), 1);
});
