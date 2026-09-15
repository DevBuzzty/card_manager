const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { sealedToRemote, remoteToLocalSealed, _recentlyPushedSealed, _applyPulledSealed, _sealedPushRows } = require('./sync.cjs');
const { ensureSealedSchema } = require('./sealed-items.cjs');

// Spec G3 §7.1 — Sealed-Bestand als vierter Sync-Strom. startSync() selbst laeuft hier nicht (echte
// Zeitgeber, Supabase); getestet werden die Abbildung, das Anwenden gezogener Seiten mit Echo-Sperre und
// die Auswahl der zu schiebenden Zeilen -- genau die Stuecke, die pullSealed/pushSealed benutzen.

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);');
  ensureSealedSchema(db);
  return db;
}
const REMOTE = {
  sealed_id: 's1', cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', quantity: 2,
  price: 499.29, price_updated_at: '2026-09-15T05:00:03.123456+00:00',
  created_at: '2026-09-14T18:00:00.5+00:00', updated_at: '2026-09-15T05:00:04.654321+00:00', deleted: false,
};
const row = (db, id) => db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ?').get(id);

test('sealedToRemote: Boolean, keine eigenen Zeitstempel, price_updated_at als UTC-ISO', () => {
  const local = {
    sealed_id: 's1', cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', quantity: 2,
    price: 499.29, price_updated_at: '2026-09-15 05:00:03', created_at: '2026-09-01 10:00:00', updated_at: '2026-09-15 05:00:03', deleted: 0,
  };
  assert.deepEqual(sealedToRemote(local), {
    sealed_id: 's1', cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', quantity: 2,
    price: 499.29, price_updated_at: '2026-09-15T05:00:03.000Z', deleted: false,
  });
  const gone = sealedToRemote({ ...local, price: null, price_updated_at: null, deleted: 1 });
  assert.equal(gone.deleted, true);
  assert.equal(gone.price, null);
  assert.equal(gone.price_updated_at, null);
});

test('remoteToLocalSealed: Cloud-Zeitstempel in lokaler Form, deleted als 0/1', () => {
  const l = remoteToLocalSealed({ ...REMOTE, deleted: true });
  assert.equal(l.price_updated_at, '2026-09-15 05:00:03');
  assert.equal(l.deleted, 1);
  assert.ok(!('updated_at' in l) && !('created_at' in l), 'Cloud-Zeitstempel landen nie in den lokalen Spalten');
});

test('Pull legt eine am Handy angelegte Zeile an, lokale Zeitstempel ohne T', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  assert.equal(_applyPulledSealed(db, [REMOTE]), 1);
  const r = row(db, 's1');
  assert.equal(r.quantity, 2);
  assert.equal(r.price, 499.29);
  assert.equal(r.price_updated_at, '2026-09-15 05:00:03');
  assert.ok(!String(r.updated_at).includes('T') && !String(r.created_at).includes('T'));
});

test('Echo-Sperre: die eigene gepushte Zeile wird nicht erneut angewandt', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _recentlyPushedSealed.set('s1', REMOTE.updated_at);
  assert.equal(_applyPulledSealed(db, [REMOTE]), 0);
  assert.equal(row(db, 's1'), undefined);
  assert.equal(_recentlyPushedSealed.has('s1'), false, 'Echo-Eintrag muss verbraucht sein');
});

test('fremde Aenderung wird angewandt, auch wenn die Zeile zuvor gepusht wurde', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _applyPulledSealed(db, [REMOTE]);
  _recentlyPushedSealed.set('s1', REMOTE.updated_at);
  assert.equal(_applyPulledSealed(db, [{ ...REMOTE, quantity: 3, updated_at: '2026-09-15T06:00:00+00:00' }]), 1);
  assert.equal(row(db, 's1').quantity, 3);
});

test('Soft-Delete kommt als deleted = 1 an, die Zeile bleibt', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _applyPulledSealed(db, [REMOTE]);
  _applyPulledSealed(db, [{ ...REMOTE, deleted: true, updated_at: '2026-09-15T07:00:00+00:00' }]);
  assert.equal(row(db, 's1').deleted, 1);
});

test('unveraenderte gezogene Zeile stempelt updated_at nicht neu', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _applyPulledSealed(db, [REMOTE]);
  db.prepare("UPDATE sealed_items SET updated_at = '2000-01-01 00:00:00' WHERE sealed_id = 's1'").run();
  _applyPulledSealed(db, [{ ...REMOTE, updated_at: '2026-09-15T08:00:00+00:00' }]);
  assert.equal(row(db, 's1').updated_at, '2000-01-01 00:00:00', 'sonst schoebe der naechste Push die Zeile grundlos zurueck');
});

