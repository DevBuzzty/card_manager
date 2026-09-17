const test = require('node:test');
const assert = require('node:assert/strict');
const { BOM, detectDelimiter, parseCsv, toCsv } = require('./csv.cjs');

const cells = (text) => parseCsv(text).rows.map((r) => r.cells);

test('Trennzeichen: Komma, Semikolon, Tab aus der Kopfzeile; Gleichstand Komma; Zeichen in Anführungszeichen zählen nicht', () => {
  assert.equal(detectDelimiter('a,b,c\n1;2;3;4;5'), ',');
  assert.equal(detectDelimiter('a;b;c\n1,2,3,4,5'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('"a;b;c",d'), ',');
  assert.equal(detectDelimiter('abc'), ',');
});

test('BOM wird entfernt, Leerzeilen übersprungen, Zeilennummer der Datei bleibt', () => {
  const { delimiter, rows } = parseCsv(`${BOM}a;b\r\n\r\n1;2\r\n;\r\n3;4`);
  assert.equal(delimiter, ';');
  assert.deepEqual(rows, [
    { line: 1, cells: ['a', 'b'] },
    { line: 3, cells: ['1', '2'] },
    { line: 5, cells: ['3', '4'] },
  ]);
});

test('Anführungszeichen: Trennzeichen, doppelte Anführungszeichen und Zeilenumbruch im Feld', () => {
  const { rows } = parseCsv('a,b\n"x, y","sagt ""hallo"""\n"zwei\nZeilen",z\nw,v');
  assert.deepEqual(rows.map((r) => r.cells), [['a', 'b'], ['x, y', 'sagt "hallo"'], ['zwei\nZeilen', 'z'], ['w', 'v']]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 3, 5]);
});

test('leere Zellen und fehlender Zeilenumbruch am Ende', () => {
  assert.deepEqual(cells('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
  assert.deepEqual(cells(''), []);
  assert.deepEqual(cells(BOM), []);
});

test('toCsv: BOM, CRLF, nur nötige Felder in Anführungszeichen, Umlaute unverändert', () => {
  const out = toCsv([['name', 'note'], ['Dunkler Magier', 'Fächer 3, oben'], ['Ä"Ö', 'a\nb'], [7, null]]);
  assert.equal(out, `${BOM}name,note\r\nDunkler Magier,"Fächer 3, oben"\r\n"Ä""Ö","a\nb"\r\n7,\r\n`);
  assert.equal(toCsv([['a;b', 'c']], { delimiter: ';', bom: false }), '"a;b";c\r\n');
});

test('Rundlauf toCsv -> parseCsv', () => {
  const data = [['a', 'b', 'c'], ['x, "y"', 'zwei\r\nZeilen', ''], ['Ü', '|', 'ß']];
  assert.deepEqual(cells(toCsv(data)), data);
});
