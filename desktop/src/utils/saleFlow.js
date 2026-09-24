// Spec I §5.2 -- Logik des Verkaufswegs ohne Oberflaeche: Kanal wie beim letzten Mal (Punkt 2),
// naechster sinnvoller Schritt (Punkt 5), Fehler am Feld mit einer Handlung, die sie behebt (Punkt 6).
// ZWILLING: android ml/SaleFlow.kt, Fixture docs/fixtures/sales/sale-flow.json.
import { euroCentsText } from './saleMath.js';

// Kanal des juengsten nicht stornierten Verkaufs (nach sold_on; bei gleichem Tag der zuerst gelieferte).
// Kein neues Feld: "wie beim letzten Mal" ergibt sich aus den Verkaeufen selbst (Spec §7).
export function lastChannel(sales, fallback = 'cardmarket') {
  let best = null;
  for (const s of sales || []) {
    if (s.status === 'storniert' || s.deleted) continue;
    if (!best || String(s.sold_on) > String(best.sold_on)) best = s;
  }
  return best?.channel_id || fallback;
}

export const NEXT_STEP_LABELS = {
  'naechstes-exemplar': 'Nächstes Exemplar',
  'angebot-ansehen': 'Angebot ansehen',
  'verkaufsliste-ansehen': 'Verkaufsliste ansehen',
  fertig: 'Fertig',
};

// way: 'verkauft' | 'angebot' | 'verkaufsliste'; remaining: weitere vorgemerkte Exemplare derselben Karte.
export function nextSteps({ way, remaining = 0, listingId = null }) {
  const steps = [];
  if (way === 'angebot' && listingId) steps.push('angebot-ansehen');
  if (way === 'verkaufsliste') steps.push('verkaufsliste-ansehen');
  if (way !== 'verkaufsliste' && remaining > 0) steps.push('naechstes-exemplar');
  steps.push('fertig');
  return steps;
}

// "4,50" oder "4.50" -> Zahl; leer -> null; kaputt -> NaN.
const parseEuro = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).trim().replace(',', '.')));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const suggestFix = (field, cents) => (cents == null ? null : { label: `Vorschlag ${euroCentsText(cents)} übernehmen`, field, cents });

export function validateSale(form, { suggestionCents = null, today }) {
  const errors = [];
  const gross = parseEuro(form.gross);
  if (gross === null) errors.push({ field: 'gross', text: 'Der Preis fehlt.', fix: suggestFix('gross', suggestionCents) });
  else if (!Number.isFinite(gross) || gross < 0) errors.push({ field: 'gross', text: 'Der Preis muss 0 € oder mehr sein.', fix: suggestFix('gross', suggestionCents) });
  for (const [field, text] of [['fees', 'Gebühren müssen 0 € oder mehr sein.'], ['shipping', 'Versand muss 0 € oder mehr sein.']]) {
    const v = parseEuro(form[field]);
    if (v !== null && !(Number.isFinite(v) && v >= 0)) errors.push({ field, text, fix: { label: 'Auf 0 € setzen', field, cents: 0 } });
  }
  if (!DATE.test(String(form.sold_on || ''))) errors.push({ field: 'sold_on', text: 'Ungültiges Datum.', fix: { label: 'Heute', field: 'sold_on', value: today } });
  return errors;
}

export function validateListing(form, { suggestionCents = null }) {
  const errors = [];
  const price = parseEuro(form.price);
  if (price === null || !Number.isFinite(price) || price <= 0) {
    errors.push({ field: 'price', text: 'Der Angebotspreis muss über 0 € liegen.', fix: suggestFix('price', suggestionCents) });
  }
  const url = String(form.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    errors.push({ field: 'url', text: 'Der Link muss mit http:// oder https:// beginnen.', fix: { label: 'https:// ergänzen', field: 'url', value: `https://${url}` } });
  }
  return errors;
}
