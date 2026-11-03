// Spec 2026-11-03 §5.1/§10 -- buildCmIndex (rein) und Plausibilität des Index-Baus mit Mini-Dateien.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { blocksAus, buildCmIndex, MIN_CARDSETS, MIN_NONSINGLES, MIN_PREFIXES, MIN_SINGLES, plausibel, prefixOf } from "./cm_index.ts";

const META = { date: "2026-11-03", builtAt: "2026-11-03T05:20:41Z" };
const singles = [
  { idProduct: 103, name: "Blue-Eyes White Dragon", idExpansion: 11 },
  { idProduct: 101, name: "Blue-Eyes White Dragon", idExpansion: 10 },
  { idProduct: 201, name: "Ash Blossom & Joyous Spring", idExpansion: 20 },
  { idProduct: 202, name: "Ash Blossom & Joyous Spring", idExpansion: 20 },
  { idProduct: 211, name: "Maxx \"C\"", idExpansion: 20 },
  { idProduct: 212, name: "Maxx \"C\"", idExpansion: 20 },
  { idProduct: 221, name: "Effect Veiler", idExpansion: 20 },
  { idProduct: 222, name: "Effect Veiler", idExpansion: 20 },
  { idProduct: 231, name: "Ghost Ogre & Snow Rabbit", idExpansion: 20 },
  { idProduct: 232, name: "Ghost Ogre & Snow Rabbit", idExpansion: 20 },
  { idProduct: 301, name: "Kuriboh", idExpansion: 30 },
  { idProduct: 999, name: "Ohne Expansion", idExpansion: null },
];
const nonsingles = [
  { idProduct: 900, name: "Legend of Blue Eyes White Dragon Booster", idExpansion: 10 },
  { idProduct: 901, name: "Legend of Blue Eyes White Dragon: 25th Anniversary Edition Booster", idExpansion: 11 },
  { idProduct: 920, name: "Rarity Collection Booster", idExpansion: 20 },
  { idProduct: 930, name: "Kuriboh Kollection Booster", idExpansion: 30 },
];
const cardsets = [
  { set_code: "LOB", set_name: "Legend of Blue Eyes White Dragon" },
  { set_code: "lob", set_name: "Legend of Blue Eyes White Dragon: 25th Anniversary Edition" },
  { set_code: "RA01", set_name: "Rarity Collection" },
  { set_code: "KICO", set_name: "Kuriboh Kollection" },
  { set_code: "LDK2", set_name: "Legendary Decks II" }, // keine Expansion -> kein Eintrag in x
];
const real = [
  { name: "Maxx \"C\"", set_code: "RA01-EN011", rarity: "Ultra Rare", cm_product_id: 211 },
  { name: "Effect Veiler", set_code: "RA01-DE012", rarity: "UR", cm_product_id: 221 },
  { name: "Ghost Ogre & Snow Rabbit", set_code: "RA01-EN013", rarity: "Secret Rare", cm_product_id: 232 },
  { name: "Ash Blossom & Joyous Spring", set_code: "RA01-EN010", rarity: "Secret Rare", cm_product_id: 202 },
  // Konflikt: zwei Zeilen, verschiedene IDs -> Schlüssel fällt weg (auch eine dritte Zeile bringt ihn nicht zurück)
  { name: "Blue-Eyes White Dragon", set_code: "LOB-EN001", rarity: "Ultra Rare", cm_product_id: 101 },
  { name: "Blue-Eyes White Dragon", set_code: "LOB-DE001", rarity: "Ultra Rare", cm_product_id: 103 },
  { name: "Blue-Eyes White Dragon", set_code: "LOB-E001", rarity: "Ultra Rare", cm_product_id: 101 },
  // gleiche ID zweimal: bleibt
  { name: "Kuriboh", set_code: "KICO-EN001", rarity: "Common", cm_product_id: 301 },
  { name: "Kuriboh", set_code: "KICO-DE001", rarity: "Common", cm_product_id: 301 },
  // unbekannte Seltenheit / KR fallen weg
  { name: "Kuriboh", set_code: "KICO-EN002", rarity: "Unknown", cm_product_id: 301 },
  { name: "Kuriboh", set_code: "KICO-KR001", rarity: "Rare", cm_product_id: 301 },
];

Deno.test("buildCmIndex: Format §5.1, s sortiert, x mit ganzem set_code, ohne leere Einträge", () => {
  const ix = buildCmIndex({ singles, nonsingles, cardsets, real: [] }, META);
  assertEquals(ix.v, 1);
  assertEquals(ix.date, "2026-11-03");
  assertEquals(ix.built_at, "2026-11-03T05:20:41Z");
  assertEquals(ix.s["blueeyeswhitedragon"], [101, 10, 103, 11]);
  assertEquals(ix.s["ashblossomjoyousspring"], [201, 20, 202, 20]);
  assertEquals(ix.s["ohneexpansion"], undefined);
  assertEquals(ix.x, { LOB: [10, 11], RA01: [20], KICO: [30] });
  assertEquals(ix.real, {});
  assertEquals(ix.learned, {});
  assertEquals(ix.blocks, {});
  assertEquals(ix.stats, { singles: 12, nonsingles: 4, cardsets: 5, names: 6, prefixes: 3, real: 0, catalog: false, blockSamples: 0 });
});

