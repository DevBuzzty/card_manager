// supabase/functions/refresh-cardmarket-prices/cm_index.ts -- Spec 2026-11-03 §5.1. Eigenständiger Schritt "cm-index":
// baut aus cardsets (YGOPRODeck), products_nonsingles/_singles (Cardmarket) und den echten IDs der Cloud-Sammlung den
// kompakten Index für resolve-cm-product und legt ihn im privaten Bucket cm-index ab. Läuft nur mit Body { "step": "cm-index" }
// (eigener Aufruf, 05:20 UTC); der 05:00-Lauf bleibt unverändert. Jeder Fehler: nichts hochladen, der Index vom Vortag bleibt.
import {
  buildExpansionIndex, type ExpansionIndex, expansionIdsFor, learnRanks, normName, type Product,
} from "../_shared/cm-parse.ts";
import { RarityNorm } from "../_shared/rarity-norm.ts";
import { CodeKey } from "../_shared/code-key.ts";
import { gzipJson } from "./price_file.ts";

export const CARDSETS_URL = "https://db.ygoprodeck.com/api/v7/cardsets.php";
export const NONSINGLES_URL = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_3.json";
export const SINGLES_URL = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_3.json";

export const MIN_SINGLES = 50_000;
export const MIN_NONSINGLES = 1_000;
export const MIN_CARDSETS = 500;
export const MIN_PREFIXES = 300;
export type Grenzen = { singles: number; nonsingles: number; cardsets: number; prefixes: number };
const GRENZEN: Grenzen = { singles: MIN_SINGLES, nonsingles: MIN_NONSINGLES, cardsets: MIN_CARDSETS, prefixes: MIN_PREFIXES };

export type RealRow = { name: string | null; set_code: string | null; rarity: string | null; cm_product_id: number | string | null };
export type Probe = { prefix: string; rarityKey: string; idProduct: number };
export type Pos = Map<number, { exp: number; n: number; rank: number }>;
export type CmIndexStats = {
  singles: number; nonsingles: number; cardsets: number; names: number; prefixes: number; real: number; catalog: boolean; blockSamples: number;
};
export type CmIndex = {
  v: 1;
  date: string;
  built_at: string;
  s: Record<string, number[]>;
  x: Record<string, number[]>;
  real: Record<string, number>;
  learned: Record<string, Record<string, number>>;
  blocks: Record<string, Record<string, number>>;
  stats: CmIndexStats;
};

// Wie Desktop prefixOf (cardmarket-bulk.cjs): Teil vor dem ersten "-", groß.
export const prefixOf = (setCode: unknown) => String(setCode ?? "").split("-")[0].toUpperCase();
// Wie resolve-cm-product codeKeyOf (Schlüssel von real und Cache): CodeKey.of, sonst der ganze Code getrimmt und groß.
export const codeKeyOf = (setCode: unknown) => CodeKey.of(String(setCode ?? "")) ?? String(setCode ?? "").trim().toUpperCase();
// Wie language-kr.cjs: KR-Region oder altes einzelnes K direkt vor der Nummer.
export const istKrCode = (code: unknown) => /-KR?[A-Z]?\d/i.test(String(code ?? ""));

// cardsets -> ganzer set_code (groß) -> Set-Namen (wie Desktop buildIndexes, ohne Split).
export function setsByPrefixAus(cardsets: { set_code?: unknown; set_name?: unknown }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of cardsets) {
    const k = String(c?.set_code ?? "").toUpperCase();
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(String(c.set_name ?? ""));
  }
  return m;
}

export function xAus(setsByPrefix: Map<string, string[]>, expansionIndex: ExpansionIndex): Record<string, number[]> {
  const x: Record<string, number[]> = {};
  for (const [k, names] of setsByPrefix) {
    const ids = [...expansionIdsFor(names, expansionIndex)].sort((a, b) => a - b);
    if (ids.length) x[k] = ids;
  }
  return x;
}

