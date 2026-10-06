import { assertEquals } from "jsr:@std/assert@1";
import { median3, summarizeSales } from "./summarize.ts";
import type { SoldItem } from "../_shared/ebay-client.ts";

const P = { card_id: "1", set_code: "SDJ-G001", language: "DE", rarity: "Ultra Rare" };
const it = (title: string, price: number | null, soldAt: string, extra: Partial<SoldItem> = {}): SoldItem =>
  ({ itemId: title, title, price, currency: "EUR", soldAt, url: `https://www.ebay.de/itm/${price}`, conditionId: "4000", ...extra });

Deno.test("median3: unter 3 null, ungerade, gerade, auf Cent", () => {
  assertEquals(median3([]), null);
  assertEquals(median3([1, 2]), null);
  assertEquals(median3([3, 1, 2]), 2);
  assertEquals(median3([4, 1, 2, 3]), 2.5);
  assertEquals(median3([1.111, 2.221, 3.333, 4.444]), 2.78);
});

Deno.test("summarizeSales: nur passende EUR-Verkäufe mit Preis, 1. Auflage getrennt, jüngster Verkauf", () => {
  const s = summarizeSales([
    it("SDJ-G001 1. Auflage", 9, "2026-09-20T10:00:00Z"),
    it("SDJ-G001 1st Edition", 10, "2026-09-21T10:00:00Z"),
    it("SDJ-G001 Erstauflage", 8, "2026-09-22T10:00:00Z"),
    it("SDJ-G001", 6, "2026-09-28T14:03:00Z"),
    it("SDJ-G001 PSA 10", 200, "2026-09-29T10:00:00Z"),
    it("SDJ-G001", 5, "2026-09-25T10:00:00Z", { currency: "USD" }),
    it("SDJ-G001", null, "2026-09-26T10:00:00Z"),
    it("LOB-DE001", 50, "2026-09-27T10:00:00Z"),
  ], P);
  assertEquals([s.status, s.n_all, s.median_all, s.n_first, s.median_first], ["ok", 4, 8.5, 3, 9]);
  assertEquals([s.last_sold_at, s.last_sold_price], ["2026-09-28T14:03:00Z", 6]);
  assertEquals(s.sales.map((x) => x.price), [6, 8, 10, 9]);
  assertEquals(s.sales[0], { title: "SDJ-G001", price: 6, sold_at: "2026-09-28T14:03:00Z", url: "https://www.ebay.de/itm/6", first: false });
});

Deno.test("summarizeSales: 0-2 passende -> zu_wenig, Mediane null, Belege trotzdem", () => {
  const s = summarizeSales([it("SDJ-G001", 6, "2026-09-28T14:03:00Z"), it("SDJ-G001", 7, "2026-09-27T14:03:00Z")], P);
  assertEquals([s.status, s.n_all, s.median_all, s.median_first, s.sales.length], ["zu_wenig", 2, null, null, 2]);
  assertEquals(summarizeSales([], P), { median_all: null, n_all: 0, median_first: null, n_first: 0, last_sold_at: null, last_sold_price: null, sales: [], status: "zu_wenig" });
});

Deno.test("summarizeSales: höchstens 20 Belege, jüngste zuerst; Verkäufe ohne Datum zählen, aber hinten", () => {
  const many = Array.from({ length: 25 }, (_, i) => it("SDJ-G001", i + 1, `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
  many.push(it("SDJ-G001", 99, null as unknown as string, { soldAt: null }));
  const s = summarizeSales(many, P);
  assertEquals([s.n_all, s.sales.length, s.sales[0].price, s.last_sold_price], [26, 20, 25, 25]);
});
