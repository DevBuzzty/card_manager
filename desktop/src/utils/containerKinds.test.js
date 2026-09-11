import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_LABELS, KIND_OPTIONS } from './containerKinds.js';

test('die drei Behaelterarten tragen ihre deutschen Beschriftungen', () => {
  assert.deepEqual(KIND_LABELS, { binder: 'Ordner', box: 'Box', deckbox: 'Deckbox' });
});

test('KIND_OPTIONS ist die Ableitung von KIND_LABELS -- gleiche Beschriftung, gleiche Reihenfolge', () => {
  assert.deepEqual(KIND_OPTIONS, [
    { value: 'binder', label: 'Ordner' },
    { value: 'box', label: 'Box' },
    { value: 'deckbox', label: 'Deckbox' },
  ]);
});

test('keine Beschriftung steht zweimal da: jede Option findet sich in der Tabelle wieder', () => {
  // Der eigentliche Fund des Abschlussreviews -- wer "Ordner" umbenennt, benennt beides um.
  for (const { value, label } of KIND_OPTIONS) assert.equal(KIND_LABELS[value], label);
  assert.equal(KIND_OPTIONS.length, Object.keys(KIND_LABELS).length);
});

test('eine unbekannte Art hat keine Beschriftung -- der Rueckfall bleibt Sache der Ansicht', () => {
  // Die drei Verwendungsstellen schreiben `KIND_LABELS[kind] || kind`; dafuer muss hier
  // undefined herauskommen und keine erfundene Beschriftung.
  assert.equal(KIND_LABELS.tresor, undefined);
});
