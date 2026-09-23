// Spec I §5.3 -- Anzahlen der vier Verkaufen-Stationen. ZWILLING: android VerkaufenZahlen.kt (gleiche
// Definition). null heisst "laedt noch" -- dann steht keine Zahl hinter dem Namen, nie eine falsche 0.
// - Kandidaten: Anzahl der Duplikat-Gruppen (duplicates()).
// - Zum Verkauf: vorgemerkte Exemplare, die in keinem aktiven Angebot stecken (nav-counts.forSale).
// - Angebote: aktive Angebote (nav-counts.listingsOpen).
// - Verkaeufe: gebuchte, nicht stornierte Verkaeufe.
export function verkaufenCounts({ duplicateGroups, nav, sales }) {
  return {
    kandidaten: Array.isArray(duplicateGroups) ? duplicateGroups.length : null,
    'zum-verkauf': nav ? nav.forSale : null,
    angebote: nav ? nav.listingsOpen : null,
    verkaeufe: Array.isArray(sales) ? sales.filter((s) => s && s.status === 'aktiv' && !s.deleted).length : null,
  };
}
