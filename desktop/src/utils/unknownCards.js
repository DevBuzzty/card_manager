// Spec I §3.3 / Abschlussreview B2 -- die Karten mit set_code = 'Unknown' als Kacheln fuer Scannen.
// Eine Kachel je Passcode (wie nav-counts: COUNT(DISTINCT id)), die Drucke darunter als variants --
// dieselbe Form, die CardTile aus der Kartenliste kennt.
export function unknownCardGroups(rows) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.set_code !== 'Unknown' || r.deleted) continue;
    const key = String(r.id);
    if (!groups.has(key)) groups.set(key, { ...r, quantity: 0, totalValue: 0, variants: [], rarities: new Set(), nonstandard: 0 });
    const g = groups.get(key);
    const qty = r.quantity || 1;
    g.quantity += qty;
    g.totalValue += r.value != null ? r.value : (r.price || 0) * qty;
    g.nonstandard += r.nonstandard || 0;
    if (r.rarity) g.rarities.add(r.rarity);
    g.variants.push(r);
  }
  return [...groups.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));
}
