import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeName, levenshtein, deckSectionFor, moveTarget, moveLabel, resolveImport, importPlan, countsText, skippedText,
  failedText, deckNameFor, suggestionText, ambiguousOptionText, unknownPasscodeText, prepareImport,
} from './deckImport.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/import.json', import.meta.url), 'utf8'));

test('Fixture: Normalisierung', () => {
  for (const c of FIX.normalize) assert.equal(normalizeName(c.in), c.out, c.in);
});

test('Fixture: Levenshtein', () => {
  for (const c of FIX.levenshtein) assert.equal(levenshtein(c.a, c.b), c.d, `${c.a}/${c.b}`);
});

test('Fixture: Abschnitt per Typ und Zeilenaktion', () => {
  for (const c of FIX.sectionFor) assert.equal(deckSectionFor(c.type), c.section, String(c.type));
  for (const c of FIX.moveTarget) {
    assert.equal(moveTarget(c.section, c.type), c.target, `${c.section}/${c.type}`);
    assert.equal(moveLabel(c.section), c.label);
  }
});

for (const c of FIX.resolve) {
  test(`Fixture auflösen: ${c.name}`, () => {
    const resolved = resolveImport(c.parsed, c.catalog ? FIX.catalog : null);
    assert.equal(resolved.catalogMissing, c.expected.catalogMissing);
    assert.deepEqual(resolved.rows.map((r) => ({ ...r, candidates: r.candidates.map((x) => x.passcode) })), c.expected.rows);
    for (const p of c.plans) {
      const plan = importPlan(resolved, p.choices);
      const { countsText: ct, skippedText: st, ...rest } = p.expected;
      assert.deepEqual(plan, rest, JSON.stringify(p.choices));
      assert.equal(countsText(plan.counts), ct);
      assert.equal(skippedText(plan.skipped.length), st);
    }
  });
}

test('Fixture: Texte', () => {
  for (const t of FIX.texts.failed) assert.equal(failedText(t.message), t.text);
  for (const t of FIX.texts.deckName) assert.equal(deckNameFor(t.file), t.name);
  for (const t of FIX.texts.suggestion) assert.equal(suggestionText(t.name), t.text);
  for (const t of FIX.texts.ambiguousOption) assert.equal(ambiguousOptionText(t), t.text);
  for (const t of FIX.texts.unknownPasscode) assert.equal(unknownPasscodeText(t.passcode), t.text);
});

test('Vorschau vorbereiten: YDKE lädt nur die gelesenen Passcodes, Textliste alle, Lesefehler lädt nichts', async () => {
  const calls = [];
  const load = async (ids) => { calls.push(ids); return { available: true, cards: FIX.catalog }; };
  const ydke = await prepareImport('ydke://ryPeAA==!!!', undefined, load);
  assert.deepEqual(calls, [['14558127']]);
  assert.equal(ydke.resolved.rows[0].status, 'ok');
  const text = await prepareImport('3 Raigeki', undefined, load);
  assert.equal(calls[1], null);
  assert.deepEqual(text.resolved.rows[0].candidates.map((c) => c.passcode), ['12580477']);
  assert.deepEqual(await prepareImport('ydke://kaputt', undefined, load), { error: 'Kein gültiger YDKE-Link' });
  assert.deepEqual(await prepareImport('3 Raigeki', 'ydk', load), { error: 'Keine Deckliste erkannt' });
  assert.equal(calls.length, 2, 'ohne gelesene Karte kein Katalogzugriff');
  const missing = await prepareImport('3 Raigeki', undefined, async () => ({ available: false, cards: [] }));
  assert.equal(missing.resolved.catalogMissing, true);
});
