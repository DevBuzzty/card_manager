// Spec H3b §10 -- Deno-Zwilling gegen dieselbe Fixture wie listing-text.cjs / listingText.js / ListingText.kt.
import { assertEquals } from "jsr:@std/assert@1";
import { afterListingSale, cleanupAfterSale, listingDescription, listingTitle, type LineItem, pieceCents, rowTitle } from "./listing-text.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/listings/listings.json", import.meta.url)));
const items = (ids: string[]): LineItem[] => ids.map((id) => F.items[id]);

Deno.test("Titel wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.titles) {
    const t = listingTitle(items(c.items));
    assertEquals(t, c.title, c.name);
    assertEquals(t.length, c.length, c.name);
  }
});

Deno.test("Beschreibung wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.descriptions) assertEquals(listingDescription(items(c.items), c.priceCents), c.text, c.name);
});

Deno.test("Stückpreis wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.pieceCents) assertEquals(pieceCents(c.total, c.quantity), c.cents);
});

Deno.test("Verkauf aus dem Angebot wie H3a + A6 (alle Fixture-Fälle)", () => {
  for (const c of F.afterSale) assertEquals(afterListingSale(c.listing, c.live, c.sold), c.result, c.name);
});

Deno.test("Zeilentitel wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.rowTitleCases) assertEquals(rowTitle(c.listing, items(c.items)), c.title);
});

Deno.test("Aufräumen nach Verkauf wie H3a (alle Fixture-Fälle)", () => {
  const B = F.board;
  const boardItems = B.items.map((it: Record<string, unknown>) => ({ ...B.base, ...it }));
  for (const c of B.cleanup) assertEquals(cleanupAfterSale(B.listings, boardItems, c.sold, c.except), c.result, c.name);
});
