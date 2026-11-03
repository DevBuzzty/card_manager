// Spec 2026-11-03 §5.3/§5.4/§10 -- Kette je Druck mit Fake-Index, Fake-Preisdatei, Fake-YGOPRODeck und Fake-Cache.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type Anfrage, KeinIndex, resolveAnfrage, type ResolveDeps } from "./resolve.ts";
import type { CmIndexDatei, PriceFile } from "./index-file.ts";
import type { YgoKarte } from "./ygoprodeck.ts";
import { fakeCacheStore } from "./fake-cache-store.ts";
import type { CacheRow } from "./cache-store.ts";

const NOW = new Date("2026-11-03T12:00:00Z");
const INDEX: CmIndexDatei = {
  v: 1,
  date: "2026-11-03",
  built_at: "2026-11-03T05:20:41Z",
  s: {
    blueeyeswhitedragon: [102800, 1011, 102801, 1012],
    ashblossomjoyousspring: [741197, 1734, 741198, 1734, 741199, 1734, 500001, 1500],
    mysticalelf: [12, 1011, 13, 1013],
    darkmagician: [301, 30, 302, 30],
  },
  x: { LOB: [1011, 1013], RA01: [1734], MP19: [1500], YGLD: [30] },
  real: { "RA01-8|ashblossomjoyousspring|quartercenturysecretrare": 741199 },
  learned: {
    "1734|3|ultrarare": { "0": 2 },
    "1734|3|secretrare": { "1": 1 },
    "30|2|ultrarare": { "0": 3 },
  },
  blocks: { "1734": { ultrarare: 100, secretrare: 200, starlightrare: 300 } },
  stats: { singles: 10, nonsingles: 4, cardsets: 4, names: 4, prefixes: 4, real: 1, catalog: false, blockSamples: 1 },
};
const PREISE: PriceFile = {
  v: 1,
  date: "2026-11-02",
  p: { "102800": [12.5, 9], "102801": [0.09, 0.05], "741197": [0.89, 0.5], "741198": [3.2, null], "741199": [34.94, 30], "500001": [0, 1] },
};
const ASH_SETS = [
  { set_code: "RA01-EN008", set_rarity: "Ultra Rare" },
  { set_code: "RA01-EN008", set_rarity: "Secret Rare" },
  { set_code: "RA01-EN008", set_rarity: "Quarter Century Secret Rare" },
  { set_code: "MP19-EN001", set_rarity: "Prismatic Secret Rare" },
];

function welt(o: { ygo?: (id: string) => Promise<YgoKarte | null>; rows?: CacheRow[]; index?: CmIndexDatei | null; preise?: PriceFile | null; blocksAktiv?: boolean; cache?: ReturnType<typeof fakeCacheStore> } = {}) {
  const ygoCalls: string[] = [];
  const cache = o.cache ?? fakeCacheStore({ rows: o.rows });
  const errors: unknown[][] = [];
  const logs: unknown[][] = [];
  const deps: ResolveDeps = {
    index: () => Promise.resolve(o.index === undefined ? INDEX : o.index),
    preise: () => Promise.resolve(o.preise === undefined ? PREISE : o.preise),
    ygo: (id) => { ygoCalls.push(id); return o.ygo ? o.ygo(id) : Promise.resolve({ name: "Ash Blossom & Joyous Spring", sets: ASH_SETS }); },
    cache: cache.store,
    now: () => NOW,
    zustand: { tabelleFehltGemeldet: false },
    log: (...a) => { logs.push(a); },
    logError: (...a) => { errors.push(a); },
    blocksAktiv: o.blocksAktiv ?? false,
  };
  return { deps, ygoCalls, cache, errors, logs };
}
const anfrage = (printings: [string, string][], name_en: string | null = "Ash Blossom & Joyous Spring", card_id = "14558127"): Anfrage =>
  ({ card_id, name_en, printings: printings.map(([set_code, rarity]) => ({ set_code, rarity })) });
