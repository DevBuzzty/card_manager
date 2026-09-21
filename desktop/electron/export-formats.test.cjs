const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BOM } = require('./csv.cjs');
const { dragonShieldCsv, ygoprodeckCsv, cardmarketWantslist, saleListText, pieceValue, euroText } = require('./export-formats.cjs');

// Spec F1 §4/§6 -- je Format ein Formatierer gegen eine Fixture-Datei. Die Fixture-Dateien stehen ohne BOM und mit LF
// (Git kann Zeilenenden umschreiben); geprueft wird BOM bzw. kein BOM getrennt, der Inhalt mit normalisierten Zeilenenden.
const DIR = path.join(__dirname, '..', '..', 'docs', 'fixtures', 'import-export');
const IN = JSON.parse(fs.readFileSync(path.join(DIR, 'export-input.json'), 'utf8'));
const expected = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const nameEn = (id) => IN.namesEn[id] || null;
const csvBody = (out) => {
  assert.ok(out.startsWith(BOM), 'CSV beginnt mit BOM');
  assert.ok(out.includes('\r\n'), 'CSV mit CRLF');
  return out.slice(1).replace(/\r\n/g, '\n');
};

test('Dragon Shield: Zeile je Printing × Edition × Zustand, englischer Name, Zustandswörter, Stückwert, Unknown ohne Set-Code', () => {
  assert.equal(csvBody(dragonShieldCsv(IN.copies, nameEn)), expected('export-dragonshield.csv'));
});

test('YGOPRODeck: Zeile je Printing mit Menge und Passcode', () => {
  assert.equal(csvBody(ygoprodeckCsv(IN.copies, nameEn)), expected('export-ygoprodeck.csv'));
});

test('Cardmarket-Wantslist: eine Zeile je Wunsch, englischer Name, Rückfall auf den gespeicherten Namen', () => {
  const out = cardmarketWantslist(IN.wishlist, nameEn);
  assert.ok(!out.startsWith(BOM));
  assert.equal(out, expected('export-wantslist.txt'));
  assert.equal(cardmarketWantslist([], nameEn), '');
});

test('Verkaufsliste: Preisvorschlag je Stück (Marktwert mit 1.-Auflage-Preis und Zustandsfaktor, minus 5 % Abschlag, auf 5 Cent abgerundet), Summe, Unknown weggelassen', () => {
  const { text, omitted } = saleListText(IN.copies);
  assert.ok(!text.startsWith(BOM));
  assert.equal(text, expected('export-verkaufsliste.txt'));
  assert.equal(omitted, 1);
});

test('Verkaufsliste: ohne Preis, Einzahl, Tausenderpunkt; leer ohne bekannte Printings', () => {
  const base = IN.copies[3];
  const { text } = saleListText([{ ...base, price: 0 }]);
  assert.equal(text, '1× Blauäugiger w. Drache – SDK-DE001 – Ultra Rare – Unlimitiert – GD – ohne Preis\n\nSumme: 1 Karte · 0,00 €\n');
  assert.equal(euroText(1234.5), '1.234,50 €');
  assert.deepEqual(saleListText([IN.copies[5]]), { text: '', omitted: 1 });
});

// Spec H2 §9, Plan-Abweichung 6 -- die Preisspalte der Verkaufsliste zeigt den Preisvorschlag
// (Marktwert minus Abschlag, nie unter dem Mindestpreis), nicht mehr den Marktwert.
test('Verkaufsliste zeigt den Preisvorschlag (Spec H2 §9, Plan-Abweichung 6)', () => {
  const cp = { card_id: '1', name: 'Dunkler Magier', set_code: 'LOB-DE005', language: 'DE', rarity: 'Common', edition: 'unlimited', condition: 'NM', price: 2, price_first_ed: null };
  const { text } = saleListText([cp, { ...cp, price: null }], { discount: 5, minCents: 10 });
  assert.match(text, /1× Dunkler Magier – LOB-DE005 – Common – Unlimitiert – NM – 1,90 €/);
  assert.match(text, /– ohne Preis/);
  assert.match(text, /Summe: 2 Karten · 1,90 €/);
});

// I1 -- nameEn ruft main.cjs#exportBuild ueber den Katalog auf (fs.statSync je Aufruf); sortGroups darf es daher
// hoechstens einmal je Gruppe aufrufen, nicht im Comparator (der O(n log n)-mal laeuft). Zaehler-Fake ueber nameEn.
test('I1: nameEn wird höchstens einmal je Gruppe aufgerufen (Dragon Shield: 6 Gruppen, YGOPRODeck: 4 Gruppen)', () => {
  let dsCalls = 0;
  dragonShieldCsv(IN.copies, (id) => { dsCalls += 1; return nameEn(id); });
  assert.equal(dsCalls, 6);
  let ygoCalls = 0;
  ygoprodeckCsv(IN.copies, (id) => { ygoCalls += 1; return nameEn(id); });
  assert.equal(ygoCalls, 4);
});

test('Stückwert: 1.-Auflage-Preis nur bei edition first, sonst Basispreis, mal Zustandsfaktor, auf Cent gerundet', () => {
  assert.equal(pieceValue({ price: 12.5, price_first_ed: 20, edition: 'first', condition: 'EX' }), 17);
  assert.equal(pieceValue({ price: 12.5, price_first_ed: 20, edition: 'unlimited', condition: 'EX' }), 10.63);
  assert.equal(pieceValue({ price: 12.5, price_first_ed: null, edition: 'first', condition: 'NM' }), 12.5);
});
