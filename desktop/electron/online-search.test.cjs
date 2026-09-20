const test = require('node:test');
const assert = require('node:assert/strict');
const { onlineSearch } = require('./online-search.cjs');

// Nachbau von YGOPRODeck: `de` sind die Karten der deutschen Datenbank, `en` alle. Eine Abfrage mit
// language=de liefert NUR die deutschen Treffer -- fehlende ids fallen still weg (bei einer einzigen
// id antwortet die echte API mit HTTP 400, was fetchCards ebenfalls als [] durchreicht).
const DB = [
  { id: 93481594, name: 'Solfachord Happiness', de: null },
  { id: 46986414, name: 'Dark Magician', de: 'Dunkler Magier' },
  { id: 2463794, name: 'Ambush Knight', de: 'Überfallritter' },
];
function fakeApi(calls) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const german = u.searchParams.get('language') === 'de';
    const ids = (u.searchParams.get('id') || '').split(',').filter(Boolean);
    const fname = (u.searchParams.get('fname') || '').toLowerCase();
    const hits = DB.filter(c => (ids.length > 0
      ? ids.includes(String(c.id))
      : (german ? (c.de || '') : c.name).toLowerCase().includes(fname)));
    return hits.filter(c => !german || c.de).map(c => ({ id: c.id, name: german ? c.de : c.name }));
  };
}

test('Passcode nur in der englischen Datenbank: Rueckfall statt leerer Liste', async () => {
  const calls = [];
  const out = await onlineSearch(fakeApi(calls), '93481594');
  assert.deepEqual(out, [{ id: 93481594, name: 'Solfachord Happiness' }]);
  assert.equal(calls.length, 2, 'erst deutsch, dann englisch nachgefasst');
});

test('Passcode mit fuehrender Null wird ohne sie abgefragt, deutscher Name gewinnt', async () => {
  const calls = [];
  const out = await onlineSearch(fakeApi(calls), '02463794');
  assert.deepEqual(out, [{ id: 2463794, name: 'Überfallritter' }]);
  assert.ok(calls[0].includes('id=2463794'), 'ohne fuehrende Null: ' + calls[0]);
  assert.equal(calls.length, 1, 'deutscher Treffer, kein Nachfassen');
});

test('Katalog-Treffer: fehlt die Karte in der deutschen Datenbank, kommt sie trotzdem mit', async () => {
  const out = await onlineSearch(fakeApi([]), 'Solfachord', ['93481594']);
  assert.deepEqual(out, [{ id: 93481594, name: 'Solfachord Happiness' }]);
});

test('Namenssuche: deutsche Treffer zuerst, Katalog davor die englische Liste, keine Dubletten', async () => {
  const out = await onlineSearch(fakeApi([]), 'a', ['93481594', '46986414']);
  assert.deepEqual(out.map(c => c.id), [46986414, 2463794, 93481594],
    'Dunkler Magier (de), Überfallritter (de), dann der Katalog-Treffer');
});

test('leere Eingabe fragt nichts ab', async () => {
  const calls = [];
  assert.deepEqual(await onlineSearch(fakeApi(calls), '   '), []);
  assert.equal(calls.length, 0);
});