test('Push-Auswahl: nach dem Cursor, ohne die laufende Sekunde, mit Soft-Deletes', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO sealed_items (sealed_id, cm_product_id, name, kind, quantity, deleted, updated_at)
    VALUES (?, 254469, 'Metal Raiders Booster Box', 'display', 1, ?, ?)`);
  ins.run('s-alt', 0, '2026-09-13 00:00:00');
  ins.run('s-neu', 0, '2026-09-15 05:00:00');
  ins.run('s-weg', 1, '2026-09-15 06:00:00');
  ins.run('s-jetzt', 0, '2999-01-01 00:00:00');
  const rows = _sealedPushRows(db, '2026-09-14 00:00:00');
  assert.deepEqual(rows.map((r) => r.sealed_id).sort(), ['s-neu', 's-weg']);
  assert.equal(sealedToRemote(rows.find((r) => r.sealed_id === 's-weg')).deleted, true);
});

// Fix I2 (final-review-report.md): eine gezogene Aenderung darf nicht als "lokale Aenderung" erneut
// hochgeschoben werden -- sonst kann sie eine inzwischen neuere Handy-Schreibaktion ueberschreiben.
// Die Zusicherungen vergleichen updated_at direkt mit dem Cursor (Zeichenkettenvergleich, wie
// sealedPushRows selbst es tut) statt ueber _sealedPushRows' eigene "nicht in der laufenden Sekunde"-
// Ausnahme zu gehen -- die waere gegen die echte Uhrzeit lauffaehig instabil.
const CURSOR = '2026-09-14 00:00:00';
function withPushCursor(db, cursor) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_sealed_last_push', ?)").run(cursor);
}

test('Fix I2: eine neu gezogene Zeile bekommt keinen updated_at neuer als der Push-Cursor', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  withPushCursor(db, CURSOR);
  assert.equal(_applyPulledSealed(db, [REMOTE]), 1);
  assert.ok(row(db, 's1').updated_at <= CURSOR, `updated_at (${row(db, 's1').updated_at}) darf den Cursor nicht ueberholen`);
  const rows = _sealedPushRows(db, CURSOR);
  assert.deepEqual(rows.map((r) => r.sealed_id), [], 'die gezogene Neuanlage darf nicht zurueckgeschoben werden');
});

test('Fix I2: eine gezogene Aenderung einer vorhandenen Zeile bekommt keinen updated_at neuer als der Push-Cursor', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  withPushCursor(db, CURSOR);
  _applyPulledSealed(db, [REMOTE]);
  // Der Push-Cursor bewegt sich zwischenzeitlich nicht (kein lokaler Push) -- die Grenze bleibt dieselbe,
  // die die erste Anwendung schon benutzt hat: OLD.updated_at ist danach bereits gleich dem Cursor.
  // Genau dieser Fall darf trg_sealed_updated nicht erneut auf CURRENT_TIMESTAMP stempeln lassen.
  assert.equal(row(db, 's1').updated_at, CURSOR, 'Testannahme: die erste Anwendung stempelt bereits auf den Cursor');
  const changed = { ...REMOTE, quantity: 3, updated_at: '2026-09-15T09:00:00+00:00' };
  assert.equal(_applyPulledSealed(db, [changed]), 1);
  assert.equal(row(db, 's1').quantity, 3);
  assert.ok(row(db, 's1').updated_at <= CURSOR, `updated_at (${row(db, 's1').updated_at}) darf den Cursor nicht ueberholen`);
  const rows = _sealedPushRows(db, CURSOR);
  assert.deepEqual(rows.map((r) => r.sealed_id), [], 'die gezogene Aenderung darf nicht zurueckgeschoben werden');
});

test('Fix I2: eine lokale Aenderung nach dem Pull erscheint weiterhin in der Push-Auswahl', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  withPushCursor(db, CURSOR);
  _applyPulledSealed(db, [REMOTE]);
  // Eine echte lokale Schreibaktion laesst updated_at unberuehrt, sodass trg_sealed_updated stempelt --
  // hier fest auf einen Zeitpunkt zwischen Cursor und "jetzt" gesetzt, damit der Test nicht von der
  // echten Uhrzeit abhaengt (sealedPushRows schliesst die laufende Sekunde aus).
  db.prepare("UPDATE sealed_items SET quantity = 1, updated_at = '2026-09-14 12:00:00' WHERE sealed_id = ?").run('s1');
  const rows = _sealedPushRows(db, CURSOR);
  assert.deepEqual(rows.map((r) => r.sealed_id), ['s1'], 'eine lokale Aenderung nach dem Pull muss gepusht werden');
});

// Quelltext-Zaun wie in test-sync.cjs: prueft die Reihenfolge der Aufrufe in cycle(), keine Semantik.
test('Zyklus: Sealed nach den Exemplaren gezogen und geschoben, vor Preishistorie, Tageswert und Alarmen', () => {
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  const start = src.indexOf('async function cycle(');
  const end = src.indexOf('setInterval(cycle', start);
  assert.ok(start >= 0 && end > start, 'cycle() muss gefunden werden');
  const body = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, `fehlt in cycle(): ${s}`); return i; };
  assert.ok(at('pullCopies(c)') < at('pullSealedSafe(c)'));
  assert.ok(at('pullSealedSafe(c)') < at('await push(c)'));
  assert.ok(at('pushCopies(c)') < at('pushSealedSafe(c)'));
  assert.ok(at('pushSealedSafe(c)') < at('pullPriceHistory(c)'));
  assert.ok(at('syncSnapshot(c)') < at('syncPriceAlerts(c)'));
  assert.ok(body.includes("'sealed-changed'"), 'nach gezogenen Sealed-Aenderungen muss sealed-changed gesendet werden');
});
