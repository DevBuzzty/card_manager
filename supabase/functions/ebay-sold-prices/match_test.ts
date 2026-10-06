import { assertEquals } from "jsr:@std/assert@1";
import { matchSale, type Printing } from "./match.ts";

const P = (set_code: string, rarity: string): Printing => ({ card_id: "1", set_code, language: "DE", rarity });
const ok = (t: string, p: Printing, c: string | null = "4000") => matchSale(t, c, p).ok;

Deno.test("Set-Code muss im Titel stehen, Schreibvarianten zählen, Teilstrings nicht", () => {
  const p = P("LOB-DE001", "Ultra Rare");
  assertEquals(ok("Blauäugiger w. Drache LOB-DE001 Ultra Rare", p), true);
  assertEquals(ok("Blauäugiger LOBDE001", p), true);
  assertEquals(ok("Blauäugiger LOB DE001", p), true);
  assertEquals(ok("blauäugiger lob-de001", p), true);
  assertEquals(ok("Blauäugiger LOB-DE0012", p), false);
  assertEquals(ok("Blauäugiger XLOB-DE001", p), false);
  assertEquals(ok("Blauäugiger weißer Drache Ultra Rare", p), false);
  assertEquals(ok("Red-Eyes SDJ-G001 1. Auflage", P("SDJ-G001", "Ultra Rare")), true);
});

Deno.test("Fremde Rarity raus, keine Rarity bleibt drin, QCSR ist nicht Secret Rare", () => {
  const sr = P("RA01-DE001", "Secret Rare");
  assertEquals(ok("Karte RA01-DE001 Secret Rare", sr), true);
  assertEquals(ok("Karte RA01-DE001", sr), true);
  assertEquals(ok("Karte RA01-DE001 Ultra Rare", sr), false);
  assertEquals(ok("Karte RA01-DE001 Quarter Century Secret Rare", sr), false);
  assertEquals(ok("Karte RA01-DE001 QCSR", sr), false);
  assertEquals(ok("Karte RA01-DE001 Quarter Century Secret Rare", P("RA01-DE001", "Quarter Century Secret Rare")), true);
  assertEquals(ok("Karte RA01-DE001 UR", P("RA01-DE001", "Ultra Rare")), true);
  assertEquals(ok("Karte RA01-DE001 Super Rare", P("RA01-DE001", "Ultra Rare")), false);
});

Deno.test("Ausschlüsse: gegradet, Mengen, Unechtes, Verändert; 1x ist ein Einzelstück", () => {
  const p = P("MAMO-DE020", "Ultra Rare");
  for (const t of ["MAMO-DE020 PSA 10", "MAMO-DE020 BGS 9.5", "MAMO-DE020 CGC", "MAMO-DE020 Beckett", "MAMO-DE020 graded", "MAMO-DE020 gegradet",
    "MAMO-DE020 Lot", "MAMO-DE020 Konvolut", "MAMO-DE020 Sammlung", "MAMO-DE020 Bundle", "MAMO-DE020 Playset", "3x MAMO-DE020", "MAMO-DE020 x3", "MAMO-DE020 3 x",
    "MAMO-DE020 Proxy", "MAMO-DE020 Orica", "MAMO-DE020 Replica", "MAMO-DE020 Fan Made", "MAMO-DE020 Custom", "MAMO-DE020 Altered", "MAMO-DE020 Signed", "MAMO-DE020 signiert",
    "MAMO-DE020 PGS 9", "MAMO-DE020 AOG", "MAMO-DE020 GSG", "MAMO-DE020 Restposten", "MAMO-DE020 Sammelauflösung", "MAMO-DE020 Sammelaufloesung",
    "MAMO-DE020 Set", "MAMO-DE020 Misprint", "MAMO-DE020 Fehldruck"]) {
    assertEquals(ok(t, p), false, t);
  }
  assertEquals(ok("1x MAMO-DE020 Ultra Rare", p), true);
  assertEquals(ok("MAMO-DE020 x1", p), true);
  assertEquals(ok("MAMO-DE020", p, "2750"), false, "eBay-Zustand gegradet");
});

Deno.test("Auflage aus dem Titel", () => {
  const p = P("SDJ-G001", "Ultra Rare");
  for (const t of ["SDJ-G001 1. Auflage", "SDJ-G001 1.Auflage", "SDJ-G001 1 Auflage", "SDJ-G001 1st Edition", "SDJ-G001 1st Ed", "SDJ-G001 Erstauflage", "SDJ-G001 First Edition"]) {
    assertEquals(matchSale(t, "4000", p).first, true, t);
  }
  assertEquals(matchSale("SDJ-G001 Unlimitiert", "4000", p).first, false);
  assertEquals(matchSale("SDJ-G001", "4000", p).first, false);
  assertEquals(matchSale("SDJ-G001 Non 1st Edition", "4000", p).first, false);
  assertEquals(matchSale("SDJ-G001 Non-First", "4000", p).first, false);
});

Deno.test("Messkorb-Regeln: Trenner, Rarity-Schreibweisen, zwei Codes", () => {
  assertEquals(ok("Karte DOCS - DE050", P("DOCS-DE050", "Ultra Rare")), true);
  assertEquals(ok("Karte RA05DE084", P("RA05-DE084", "Ultra Rare")), true);
  assertEquals(ok("Karte DOOD EN049", P("DOOD-EN049", "Ultra Rare")), true);
  assertEquals(ok("Karte LOB-DE001 Ultra-Rare", P("LOB-DE001", "Super Rare")), false);
  assertEquals(ok("Karte LOB-DE001 Ultra-Rare", P("LOB-DE001", "Ultra Rare")), true);
  assertEquals(ok("Karte LOB-DE001 Secret", P("LOB-DE001", "Ultra Rare")), false);
  assertEquals(ok("LOB-DE001 LOB-DE002 Ultra Rare", P("LOB-DE001", "Ultra Rare")), false, "Sammelangebot");
  assertEquals(ok("LOB-DE001 lob-de001 Ultra Rare", P("LOB-DE001", "Ultra Rare")), true, "gleicher Code zweimal");
});

Deno.test("Messkorb: jede von Hand bewertete Zuordnung stimmt", () => {
  const korb = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/titles.json", import.meta.url)));
  const falsch: string[] = [];
  for (const k of korb) {
    const r = matchSale(k.title, k.conditionId || null, { card_id: "x", set_code: k.set_code, language: "DE", rarity: k.rarity });
    if (r.ok !== k.expect.ok || (k.expect.ok && r.first !== k.expect.first)) falsch.push(`${k.set_code} | ${k.title} -> ${JSON.stringify(r)}`);
  }
  assertEquals(falsch, []);
});