const kurz = (r: { status: string; how: string | null; reason: string | null; cm: number[] }) => [r.status, r.how ?? r.reason, r.cm];

Deno.test("Kette: unique, real, derived (nach needs-printings), too-few, rarity-unknown, no-expansion, no-candidate, kr -- Reihenfolge wie Anfrage", async () => {
  const w = welt();
  const a = await resolveAnfrage(anfrage([
    ["RA01-DE008", "Quarter Century Secret Rare"],
    ["RA01-EN008", "Ultra Rare"],
    ["RA01-EN008", "Secret Rare"],
    ["RA01-DE008", "Unknown"],
    ["MP19-DE001", "Prismatic Secret Rare"],
    ["XXXX-DE001", "Ultra Rare"],
    ["RA01-KR008", "Ultra Rare"],
  ]), w.deps);
  assertEquals(a.results.map(kurz), [
    ["resolved", "real", [741199]],
    ["resolved", "derived", [741197]],
    ["ambiguous", "too-few", [741197, 741198, 741199]],
    ["ambiguous", "rarity-unknown", [741197, 741198, 741199]],
    ["resolved", "unique", [500001]],
    ["not_found", "no-expansion", []],
    ["not_found", "kr", []],
  ]);
  assertEquals(a.results.map((r) => [r.set_code, r.rarity, r.code_key, r.rarity_key]), [
    ["RA01-DE008", "Quarter Century Secret Rare", "RA01-8", "quartercenturysecretrare"],
    ["RA01-EN008", "Ultra Rare", "RA01-8", "ultrarare"],
    ["RA01-EN008", "Secret Rare", "RA01-8", "secretrare"],
    ["RA01-DE008", "Unknown", "RA01-8", ""],
    ["MP19-DE001", "Prismatic Secret Rare", "MP19-1", "prismaticsecretrare"],
    ["XXXX-DE001", "Ultra Rare", "XXXX-1", "ultrarare"],
    ["RA01-KR008", "Ultra Rare", "RA01-8", "ultrarare"],
  ]);
  assert(a.results.every((r) => r.cached === false));
  assertEquals(w.ygoCalls, ["14558127"]); // höchstens ein Abruf je Anfrage
  assertEquals(a.ok, true);
  assertEquals(a.v, 1);
  assertEquals(a.index_date, "2026-11-03");
  assertEquals(a.price_date, "2026-11-02");
  // prices nur für gelieferte IDs (500001 hat trend 0 -> steht trotzdem in der Datei)
  assertEquals(a.prices, { "741197": [0.89, 0.5], "741198": [3.2, null], "741199": [34.94, 30], "500001": [0, 1] });
});

Deno.test("Kette: no-candidate und Karte in zwei Expansionen desselben Präfixes -> no-group, cm über beide", async () => {
  const w = welt();
  const a = await resolveAnfrage(anfrage([["LOB-DE005", "Ultra Rare"]], "Exodia the Forbidden One"), w.deps);
  assertEquals(a.results.map(kurz), [["not_found", "no-candidate", []]]);
  const b = await resolveAnfrage(anfrage([["LOB-DE077", "Common"]], "Mystical Elf"), w.deps);
  assertEquals(b.results.map(kurz), [["ambiguous", "no-group", [12, 13]]]);
});

Deno.test("Kein Abruf bei name_en ohne Bedarf; card.ab über alle Expansionen, ab_products", async () => {
  const w = welt();
  const a = await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon", "89631139"), w.deps);
  assertEquals(w.ygoCalls, []);
  assertEquals(a.results.map(kurz), [["resolved", "unique", [102800]]]);
  assertEquals(a.card, { name_en: "Blue-Eyes White Dragon", ab: 0.09, ab_products: 2 });
  assertEquals(a.prices, { "102800": [12.5, 9] });
});

Deno.test("card.ab: Trend 0 zählt nicht", async () => {
  const w = welt();
  const a = await resolveAnfrage(anfrage([["MP19-DE001", "Prismatic Secret Rare"]]), w.deps);
  assertEquals(a.card.ab, 0.89);
  assertEquals(a.card.ab_products, 4);
});

