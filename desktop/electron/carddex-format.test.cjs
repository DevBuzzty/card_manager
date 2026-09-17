const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BOM } = require('./csv.cjs');
const { CARDDEX_COLUMNS, carddexGroups, writeCarddex, readCarddex, tagsOfCell } = require('./carddex-format.cjs');

// Spec F1 §2/§6 -- Card Dex schreiben gegen die Fixture-Datei, lesen mit BOM, Semikolon, Anfuehrungszeichen.
// Die Fixture-Dateien stehen ohne BOM und mit LF (Git kann Zeilenenden umschreiben); geprueft wird mit normalisierten Zeilenenden.
const DIR = path.join(__dirname, '..', '..', 'docs', 'fixtures', 'import-export');
const fixture = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const IN = JSON.parse(fixture('export-input.json'));

test('Card Dex schreiben: BOM, CRLF, Gruppen, Sortierung (Behälter, Seite, Fach, Name, Set-Code), Box ohne Seite/Fach, Tags, Notiz', () => {
  const out = writeCarddex(carddexGroups(IN.copies));
  assert.ok(out.startsWith(BOM));
  assert.ok(out.includes('\r\n'));
  assert.equal(out.slice(1).replace(/\r\n/g, '\n'), fixture('export-carddex.csv').replace(/\r\n/g, '\n'));
});

test('Card Dex lesen: eigene Exportdatei mit BOM, Werte als Text, Tags als Liste, Zeilennummer', () => {
  const r = readCarddex(`${BOM}${fixture('export-carddex.csv')}`);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows[0], {
    line: 2, passcode: '46986414', name: 'Dunkler Magier', set_code: 'LOB-DE005', rarity: 'Ultra Rare', language: 'DE',
    count: '2', edition: 'first', condition: 'NM', container: 'Binder Blau', container_kind: 'binder', pockets_per_page: '9',
    page: '1', slot: '1', tags: ['Deck', 'Tausch'], note: '',
  });
  assert.equal(r.rows[4].note, 'Kante, "leicht" bestoßen');
  assert.deepEqual(r.rows[4].tags, []);
  assert.equal(r.rows[5].set_code, 'Unknown');
});

test('Card Dex lesen: Semikolon (Excel DE), Tags getrimmt und ohne Dubletten', () => {
  const r = readCarddex(fixture('carddex-semikolon.csv'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.line, x.passcode, x.count, x.container]), [[2, '46986414', '2', 'Binder Blau'], [3, '89631139', '1', '']]);
  assert.deepEqual(r.rows[0].tags, ['Deck', 'Tausch']);
  assert.equal(r.rows[0].note, 'Kante, leicht bestoßen');
});

test('Card Dex lesen: Spalten über den Namen, nicht über die Position', () => {
  const text = 'carddex_version,count,passcode,note\n1,3,46986414,x\n';
  const r = readCarddex(text);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].passcode, '46986414');
  assert.equal(r.rows[0].count, '3');
  assert.equal(r.rows[0].container, '');
});

test('Fehlerfälle: leer, ohne Kopfzeile/Pflichtspalte, fremdes Format, neuere Version', () => {
  assert.deepEqual(readCarddex(''), { ok: false, error: 'unreadable', text: 'Datei nicht lesbar' });
  assert.deepEqual(readCarddex(`${BOM}\r\n\r\n`), { ok: false, error: 'unreadable', text: 'Datei nicht lesbar' });
  assert.equal(readCarddex('carddex_version,passcode\n1,46986414\n').error, 'unreadable', 'count fehlt');
  assert.equal(readCarddex(`${CARDDEX_COLUMNS.join(',')}\n`).error, 'unreadable', 'nur Kopfzeile');
  assert.deepEqual(readCarddex('Folder Name,Quantity,Card Name\nA,1,B\n'),
    { ok: false, error: 'not-carddex', text: 'Nur Card-Dex-CSV – andere Formate folgen' });
  assert.deepEqual(readCarddex(fixture('carddex-neuer.csv')),
    { ok: false, error: 'newer-version', text: 'Datei stammt aus einer neueren Card-Dex-Version' });
});

test('tagsOfCell: JSON-Array normalisiert, kaputte Zelle ohne Tags', () => {
  assert.deepEqual(tagsOfCell('[" a ","A","b",3]'), ['a', 'b']);
  assert.deepEqual(tagsOfCell('kaputt'), []);
  assert.deepEqual(tagsOfCell(null), []);
});
