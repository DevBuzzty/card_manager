const test = require('node:test');
const assert = require('node:assert');
const { nextNotification, openSignature } = require('./alert-notify.cjs');

const ev = (...ids) => ids.map((id) => ({ id }));

test('erster Lauf ist still und setzt die Marke auf die größte id', () => {
  assert.deepStrictEqual(nextNotification(ev(5, 3), null), { notify: 'none', event: null, count: 0, marker: 5 });
  assert.deepStrictEqual(nextNotification(ev(5, 3), ''), { notify: 'none', event: null, count: 0, marker: 5 });
});

test('erster Lauf ohne Treffer setzt die Marke auf 0, der nächste Treffer wird gemeldet', () => {
  assert.deepStrictEqual(nextNotification([], null), { notify: 'none', event: null, count: 0, marker: 0 });
  const r = nextNotification(ev(1), '0');
  assert.equal(r.notify, 'one');
  assert.equal(r.event.id, 1);
  assert.equal(r.marker, 1);
});

test('ein neuer Treffer', () => {
  const r = nextNotification(ev(7, 5), '5');
  assert.deepStrictEqual(r, { notify: 'one', event: { id: 7 }, count: 1, marker: 7 });
});

test('mehrere neue Treffer', () => {
  assert.deepStrictEqual(nextNotification(ev(9, 8, 5), '5'), { notify: 'many', event: null, count: 2, marker: 9 });
});

test('Marke läuft nur vorwärts', () => {
  assert.deepStrictEqual(nextNotification(ev(3), '8'), { notify: 'none', event: null, count: 0, marker: 8 });
  assert.deepStrictEqual(nextNotification([], '8'), { notify: 'none', event: null, count: 0, marker: 8 });
});

test('Signatur ändert sich mit der Menge offener Treffer', () => {
  assert.equal(openSignature(ev(9, 8)), openSignature(ev(9, 8)));
  assert.notEqual(openSignature(ev(9, 8)), openSignature(ev(9)));
  assert.equal(openSignature([]), '');
});