Deno.test("Ohne name_en: Name von YGOPRODeck, derselbe Abruf liefert die Seltenheiten", async () => {
  const w = welt();
  const a = await resolveAnfrage(anfrage([["RA01-EN008", "Ultra Rare"], ["MP19-DE001", "Prismatic Secret Rare"]], null), w.deps);
  assertEquals(w.ygoCalls.length, 1);
  assertEquals(a.card.name_en, "Ash Blossom & Joyous Spring");
  assertEquals(a.results.map(kurz), [["resolved", "derived", [741197]], ["resolved", "unique", [500001]]]);
});

Deno.test("YGOPRODeck 400 (Karte unbekannt) ohne name_en -> no-name, nicht gecacht; card.ab null", async () => {
  const w = welt({ ygo: () => Promise.resolve({ name: null, sets: [] }) });
  const a = await resolveAnfrage(anfrage([["RA01-EN008", "Ultra Rare"]], null), w.deps);
  assertEquals(a.results.map(kurz), [["not_found", "no-name", []]]);
  assertEquals(a.card, { name_en: null, ab: null, ab_products: 0 });
  assertEquals(w.cache.writes.length, 0);
});

Deno.test("YGOPRODeck Timeout bei needs-printings -> ambiguous/no-printings, nicht gecacht; andere Einträge schon", async () => {
  const w = welt({ ygo: () => Promise.resolve(null) });
  const a = await resolveAnfrage(anfrage([["RA01-EN008", "Ultra Rare"], ["LOB-DE001", "Ultra Rare"]], "Ash Blossom & Joyous Spring"), w.deps);
  assertEquals(a.results.map(kurz)[0], ["ambiguous", "no-printings", [741197, 741198, 741199]]);
  assertEquals(w.ygoCalls.length, 1);
  assertEquals(w.cache.writes.length, 1);
  assertEquals(w.cache.writes[0].map((r) => r.code_key), ["LOB-1"]);
});

Deno.test("YGOPRODeck liefert keinen Druck des Präfixes -> pr = [] -> not-by-rarity (gecacht)", async () => {
  const w = welt({ ygo: () => Promise.resolve({ name: "Ash Blossom & Joyous Spring", sets: [{ set_code: "MP19-EN001", set_rarity: "Prismatic Secret Rare" }] }) });
  const a = await resolveAnfrage(anfrage([["RA01-EN008", "Ultra Rare"]]), w.deps);
  assertEquals(a.results.map(kurz), [["ambiguous", "not-by-rarity", [741197, 741198, 741199]]]);
  assertEquals(w.cache.writes[0].length, 1);
});

Deno.test("Unbekannte YGOPRODeck-Seltenheiten zählen als eigener Wert: zwei 'Unknown' = Duplikat -> not-by-rarity", async () => {
  const w = welt({ ygo: () => Promise.resolve({ name: "x", sets: [
    { set_code: "RA01-EN008", set_rarity: "Ultra Rare" }, { set_code: "RA01-EN008", set_rarity: "Unknown" }, { set_code: "RA01-EN008", set_rarity: "Unknown" },
  ] }) });
  const a = await resolveAnfrage(anfrage([["RA01-EN008", "Ultra Rare"]]), w.deps);
  assertEquals(a.results.map(kurz), [["ambiguous", "not-by-rarity", [741197, 741198, 741199]]]);
  const w2 = welt({ ygo: () => Promise.resolve({ name: "x", sets: [
    { set_code: "RA01-EN008", set_rarity: "Ultra Rare" }, { set_code: "RA01-EN008", set_rarity: "Unknown" }, { set_code: "RA01-EN008", set_rarity: "Neu" },
  ] }) });
  const b = await resolveAnfrage(anfrage([["RA01-EN008", "Ultra Rare"]]), w2.deps);
  assertEquals(b.results.map(kurz), [["resolved", "derived", [741197]]]);
});

