// Plan H3b2 Task 3 -- Bestellung -> Buchung gegen docs/fixtures/ebay/orders.json.
import { assertEquals } from "jsr:@std/assert@1";
import { bookingFor, feeUpdate, finalFeeCents, notices, parseOrder, pickCopies, tokenDue } from "./ebay-orders.ts";

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
