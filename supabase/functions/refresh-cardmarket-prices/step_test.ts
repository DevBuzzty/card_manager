// Spec 2026-11-03 §5.1/§10 -- step-Weiche und Ablauf des Index-Schritts ohne Netz (Fake-fetch, Fake-Upload).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { CARDSETS_URL, NONSINGLES_URL, routeStep, runCmIndexStep, SINGLES_URL, type StepDeps } from "./cm_index.ts";
import { jsonBody } from "../_shared/http.ts";

const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json";
const KATALOG_URL = "https://x.supabase.co/storage/v1/object/public/catalog/catalog.v11.json.gz";
const GRENZEN = { singles: 2, nonsingles: 1, cardsets: 1, prefixes: 1 };

const files = {
  cardsets: [{ set_code: "RA01", set_name: "Rarity Collection" }],
  nonsingles: { products: [{ idProduct: 920, name: "Rarity Collection Booster", idExpansion: 20 }] },
  singles: { products: [
    { idProduct: 211, name: "Maxx \"C\"", idExpansion: 20 },
    { idProduct: 212, name: "Maxx \"C\"", idExpansion: 20 },
    { idProduct: 221, name: "Effect Veiler", idExpansion: 20 },
  ] },
};

async function gz(obj: unknown): Promise<Uint8Array> {
  const st = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(st).arrayBuffer());
}

