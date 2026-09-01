// supabase/functions/scrape-deals/ebay_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { ebayFilter, mapEbayItem, shouldDropForUsed, isNewConditionId } from "./ebay.ts";

Deno.test("ebayFilter: base filters always present, fixed-price + ship-to-DE", () => {
  const f = ebayFilter(0, "any");
  assertEquals(f.includes("buyingOptions:{FIXED_PRICE}"), true);
  assertEquals(f.includes("deliveryCountry:DE"), true);
  assertEquals(f.includes("conditionIds"), false);
  assertEquals(f.includes("price:"), false);
});

Deno.test("ebayFilter: price range added when max > 0, EUR currency", () => {
  const f = ebayFilter(90, "any");
  assertEquals(f.includes("price:[..90]"), true);
  assertEquals(f.includes("priceCurrency:EUR"), true);
});

Deno.test("ebayFilter: 'new' adds conditionIds, 'used'/'any' do not", () => {
  assertEquals(ebayFilter(50, "new").includes("conditionIds:{1000|1500}"), true);
  assertEquals(ebayFilter(50, "used").includes("conditionIds"), false);
  assertEquals(ebayFilter(50, "any").includes("conditionIds"), false);
});

Deno.test("isNewConditionId: only 1000 and 1500 are new", () => {
  assertEquals(isNewConditionId("1000"), true);
  assertEquals(isNewConditionId("1500"), true);
  assertEquals(isNewConditionId("3000"), false);
  assertEquals(isNewConditionId("7000"), false);
  assertEquals(isNewConditionId(undefined), false);
});

Deno.test("shouldDropForUsed: drops new items only when condition is 'used'", () => {
  assertEquals(shouldDropForUsed({ conditionId: "1000" }, "used"), true);
  assertEquals(shouldDropForUsed({ conditionId: "1500" }, "used"), true);
  assertEquals(shouldDropForUsed({ conditionId: "3000" }, "used"), false);
  assertEquals(shouldDropForUsed({ conditionId: "1000" }, "any"), false);
  assertEquals(shouldDropForUsed({ conditionId: "1000" }, "new"), false);
});

Deno.test("mapEbayItem: maps EUR item, keeps id/title/url/image", () => {
  const it = mapEbayItem({
    itemId: "v1|123|0", title: "Yugioh Display",
    price: { value: "79.90", currency: "EUR" },
    itemWebUrl: "https://www.ebay.de/itm/123",
    image: { imageUrl: "https://i.ebayimg.com/x.jpg" },
  });
  assertEquals(it, {
    source: "ebay", listingId: "v1|123|0", title: "Yugioh Display",
    price: 79.9, url: "https://www.ebay.de/itm/123",
    imageUrl: "https://i.ebayimg.com/x.jpg",
  });
});

Deno.test("mapEbayItem: non-EUR price -> price null (loop drops it)", () => {
  const it = mapEbayItem({
    itemId: "1", title: "x", price: { value: "80", currency: "USD" },
    itemWebUrl: "https://www.ebay.de/itm/1",
  });
  assertEquals(it?.price, null);
});

Deno.test("mapEbayItem: image falls back to thumbnailImages", () => {
  const it = mapEbayItem({
    itemId: "1", title: "x", price: { value: "5", currency: "EUR" },
    itemWebUrl: "https://www.ebay.de/itm/1",
    thumbnailImages: [{ imageUrl: "https://thumb/1.jpg" }],
  });
  assertEquals(it?.imageUrl, "https://thumb/1.jpg");
});

Deno.test("mapEbayItem: missing itemId or url -> null", () => {
  assertEquals(mapEbayItem({ title: "x", itemWebUrl: "u" }), null);
  assertEquals(mapEbayItem({ itemId: "1", title: "x" }), null);
});
