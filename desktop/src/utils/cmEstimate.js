import { fmtEUR } from './format.js';

// Hinweis am Druck, wenn der Preis nur eine Schaetzung aus der Cardmarket-Spanne ist.
export function estimateHint(variant) {
  if (!variant || !variant.cm_estimate) return null;
  return {
    label: 'Schätzung',
    title: `Cardmarket-Spanne ${fmtEUR(variant.price)} – ${fmtEUR(variant.cm_estimate_max)}, genaue Version unbekannt`,
  };
}

const hhmm = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// Meldung nach dem Knopf "Rest scrapen".
export function cmRunMessage(r) {
  if (r?.paused) return `Cardmarket pausiert, Pause bis ${hhmm(r.until)}.`;
  const fe = r.firstEd || {};
  const checks = (r.pruefungenGesehen || 0) + (fe.pruefungenGesehen || 0);
  let msg = `Cardmarket fertig: ${r.updated || 0} aktualisiert, ${r.noMatch || 0} ohne Treffer, ${r.errors || 0} Fehler.`;
  if (fe.updated > 0) msg += ` ${fe.updated} Erstausgaben aktualisiert.`;
  if (r.derived > 0) msg += ` ${r.derived} aus dem Set abgeleitet.`;
  msg += ` ${checks} Prüfungen.`;
  if (r.until) msg += ` Pause bis ${hhmm(r.until)}.`;
  return msg;
}
