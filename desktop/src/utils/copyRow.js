// Spec I §4.1 -- eine Zeile je Exemplar: Zustand und Auflage vorn, Standort im Klartext, hoechstens
// zwei Marken ("zum Verkauf", "angeboten"). Fehlt der Behaelter, steht "noch nicht einsortiert" --
// nie "ohne Standort".
// ZWILLING: android ml/CopyRowText.kt, Fixture docs/fixtures/copies/copy-row.json.
import { EDITION_LABELS } from './valuation.js';
import { formatCopyLocation } from './copyLocation.js';

export const UNSORTED_TEXT = 'noch nicht einsortiert';

// `container`: die Zeile aus listContainers() zu copy.container_id (oder null, wenn nicht gefunden);
// `activeOffers`: aktive Angebote dieses Exemplars (listingOffers()[copy_id]).
export function copyRow(copy, container, activeOffers = []) {
  const edition = copy.edition || 'unknown';
  const lead = `${copy.condition || 'NM'} · ${EDITION_LABELS[edition] || edition}`;
  const unsorted = !copy.container_id || !container;
  const location = unsorted ? UNSORTED_TEXT : formatCopyLocation(copy, container);
  const marks = [];
  if (copy.for_sale) marks.push('zum-verkauf');
  if (activeOffers.length > 0) marks.push('angeboten');
  return { lead, location, unsorted, marks };
}

export const MARK_LABELS = { 'zum-verkauf': 'zum Verkauf', angeboten: 'angeboten' };
