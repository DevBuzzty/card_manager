// Spec H2 -- ZWILLING (Teilmenge) von desktop/electron/sales-math.cjs und android ml/SalesMath.kt.
// Fixture: docs/fixtures/sales/sales.json. Der Renderer rechnet nur Vorschau und Vorschlag; gebucht wird im Hauptprozess.
import { unitPrice, conditionFactor } from './valuation.js';

const blank = (v) => v == null || v === '';
export const toCents = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
export const fromCents = (c) => c / 100;

// Marktwert eines Exemplars = unitPrice (G4, 1st Ed) x Zustandsfaktor, auf Cent gerundet.
export function marketValueCents(card, copy) {
  return Math.round(unitPrice(card, copy) * conditionFactor(copy && copy.condition) * 100);
}

export function netCents(sale) {
  return (toCents(sale.gross) || 0) - (toCents(sale.fees) || 0) - (toCents(sale.shipping) || 0);
}

export function feeDefaultCents(grossCents, feePercent) {
  return Math.round(grossCents * (Number(feePercent) || 0) / 100);
}

// Zeile der Verkaufsliste: Netto/Marktwert EINES Verkaufs. Aktiver, nicht geloeschter Verkauf: nur
// Positionen, deren Exemplar noch auf DIESEN Verkauf zeigt (Doppelverkauf). Jeder andere Status
// (storniert): alle lebenden Positionen OHNE die sold_in-Pruefung -- ein Storno raeumt sold_in am
// Exemplar, die Positionen bleiben stehen. ZWILLING: sales-math.cjs#saleListValues, SalesMath.kt#listValues.
export function saleListValues(sale, items, soldInOf) {
  const live = items.filter((it) => it.sale_id === sale.sale_id && !it.deleted);
  const counted = sale.status === 'aktiv' && !sale.deleted
    ? live.filter((it) => soldInOf(it.copy_id) === sale.sale_id)
    : live;
  return {
    netCents: counted.reduce((a, it) => a + (toCents(it.share) || 0), 0),
    marketCents: counted.reduce((a, it) => a + (toCents(it.value_at_sale) || 0), 0),
  };
}

// Vorschlag = Marktwert x (1 - Abschlag), auf 5 ct abgerundet, nie unter dem Mindestpreis. Kein Marktwert -> null.
export function suggestionCents(valueCents, discountPercent, minCents) {
  if (valueCents == null || valueCents <= 0) return null;
  const floored = Math.floor((valueCents * (100 - discountPercent)) / 500) * 5;
  return Math.max(floored, minCents);
}

export function normalizeDiscount(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!/^[0-9]{1,2}$/.test(s)) return 5;
  const n = Number(s);
  return n <= 90 ? n : 5;
}
export function normalizeMinPrice(raw) {
  const s = raw == null ? '' : String(raw).trim().replace(',', '.');
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(s)) return 10;
  const c = Math.round(Number(s) * 100);
  return c <= 10000 ? c : 10;
}

const MINUS = '−';
export function euroCentsText(c) {
  const abs = Math.abs(c);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=([0-9]{3})+(?![0-9]))/g, '.');
  const txt = `${euros},${String(abs % 100).padStart(2, '0')} €`;
  return c < 0 ? MINUS + txt : txt;
}
export function diffText(net, market) {
  const d = net - market;
  const sign = d > 0 ? '+' : d < 0 ? MINUS : '±';
  const money = `${sign}${euroCentsText(Math.abs(d))}`;
  if (market <= 0) return money;
  const pm = Math.round((Math.abs(d) * 1000) / market); // Promille, auf eine Nachkommastelle
  const pct = `${Math.floor(pm / 10)},${pm % 10}`;
  return `${money} (${sign}${pct} %)`;
}
