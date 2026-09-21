// desktop/electron/sales-math.cjs
// Spec H2 §5.3/§7/§8/§9 -- Rechenregeln fuer Verkaeufe, in ganzen Cent. MASSGEBLICH fuer das Buchen am PC.
// ZWILLINGE: desktop/src/utils/saleMath.js (Renderer-Teilmenge) und
// android/app/src/main/java/com/example/yugiohscanner/ml/SalesMath.kt. Gemeinsame Fixture: docs/fixtures/sales/sales.json.
// Wer eine Fassung aendert, aendert alle drei.
const { unitPrice, conditionFactor } = require('./valuation.cjs');

const blank = (v) => v == null || v === '';
const toCents = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const fromCents = (c) => c / 100;

// Marktwert eines Exemplars = unitPrice (G4, 1st Ed) x Zustandsfaktor, auf Cent gerundet.
function marketValueCents(card, copy) {
  return Math.round(unitPrice(card, copy) * conditionFactor(copy && copy.condition) * 100);
}

function netCents(sale) {
  return (toCents(sale.gross) || 0) - (toCents(sale.fees) || 0) - (toCents(sale.shipping) || 0);
}

function feeDefaultCents(grossCents, feePercent) {
  return Math.round(grossCents * (Number(feePercent) || 0) / 100);
}

// Anteil_i = round(net * w_i / W); Rest an die erste Position mit dem groessten Gewicht. W = 0 -> alle Gewichte 1.
function distribute(net, valueCents) {
  if (valueCents.length === 0) return [];
  const total = valueCents.reduce((a, b) => a + b, 0);
  const w = total > 0 ? valueCents : valueCents.map(() => 1);
  const W = total > 0 ? total : valueCents.length;
  const shares = w.map((x) => Math.round((net * x) / W));
  let big = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[big]) big = i;
  shares[big] += net - shares.reduce((a, b) => a + b, 0);
  return shares;
}

const live = (s) => s.status === 'aktiv' && !s.deleted;

// Gezaehlte Positionen eines Verkaufs: lebend und das Exemplar zeigt mit sold_in auf genau diesen Verkauf (Spec §8).
function countedItems(sale, items, soldInOf) {
  return items.filter((it) => it.sale_id === sale.sale_id && !it.deleted && soldInOf(it.copy_id) === sale.sale_id);
}

// Zeile der Verkaufsliste: Netto/Marktwert EINES Verkaufs (anders als saleTotals, das ueber mehrere summiert).
// Aktiver, nicht geloeschter Verkauf: nur gezaehlte Positionen (countedItems -- sold_in zeigt auf DIESEN
// Verkauf, wegen Doppelverkauf). Jeder andere Status (storniert): alle lebenden Positionen OHNE die
// sold_in-Pruefung -- ein Storno raeumt sold_in am Exemplar, die Positionen selbst bleiben stehen und
// zeigen weiterhin ihren Betrag (die Oberflaeche streicht ihn durch). ZWILLING: saleMath.js#saleListValues,
// SalesMath.kt#listValues.
function saleListValues(sale, items, soldInOf) {
  const counted = sale.status === 'aktiv' && !sale.deleted
    ? countedItems(sale, items, soldInOf)
    : items.filter((it) => it.sale_id === sale.sale_id && !it.deleted);
  return {
    netCents: counted.reduce((a, it) => a + (toCents(it.share) || 0), 0),
    marketCents: counted.reduce((a, it) => a + (toCents(it.value_at_sale) || 0), 0),
  };
}

// Verkaeufe, die ein Exemplar mit einem anderen aktiven Verkauf teilen (beide lebende Positionen).
function doubleSold(sales, items) {
  const active = new Set(sales.filter(live).map((s) => s.sale_id));
  const byCopy = new Map();
  for (const it of items) {
    if (it.deleted || !active.has(it.sale_id)) continue;
    if (!byCopy.has(it.copy_id)) byCopy.set(it.copy_id, new Set());
    byCopy.get(it.copy_id).add(it.sale_id);
  }
  const out = new Set();
  for (const ids of byCopy.values()) if (ids.size > 1) for (const id of ids) out.add(id);
  return out;
}