Deno.test("Deck-Set: learned einig, aber doppelte Seltenheit -> not-by-rarity", async () => {
  const w = welt({ ygo: () => Promise.resolve({ name: "Dark Magician", sets: [{ set_code: "YGLD-ENA01", set_rarity: "Ultra Rare" }, { set_code: "YGLD-ENB01", set_rarity: "Ultra Rare" }] }) });
  const a = await resolveAnfrage(anfrage([["YGLD-DEA01", "Ultra Rare"]], "Dark Magician", "46986414"), w.deps);
  assertEquals(a.results.map(kurz), [["ambiguous", "not-by-rarity", [301, 302]]]);
});

Deno.test("Block-Regel nur mit blocksAktiv: no-model -> blocks; ohne Schalter bleibt no-model", async () => {
  const sets = [
    { set_code: "RA01-EN008", set_rarity: "Ultra Rare" }, { set_code: "RA01-EN008", set_rarity: "Secret Rare" }, { set_code: "RA01-EN008", set_rarity: "Starlight Rare" },
  ];
  const aus = welt({ ygo: () => Promise.resolve({ name: "x", sets }) });
  const a = await resolveAnfrage(anfrage([["RA01-EN008", "Starlight Rare"]]), aus.deps);
  assertEquals(a.results.map(kurz), [["ambiguous", "no-model", [741197, 741198, 741199]]]);
  assertEquals(aus.ygoCalls.length, 0); // ohne Block-Regel braucht no-model keine Seltenheiten

  const an = welt({ ygo: () => Promise.resolve({ name: "x", sets }), blocksAktiv: true });
  const b = await resolveAnfrage(anfrage([["RA01-EN008", "Starlight Rare"], ["RA01-EN008", "Secret Rare"]]), an.deps);
  assertEquals(b.results.map(kurz), [["resolved", "blocks", [741199]], ["resolved", "blocks", [741198]]]);
  assertEquals(an.ygoCalls.length, 1);

  // Block-Regel braucht Seltenheiten, YGOPRODeck fällt aus -> Ergebnis aus Schritt 8, als Fremdfehler nicht gecacht
  const weg = welt({ ygo: () => Promise.resolve(null), blocksAktiv: true });
  const c = await resolveAnfrage(anfrage([["RA01-EN008", "Starlight Rare"]]), weg.deps);
  assertEquals(c.results.map(kurz), [["ambiguous", "no-model", [741197, 741198, 741199]]]);
  assertEquals(weg.cache.writes.length, 0);
});

Deno.test("Cache: gültige Zeilen (resolved < 30 Tage / gleiches index_date) werden benutzt, abgelaufene nicht", async () => {
  const row = (code_key: string, rarity_key: string, status: CacheRow["status"], cm: number[], checked_at: string, index_date: string): CacheRow =>
    ({ card_id: "14558127", code_key, rarity_key, status, how: status === "resolved" ? "derived" : null, reason: status === "resolved" ? null : "no-model", cm, index_date, checked_at, name_norm: "ashblossomjoyousspring" });
  const w = welt({ rows: [
    row("RA01-8", "ultrarare", "resolved", [999], "2026-10-10T00:00:00Z", "2026-10-01"), // 24 Tage alt -> gültig
    row("RA01-8", "secretrare", "resolved", [998], "2026-10-01T00:00:00Z", "2026-10-01"), // 33 Tage alt -> abgelaufen
    row("RA01-8", "starlightrare", "ambiguous", [1, 2], "2026-11-03T05:30:00Z", "2026-11-03"), // gleicher Index -> gültig
    row("RA01-8", "", "ambiguous", [1, 2], "2026-11-02T05:30:00Z", "2026-11-02"), // alter Index -> neu
  ] });
  const a = await resolveAnfrage(anfrage([["RA01-DE008", "Ultra Rare"], ["RA01-EN008", "Secret Rare"], ["RA01-EN008", "Starlight Rare"], ["RA01-EN008", ""]]), w.deps);
  assertEquals(a.results.map((r) => [r.status, r.how ?? r.reason, r.cm, r.cached]), [
    ["resolved", "derived", [999], true],
    ["ambiguous", "too-few", [741197, 741198, 741199], false],
    ["ambiguous", "no-model", [1, 2], true],
    ["ambiguous", "rarity-unknown", [741197, 741198, 741199], false],
  ]);
  assertEquals(w.cache.reads, [{ cardId: "14558127", codeKeys: ["RA01-8"] }]); // EINE Leseabfrage
  assertEquals(w.cache.writes.length, 1); // EIN Upsert, nur die neu berechneten
  assertEquals(w.cache.writes[0].map((r) => r.rarity_key), ["secretrare", ""]);
  assertEquals(w.ygoCalls.length, 0);
});

