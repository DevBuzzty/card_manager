// Spec G2 §5.3 — Quellenfamilien (Spec G1 §4.2).
// DRITTER ZWILLING von desktop/electron/price-families.json (Desktop: electron/movers.cjs) und
// android/app/src/main/java/com/example/yugiohscanner/ml/PriceFamily.kt. families_test.ts vergleicht
// gegen die JSON-Datei. Wer eine Seite aendert, aendert alle drei.
export const FAMILIES: Record<string, string> = {
  cm_bulk: "cm",
  cm_scrape: "cm",
  cloud: "cm",
  ygoprodeck: "ygo",
  manual: "manual",
};

export function familyOfSource(source: string | null | undefined): string {
  return source != null && Object.hasOwn(FAMILIES, source) ? FAMILIES[source] : "unknown";
}

// Familie des aktuellen Preises aus cards.price_locked (0 YGOPRODeck, 1 Cardmarket, 2 manuell).
export function familyOfLock(priceLocked: number | null | undefined): string {
  const n = priceLocked == null ? 0 : Number(priceLocked);
  if (n === 0) return "ygo";
  if (n === 1) return "cm";
  if (n === 2) return "manual";
  return "unknown";
}