function saleTotals(sales, items, soldInOf) {
  const t = { netCents: 0, marketCents: 0, feesCents: 0, sales: 0, cards: 0 };
  for (const s of sales.filter(live)) {
    const counted = countedItems(s, items, soldInOf);
    if (counted.length === 0) continue;
    t.sales += 1;
    t.cards += counted.length;
    t.feesCents += toCents(s.fees) || 0;
    for (const it of counted) { t.netCents += toCents(it.share) || 0; t.marketCents += toCents(it.value_at_sale) || 0; }
  }
  return t;
}

function periodFilter(sales, period, today) {
  if (period === 'monat') return sales.filter((s) => String(s.sold_on).slice(0, 7) === today.slice(0, 7));
  if (period === 'jahr') return sales.filter((s) => String(s.sold_on).slice(0, 4) === today.slice(0, 4));
  return sales;
}

function byChannel(sales, items, soldInOf) {
  const m = new Map();
  for (const s of sales.filter(live)) {
    const t = saleTotals([s], items, soldInOf);
    if (t.sales === 0) continue;
    const r = m.get(s.channel_id) || { channel_id: s.channel_id, channel_name: s.channel_name, sales: 0, netCents: 0, feesCents: 0, diffCents: 0 };
    r.sales += 1; r.netCents += t.netCents; r.feesCents += t.feesCents; r.diffCents += t.netCents - t.marketCents;
    m.set(s.channel_id, r);
  }
  return [...m.values()].sort((a, b) => (b.netCents - a.netCents) || a.channel_name.localeCompare(b.channel_name, 'de'));
}

function byMonth(sales, items, soldInOf, today, months = 12) {
  let y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
  const keys = [];
  for (let i = 0; i < months; i++) {
    keys.unshift(`${y}-${String(mo).padStart(2, '0')}`);
    mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
  }
  return keys.map((month) => ({
    month,
    netCents: saleTotals(sales.filter((s) => String(s.sold_on).slice(0, 7) === month), items, soldInOf).netCents,
  }));
}

// Vorschlag = Marktwert x (1 - Abschlag), auf 5 ct abgerundet, nie unter dem Mindestpreis. Kein Marktwert -> null.
function suggestionCents(valueCents, discountPercent, minCents) {
  if (valueCents == null || valueCents <= 0) return null;
  const floored = Math.floor((valueCents * (100 - discountPercent)) / 500) * 5;
  return Math.max(floored, minCents);
}

function normalizeDiscount(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!/^[0-9]{1,2}$/.test(s)) return 5;
  const n = Number(s);
  return n <= 90 ? n : 5;
}
function normalizeMinPrice(raw) {
  const s = raw == null ? '' : String(raw).trim().replace(',', '.');
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(s)) return 10;
  const c = Math.round(Number(s) * 100);
  return c <= 10000 ? c : 10;
}

const MINUS = '−';
function euroCentsText(c) {
  const abs = Math.abs(c);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=([0-9]{3})+(?![0-9]))/g, '.');
  const txt = `${euros},${String(abs % 100).padStart(2, '0')} €`;
  return c < 0 ? MINUS + txt : txt;
}
function diffText(net, market) {
  const d = net - market;
  const sign = d > 0 ? '+' : d < 0 ? MINUS : '±';
  const money = `${sign}${euroCentsText(Math.abs(d))}`;
  if (market <= 0) return money;
  const pm = Math.round((Math.abs(d) * 1000) / market); // Promille, auf eine Nachkommastelle
  const pct = `${Math.floor(pm / 10)},${pm % 10}`;
  return `${money} (${sign}${pct} %)`;
}

module.exports = {
  toCents, fromCents, marketValueCents, netCents, feeDefaultCents, distribute, countedItems, saleListValues,
  doubleSold, saleTotals, periodFilter, byChannel, byMonth, suggestionCents, normalizeDiscount, normalizeMinPrice,
  euroCentsText, diffText,
};
