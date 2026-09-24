// Spec I §5.3 -- Anzahlen der vier Verkaufen-Stationen. ZWILLING: android VerkaufenZahlen.kt (gleiche
// Definition). null heisst "laedt noch" -- dann steht keine Zahl hinter dem Namen, nie eine falsche 0.
// Restrunde 2: die Zahl am Reiter zeigt genau, was die Liste im Standardzustand zeigt.
// - Kandidaten: Anzahl der Duplikat-Gruppen (duplicates()).
// - Zum Verkauf: alle vorgemerkten, lebenden Exemplare wie forSaleSummary/die Kopfzeile der Liste --
//   INKLUSIVE der Exemplare in aktiven Angeboten (das Abzeichen "Verkaufen" der Seitenleiste zaehlt
//   weiter ohne Doppelung ueber nav-counts).
// - Angebote: aktive Angebote (nav-counts.listingsOpen).
// - Verkaeufe: Eintraege der Verkaufsliste im Standard-Zeitraum (Monat), Stornos eingeschlossen --
//   salesInDefaultPeriod ist dafuer die Liste aus sales-overview mit period 'monat'.
import { forSaleSummary } from './duplicates.js';

export const SALES_DEFAULT_PERIOD = 'monat';

export function verkaufenCounts({ duplicateGroups, saleCopies, nav, salesInDefaultPeriod }) {
  return {
    kandidaten: Array.isArray(duplicateGroups) ? duplicateGroups.length : null,
    'zum-verkauf': Array.isArray(saleCopies) ? forSaleSummary(saleCopies).copies : null,
    angebote: nav ? nav.listingsOpen : null,
    verkaeufe: Array.isArray(salesInDefaultPeriod) ? salesInDefaultPeriod.length : null,
  };
}
