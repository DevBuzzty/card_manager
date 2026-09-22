import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES, resolveMode, contrastRatio } from './theme.js';

// ZWILLING: android DesignTokensTest.kt liest dieselbe Datei.
const TOK = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/tokens.json', import.meta.url), 'utf8'));

test('ROLES nennt genau die Rollen der Token-Datei', () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(TOK.roles).sort());
});

test('resolveMode: hell ist die Vorgabe, System folgt dem Geraet', () => {
  assert.equal(resolveMode('light', true), 'light');
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('system', true), 'dark');
  assert.equal(resolveMode('system', false), 'light');
  assert.equal(resolveMode(undefined, true), 'light', 'ohne Einstellung immer hell');
  assert.equal(resolveMode('quatsch', true), 'light');
});

test('Kontrast: jedes geforderte Paar erreicht seinen Mindestwert in beiden Modi', () => {
  for (const c of TOK.contrast) {
    for (const mode of ['light', 'dark']) {
      const r = contrastRatio(TOK.roles[c.fg][mode], TOK.roles[c.bg][mode]);
      assert.ok(r >= c.min, `${c.fg} auf ${c.bg} (${mode}): ${r.toFixed(2)} < ${c.min}`);
    }
  }
});
