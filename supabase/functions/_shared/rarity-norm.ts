// supabase/functions/_shared/rarity-norm.ts -- Spec 2026-11-03 §3.3. Seltenheit -> Vergleichsschlüssel; null = unbekannt.
// Twin: android cloud/RarityNorm.kt, Fixture docs/fixtures/rarity-norm.json. Liste nur zusammen mit der Fixture ändern.
const KEINE = new Set([
  "", "unknown", "unbekannt", "new", "reprint", "newartwork", "europeandebut", "oceaniandebut", "europeanoceaniandebut", "forcesmw",
]);
const ALIAS: Record<string, string> = {
  n: "common", c: "common", normal: "common",
  r: "rare", sr: "superrare", ur: "ultrarare", utr: "ultimaterare",
  scr: "secretrare", secret: "secretrare",
  gr: "ghostrare", hr: "ghostrare", holographicrare: "ghostrare",
  pscr: "prismaticsecretrare", cr: "collectorsrare",
  qcsr: "quartercenturysecretrare", qcscr: "quartercenturysecretrare",
  "20thsr": "20thsecretrare", "20thscr": "20thsecretrare",
  slr: "starlightrare", plscr: "platinumsecretrare",
  starfoil: "starfoilrare", shatterfoil: "shatterfoilrare", mosaic: "mosaicrare", extrasecret: "extrasecretrare",
  duelterminalnormalrareparallelrare: "duelterminalnormalparallelrare",
};

function key(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").replaceAll("<!--", "").replaceAll("-->", "").trim();
  const n = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (KEINE.has(n)) return null;
  return ALIAS[n] ?? n;
}

function gleich(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = key(a);
  return ka !== null && ka === key(b);
}

export const RarityNorm = { key, gleich };
