import { assertEquals } from "jsr:@std/assert@1";
import { buildPriceFile, gzipJson } from "./price_file.ts";

Deno.test("buildPriceFile: trend/low > 0 bleiben, 0/null/kaputt werden null, leere Zeilen fallen weg", () => {
  const guide = { priceGuides: [
    { idProduct: 101, trend: 1.5, low: 0.2 },
    { idProduct: 102, trend: 0, low: 0.5 },      // trend 0 = kein Trend
    { idProduct: 103, trend: null, low: null },  // nichts -> weg
    { idProduct: "x", trend: 3 },                // kaputte ID -> weg
    { idProduct: 104, trend: 2 },                // low fehlt
  ] };
  assertEquals(buildPriceFile(guide, "2026-10-04"), {
    v: 1, date: "2026-10-04",
    p: { "101": [1.5, 0.2], "102": [null, 0.5], "104": [2, null] },
  });
});

Deno.test("buildPriceFile: kein priceGuides-Array -> leere Datei", () => {
  assertEquals(buildPriceFile(null, "2026-10-04"), { v: 1, date: "2026-10-04", p: {} });
});

Deno.test("gzipJson: entpackt wieder zum selben JSON", async () => {
  const gz = await gzipJson({ a: 1 });
  const text = await new Response(new Blob([gz as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  assertEquals(JSON.parse(text), { a: 1 });
});
