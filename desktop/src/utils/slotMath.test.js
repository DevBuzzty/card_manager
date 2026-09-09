import { test } from 'node:test';
import assert from 'node:assert/strict';
import { next, firstFree } from './slotMath.js';

test('next rueckt innerhalb der Seite vor', () => {
  assert.deepEqual(next(3, 4, 9), { page: 3, slot: 5 });
});

test('next blaettert am Seitenende um', () => {
  assert.deepEqual(next(3, 9, 9), { page: 4, slot: 1 });
  assert.deepEqual(next(3, 4, 4), { page: 4, slot: 1 });
  assert.deepEqual(next(3, 12, 12), { page: 4, slot: 1 });
});

test('firstFree bei leerem Binder ist Seite 1 Fach 1', () => {
  assert.deepEqual(firstFree([], 9), { page: 1, slot: 1 });
});

test('firstFree findet die Luecke, nicht das Ende', () => {
  // Fach 2 auf Seite 1 ist frei -- der Vorschlag muss dorthin, nicht hinter das letzte.
  const belegt = [{ page: 1, slot: 1 }, { page: 1, slot: 3 }, { page: 1, slot: 4 }];
  assert.deepEqual(firstFree(belegt, 9), { page: 1, slot: 2 });
});

test('firstFree geht bei voller Seite auf die naechste', () => {
  const volleSeite = [1, 2, 3, 4].map((slot) => ({ page: 1, slot }));
  assert.deepEqual(firstFree(volleSeite, 4), { page: 2, slot: 1 });
});

test('firstFree ueberspringt eine ganz volle Seite und findet die Luecke dahinter', () => {
  const belegt = [1, 2, 3, 4].map((slot) => ({ page: 1, slot }))
    .concat([{ page: 2, slot: 1 }, { page: 2, slot: 3 }]);
  assert.deepEqual(firstFree(belegt, 4), { page: 2, slot: 2 });
});

test('firstFree ignoriert Faecher jenseits der Seitengroesse', () => {
  // Ein Datensatz aus einer frueheren, groesseren Seitengroesse darf nicht dazu fuehren,
  // dass ein gueltiges Fach als belegt gilt.
  const belegt = [{ page: 1, slot: 1 }, { page: 1, slot: 7 }];
  assert.deepEqual(firstFree(belegt, 4), { page: 1, slot: 2 });
});

test('unsinnige Eingaben werfen nicht', () => {
  assert.doesNotThrow(() => next(0, 0, 0));
  assert.doesNotThrow(() => next(-3, -1, 9));
  assert.doesNotThrow(() => firstFree([{ page: 0, slot: 0 }], 0));
});

test('firstFree wirft auch bei sehr vielen belegten Faechern nicht (kein Math.max(...arr))', () => {
  // Zwillings-Kreuzprobe: Math.max(...array) sprengt ab ein paar zehntausend Elementen die
  // Aufrufstapel-Grenze der Engine -- ein Wurf, den es laut Kopfkommentar nie geben darf und
  // den Kotlins maxOf (kein Argument-Spread) so nicht kennt.
  const volleSeiten = [];
  for (let pg = 1; pg <= 150000; pg++) volleSeiten.push({ page: pg, slot: 1 });
  assert.doesNotThrow(() => firstFree(volleSeiten, 9));
  assert.deepEqual(firstFree(volleSeiten, 9), { page: 1, slot: 2 });
});
