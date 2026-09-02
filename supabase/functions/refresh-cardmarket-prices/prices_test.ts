// supabase/functions/refresh-cardmarket-prices/prices_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { pickTrends } from "./prices.ts";

const guide = {
  version: 1,
  priceGuides: [
    { idProduct: 102801, trend: 0.42, low: 0.1 },
    { idProduct: 741145, trend: 12.5, low: 9 },
    { idProduct: 102800, trend: null, low: 20 },   // no trend -> skipped
    { idProduct: 999001, trend: 0, low: 0.02 },     // 0 means "no trend" -> skipped
    { idProduct: 741145, trend: 12.5, low: 9 },     // duplicate -> once
    { idProduct: 555555, trend: 3.3 },              // not needed -> skipped
  ],
};

Deno.test("pickTrends keeps only needed ids with a positive trend, de-duplicated", () => {
  const out = pickTrends(guide, new Set([102801, 741145, 102800, 999001, 123]));
  assertEquals(out, [
    { id_product: 102801, trend: 0.42 },
    { id_product: 741145, trend: 12.5 },
  ]);
});

Deno.test("pickTrends: empty ids -> []", () => {
  assertEquals(pickTrends(guide, new Set()), []);
});

Deno.test("pickTrends: malformed guide -> []", () => {
  assertEquals(pickTrends(null, new Set([1])), []);
  assertEquals(pickTrends({}, new Set([1])), []);
  assertEquals(pickTrends({ priceGuides: "nope" }, new Set([1])), []);
});

Deno.test("pickTrends: non-numeric trend is skipped", () => {
  assertEquals(pickTrends({ priceGuides: [{ idProduct: 1, trend: "0.5" }, { idProduct: 2, trend: NaN }, { idProduct: 3, trend: -1 }] }, new Set([1, 2, 3])), []);
});