Deno.test("Cache: Upsert entdoppelt (letzter gewinnt), Payload mit checked_at und index_date; KR nie gelesen", async () => {
  const w = welt();
  await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"], ["LOB-EN001", "UR"], ["LOB-KR001", "Ultra Rare"]], "Blue-Eyes White Dragon", "89631139"), w.deps);
  assertEquals(w.cache.reads, [{ cardId: "89631139", codeKeys: ["LOB-1"] }]);
  assertEquals(w.cache.writes, [[{
    card_id: "89631139", code_key: "LOB-1", rarity_key: "ultrarare", status: "resolved", how: "unique", reason: null, cm: [102800],
    index_date: "2026-11-03", checked_at: "2026-11-03T12:00:00.000Z", name_norm: "blueeyeswhitedragon",
  }]]);
});

Deno.test("Cache: fehlende Tabelle (PGRST205) -> ohne Cache weiter, einmal je Instanz protokolliert; andere Fehler nie fatal", async () => {
  const cache = fakeCacheStore({ failRead: { code: "PGRST205", message: "Could not find the table" }, failWrite: { code: "42P01", message: "relation does not exist" } });
  const w = welt({ cache });
  const a = await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon"), w.deps);
  await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon"), w.deps);
  assertEquals(a.results[0].cached, false);
  assertEquals(a.results[0].status, "resolved");
  assertEquals(w.logs.filter((l) => String(l[0]).includes("cm_resolve_cache fehlt")).length, 1);
  assertEquals(w.errors.length, 0);

  const kaputt = fakeCacheStore({ failRead: { code: "XX000", message: "boom" }, failWrite: { code: "XX000", message: "boom" } });
  const w2 = welt({ cache: kaputt });
  const b = await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon"), w2.deps);
  assertEquals(b.results[0].status, "resolved");
  assertEquals(w2.errors.length, 2);
});

Deno.test("Ohne Index -> KeinIndex; ohne Preisdatei: price_date null, prices {}, ab null", async () => {
  await assertRejects(() => resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]]), welt({ index: null }).deps), KeinIndex);
  const a = await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon"), welt({ preise: null }).deps);
  assertEquals(a.price_date, null);
  assertEquals(a.prices, {});
  assertEquals(a.card, { name_en: "Blue-Eyes White Dragon", ab: null, ab_products: 2 });
});

// --- Review-Nachtrag 2 (03.11.): "real" nur druckgenau (CodeKey mit Nummer), Cache-Identität mit Name ---

// LDK2: Blue-Eyes dreimal Common mit eigener Nummer (Alternativ-Artworks K01/K02/K03) in EINER Expansion.
const LDK2_INDEX: CmIndexDatei = {
  ...INDEX,
  s: { ...INDEX.s, blueeyeswhitedragon: [102800, 1011, 102801, 1012, 700001, 2000, 700002, 2000, 700003, 2000] },
  x: { ...INDEX.x, LDK2: [2000], LOB: [1011, 1012] },
  real: { ...INDEX.real, "LDK2-K01|blueeyeswhitedragon|common": 700001, "LOB-1|blueeyeswhitedragon|ultrarare": 102800, "LDK2-K03|blueeyeswhitedragon|common": 999999 },
};
const BEWD_YGO = () => Promise.resolve({ name: "Blue-Eyes White Dragon", sets: [
  { set_code: "LDK2-ENK01", set_rarity: "Common" }, { set_code: "LDK2-ENK02", set_rarity: "Common" }, { set_code: "LDK2-ENK03", set_rarity: "Common" },
] });

