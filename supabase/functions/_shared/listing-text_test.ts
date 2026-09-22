// Spec H3b §10 -- Deno-Zwilling gegen dieselbe Fixture wie listing-text.cjs / listingText.js / ListingText.kt.
import { assertEquals } from "jsr:@std/assert@1";
import { listingDescription, listingTitle, type LineItem, pieceCents } from "./listing-text.ts";

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
