const crypto = require('crypto');
const { CONDITIONS, EDITIONS, conditionFactor } = require('./valuation.cjs');

const norm = (p) => ({ id: String(p.id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown' });
const KEY = 'card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity';

function defaults(db) {
  const get = (k) => { try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; } catch { return null; } };
  const edition = get('default_edition'), condition = get('default_condition');
  return {
    edition: EDITIONS.includes(edition) ? edition : 'unknown',
    condition: CONDITIONS.includes(condition) ? condition : 'NM',
  };
}

function listCopies(db, printing) {
  return db.prepare(`SELECT * FROM card_copies WHERE ${KEY} AND deleted = 0 ORDER BY created_at, copy_id`).all(norm(printing));
}

function groupCopies(rows) {
  const m = new Map();
  for (const c of rows || []) {
    const k = `${c.edition || 'unknown'}|${c.condition || 'NM'}`;
    m.set(k, (m.get(k) || 0) + (Number(c.count) || 1));
  }
  return Array.from(m.entries())
    .map(([k, count]) => { const [edition, condition] = k.split('|'); return { edition, condition, count }; })
    .sort((a, b) => (EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)) || (CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)));
}

function addCopies(db, printing, { edition, condition, count = 1 } = {}) {
  const p = norm(printing);
  const d = defaults(db);
  const ed = EDITIONS.includes(edition) ? edition : d.edition;
  const co = CONDITIONS.includes(condition) ? condition : d.condition;
  const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition)
    VALUES (@copy_id, @id, @set_code, @language, @rarity, @edition, @condition)`);
  const ids = [];
  db.transaction(() => {
    for (let i = 0; i < Math.max(1, Number(count) || 1); i++) {
      const copy_id = crypto.randomUUID();
      ins.run({ ...p, copy_id, edition: ed, condition: co });
      ids.push(copy_id);
    }
  })();
  return ids;
}

// Standard-first: the default group goes first, then the remaining copies ordered so that the
// most valuable (highest factor, non-default edition) are removed LAST.
function removeCopies(db, printing, { edition, condition, count = 1 } = {}) {
  const p = norm(printing);
  const n = Math.max(1, Number(count) || 1);
  let rows;
  if (edition || condition) {
    rows = db.prepare(`SELECT copy_id FROM card_copies WHERE ${KEY} AND deleted = 0
      AND (@edition IS NULL OR edition = @edition) AND (@condition IS NULL OR condition = @condition)
      ORDER BY created_at DESC, copy_id LIMIT @n`).all({ ...p, edition: edition || null, condition: condition || null, n });
  } else {
    const d = defaults(db);
    const all = db.prepare(`SELECT copy_id, edition, condition, created_at FROM card_copies WHERE ${KEY} AND deleted = 0`).all(p);
    all.sort((a, b) => {
      const sa = (a.edition === d.edition && a.condition === d.condition) ? 0 : 1;
      const sb = (b.edition === d.edition && b.condition === d.condition) ? 0 : 1;
      if (sa !== sb) return sa - sb;                                   // standard first
      const fa = conditionFactor(a.condition), fb = conditionFactor(b.condition);
      if (fa !== fb) return fa - fb;                                   // cheaper condition first
      const ea = a.edition === 'first' ? 1 : 0, eb = b.edition === 'first' ? 1 : 0;
      if (ea !== eb) return ea - eb;                                   // 1st edition last
      return String(b.created_at).localeCompare(String(a.created_at)); // newest first
    });
    rows = all.slice(0, n);
  }
  const upd = db.prepare('UPDATE card_copies SET deleted = 1 WHERE copy_id = ?');
  db.transaction(() => { for (const r of rows) upd.run(r.copy_id); })();
  return rows.length;
}

function moveCopies(db, from, to) {
  const f = norm(from), t = norm(to);
  const info = db.prepare(`UPDATE card_copies SET set_code = @t_set_code, language = @t_language, rarity = @t_rarity
    WHERE card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0`)
    .run({ ...f, t_set_code: t.set_code, t_language: t.language, t_rarity: t.rarity });
  return info.changes;
}

function updateCopyGroup(db, printing, from, to) {
  const p = norm(printing);
  if (!EDITIONS.includes(to.edition) || !CONDITIONS.includes(to.condition)) throw new Error('invalid edition/condition');
  const info = db.prepare(`UPDATE card_copies SET edition = @to_edition, condition = @to_condition
    WHERE ${KEY} AND deleted = 0 AND edition = @from_edition AND condition = @from_condition`)
    .run({ ...p, to_edition: to.edition, to_condition: to.condition, from_edition: from.edition, from_condition: from.condition });
  return info.changes;
}

function softDeletePrinting(db, printing) {
  const p = norm(printing);
  db.prepare(`UPDATE card_copies SET deleted = 1 WHERE ${KEY} AND deleted = 0`).run(p);
  // The trigger tombstones the card row; make it explicit for printings that had no copies.
  db.prepare('UPDATE cards SET deleted = 1, quantity = 0 WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0').run(p);
}

module.exports = { defaults, listCopies, groupCopies, addCopies, removeCopies, moveCopies, updateCopyGroup, softDeletePrinting };