// normName -> flaches Array [idProduct, idExpansion, …], je Name nach idProduct aufsteigend. Ohne Expansion: weg.
export function sAus(singles: Product[]): Record<string, number[]> {
  const m = new Map<string, [number, number][]>();
  for (const p of singles) {
    const name = normName(p?.name);
    const id = Number(p?.idProduct), exp = p?.idExpansion == null ? NaN : Number(p.idExpansion);
    if (!name || !Number.isFinite(id) || !Number.isFinite(exp)) continue;
    if (!m.has(name)) m.set(name, []);
    m.get(name)!.push([id, exp]);
  }
  const s: Record<string, number[]> = {};
  for (const [name, list] of m) s[name] = list.sort((a, b) => a[0] - b[0]).flat();
  return s;
}

// idProduct -> Position in seiner Versionsgruppe (Name + Expansion), wie Desktop buildVersionIndex().pos.
export function posAus(s: Record<string, number[]>): Pos {
  const pos: Pos = new Map();
  for (const flach of Object.values(s)) {
    const gruppen = new Map<number, number[]>();
    for (let i = 0; i + 1 < flach.length; i += 2) {
      if (!gruppen.has(flach[i + 1])) gruppen.set(flach[i + 1], []);
      gruppen.get(flach[i + 1])!.push(flach[i]);
    }
    for (const [exp, ids] of gruppen) ids.forEach((id, rank) => pos.set(id, { exp, n: ids.length, rank })); // ids schon aufsteigend
  }
  return pos;
}

// codeKey|normName|rarityKey -> cm_product_id (codeKey = CodeKey.of(set_code) ?: set_code groß, also MIT Kartennummer --
// Review-Nachtrag 2: je Präfix träfe ein fremdes Artwork/ein Reprint derselben Seltenheit). Verschiedene IDs für denselben
// Schlüssel: Schlüssel fällt ganz weg.
export function realAus(rows: RealRow[]): Record<string, number> {
  const real = new Map<string, number>();
  const konflikt = new Set<string>();
  for (const r of rows) {
    const rk = RarityNorm.key(r.rarity);
    const id = Number(r.cm_product_id);
    const name = normName(r.name);
    if (!rk || !name || !r.set_code || istKrCode(r.set_code) || !Number.isInteger(id) || id <= 0) continue;
    const key = `${codeKeyOf(r.set_code)}|${name}|${rk}`;
    if (konflikt.has(key)) continue;
    const alt = real.get(key);
    if (alt !== undefined && alt !== id) {
      real.delete(key);
      konflikt.add(key);
    } else real.set(key, id);
  }
  return Object.fromEntries(real);
}

export function learnedAus(real: Record<string, number>, pos: Pos): Record<string, Record<string, number>> {
  const known = Object.entries(real).map(([k, id]) => ({ rarity: k.slice(k.lastIndexOf("|") + 1), idProduct: id }));
  const out: Record<string, Record<string, number>> = {};
  for (const [k, m] of learnRanks(known, { pos })) out[k] = Object.fromEntries([...m].map(([rank, n]) => [String(rank), n]));
  return out;
}

export function probenAusReal(real: Record<string, number>): Probe[] {
  return Object.entries(real).map(([k, id]) => {
    const [codeKey, , rarityKey] = k.split("|");
    return { prefix: prefixOf(codeKey), rarityKey, idProduct: id };
  });
}

// Katalog v11: cards[].printings[] / printings_verified[] mit code, rarity, cm (Zahl oder Array). Nur einzelne cm.
export function katalogProben(catalog: unknown): Probe[] {
  const out: Probe[] = [];
  const cards = (catalog as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) return out;
  for (const c of cards as Record<string, unknown>[]) {
    for (const liste of [c?.printings, c?.printings_verified]) {
      if (!Array.isArray(liste)) continue;
      for (const p of liste as Record<string, unknown>[]) {
        if (typeof p?.cm !== "number" || !Number.isInteger(p.cm) || p.cm <= 0) continue;
        if (p.lang === "KR" || istKrCode(p.code)) continue;
        const rk = RarityNorm.key(p.rarity as string);
        if (!rk) continue;
        out.push({ prefix: prefixOf(p.code), rarityKey: rk, idProduct: p.cm });
      }
    }
  }
  return out;
}

