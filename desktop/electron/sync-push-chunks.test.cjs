const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { _upsertCardsInChunks, _recentlyPushed } = require('./sync.cjs');

// Spec F1 §3 -- nach einem grossen Import schiebt der Push die cards-Zeilen in Bloecken zu 500 (wie Exemplare und Behaelter).
function fakeClient({ failOnCall = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows, opts) {
          calls.push({ table, rows, opts });
          const n = calls.length;
          return {
            select: async (cols) => {
              if (n === failOnCall) return { data: null, error: { message: 'kaputt' } };
              return { data: rows.map((r) => ({ id: r.id, set_code: r.set_code, language: r.language, updated_at: `ts-${n}`, cols })), error: null };
            },
          };
        },
      };
    },
  };
}
const localRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: String(10000000 + i), set_code: 'LOB-DE001', language: 'DE', rarity: 'Common', name: 'X', quantity: 3, deleted: 0, price: 1,
}));

test('cards-Push in Blöcken zu 500, gespiegelte Spalten ohne quantity, alle Echo-Zeilen zurück', async () => {
  const c = fakeClient();
  const pushed = await _upsertCardsInChunks(c, localRows(1201));
  assert.deepEqual(c.calls.map((x) => [x.table, x.rows.length, x.opts.onConflict]),
    [['cards', 500, 'id,set_code,language,rarity'], ['cards', 500, 'id,set_code,language,rarity'], ['cards', 201, 'id,set_code,language,rarity']]);
  assert.equal(pushed.length, 1201);
  assert.ok(!('quantity' in c.calls[0].rows[0]), 'quantity wird nicht gespiegelt');
  assert.equal(c.calls[0].rows[0].deleted, false);
  assert.equal(pushed[1200].updated_at, 'ts-3');
});

test('cards-Push: ein Fehler im zweiten Block bricht ab, kein dritter Block', async () => {
  const c = fakeClient({ failOnCall: 2 });
  await assert.rejects(_upsertCardsInChunks(c, localRows(1201)), /Push failed: kaputt/);
  assert.equal(c.calls.length, 2);
  assert.deepEqual(await _upsertCardsInChunks(fakeClient(), []), []);
});

// Fix Runde 1 (Review): pushCopies/pushContainers/pushSealed tragen ihre Echo-Sperre pro Block ein,
// nicht erst nach dem ganzen Push -- sonst bliebe ein bereits erfolgreich in die Cloud geschobener
// Block ungesperrt, wenn ein spaeterer Block scheitert, und sein Echo wuerde beim naechsten Pull
// faelschlich als fremde Aenderung gewertet. cards muss sich gleich verhalten.
test('cards-Push: Block 1 bleibt in der Echo-Sperre, auch wenn Block 2 scheitert', async () => {
  _recentlyPushed.clear();
  const c = fakeClient({ failOnCall: 2 });
  await assert.rejects(_upsertCardsInChunks(c, localRows(1201)), /Push failed: kaputt/);
  assert.equal(_recentlyPushed.get('10000000|LOB-DE001|DE'), 'ts-1', 'erste Zeile von Block 1 ist gesperrt');
  assert.equal(_recentlyPushed.get('10000499|LOB-DE001|DE'), 'ts-1', 'letzte Zeile von Block 1 ist gesperrt');
  assert.equal(_recentlyPushed.has('10000500|LOB-DE001|DE'), false, 'Block 2 kam nie zurueck, also keine Sperre dafuer');
  _recentlyPushed.clear();
});

// Quelltext-Zaun: push() benutzt den Blockweg und rueckt den Cursor erst danach vor.
test('push() schiebt über upsertCardsInChunks, Cursor danach', () => {
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  const start = src.indexOf('async function push(c)');
  const end = src.indexOf('async function pullCopies(', start);
  const body = src.slice(start, end);
  assert.ok(body.includes('await upsertCardsInChunks(c, changed)'), 'push() muss in Blöcken schieben');
  assert.ok(!body.includes(".from('cards')"), 'kein ungeteilter Upsert mehr in push()');
  assert.ok(body.indexOf('upsertCardsInChunks') < body.indexOf("setSetting(db, 'sync_last_push'"));
});