Deno.test("real: gleicher CodeKey (andere Region) -> resolved/real", async () => {
  const w = welt({ index: LDK2_INDEX, ygo: BEWD_YGO });
  const a = await resolveAnfrage(anfrage([["LDK2-DEK01", "Common"]], "Blue-Eyes White Dragon", "89631139"), w.deps);
  assertEquals(a.results.map(kurz), [["resolved", "real", [700001]]]);
});

Deno.test("real: andere Nummer, gleiche Seltenheit (fremdes Artwork) -> nie real, mehrdeutig über alle Versionen", async () => {
  const w = welt({ index: LDK2_INDEX, ygo: BEWD_YGO });
  const a = await resolveAnfrage(anfrage([["LDK2-DEK02", "Common"]], "Blue-Eyes White Dragon", "89631139"), w.deps);
  assertEquals(a.results[0].status, "ambiguous");
  assertEquals(a.results[0].how, null);
  assertEquals(a.results[0].cm, [700001, 700002, 700003]);
});

Deno.test("real: ID nicht unter den Versionen der Karte in den Expansionen -> nicht real", async () => {
  const w = welt({ index: LDK2_INDEX, ygo: BEWD_YGO });
  const a = await resolveAnfrage(anfrage([["LDK2-DEK03", "Common"]], "Blue-Eyes White Dragon", "89631139"), w.deps);
  assert(a.results[0].how !== "real");
  assert(!a.results[0].cm.includes(999999));
});

Deno.test("real: Karte in mehreren Expansionen hinter dem Präfix (Reprint) -> nicht real", async () => {
  const w = welt({ index: LDK2_INDEX });
  const a = await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon", "89631139"), w.deps);
  assert(a.results[0].how !== "real");
  assertEquals(a.results[0].status, "ambiguous");
  assertEquals(a.results[0].cm, [102800, 102801]);
});

Deno.test("Cache: Zeile mit anderem Namen (z. B. vergiftet über name_en) zählt nicht und wird überschrieben", async () => {
  const cache = fakeCacheStore();
  // Fremder Name für Blue-Eyes (89631139): Ergebnis wird mit name_norm "darkmagician" gespeichert ...
  const boese = welt({ cache });
  await resolveAnfrage(anfrage([["YGLD-DEA01", "Ultra Rare"]], "Dark Magician", "89631139"), boese.deps);
  assertEquals(cache.writes[0][0].name_norm, "darkmagician");
  // ... die korrekte Anfrage (anderer Name) bekommt sie nicht, sondern rechnet neu und überschreibt.
  const gut = welt({ cache });
  const a = await resolveAnfrage(anfrage([["YGLD-DEA01", "Ultra Rare"]], "Blue-Eyes White Dragon", "89631139"), gut.deps);
  assertEquals(a.results.map((r) => [r.status, r.reason, r.cached]), [["not_found", "no-candidate", false]]);
  assertEquals(cache.writes[1][0].name_norm, "blueeyeswhitedragon");
  // Ohne name_en zählt der YGOPRODeck-Name.
  const ohne = welt({ cache, ygo: () => Promise.resolve({ name: "Blue-Eyes White Dragon", sets: [] }) });
  const b = await resolveAnfrage(anfrage([["YGLD-DEA01", "Ultra Rare"]], null, "89631139"), ohne.deps);
  assertEquals(b.results[0].cached, true);
  // Alte Zeilen ohne name_norm gelten nie.
  const alt = welt({ rows: [{ card_id: "89631139", code_key: "LOB-1", rarity_key: "ultrarare", status: "resolved", how: "unique", reason: null,
    cm: [1], index_date: "2026-11-03", checked_at: "2026-11-03T05:00:00Z" } as CacheRow] });
  const c = await resolveAnfrage(anfrage([["LOB-DE001", "Ultra Rare"]], "Blue-Eyes White Dragon", "89631139"), alt.deps);
  assertEquals(c.results.map((r) => [r.cm, r.cached]), [[[102800], false]]);
});

