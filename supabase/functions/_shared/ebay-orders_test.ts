// Plan H3b2 Task 3 -- Bestellung -> Buchung gegen docs/fixtures/ebay/orders.json.
import { assertEquals } from "jsr:@std/assert@1";
import { bookingFor, feesPatch, feeUpdate, finalFeeCents, notices, parseOrder, pickCopies, tokenDue } from "./ebay-orders.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/ebay/orders.json", import.meta.url)));

Deno.test("Bestellung lesen (alle Fixture-Fälle)", () => {
  for (const c of F.orders) assertEquals(parseOrder(c.order, F.env), c.parsed, c.name);
});

Deno.test("Exemplare wählen: die ersten q lebenden nach copy_id, Fehlende gezählt", () => {
  for (const c of F.orders.filter((c: { pick?: unknown }) => c.pick)) {
    assertEquals(pickCopies(parseOrder(c.order, F.env), c.live), c.pick, c.name);
  }
});

Deno.test("Buchung: Preis, Gebühr (A1), Marktwert, Aufteilung", () => {
  for (const c of F.orders.filter((c: { booking?: unknown }) => c.booking)) {
    const p = parseOrder(c.order, F.env);
    assertEquals(bookingFor(p, c.pick.copyIds, F.cards, c.feePercent ?? 0), c.booking, c.name);
  }
});

Deno.test("Gebühren nachtragen nur bei unveränderter vorläufiger Gebühr (A2)", () => {
  for (const c of F.feeUpdate) assertEquals(feeUpdate(c), c.result, c.name);
});

Deno.test("Endgültige Gebühr aus den Finanzdaten", () => {
  for (const c of F.finalFee) assertEquals(finalFeeCents(c.transactions), c.cents, c.name);
});

Deno.test("Hinweise mit festen Schlüsseln und Wortlaut", () => {
  // deno-lint-ignore no-explicit-any
  for (const c of F.notices) assertEquals((notices as any)[c.fn](...c.args), c.notice, c.fn);
});

Deno.test("Token-Hinweis 30 Tage vor Ablauf", () => {
  for (const c of F.tokenDue) assertEquals(tokenDue(c.expires, Date.parse(c.now)), c.due, JSON.stringify(c));
});

Deno.test("Gebühr nachtragen: Kopf bleibt, Anteile nach eingefrorenem Marktwert neu verteilt", () => {
  const sale = {
    head: { sale_id: "s1", sold_on: "2026-09-24", channel_id: "ebay", channel_name: "eBay", gross: "9.00", fees: "0.90", shipping: "1.00", note: "eBay-Bestellung O-2", status: "aktiv" },
    items: [{ copy_id: "c3", value_at_sale: "1.70" }, { copy_id: "c1", value_at_sale: "2.00" }, { copy_id: "c2", value_at_sale: "2.00" }],
  };
  assertEquals(feesPatch(sale, 81), {
    p_sale: { sale_id: "s1", sold_on: "2026-09-24", channel_id: "ebay", channel_name: "eBay", gross: 9, fees: 0.81, shipping: 1, note: "eBay-Bestellung O-2" },
    // Netto 900 - 81 - 100 = 719 -> 252,28 / 252,28 / 214,44 -> 252 + 252 + 214 = 718, Rest 1 an die erste größte (c1)
    p_shares: [{ copy_id: "c1", share: 2.53 }, { copy_id: "c2", share: 2.52 }, { copy_id: "c3", share: 2.14 }],
  });
});
