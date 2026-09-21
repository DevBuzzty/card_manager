// desktop/electron/sales.cjs — Spec H2 §5–§8: Verkaeufe buchen, bearbeiten, teilweise zuruecknehmen, stornieren, lesen.
// Rechenregeln ausschliesslich aus sales-math.cjs (Zwilling). Rueckkehr-Regel wortgleich zu
// supabase/sales_schema.sql#sale_return_copy (Plan-Abweichung 2). Jede Schreibaktion ist EINE Transaktion.
const crypto = require('crypto');
const M = require('./sales-math.cjs');

class SaleError extends Error {}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const blank = (v) => v == null || v === '';

function listChannels(db) {
  return db.prepare('SELECT * FROM sale_channels WHERE deleted = 0 ORDER BY sort, name').all();
}

function saveChannel(db, { channel_id, name, fee_percent } = {}) {
  const n = String(name ?? '').trim();
  if (!n) throw new SaleError('Der Kanal braucht einen Namen.');
  const fee = Number(fee_percent);
  if (!Number.isFinite(fee) || fee < 0 || fee > 100) throw new SaleError('Die Gebühr muss zwischen 0 und 100 % liegen.');
  if (channel_id) {
    const info = db.prepare('UPDATE sale_channels SET name = ?, fee_percent = ? WHERE channel_id = ? AND deleted = 0').run(n, fee, channel_id);
    if (info.changes === 0) throw new SaleError('Kanal nicht gefunden.');
    return channel_id;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO sale_channels (channel_id, name, fee_percent) VALUES (?, ?, ?)').run(id, n, fee);
  return id;
}

function hideChannel(db, channelId) {
  const row = db.prepare('SELECT builtin FROM sale_channels WHERE channel_id = ? AND deleted = 0').get(channelId);
  if (!row) throw new SaleError('Kanal nicht gefunden.');
  if (row.builtin) throw new SaleError('Feste Kanäle lassen sich nicht ausblenden.');
  db.prepare('UPDATE sale_channels SET deleted = 1 WHERE channel_id = ?').run(channelId);
}

// Lebende, unverkaufte Exemplare mit Kartendaten und Marktwert (Cent). Ausgeschriebene Spalten wie listSaleCopies.
function liveCopies(db, copyIds) {
  const q = db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition, cp.for_sale,
           c.name, c.image_url, c.price, c.price_first_ed
      FROM card_copies cp
      LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.copy_id = ? AND cp.deleted = 0 AND cp.sold_in IS NULL`);
  return copyIds.map((id) => {
    const r = q.get(id);
    return r ? { ...r, valueCents: M.marketValueCents(r, r) } : null;
  });
}

function previewSale(db, copyIds) {
  const rows = liveCopies(db, [...new Set(copyIds || [])]).filter(Boolean);
  return {
    items: rows.map(({ price, price_first_ed, for_sale, ...r }) => r),
    marketCents: rows.reduce((a, r) => a + r.valueCents, 0),
  };
}

// `current` (nur beim Bearbeiten): { channel_id, channel_name } des Verkaufs vor der Aenderung.
function checkHead(db, h, current) {
  if (!DATE.test(String(h.sold_on || ''))) throw new SaleError('Ungültiges Datum.');
  const gross = Number(h.gross);
  if (blank(h.gross) || !Number.isFinite(gross) || gross < 0) throw new SaleError('Der Preis muss 0 € oder mehr sein.');
  for (const [k, label] of [['fees', 'Gebühren'], ['shipping', 'Versand']]) {
    const v = Number(h[k]);
    if (!blank(h[k]) && !(Number.isFinite(v) && v >= 0)) throw new SaleError(`${label} müssen 0 € oder mehr sein.`);
  }
  // Ein unveraendert gebliebener Kanal darf inzwischen ausgeblendet worden sein (Bearbeiten); ein neu
  // gewaehlter oder beim Buchen gewaehlter Kanal muss aktiv sein.
  const unchanged = !!current && current.channel_id === h.channel_id;
  const ch = db.prepare('SELECT channel_id, name, deleted FROM sale_channels WHERE channel_id = ?').get(h.channel_id);
  if (!ch || (ch.deleted && !unchanged)) throw new SaleError('Kanal nicht gefunden.');
  return {
    sold_on: h.sold_on, channel_id: ch.channel_id,
    // Kanalname ist die Momentaufnahme vom Buchen (Spec §4.1): bleibt der Kanal derselbe, behaelt der
    // Verkauf seinen alten Namen, auch wenn der Kanal seither umbenannt wurde.
    channel_name: unchanged ? current.channel_name : ch.name,
    gross: M.toCents(gross) / 100,
    fees: blank(h.fees) ? null : M.toCents(h.fees) / 100, shipping: blank(h.shipping) ? null : M.toCents(h.shipping) / 100,
    note: blank(h.note) ? null : String(h.note).trim() || null,
  };
}

function bookSale(db, input = {}) {
  const ids = [...new Set(Array.isArray(input.copyIds) ? input.copyIds : [])];
  if (ids.length === 0) throw new SaleError('Mindestens eine Karte auswählen.');
  const head = checkHead(db, input);
  const saleId = crypto.randomUUID();
  db.transaction(() => {
    const rows = liveCopies(db, ids);
    if (rows.some((r) => !r)) throw new SaleError('Karte bereits verkauft oder gelöscht.');
    // Deterministische Reihenfolge fuer distribute()/den Rest-Cent -- unabhaengig von der Reihenfolge, in
    // der die Karten ausgewaehlt wurden. Das Handy muss beim Buchen dieselbe Sortierung (nach copy_id) verwenden.
    rows.sort((a, b) => (a.copy_id < b.copy_id ? -1 : a.copy_id > b.copy_id ? 1 : 0));
    const shares = M.distribute(M.netCents(head), rows.map((r) => r.valueCents));
    db.prepare(`INSERT INTO sales (sale_id, sold_on, channel_id, channel_name, gross, fees, shipping, note)
      VALUES (@sale_id, @sold_on, @channel_id, @channel_name, @gross, @fees, @shipping, @note)`).run({ sale_id: saleId, ...head });
    const insItem = db.prepare(`INSERT INTO sale_items (sale_id, copy_id, value_at_sale, share, was_for_sale, card_id, set_code,
      language, rarity, edition, condition, name, image_url) VALUES (@sale_id, @copy_id, @value, @share, @was, @card_id, @set_code,
      @language, @rarity, @edition, @condition, @name, @image_url)`);
    const sell = db.prepare('UPDATE card_copies SET deleted = 1, sold_in = ?, for_sale = 0, updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?');
    rows.forEach((r, i) => {
      insItem.run({ sale_id: saleId, copy_id: r.copy_id, value: r.valueCents / 100, share: shares[i] / 100, was: r.for_sale ? 1 : 0,
        card_id: String(r.card_id), set_code: r.set_code, language: r.language, rarity: r.rarity, edition: r.edition,
        condition: r.condition, name: r.name ?? null, image_url: r.image_url ?? null });
      sell.run(saleId, r.copy_id);
    });
  })();
  return saleId;
}

// Rueckkehr eines Exemplars aus Verkauf saleId -- wortgleich zu supabase sale_return_copy.
function returnCopy(db, saleId, copyId, wasForSale) {
  const cc = db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(copyId);
  if (!cc || cc.sold_in !== saleId) return;
  const other = db.prepare(`SELECT si.sale_id FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
     WHERE si.copy_id = ? AND si.sale_id <> ? AND si.deleted = 0 AND s.status = 'aktiv' AND s.deleted = 0
     ORDER BY s.created_at, s.sale_id LIMIT 1`).get(copyId, saleId);
  if (other) {
    db.prepare('UPDATE card_copies SET sold_in = ?, updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?').run(other.sale_id, copyId);
    return;
  }
  // `=` statt `IS`, wortgleich zu SQL `o.container_id = cc.container_id`: NULL matcht NULL nie, zwei
  // nicht einsortierte Exemplare (container_id NULL) auf "demselben" Seite/Fach-Paar sind kein Konflikt.
  const occupied = cc.page != null && cc.slot != null && db.prepare(`SELECT 1 FROM card_copies
     WHERE copy_id <> ? AND deleted = 0 AND container_id = ? AND page = ? AND slot = ?`).get(copyId, cc.container_id, cc.page, cc.slot);
  if (occupied) {
    db.prepare(`UPDATE card_copies SET deleted = 0, sold_in = NULL, for_sale = ?, page = NULL, slot = NULL, needs_review = 1,
      review_reason = 'Fach inzwischen belegt', updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?`).run(wasForSale ? 1 : 0, copyId);
  } else {
    db.prepare('UPDATE card_copies SET deleted = 0, sold_in = NULL, for_sale = ?, updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?')
      .run(wasForSale ? 1 : 0, copyId);
  }
}

function activeSale(db, saleId) {
  const s = db.prepare('SELECT * FROM sales WHERE sale_id = ? AND deleted = 0').get(saleId);
  if (!s) throw new SaleError('Verkauf nicht gefunden.');
  return s;
}

function updateSale(db, input = {}) {
  const returned = new Set(Array.isArray(input.returnCopyIds) ? input.returnCopyIds : []);
  db.transaction(() => {
    const s = activeSale(db, input.sale_id);
    if (s.status !== 'aktiv') throw new SaleError('Ein stornierter Verkauf lässt sich nicht ändern.');
    const head = checkHead(db, input, { channel_id: s.channel_id, channel_name: s.channel_name });
    db.prepare(`UPDATE sales SET sold_on = @sold_on, channel_id = @channel_id, channel_name = @channel_name, gross = @gross,
      fees = @fees, shipping = @shipping, note = @note WHERE sale_id = @sale_id`).run({ sale_id: s.sale_id, ...head });
    // Nach copy_id, nicht created_at: dieselbe deterministische Reihenfolge wie bookSale fuer den Rest-Cent.
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? AND deleted = 0 ORDER BY copy_id').all(s.sale_id);
    for (const it of items.filter((i) => returned.has(i.copy_id))) {
      db.prepare('UPDATE sale_items SET deleted = 1, share = 0 WHERE sale_id = ? AND copy_id = ?').run(s.sale_id, it.copy_id);
      returnCopy(db, s.sale_id, it.copy_id, it.was_for_sale);
    }
    const rest = items.filter((i) => !returned.has(i.copy_id));
    if (rest.length === 0) throw new SaleError('Mindestens eine Karte muss im Verkauf bleiben – sonst stornieren.');
    const shares = M.distribute(M.netCents(head), rest.map((i) => M.toCents(i.value_at_sale)));
    const upd = db.prepare('UPDATE sale_items SET share = ? WHERE sale_id = ? AND copy_id = ? AND share IS NOT ?');
    rest.forEach((it, i) => upd.run(shares[i] / 100, s.sale_id, it.copy_id, shares[i] / 100));
  })();
}

function cancelSale(db, saleId) {
  db.transaction(() => {
    const s = activeSale(db, saleId);
    if (s.status !== 'aktiv') return;
    db.prepare("UPDATE sales SET status = 'storniert' WHERE sale_id = ?").run(saleId);
    for (const it of db.prepare('SELECT copy_id, was_for_sale FROM sale_items WHERE sale_id = ? AND deleted = 0').all(saleId)) {
      returnCopy(db, saleId, it.copy_id, it.was_for_sale);
    }
  })();
}

function soldInLookup(db) {
  const m = new Map(db.prepare('SELECT copy_id, sold_in FROM card_copies WHERE sold_in IS NOT NULL').all().map((r) => [r.copy_id, r.sold_in]));
  return (id) => m.get(id) ?? null;
}

function salesOverview(db, { period = 'monat', today } = {}) {
  const sales = db.prepare('SELECT * FROM sales WHERE deleted = 0 ORDER BY sold_on DESC, created_at DESC, sale_id').all();
  const items = db.prepare('SELECT sale_id, copy_id, value_at_sale, share, deleted FROM sale_items').all();
  const soldInOf = soldInLookup(db);
  const inPeriod = M.periodFilter(sales, period, today);
  const doubles = M.doubleSold(sales, items);
  return {
    totals: M.saleTotals(inPeriod, items, soldInOf),
    byChannel: M.byChannel(inPeriod, items, soldInOf),
    byMonth: M.byMonth(sales, items, soldInOf, today, 12),
    sales: inPeriod.map((s) => {
      const v = M.saleListValues(s, items, soldInOf);
      return { ...s, netCents: v.netCents, marketCents: v.marketCents,
        cards: items.filter((i) => i.sale_id === s.sale_id && !i.deleted).length, doubleSold: doubles.has(s.sale_id) };
    }),
  };
}

function saleDetail(db, saleId) {
  const sale = activeSale(db, saleId);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY deleted, value_at_sale DESC, copy_id').all(saleId);
  return { sale, items };
}

function cardSales(db, cardId) {
  return db.prepare(`SELECT si.sale_id, si.copy_id, si.share, si.set_code, si.rarity, si.language, si.edition, si.condition,
                            s.sold_on, s.channel_name, s.status
                       FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
                      WHERE si.card_id = ? AND si.deleted = 0 AND s.deleted = 0
                      ORDER BY s.sold_on DESC, s.sale_id`).all(String(cardId));
}

module.exports = {
  SaleError, listChannels, saveChannel, hideChannel, previewSale, bookSale, updateSale, cancelSale,
  salesOverview, saleDetail, cardSales,
};
