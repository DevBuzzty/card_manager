// supabase/functions/_shared/sales-math.ts
// Spec H3b §7.2 -- Deno-ZWILLING (Teilmenge) von desktop/electron/sales-math.cjs und valuation.cjs: toCents, unitPrice,
// conditionFactor, marketValueCents, netCents, feeDefaultCents, distribute. Weitere Fassungen:
// desktop/src/utils/saleMath.js, android .../ml/SalesMath.kt (+ cloud/Valuation.kt). Gemeinsame Fixture:
// docs/fixtures/sales/sales.json (marketValue, net, feeDefault, distribute). Wer eine Fassung aendert, aendert alle.
import { CONDITION_FACTORS } from "./condition-factors.ts";

export type Money = number | string | null | undefined;
export type PriceCard = { price?: Money; price_first_ed?: Money };
export type PriceCopy = { edition?: string | null; condition?: string | null };

const blank = (v: unknown) => v == null || v === "";
export const toCents = (v: Money): number | null =>
  blank(v) || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100);

export function conditionFactor(code: string | null | undefined): number {
  const f = CONDITION_FACTORS[String(code || "").toUpperCase()];
  return typeof f === "number" ? f : 1;
}

// Spec G4 §6: 1. Auflage mit eigenem Preis -> price_first_ed, sonst price.
export function unitPrice(card: PriceCard | null | undefined, copy: PriceCopy | null | undefined): number {
  if (copy && copy.edition === "first" && card && card.price_first_ed != null) return Number(card.price_first_ed);
  return Number(card && card.price) || 0;
}

export function marketValueCents(card: PriceCard | null | undefined, copy: PriceCopy | null | undefined): number {
  return Math.round(unitPrice(card, copy) * conditionFactor(copy && copy.condition) * 100);
}

export function netCents(sale: { gross: Money; fees?: Money; shipping?: Money }): number {
  return (toCents(sale.gross) || 0) - (toCents(sale.fees) || 0) - (toCents(sale.shipping) || 0);
}

export function feeDefaultCents(grossCents: number, feePercent: Money): number {
  return Math.round(grossCents * (Number(feePercent) || 0) / 100);
}

// Anteil_i = round(net * w_i / W); Rest an die erste Position mit dem groessten Gewicht. W = 0 -> alle Gewichte 1.
export function distribute(net: number, valueCents: number[]): number[] {
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
