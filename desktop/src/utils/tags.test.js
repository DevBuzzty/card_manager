import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags, serializeTags, addTag, removeTag } from './tags.js';

test('parseTags vertraegt null, leer und Unsinn', () => {
  for (const bad of [null, undefined, '', '   ', 'kein json', '{"a":1}', '42', '"text"']) {
    assert.deepEqual(parseTags(bad), [], 'fiel um bei: ' + String(bad));
  }
});

test('parseTags liest ein Array und wirft Nicht-Zeichenketten weg', () => {
  assert.deepEqual(parseTags('["Kratzer", 7, null, "Tausch Max"]'), ['Kratzer', 'Tausch Max']);
});

test('parseTags beschneidet und entfernt Leere', () => {
  assert.deepEqual(parseTags('["  Kratzer  ", "   ", "Tausch"]'), ['Kratzer', 'Tausch']);
});

test('parseTags entfernt Doppelte ohne Ruecksicht auf Gross-Kleinschreibung, erste Schreibweise gewinnt', () => {
  assert.deepEqual(parseTags('["Tausch", "tausch", "TAUSCH"]'), ['Tausch']);
});

test('parseTags behaelt die Einfuegereihenfolge', () => {
  assert.deepEqual(parseTags('["Zebra", "Anton"]'), ['Zebra', 'Anton']);
});

test('serializeTags gibt bei leerer Liste null, nicht "[]"', () => {
  assert.equal(serializeTags([]), null);
  assert.equal(serializeTags(null), null);
});

test('serializeTags und parseTags sind zueinander invers', () => {
  const list = ['Kratzer', 'Tausch Max'];
  assert.deepEqual(parseTags(serializeTags(list)), list);
});

test('addTag haengt an, beschneidet und ignoriert Doppelte', () => {
  assert.deepEqual(addTag(['Kratzer'], '  Tausch '), ['Kratzer', 'Tausch']);
  assert.deepEqual(addTag(['Tausch'], 'tausch'), ['Tausch']);
  assert.deepEqual(addTag(['Tausch'], '   '), ['Tausch']);
});

test('removeTag entfernt ohne Ruecksicht auf Gross-Kleinschreibung', () => {
  assert.deepEqual(removeTag(['Kratzer', 'Tausch'], 'TAUSCH'), ['Kratzer']);
  assert.deepEqual(removeTag(['Kratzer'], 'gibtsnicht'), ['Kratzer']);
});

test('parseTags beschneidet NBSP (U+00A0) an beiden Raendern', () => {
  const nbsp = String.fromCharCode(0xa0);
  assert.deepEqual(parseTags(`["${nbsp}Tausch${nbsp}"]`), ['Tausch']);
});

test('parseTags beschneidet das Byte-Order-Zeichen (U+FEFF) am Rand', () => {
  const bom = String.fromCharCode(0xfeff);
  assert.deepEqual(parseTags(`["${bom}Tausch"]`), ['Tausch']);
});

test('parseTags entfernt einen Tag, der nur aus NBSP besteht', () => {
  const nbsp = String.fromCharCode(0xa0);
  assert.deepEqual(parseTags(`["${nbsp}${nbsp}", "Tausch"]`), ['Tausch']);
});

test('parseTags haelt "Tausch" und NBSP-Tausch fuer denselben Tag', () => {
  const nbsp = String.fromCharCode(0xa0);
  assert.deepEqual(parseTags(`["Tausch", "${nbsp}Tausch"]`), ['Tausch']);
});

test('parseTags liefert bei Muell nach einem gueltigen Array eine leere Liste', () => {
  assert.deepEqual(parseTags('["a"] extra'), []);
});