// Je Expansion (aus der Versionsgruppe der idProduct) und Seltenheit: unterer Median der idProducts.
// Expansionen mit weniger als 2 verschiedenen Seltenheiten fehlen.
export function blocksAus(proben: Probe[], pos: Pos): Record<string, Record<string, number>> {
  const gesehen = new Set<string>();
  const je = new Map<number, Map<string, number[]>>();
  for (const p of proben) {
    const k = `${p.idProduct}|${p.rarityKey}`;
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    const exp = pos.get(p.idProduct)?.exp;
    if (exp === undefined) continue;
    if (!je.has(exp)) je.set(exp, new Map());
    const m = je.get(exp)!;
    if (!m.has(p.rarityKey)) m.set(p.rarityKey, []);
    m.get(p.rarityKey)!.push(p.idProduct);
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [exp, m] of je) {
    if (m.size < 2) continue;
    const e: Record<string, number> = {};
    for (const [rk, ids] of m) {
      ids.sort((a, b) => a - b);
      e[rk] = ids[Math.floor((ids.length - 1) / 2)];
    }
    out[String(exp)] = e;
  }
  return out;
}

function fertig(
  t: { s: Record<string, number[]>; x: Record<string, number[]>; rows: RealRow[]; catalog: unknown | null },
  zahlen: { singles: number; nonsingles: number; cardsets: number },
  meta: { date: string; builtAt: string },
): CmIndex {
  const real = realAus(t.rows);
  const pos = posAus(t.s);
  const proben = probenAusReal(real);
  if (t.catalog != null) proben.push(...katalogProben(t.catalog));
  return {
    v: 1,
    date: meta.date,
    built_at: meta.builtAt,
    s: t.s,
    x: t.x,
    real,
    learned: learnedAus(real, pos),
    blocks: blocksAus(proben, pos),
    stats: {
      ...zahlen,
      names: Object.keys(t.s).length,
      prefixes: Object.keys(t.x).length,
      real: Object.keys(real).length,
      catalog: t.catalog != null,
      blockSamples: proben.length,
    },
  };
}

// Rein: alle Eingaben auf einmal (Tests, Messung). runCmIndexStep lädt dieselben Teile nacheinander.
export function buildCmIndex(
  input: { singles: Product[]; nonsingles: Product[]; cardsets: { set_code?: unknown; set_name?: unknown }[]; real: RealRow[]; catalog?: unknown },
  meta: { date: string; builtAt: string },
): CmIndex {
  const x = xAus(setsByPrefixAus(input.cardsets), buildExpansionIndex(input.nonsingles));
  return fertig(
    { s: sAus(input.singles), x, rows: input.real, catalog: input.catalog ?? null },
    { singles: input.singles.length, nonsingles: input.nonsingles.length, cardsets: input.cardsets.length },
    meta,
  );
}

export function plausibel(z: Grenzen, g: Grenzen = GRENZEN): string | null {
  for (const k of ["cardsets", "nonsingles", "singles", "prefixes"] as const) {
    if (!(z[k] >= g[k])) return `unplausibel: ${k} ${z[k]} < ${g[k]}`;
  }
  return null;
}

export function routeStep(body: Record<string, unknown>): "cm-index" | "unknown" | "main" {
  const step = body?.step;
  if (step === undefined || step === null || step === "") return "main";
  return step === "cm-index" ? "cm-index" : "unknown";
}

export type StepDeps = {
  fetch: typeof fetch;
  ua: string;
  cloudCards: () => Promise<RealRow[]>; // cm_product_id not null, deleted = false, language <> 'KR'
  katalogUrl: () => Promise<string | null>; // catalog_versions kind = 'catalog'
  upload: (gz: Uint8Array) => Promise<void>; // privater Bucket cm-index, cm-index.json.gz
  env: (k: string) => string | undefined;
  now: () => Date;
  grenzen?: Grenzen;
  log?: (...a: unknown[]) => void;
  logError?: (...a: unknown[]) => void;
};
export type StepResult = { status: number; body: unknown };