Deno.test("buildCmIndex: real je CodeKey (mit Nummer; Konflikt fällt weg, KR/unbekannt raus), learned mit RarityNorm-Schlüsseln", () => {
  const ix = buildCmIndex({ singles, nonsingles, cardsets, real }, META);
  assertEquals(ix.real, {
    "RA01-11|maxxc|ultrarare": 211,
    "RA01-12|effectveiler|ultrarare": 221,
    "RA01-13|ghostogresnowrabbit|secretrare": 232,
    "RA01-10|ashblossomjoyousspring|secretrare": 202,
    "KICO-1|kuriboh|common": 301,
  });
  assertEquals(ix.learned, { "20|2|ultrarare": { "0": 2 }, "20|2|secretrare": { "1": 2 } });
  assertEquals(ix.stats.real, 5);
});

Deno.test("buildCmIndex: real -- zwei Nummern, gleiche Seltenheit (Alternativ-Artworks) sind zwei Schlüssel, kein Konflikt", () => {
  const ix = buildCmIndex({ singles, nonsingles, cardsets, real: [
    { name: "Blue-Eyes White Dragon", set_code: "LDK2-ENK01", rarity: "Common", cm_product_id: 701 },
    { name: "Blue-Eyes White Dragon", set_code: "LDK2-DEK02", rarity: "Common", cm_product_id: 702 },
    { name: "Blue-Eyes White Dragon", set_code: "LDK2-K01", rarity: "C", cm_product_id: 701 },
  ] }, META);
  assertEquals(ix.real, { "LDK2-K01|blueeyeswhitedragon|common": 701, "LDK2-K02|blueeyeswhitedragon|common": 702 });
});

Deno.test("buildCmIndex: blocks = unterer Median je Expansion und Seltenheit; Expansion mit nur einer Seltenheit fehlt", () => {
  const ix = buildCmIndex({ singles, nonsingles, cardsets, real }, META);
  // Exp 20: ultrarare {211, 221} -> unterer Median 211; secretrare {202, 232} -> 202. Exp 30 nur common -> fehlt.
  assertEquals(ix.blocks, { "20": { ultrarare: 211, secretrare: 202 } });
  assertEquals(ix.stats.blockSamples, 5);
});

Deno.test("blocksAus: doppelte (idProduct, Seltenheit) zählen einmal, unbekannte IDs fallen weg", () => {
  const pos = new Map([[1, { exp: 7, n: 1, rank: 0 }], [2, { exp: 7, n: 1, rank: 0 }], [3, { exp: 7, n: 1, rank: 0 }], [4, { exp: 7, n: 1, rank: 0 }]]);
  const b = blocksAus([
    { prefix: "A", rarityKey: "rare", idProduct: 1 },
    { prefix: "A", rarityKey: "rare", idProduct: 1 },
    { prefix: "A", rarityKey: "rare", idProduct: 3 },
    { prefix: "A", rarityKey: "rare", idProduct: 4 },
    { prefix: "A", rarityKey: "common", idProduct: 2 },
    { prefix: "A", rarityKey: "common", idProduct: 555 },
  ], pos);
  assertEquals(b, { "7": { rare: 3, common: 2 } });
});

Deno.test("buildCmIndex: Katalog-Stichproben nur einzelne cm, ohne KR und ohne unbekannte Seltenheit", () => {
  const catalog = { cards: [{ printings: [
    { code: "RA01-EN014", rarity: "Ultra Rare", cm: 231 },
    { code: "RA01-EN015", rarity: "Secret Rare", cm: [201, 202] }, // Array -> keine Stichprobe
    { code: "RA01-EN016", rarity: "Unknown", cm: 212 },
  ], printings_verified: [
    { code: "RA01-KR001", rarity: "Super Rare", lang: "KR", cm: 222 },
    { code: "RA01-DE017", rarity: "Super Rare", lang: "DE", cm: 222 },
  ] }] };
  const ix = buildCmIndex({ singles, nonsingles, cardsets, real: [], catalog }, META);
  assertEquals(ix.stats.catalog, true);
  assertEquals(ix.stats.blockSamples, 2);
  assertEquals(ix.blocks, { "20": { ultrarare: 231, superrare: 222 } });
  assertEquals(ix.real, {}); // Katalog füllt nie real/learned
  assertEquals(ix.learned, {});
});

Deno.test("prefixOf: Teil vor dem ersten Bindestrich, groß", () => {
  assertEquals(prefixOf("ra01-de008"), "RA01");
  assertEquals(prefixOf("B3-17"), "B3");
  assertEquals(prefixOf(""), "");
});

Deno.test("plausibel: Schranken §5.1", () => {
  const ok = { singles: MIN_SINGLES, nonsingles: MIN_NONSINGLES, cardsets: MIN_CARDSETS, prefixes: MIN_PREFIXES };
  assertEquals(plausibel(ok), null);
  assert(plausibel({ ...ok, singles: MIN_SINGLES - 1 })!.includes("singles"));
  assert(plausibel({ ...ok, nonsingles: 10 })!.includes("nonsingles"));
  assert(plausibel({ ...ok, cardsets: 499 })!.includes("cardsets"));
  assert(plausibel({ ...ok, prefixes: 299 })!.includes("prefixes"));
  assertEquals(plausibel({ singles: 1, nonsingles: 1, cardsets: 1, prefixes: 1 }, { singles: 1, nonsingles: 1, cardsets: 1, prefixes: 1 }), null);
});