type Route = { status?: number; body?: unknown; bytes?: Uint8Array; throws?: boolean };
function welt(routes: Record<string, Route>, extra: Partial<StepDeps> = {}) {
  const urls: string[] = [];
  const uas: (string | null)[] = [];
  const uploads: Uint8Array[] = [];
  const logs: unknown[][] = [];
  const fetchFn = (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    urls.push(u);
    uas.push(new Headers(init?.headers).get("user-agent"));
    const r = routes[u];
    if (!r) return Promise.resolve(new Response("nope", { status: 404 }));
    if (r.throws) return Promise.reject(new TypeError("netz weg"));
    if (r.bytes) return Promise.resolve(new Response(r.bytes as unknown as BodyInit, { status: r.status ?? 200 }));
    return Promise.resolve(new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 }));
  };
  const deps: StepDeps = {
    fetch: fetchFn as typeof fetch,
    ua: "TestUA/1.0",
    cloudCards: () => Promise.resolve([{ name: "Maxx \"C\"", set_code: "RA01-EN011", rarity: "Ultra Rare", cm_product_id: 211 }]),
    katalogUrl: () => Promise.resolve(KATALOG_URL),
    upload: (b) => { uploads.push(b); return Promise.resolve(); },
    env: () => undefined,
    now: () => new Date("2026-11-03T05:20:41.123Z"),
    grenzen: GRENZEN,
    log: (...a: unknown[]) => { logs.push(a); },
    logError: () => {},
    ...extra,
  };
  return { deps, urls, uas, uploads, logs };
}
const OK_ROUTES: Record<string, Route> = {
  [CARDSETS_URL]: { body: files.cardsets },
  [NONSINGLES_URL]: { body: files.nonsingles },
  [SINGLES_URL]: { body: files.singles },
};
async function entpacke(b: Uint8Array) {
  const st = new Blob([b as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(st).text());
}

Deno.test("routeStep: cm-index / unknown / main, auch für kaputten Body", async () => {
  assertEquals(routeStep({ step: "cm-index" }), "cm-index");
  assertEquals(routeStep({ step: "anderes" }), "unknown");
  assertEquals(routeStep({ step: 5 }), "unknown");
  assertEquals(routeStep({}), "main");
  assertEquals(routeStep({ step: "" }), "main");
  assertEquals(routeStep({ step: null }), "main");
  const kaputt = await jsonBody(new Request("https://x", { method: "POST", body: "{kein json" }));
  assertEquals(routeStep(kaputt), "main");
  const ohne = await jsonBody(new Request("https://x", { method: "POST" }));
  assertEquals(routeStep(ohne), "main");
});

Deno.test("runCmIndexStep: Erfolg -- Reihenfolge cardsets -> nonsingles -> singles, nie der Preisführer, UA, Upload, Body §5.1", async () => {
  const w = welt(OK_ROUTES);
  const r = await runCmIndexStep(w.deps);
  assertEquals(r.status, 200);
  assertEquals(w.urls, [CARDSETS_URL, NONSINGLES_URL, SINGLES_URL]);
  assert(!w.urls.includes(GUIDE_URL));
  assertEquals(w.uas, ["TestUA/1.0", "TestUA/1.0", "TestUA/1.0"]);
  assertEquals(w.uploads.length, 1);
  const ix = await entpacke(w.uploads[0]);
  assertEquals(ix.v, 1);
  assertEquals(ix.date, "2026-11-03");
  assertEquals(ix.built_at, "2026-11-03T05:20:41Z");
  assertEquals(ix.x, { RA01: [20] });
  assertEquals(ix.real, { "RA01-11|maxxc|ultrarare": 211 });
  assertEquals(ix.stats.catalog, false);
  assertEquals(r.body, { step: "cm-index", cmIndex: { date: "2026-11-03", names: 2, prefixes: 1, singles: 3, real: 1, catalog: false, bytes: w.uploads[0].length } });
  const phasen = w.logs.map((l) => l[1]);
  assertEquals(phasen, ["cardsets", "nonsingles", "singles", "real", "katalog", "upload"]);
  assert(w.logs.every((l) => l[0] === "[cm-index]"));
});

Deno.test("runCmIndexStep: Pflichtfehler -> 500 mit Fehlertext, kein Upload (je Eingabe)", async () => {
  const faelle: [string, Route][] = [
    [CARDSETS_URL, { throws: true }],
    [CARDSETS_URL, { status: 503, body: "x" }],
    [CARDSETS_URL, { body: "{kaputt" }],
    [CARDSETS_URL, { body: { nicht: "array" } }],
    [NONSINGLES_URL, { body: { produkte: [] } }],
    [SINGLES_URL, { status: 500, body: "x" }],
    [SINGLES_URL, { body: { products: "kein array" } }],
  ];
  for (const [url, route] of faelle) {
    const w = welt({ ...OK_ROUTES, [url]: route });
    const r = await runCmIndexStep(w.deps);
    assertEquals(r.status, 500, `${url} ${JSON.stringify(route)}`);
    assertEquals(w.uploads.length, 0);
    const body = r.body as { step: string; cmIndex: { error: string } };
    assertEquals(body.step, "cm-index");
    assert(typeof body.cmIndex.error === "string" && body.cmIndex.error.length > 0);
  }
});

Deno.test("runCmIndexStep: unplausibel (zu wenige Singles / Präfixe) -> kein Upload", async () => {
  for (const grenzen of [{ ...GRENZEN, singles: 4 }, { ...GRENZEN, prefixes: 2 }, { ...GRENZEN, cardsets: 2 }, { ...GRENZEN, nonsingles: 2 }]) {
    const w = welt(OK_ROUTES, { grenzen });
    const r = await runCmIndexStep(w.deps);
    assertEquals(r.status, 500);
    assertEquals(w.uploads.length, 0);
  }
});

Deno.test("runCmIndexStep: Upload-Fehler -> 500", async () => {
  const w = welt(OK_ROUTES, { upload: () => Promise.reject(new Error("bucket fehlt")) });
  const r = await runCmIndexStep(w.deps);
  assertEquals(r.status, 500);
  assertEquals((r.body as { cmIndex: { error: string } }).cmIndex.error.includes("bucket fehlt"), true);
});

Deno.test("runCmIndexStep: optionale Eingaben fehlen -> Upload mit stats.real = 0", async () => {
  const w = welt(OK_ROUTES, { cloudCards: () => Promise.reject(new Error("select kaputt")) });
  const r = await runCmIndexStep(w.deps);
  assertEquals(r.status, 200);
  const ix = await entpacke(w.uploads[0]);
  assertEquals(ix.stats.real, 0);
  assertEquals(ix.real, {});
});

Deno.test("runCmIndexStep: Katalog nur mit CM_INDEX_KATALOG=1; Katalogfehler ist nicht fatal", async () => {
  const katalog = { cards: [{ printings: [{ code: "RA01-EN012", rarity: "Super Rare", cm: 221 }], printings_verified: [] }] };
  const routes = { ...OK_ROUTES, [KATALOG_URL]: { bytes: await gz(katalog) } };
  const ohne = welt(routes);
  await runCmIndexStep(ohne.deps);
  assert(!ohne.urls.includes(KATALOG_URL));

  const mit = welt(routes, { env: (k) => (k === "CM_INDEX_KATALOG" ? "1" : undefined) });
  const r = await runCmIndexStep(mit.deps);
  assertEquals(r.status, 200);
  assertEquals(mit.urls.at(-1), KATALOG_URL);
  const ix = await entpacke(mit.uploads[0]);
  assertEquals(ix.stats.catalog, true);
  assertEquals(ix.blocks, { "20": { ultrarare: 211, superrare: 221 } });

  const kaputt = welt({ ...OK_ROUTES, [KATALOG_URL]: { status: 404, body: "x" } }, { env: (k) => (k === "CM_INDEX_KATALOG" ? "1" : undefined) });
  const r2 = await runCmIndexStep(kaputt.deps);
  assertEquals(r2.status, 200);
  assertEquals((await entpacke(kaputt.uploads[0])).stats.catalog, false);
});