// --- YGOPRODeck-Abruf (ygoprodeck.ts) und Lader (index-file.ts) ---
import { ygoAbruf, ygoClient, YGO_URL } from "./ygoprodeck.ts";
import { dateiLader } from "./index-file.ts";
import { gzipJson } from "../refresh-cardmarket-prices/price_file.ts";

const antwort = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

Deno.test("ygoAbruf: 200 -> Name und Drucke; 400 -> unbekannt; 5xx/Netz/Timeout -> null", async () => {
  const urls: string[] = [];
  const ok = (u: string | URL | Request) => {
    urls.push(String(u));
    return antwort(200, { data: [{ name: " Ash Blossom & Joyous Spring ", card_sets: [{ set_code: "RA01-EN008", set_rarity: "Ultra Rare" }, { set_code: 5 }, { set_code: "MP19-EN001" }] }] })();
  };
  assertEquals(await ygoAbruf(ok as typeof fetch, "14558127"), {
    name: "Ash Blossom & Joyous Spring",
    sets: [{ set_code: "RA01-EN008", set_rarity: "Ultra Rare" }, { set_code: "MP19-EN001", set_rarity: null }],
  });
  assertEquals(urls, [`${YGO_URL}?id=14558127`]);
  assertEquals(await ygoAbruf(antwort(400, { error: "No card matching" }) as typeof fetch, "1"), { name: null, sets: [] });
  assertEquals(await ygoAbruf(antwort(503, {}) as typeof fetch, "1"), null);
  assertEquals(await ygoAbruf((() => Promise.reject(new TypeError("netz"))) as typeof fetch, "1"), null);
  const haengt = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
  assertEquals(await ygoAbruf(haengt, "1", 10), null);
});

Deno.test("ygoClient: merkt nur Nicht-null, 24 h, höchstens max Karten", async () => {
  let t = 0, n = 0, fail = false;
  const f = (() => { n++; return fail ? Promise.reject(new Error("x")) : antwort(200, { data: [{ name: "K", card_sets: [] }] })(); }) as typeof fetch;
  const c = ygoClient({ fetch: f, now: () => t, max: 2 });
  await c("1"); await c("1");
  assertEquals(n, 1);
  t = 24 * 3600_000; await c("1");
  assertEquals(n, 2);
  await c("2"); await c("3"); // max 2: die älteste Karte (1) fliegt raus
  await c("3");
  assertEquals(n, 4);
  await c("1");
  assertEquals(n, 5);
  fail = true;
  assertEquals(await c("9"), null);
  assertEquals(await c("9"), null);
  assertEquals(n, 7); // null wird nicht gemerkt
});

Deno.test("dateiLader: 1 h Modulspeicher, Fehlschlag wird nicht gemerkt, v != 1 -> null", async () => {
  let t = 0, n = 0;
  let datei: Uint8Array | null = null;
  const lader = dateiLader({ download: () => { n++; return Promise.resolve(datei); }, now: () => t, logError: () => {} });
  assertEquals(await lader.index(), null);
  datei = await gzipJson(INDEX);
  assertEquals((await lader.index())?.date, "2026-11-03"); // null nicht gemerkt -> neu geladen
  await lader.index();
  assertEquals(n, 2);
  t = 3600_000;
  datei = await gzipJson({ ...INDEX, v: 2 });
  assertEquals(await lader.index(), null);
  assertEquals(n, 3);
  datei = await gzipJson(PREISE);
  assertEquals((await lader.preise())?.date, "2026-11-02");
});
