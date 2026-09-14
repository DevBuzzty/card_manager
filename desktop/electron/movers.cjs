// Spec G1 §4.2 — was als Bewegung zaehlt.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/Movers.kt. Beide laufen gegen
// docs/fixtures/portfolio/movers.json. Wer eine Seite aendert, aendert beide.
const FAMILIES = require('./price-families.json');
const { conditionFactor } = require('./valuation.cjs');

const familyOfSource = (source) => FAMILIES[source] || 'unknown';

function familyOfLock(priceLocked) {
  const n = priceLocked == null ? 0 : Number(priceLocked);
  if (n === 0) return 'ygo';
  if (n === 1) return 'cm';
  if (n === 2) return 'manual';
  return 'unknown';
}

const keyOf = (id, setCode, language, rarity) =>
  `${id}|${setCode || 'Unknown'}|${language || 'DE'}|${rarity || 'Unknown'}`;

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round = (x, f) => Math.round(x * f) / f;

// Pro Printing: die letzte Zeile <= Stichtag; gibt es keine, die frueheste (fuer "erscheinen ab").
function better(a, b, cutoff) {
  if (!a) return b;
  const aIn = a.day <= cutoff;
  const bIn = b.day <= cutoff;
  if (aIn !== bIn) return aIn ? a : b;
  if (aIn) return b.day > a.day ? b : a;
  return b.day < a.day ? b : a;
}

function computeMovers({ cards, copies, references, today, days, top = 10 }) {
  const cutoff = addDays(today, -days);

  const owned = new Map();
  for (const c of copies || []) {
    if (c.deleted) continue;
    const k = keyOf(c.card_id, c.set_code, c.language, c.rarity);
    const e = owned.get(k) || { weight: 0, count: 0 };
    e.weight += conditionFactor(c.condition);
    e.count += 1;
    owned.set(k, e);
  }

  const refs = new Map();
  for (const r of references || []) {
    const k = keyOf(r.card_id, r.set_code, r.language, r.rarity);
    refs.set(k, better(refs.get(k), r, cutoff));
  }

  let hasReference = false;
  let firstDay = null;
  const movers = [];
  for (const c of cards || []) {
    if (c.deleted) continue;
    const k = keyOf(c.id, c.set_code, c.language, c.rarity);
    const own = owned.get(k);
    const ref = refs.get(k);
    if (!own || !ref) continue;
    if (ref.day > cutoff) {
      const d = addDays(ref.day, days);
      if (firstDay == null || d < firstDay) firstDay = d;
      continue;
    }
    hasReference = true;
    const oldPrice = Number(ref.price);
    const newPrice = Number(c.price);
    if (!(newPrice > 0) || !(oldPrice > 0)) continue;
    const fam = familyOfSource(ref.source);
    if (fam !== familyOfLock(c.price_locked) || fam === 'manual' || fam === 'unknown') continue;
    const deltaUnit = round(newPrice - oldPrice, 100);
    if (deltaUnit === 0) continue;
    movers.push({
      key: k, id: c.id, set_code: c.set_code, language: c.language, rarity: c.rarity,
      name: c.name, image_url: c.image_url,
      oldPrice, newPrice, deltaUnit,
      pct: round(((newPrice - oldPrice) / oldPrice) * 100, 10),
      weight: round(own.weight, 100),
      copies: own.count,
      deltaHolding: round((newPrice - oldPrice) * own.weight, 100),
    });
  }

  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const winners = movers.filter((m) => m.deltaHolding > 0)
    .sort((a, b) => (b.deltaHolding - a.deltaHolding) || byKey(a, b)).slice(0, top);
  const losers = movers.filter((m) => m.deltaHolding < 0)
    .sort((a, b) => (a.deltaHolding - b.deltaHolding) || byKey(a, b)).slice(0, top);
  const status = hasReference ? 'ok' : 'no_reference';
  return { status, firstDay: status === 'no_reference' ? firstDay : null, winners, losers };
}

module.exports = { computeMovers, familyOfSource, familyOfLock, addDays, keyOf };
