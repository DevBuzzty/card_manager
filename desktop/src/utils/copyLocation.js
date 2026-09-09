// Spec B1 §7.3: Standort-Chip-Text fuer ein Exemplar -- eine Funktion fuer alle Darstellungsorte
// (CardDetailPanel.jsx, die Sammlungsliste aus Task 7 importiert sie von hier, das Handy aus
// Task 10 baut sie zeichengleich nach), sonst weicht die Formatierung irgendwann auseinander.
// `container` ist die zum Exemplar gehoerende Zeile aus listContainers() (oder undefined/null,
// wenn keine gefunden wird -- z.B. waehrend Behaelter noch nachgeladen werden).
export function formatCopyLocation(copy, container) {
  if (!copy?.container_id || !container) return '—';
  if (copy.page != null && copy.slot != null) return `${container.name} · S${copy.page} · F${copy.slot}`;
  return container.name;
}