async function holeJson(d: StepDeps, url: string, was: string): Promise<unknown> {
  let res: Response;
  try {
    res = await d.fetch(url, { headers: { "User-Agent": d.ua } });
  } catch (e) {
    throw new Error(`${was}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`${was}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${was}: JSON ${(e as Error).message}`);
  }
}
async function holeProdukte(d: StepDeps, url: string, was: string): Promise<Product[]> {
  const j = await holeJson(d, url, was) as { products?: unknown } | null;
  if (!j || !Array.isArray(j.products)) throw new Error(`${was}: Schlüssel products fehlt`);
  return j.products as Product[];
}

export async function runCmIndexStep(d: StepDeps): Promise<StepResult> {
  const log = d.log ?? ((...a: unknown[]) => console.log(...a));
  const logError = d.logError ?? ((...a: unknown[]) => console.error(...a));
  const g = d.grenzen ?? GRENZEN;
  const fehler = (msg: string): StepResult => {
    logError("[cm-index] Fehler:", msg);
    return { status: 500, body: { step: "cm-index", cmIndex: { error: msg } } };
  };
  const pruefe = (z: Partial<Grenzen>) =>
    plausibel({ singles: Infinity, nonsingles: Infinity, cardsets: Infinity, prefixes: Infinity, ...z }, g);
  try {
    // Nacheinander laden, je Datei nur die kompakte Struktur behalten (Speicherlimit §5.1).
    let cardsets: unknown = await holeJson(d, CARDSETS_URL, "cardsets");
    if (!Array.isArray(cardsets)) throw new Error("cardsets: kein Array");
    const nCardsets = cardsets.length;
    const setsByPrefix = setsByPrefixAus(cardsets as { set_code?: unknown; set_name?: unknown }[]);
    cardsets = null;
    log("[cm-index]", "cardsets", { cardsets: nCardsets, prefixe: setsByPrefix.size });
    const f1 = pruefe({ cardsets: nCardsets });
    if (f1) return fehler(f1);

    let nonsingles: Product[] | null = await holeProdukte(d, NONSINGLES_URL, "nonsingles");
    const nNonsingles = nonsingles.length;
    const x = xAus(setsByPrefix, buildExpansionIndex(nonsingles));
    nonsingles = null;
    log("[cm-index]", "nonsingles", { nonsingles: nNonsingles, prefixes: Object.keys(x).length });
    const f2 = pruefe({ nonsingles: nNonsingles, prefixes: Object.keys(x).length });
    if (f2) return fehler(f2);

    let singles: Product[] | null = await holeProdukte(d, SINGLES_URL, "singles");
    const nSingles = singles.length;
    const s = sAus(singles);
    singles = null;
    log("[cm-index]", "singles", { singles: nSingles, names: Object.keys(s).length });
    const f3 = pruefe({ singles: nSingles });
    if (f3) return fehler(f3);

    let rows: RealRow[] = [];
    try {
      rows = await d.cloudCards();
    } catch (e) {
      logError("[cm-index] real übersprungen:", (e as Error).message);
    }
    log("[cm-index]", "real", { zeilen: rows.length });

    let catalog: unknown = null;
    if (d.env("CM_INDEX_KATALOG") === "1") {
      try {
        const url = await d.katalogUrl();
        if (!url) throw new Error("keine Katalog-URL");
        const res = await d.fetch(url, { headers: { "User-Agent": d.ua } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        catalog = JSON.parse(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text());
      } catch (e) {
        catalog = null;
        logError("[cm-index] katalog übersprungen:", (e as Error).message);
      }
    }
    log("[cm-index]", "katalog", { aktiv: catalog != null });

    const now = d.now();
    const ix = fertig({ s, x, rows, catalog }, { singles: nSingles, nonsingles: nNonsingles, cardsets: nCardsets }, {
      date: now.toISOString().slice(0, 10),
      builtAt: now.toISOString().slice(0, 19) + "Z",
    });
    rows = [];
    catalog = null;
    const gz = await gzipJson(ix);
    await d.upload(gz);
    log("[cm-index]", "upload", { bytes: gz.length, real: ix.stats.real, blocks: Object.keys(ix.blocks).length });
    return {
      status: 200,
      body: {
        step: "cm-index",
        cmIndex: {
          date: ix.date, names: ix.stats.names, prefixes: ix.stats.prefixes, singles: ix.stats.singles,
          real: ix.stats.real, catalog: ix.stats.catalog, bytes: gz.length,
        },
      },
    };
  } catch (e) {
    return fehler((e as Error).message);
  }
}
