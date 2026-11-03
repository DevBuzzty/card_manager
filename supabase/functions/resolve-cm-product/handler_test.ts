// Spec 2026-11-03 §5.2/§10 -- Vertrag (docs/fixtures/cm-resolve/contract.json, requests), 405, 401, 503, 500 ohne Details.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleResolve, type HandlerDeps, pruefeAnfrage } from "./handler.ts";
import { type Anfrage, type Antwort, resolveAnfrage } from "./resolve.ts";
import { dateiLader } from "./index-file.ts";
import { fakeCacheStore } from "./fake-cache-store.ts";
import { gzipJson } from "../refresh-cardmarket-prices/price_file.ts";

const fx = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/cm-resolve/contract.json", import.meta.url)));
const FN = "https://x/functions/v1/resolve-cm-product";
const OK: Antwort = { ok: true, v: 1, index_date: "2026-11-03", price_date: null, card: { name_en: null, ab: null, ab_products: 0 }, results: [], prices: {} };

function welt(resolve?: HandlerDeps["resolve"]) {
  const anfragen: Anfrage[] = [];
  const errors: unknown[][] = [];
  const d: HandlerDeps = {
    verifyUser: (h) => Promise.resolve(h === "Bearer JWT"),
    resolve: resolve ?? ((a) => { anfragen.push(a); return Promise.resolve(OK); }),
    logError: (...a) => { errors.push(a); },
  };
  return { d, anfragen, errors };
}
const req = (body: unknown, o: { method?: string; auth?: string | null; raw?: string } = {}) =>
  new Request(FN, {
    method: o.method ?? "POST",
    headers: o.auth === null ? {} : { authorization: o.auth ?? "Bearer JWT", "content-type": "application/json" },
    body: (o.method ?? "POST") === "POST" ? (o.raw ?? JSON.stringify(body)) : undefined,
  });

// "printings": "11x" -> elf gültige Einträge; { "_len": n } -> Zeichenkette aus n x "a".
function baue(v: unknown): unknown {
  if (v === "11x") return Array.from({ length: 11 }, (_, i) => ({ set_code: `LOB-DE${String(i + 1).padStart(3, "0")}`, rarity: "Common" }));
  if (v && typeof v === "object" && !Array.isArray(v) && "_len" in v) return "a".repeat((v as { _len: number })._len);
  if (Array.isArray(v)) return v.map(baue);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, baue(x)]));
  return v;
}

for (const c of fx.requests) {
  Deno.test(`contract.json: ${c.name} -> ${c.status}`, async () => {
    const w = welt();
    const res = await handleResolve(req(baue(c.body)), w.d);
    assertEquals(res.status, c.status);
    const body = await res.json();
    if (c.status === 200) {
      assertEquals(body, OK);
      assertEquals(w.anfragen.length, 1);
    } else {
      assertEquals(body.ok, false);
      assertEquals(body.code, c.code);
      assert(String(body.error).startsWith("Anfrage ungültig: "));
      assertEquals(w.anfragen.length, 0);
    }
  });
}

Deno.test("pruefeAnfrage: name_en leer/null/fehlend -> null, sonst getrimmt; set_code getrimmt weitergereicht", () => {
  const p = (name_en: unknown) => pruefeAnfrage({ v: 1, card_id: "1", name_en, printings: [{ set_code: " LOB-DE001 ", rarity: "" }] });
  assertEquals(p(undefined), { anfrage: { card_id: "1", name_en: null, printings: [{ set_code: "LOB-DE001", rarity: "" }] } });
  assertEquals(p(null), p(undefined));
  assertEquals(p("   "), p(undefined));
  assertEquals(p("  Kuriboh "), { anfrage: { card_id: "1", name_en: "Kuriboh", printings: [{ set_code: "LOB-DE001", rarity: "" }] } });
  assertEquals(p("a".repeat(200) + "   "), { anfrage: { card_id: "1", name_en: "a".repeat(200), printings: [{ set_code: "LOB-DE001", rarity: "" }] } });
});

