// Spec 2026-11-03 §9.3 -- Deno-Port cm-parse.ts gegen docs/fixtures/cm-resolve/parse.json, zwei Wege:
// (1) Desktop-Wrapper (wie desktop/electron/cm-resolve-fixture.test.cjs), (2) Kern + Index aus buildCmIndex.
import { assertEquals } from "jsr:@std/assert@1";
import {
  buildExpansionIndex, buildSinglesIndex, buildVersionIndex, cmForExp, cmForPrinting, deriveForExp, deriveProduct,
  buildSetAliases, expansionIdsFor, expansionNameVariants, kernAusDesktop, kernAusS, learnRanks, normName, resolveForExp, resolveProduct,
  SET_ALIASES,
} from "./cm-parse.ts";
import { CM_SET_ALIASES } from "./cm-set-aliases.ts";
import { RarityNorm } from "./rarity-norm.ts";
import { buildCmIndex } from "../refresh-cardmarket-prices/cm_index.ts";

const fx = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/cm-resolve/parse.json", import.meta.url)));
type In = { cardName: string; prefix: string; rarity: string; printingRarities?: string[] | null; realId?: number | null; name: string };

// Weg 1: Desktop-Signaturen.
const versionIndex = buildVersionIndex(fx.files.singles);
const ix = {
  expansionIndex: buildExpansionIndex(fx.files.nonsingles),
  singlesIndex: buildSinglesIndex(fx.files.singles),
  versionIndex,
  learned: learnRanks(fx.known, versionIndex),
};
const setNamesOf = (prefix: string) =>
  fx.files.cardsets.filter((s: { set_code: string }) => s.set_code.toUpperCase() === prefix).map((s: { set_name: string }) => s.set_name);

function weg1(fn: string, i: In): unknown {
  if (fn === "expansionNameVariants") return expansionNameVariants(i.name);
  const setNames = setNamesOf(i.prefix);
  if (fn === "resolveProduct") {
    const r = resolveProduct({ cardName: i.cardName, setNames }, ix);
    return { idProduct: r.idProduct, reason: r.reason };
  }
  if (fn === "deriveProduct") {
    const q: Parameters<typeof deriveProduct>[0] = { cardName: i.cardName, setNames, rarity: i.rarity };
    if ("printingRarities" in i) q.printingRarities = i.printingRarities ?? undefined;
    const r = deriveProduct(q, ix);
    return { idProduct: r.idProduct, reason: r.reason };
  }
  return cmForPrinting({ cardName: i.cardName, setNames, rarity: i.rarity, printingRarities: i.printingRarities, realId: i.realId }, ix);
}

// Weg 2: Kern auf Expansions-ID-Ebene, Index wie im Cloud-Index (s, x), Seltenheiten als RarityNorm.key.
const cm = buildCmIndex({ singles: fx.files.singles, nonsingles: fx.files.nonsingles, cardsets: fx.files.cardsets, real: [] },
  { date: "2026-11-03", builtAt: "2026-11-03T05:20:00Z" });
const learnedK = learnRanks(
  fx.known.map((k: { rarity: string; idProduct: number }) => ({ rarity: RarityNorm.key(k.rarity)!, idProduct: k.idProduct })),
  buildVersionIndex(fx.files.singles),
);
const rk = (r: string) => RarityNorm.key(r) ?? "?" + r.trim().toLowerCase();

function weg2(fn: string, i: In): unknown {
  if (fn === "expansionNameVariants") return expansionNameVariants(i.name);
  const expIds = new Set<number>(cm.x[i.prefix] ?? []);
  const kern = kernAusS(cm.s, normName(i.cardName));
  const learned = (k: string) => learnedK.get(k);
  if (fn === "resolveProduct") {
    const r = resolveForExp(i.cardName, expIds, kern);
    return { idProduct: r.idProduct, reason: r.reason };
  }
  const pr = i.printingRarities == null ? i.printingRarities : i.printingRarities.map(rk);
  if (fn === "deriveProduct") {
    const r = deriveForExp({ cardName: i.cardName, expIds, rarity: rk(i.rarity), printingRarities: "printingRarities" in i ? pr ?? undefined : undefined }, kern, learned);
    return { idProduct: r.idProduct, reason: r.reason };
  }
  return cmForExp({ cardName: i.cardName, expIds, rarity: rk(i.rarity), printingRarities: pr, realId: i.realId }, kern, learned);
}

for (const c of fx.cases) {
  Deno.test(`parse.json Weg 1 (Desktop-Wrapper): ${c.name}`, () => assertEquals(weg1(c.fn, c.input), c.expect));
  Deno.test(`parse.json Weg 2 (Kern + buildCmIndex): ${c.name}`, () => assertEquals(weg2(c.fn, c.input), c.expect));
}

Deno.test("kernAusDesktop und kernAusS liefern dieselben Gruppen", () => {
  const a = kernAusDesktop({ singlesIndex: ix.singlesIndex, versionIndex });
  const name = normName("Ash Blossom & Joyous Spring");
  const b = kernAusS(cm.s, name);
  assertEquals(b.kandidaten(name).toSorted((x, y) => x.idProduct - y.idProduct), a.kandidaten(name).toSorted((x, y) => x.idProduct - y.idProduct));
  assertEquals(b.versionen(name, 20), [201, 202]);
  assertEquals(a.versionen(name, 20), [201, 202]);
  assertEquals(b.versionen(name, 99), undefined);
  assertEquals(b.kandidaten("andere"), []);
});

// Nachtrag Set-Aliase: cm-set-aliases.ts ist der Spiegel der Twin-Fixture (Edge-Bundles enthalten nur supabase/functions/).

Deno.test("set-aliases.json: Deno-Spiegel ist inhaltsgleich mit der Fixture", async () => {
  const fxA = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/cm-resolve/set-aliases.json", import.meta.url)));
  assertEquals(CM_SET_ALIASES, fxA.aliases);
  assertEquals(SET_ALIASES.size, fxA.aliases.length);
});

Deno.test("expansionIdsFor: Alias nur ohne Namens-Treffer, je set_name; eigener Alias-Satz injizierbar", () => {
  const idx = buildExpansionIndex([{ name: "Echtes Set Booster", idExpansion: 5 }]);
  const al = buildSetAliases([{ setName: "Echtes Set", idExpansion: [9] }, { setName: "Promo &amp; Co", idExpansion: [7, 8] }]);
  assertEquals([...expansionIdsFor(["Echtes Set"], idx, al)], [5]);
  assertEquals([...expansionIdsFor(["Promo &amp; Co"], idx, al)], [7, 8]);
  assertEquals([...expansionIdsFor(["Promo & Co", "Echtes Set"], idx, al)].sort(), [5, 7, 8]);
  assertEquals([...expansionIdsFor(["Promo & Co"], idx, new Map())], []);
  assertEquals([...expansionIdsFor(["Dark Revelation Volume 1"], idx)], [1020]);
});
