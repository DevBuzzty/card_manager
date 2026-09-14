import { assertEquals } from "jsr:@std/assert@1";
import { FAMILIES, familyOfLock, familyOfSource } from "./families.ts";

Deno.test("families: gleicht desktop/electron/price-families.json", async () => {
  const json = JSON.parse(
    await Deno.readTextFile(new URL("../../../desktop/electron/price-families.json", import.meta.url)),
  );
  assertEquals(FAMILIES, json);
});

Deno.test("families: unbekannte Quelle und Sperre", () => {
  assertEquals(familyOfSource("irgendwas"), "unknown");
  assertEquals(familyOfSource(null), "unknown");
  assertEquals(familyOfSource("toString"), "unknown");
  assertEquals(
    [familyOfLock(null), familyOfLock(0), familyOfLock(1), familyOfLock(2), familyOfLock(7)],
    ["ygo", "ygo", "cm", "manual", "unknown"],
  );
});
