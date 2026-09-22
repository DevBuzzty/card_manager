// Spec H3b §5.2/§5.3/§10 -- Abbildung Angebot -> Inventar-Artikel/Offer gegen docs/fixtures/ebay/map.json.
import { assertEquals } from "jsr:@std/assert@1";
import * as M from "./ebay-map.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/ebay/map.json", import.meta.url)));
const live = new Set<string>(F.liveCopyIds);
const built = (id: string, defs = F.defs) => {
  const d = M.desired(F.listings[id], F.items, live);
  const urls = M.ownPhotos(F.photos, id).map((p) => M.photoUrl(F.baseUrl, p.path));
  return M.buildListing(F.listings[id], d.liveItems, urls, defs);
};

Deno.test("Soll: aktiv nur eBay + aktiv + lebende Position mit lebendem Exemplar", () => {
  for (const id of Object.keys(F.listings)) {
    const d = M.desired(F.listings[id], F.items, live);
    assertEquals(d.active, F.expected[id].active, id);
    assertEquals(d.liveItems.map((i) => i.copy_id), F.expected[id].live, id);
  }
  assertEquals(M.desired(null, F.items, live).active, false);
});

Deno.test("Menge, Stückpreis, Art, Zustand, Hinweis", () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    const b = built(id), e = F.expected[id];
    assertEquals([b.kind, b.quantity, b.pieceCents, b.condition, b.problem], [e.kind, e.quantity, e.pieceCents, e.condition, e.problem], id);
  }
});

Deno.test("Inventar-Artikel und Offer wörtlich (Titel, HTML, Merkmale, Bilder, Richtlinien)", () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    const b = built(id);
    assertEquals(M.inventoryItemBody(b), F.expected[id].inventoryItem, id);
    assertEquals(M.offerBody(b, F.policies), F.expected[id].offer, id);
  }
});

Deno.test("Prüfsumme stabil und empfindlich", async () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    assertEquals(await M.hashOf(built(id)), F.expected[id].hash, id);
  }
  const b = built("l1");
  assertEquals(await M.hashOf({ ...b, quantity: 1 }) === F.expected.l1.hash, false, "Menge ändert die Prüfsumme");
  assertEquals(await M.hashOf({ ...b, aspects: {} }), F.expected.l1.hash, "Merkmale gehören nicht zur Prüfsumme");
});

Deno.test("Pflichtmerkmale ohne Wert -> missing, Text", () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    assertEquals(built(id, [...F.defs, ...F.strictExtra]).missing, F.expected[id].strictMissing, id);
  }
  for (const c of F.missingTexts) assertEquals(M.missingText(c.missing), c.text);
});

Deno.test("HTML-Entschärfung und Zeilenumbrüche", () => {
  assertEquals(M.descriptionHtml("a<b>&'\"\r\nx\ry\nz"), "a&lt;b&gt;&amp;&#39;&quot;<br>x<br>y<br>z");
});

Deno.test("Bilder: höchstens 24, nur https, ohne Doppelte; eigene Fotos höchstens 12", () => {
  const many = Array.from({ length: 30 }, (_, i) => `https://x/${i}.jpg`);
  assertEquals(M.imageList([...many, "http://x/a.jpg", "https://x/0.jpg"], []).length, 24);
  const photos = Array.from({ length: 14 }, (_, i) => ({ photo_id: `p${i}`, listing_id: "l", path: `l/${i}.jpg`, sort: 13 - i, deleted: false }));
  const own = M.ownPhotos(photos, "l");
  assertEquals([own.length, own[0].photo_id], [12, "p13"]);
});
