const assert = require('assert');
const { rowToRemote, remoteToLocalPatch } = require('./sync.cjs');

// Local SQLite row -> remote upsert payload: booleans, only mirrored columns.
const local = { id: '1', set_code: 'LOB-EN001', language: 'DE', name: 'X',
  quantity: 3, deleted: 0, price: 1.5, rarity: 'Common', last_updated: 'x', created_at: 'y' };
const remote = rowToRemote(local);
assert.strictEqual(remote.deleted, false);
assert.strictEqual(remote.quantity, 3);
assert.strictEqual(remote.id, '1');
assert.ok(!('created_at' in remote), 'created_at is not mirrored');
assert.ok(!('updated_at' in remote), 'updated_at is server-stamped, never sent');

// New mirrored columns: cm_product_id passes through (null when unresolved), price_locked is an
// integer 0/1/2 (2 = manual) — never a boolean, never undefined.
assert.strictEqual(remote.cm_product_id, null, 'unresolved printing mirrors cm_product_id = null');
assert.strictEqual(remote.price_locked, 0, 'missing price_locked mirrors as 0');
const locked = rowToRemote({ ...local, cm_product_id: 102801, price_locked: 2 });
assert.strictEqual(locked.cm_product_id, 102801);
assert.strictEqual(locked.price_locked, 2, 'manual lock (2) survives the mapping');
assert.strictEqual(rowToRemote({ ...local, price_locked: 1 }).price_locked, 1);

// Remote row -> local patch: only quantity + deleted are applied (phone-owned fields).
const patch = remoteToLocalPatch({ id: '1', set_code: 'LOB-EN001', language: 'DE',
  quantity: 7, deleted: true, updated_at: '2026-01-01T00:00:00Z' });
assert.deepStrictEqual(patch, { id: '1', set_code: 'LOB-EN001', language: 'DE', quantity: 7, deleted: 1 });

console.log('sync mapping test: PASS');