Deno.test("pruefeAnfrage: weitere Regelverstöße", () => {
  const basis = { v: 1, card_id: "1", printings: [{ set_code: "LOB-DE001", rarity: "Common" }] };
  const feld = (b: unknown) => (pruefeAnfrage(b) as { feld?: string }).feld;
  assertEquals(feld({ ...basis, card_id: "12345678901" }), "card_id");
  assertEquals(feld({ ...basis, card_id: 89631139 }), "card_id");
  assertEquals(feld({ ...basis, printings: [{ set_code: "   ", rarity: "" }] }), "printings[0].set_code");
  assertEquals(feld({ ...basis, printings: [{ set_code: "A".repeat(21), rarity: "" }] }), "printings[0].set_code");
  assertEquals(feld({ ...basis, printings: [{ set_code: "LOB-DE001", rarity: "x".repeat(61) }] }), "printings[0].rarity");
  assertEquals(feld({ ...basis, printings: [{ set_code: "LOB-DE001" }] }), "printings[0].rarity");
  assertEquals(feld({ ...basis, printings: [null] }), "printings[0]");
  assertEquals(feld({ ...basis, printings: "LOB" }), "printings");
  assertEquals(feld({ ...basis, printings: [{ set_code: "LOB-DE001", rarity: "Unknown" }] }), undefined); // unbekannte Seltenheit erlaubt
  assertEquals(feld({ ...basis, extra: 1 }), undefined); // unbekannte Felder ignoriert
});

Deno.test("Body kein JSON-Objekt -> 400 bad_request", async () => {
  for (const raw of ["[1,2]", "null", "{kaputt", "5"]) {
    const res = await handleResolve(req(null, { raw }), welt().d);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).code, "bad_request");
  }
});

Deno.test("Nur POST -> 405; ohne gültige Anmeldung -> 401 (vor der Validierung)", async () => {
  const w = welt();
  const r1 = await handleResolve(req(null, { method: "GET" }), w.d);
  assertEquals(r1.status, 405);
  assertEquals(await r1.json(), { ok: false, code: "method", error: "Nur POST." });
  const r2 = await handleResolve(req({ v: 2 }, { auth: null }), w.d);
  assertEquals(r2.status, 401);
  assertEquals(await r2.json(), { ok: false, code: "auth", error: "Nicht angemeldet." });
  const r3 = await handleResolve(req({ v: 2 }, { auth: "Bearer falsch" }), w.d);
  assertEquals(r3.status, 401);
});

const GUELTIG = fx.requests[0].body;
function mitDatei(datei: Uint8Array | null) {
  const lader = dateiLader({ download: (bucket) => Promise.resolve(bucket === "cm-index" ? datei : null), now: () => 0, logError: () => {} });
  return welt((a) => resolveAnfrage(a, {
    index: lader.index, preise: lader.preise, ygo: () => Promise.resolve(null), cache: fakeCacheStore().store,
    now: () => new Date("2026-11-03T12:00:00Z"), zustand: { tabelleFehltGemeldet: false }, log: () => {}, logError: () => {},
  }));
}

Deno.test("503 no_index: Index fehlt, ist kaputt oder hat v != 1", async () => {
  for (const datei of [null, new TextEncoder().encode("kein gzip"), await gzipJson({ v: 2, date: "2026-11-03", s: {}, x: {} })]) {
    const res = await handleResolve(req(GUELTIG), mitDatei(datei).d);
    assertEquals(res.status, 503);
    assertEquals(await res.json(), { ok: false, code: "no_index", error: "Cardmarket-Index fehlt." });
  }
});

Deno.test("200 mit echtem Lader und gültigem Index (Preisdatei fehlt -> kein Fehler)", async () => {
  const datei = await gzipJson({ v: 1, date: "2026-11-03", built_at: "x", s: { blueeyeswhitedragon: [102800, 1011] }, x: { LOB: [1011] }, real: {}, learned: {}, blocks: {}, stats: {} });
  const res = await handleResolve(req(GUELTIG), mitDatei(datei).d);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.price_date, null);
  assertEquals(body.results[0].cm, [102800]);
  assertEquals(body.results[0].status, "resolved");
});

Deno.test("500 internal ohne Details, Meldung nur im Protokoll", async () => {
  const w = welt(() => Promise.reject(new Error("geheimes Detail")));
  const res = await handleResolve(req(GUELTIG), w.d);
  assertEquals(res.status, 500);
  const text = await res.text();
  assertEquals(JSON.parse(text), { ok: false, code: "internal", error: "Interner Fehler." });
  assert(!text.includes("geheim"));
  assertEquals(w.errors.length, 1);
});
