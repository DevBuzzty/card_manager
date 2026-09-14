// Spec G2 §5 — wann ein Preis-Alarm ausloest. Reine Regel ohne Netz; index.ts laedt und schreibt.
// Bewegungsalarm mit derselben Familienregel wie Spec G1 §4.2 (electron/movers.cjs, ml/Movers.kt).
import { familyOfLock, familyOfSource } from "./families.ts";

export type Rule = {
  id: number;
  user_id: string;
  kind: "move" | "above" | "below";
  card_id: string | null;
  set_code: string | null;
  language: string | null;
  rarity: string | null;
  pct: number | null;
  min_eur: number | null;
  days: number | null;
  threshold: number | null;
  armed: boolean;
};

/** Ein Printing mit deleted = false, lebender Kopie und price > 0. */
export type Printing = {
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  price: number;
  price_locked: number | null;
};

/** Eine Zeile der RPC price_reference(days). */
export type Reference = {
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  day: string;
  price: number;
  source: string;
};

export type RecentEvent = {
  rule_id: number;
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  day: string;
};

export type AlertEvent = {
  user_id: string;
  rule_id: number;
  kind: Rule["kind"];
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  old_price: number | null;
  new_price: number;
  pct: number | null;
  days: number | null;
  threshold: number | null;
  day: string;
};

export type EvaluateInput = {
  /** UTC-Datum YYYY-MM-DD. */
  today: string;
  /** Nur aktive Regeln. */
  rules: Rule[];
  printings: Printing[];
  /** Zeilen der RPC price_reference je Fenster; Schluessel "7" bzw. "30". */
  references: Record<string, Reference[]>;
  /** Letzter Verlaufspreis vor heute je Printing-Schluessel (nur fuer Zielpreise). */
  lastBefore: Record<string, number>;
  /** Treffer der letzten 30 Tage (Fenster-Sperre des Bewegungsalarms). */
  recentEvents: RecentEvent[];
};

export type EvaluateResult = {
  events: AlertEvent[];
  armedUpdates: { id: number; armed: boolean }[];
};

export const keyOf = (
  cardId: string | null,
  setCode: string | null,
  language: string | null,
  rarity: string | null,
): string => `${cardId}|${setCode || "Unknown"}|${language || "DE"}|${rarity || "Unknown"}`;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round = (x: number, f: number) => Math.round(x * f) / f;

/** Treffer in Reihenfolge der Regeln, innerhalb einer Bewegungsregel in Reihenfolge der Printings. */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const events: AlertEvent[] = [];
  const armedUpdates: { id: number; armed: boolean }[] = [];
  const byKey = new Map<string, Printing>();
  for (const p of input.printings) byKey.set(keyOf(p.card_id, p.set_code, p.language, p.rarity), p);

  for (const rule of input.rules) {
    if (rule.kind === "move") evaluateMove(rule, input, events);
    else evaluateTarget(rule, input, byKey, events, armedUpdates);
  }
  return { events, armedUpdates };
}

// §5.1: Damals nur bei day <= heute - days; gleiche Familie, nicht manual/unknown; beide Grenzen;
// kein neuer Treffer, solange ein Treffer derselben Regel mit day > heute - days existiert.
function evaluateMove(rule: Rule, input: EvaluateInput, events: AlertEvent[]) {
  const days = Number(rule.days);
  const cutoff = addDays(input.today, -days);
  const refs = new Map<string, Reference>();
  for (const r of input.references[String(days)] ?? []) {
    refs.set(keyOf(r.card_id, r.set_code, r.language, r.rarity), r);
  }
  const blocked = new Set<string>();
  for (const e of input.recentEvents) {
    if (e.rule_id === rule.id && e.day > cutoff) blocked.add(keyOf(e.card_id, e.set_code, e.language, e.rarity));
  }
  for (const p of input.printings) {
    const k = keyOf(p.card_id, p.set_code, p.language, p.rarity);
    const ref = refs.get(k);
    if (!ref || ref.day > cutoff || blocked.has(k)) continue;
    const oldPrice = Number(ref.price);
    const newPrice = Number(p.price);
    if (!(oldPrice > 0) || !(newPrice > 0)) continue;
    const fam = familyOfSource(ref.source);
    if (fam !== familyOfLock(p.price_locked) || fam === "manual" || fam === "unknown") continue;
    const deltaUnit = round(newPrice - oldPrice, 100);
    const pct = round(((newPrice - oldPrice) / oldPrice) * 100, 10);
    if (Math.abs(deltaUnit) < Number(rule.min_eur) || Math.abs(pct) < Number(rule.pct)) continue;
    events.push({
      user_id: rule.user_id,
      rule_id: rule.id,
      kind: "move",
      card_id: p.card_id,
      set_code: p.set_code,
      language: p.language,
      rarity: p.rarity,
      old_price: oldPrice,
      new_price: newPrice,
      pct,
      days,
      threshold: null,
      day: input.today,
    });
  }
}

// §5.2: einmal pro Ueberschreiten. Fehlt das Printing, weder Treffer noch armed-Aenderung.
function evaluateTarget(
  rule: Rule,
  input: EvaluateInput,
  byKey: Map<string, Printing>,
  events: AlertEvent[],
  armedUpdates: { id: number; armed: boolean }[],
) {
  const k = keyOf(rule.card_id, rule.set_code, rule.language, rule.rarity);
  const p = byKey.get(k);
  if (!p) return;
  const price = Number(p.price);
  const threshold = Number(rule.threshold);
  const met = rule.kind === "above" ? price >= threshold : price <= threshold;
  if (met && rule.armed) {
    events.push({
      user_id: rule.user_id,
      rule_id: rule.id,
      kind: rule.kind,
      card_id: p.card_id,
      set_code: p.set_code,
      language: p.language,
      rarity: p.rarity,
      old_price: input.lastBefore[k] ?? null,
      new_price: price,
      pct: null,
      days: null,
      threshold,
      day: input.today,
    });
    armedUpdates.push({ id: rule.id, armed: false });
  } else if (!met && !rule.armed) {
    armedUpdates.push({ id: rule.id, armed: true });
  }
}
