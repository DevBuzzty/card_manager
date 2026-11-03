// supabase/functions/_shared/cm-parse.ts -- Spec 2026-11-03 §5.3. Deno-Port von desktop/electron/cardmarket-bulk-parse.cjs
// (Druck -> Cardmarket-idProduct aus den freien Produktdateien). Kern auf Ebene der Expansions-IDs (resolveForExp, deriveForExp,
// cmForExp); die Desktop-Signaturen (setNames + expansionIndex) sind dünne Wrapper darüber. reason-Werte wie im Desktop.
// Twin-Prüfung: docs/fixtures/cm-resolve/parse.json (cm-parse_test.ts hier, cm-resolve-fixture.test.cjs am Desktop).
// Keine I/O. Logik nur zusammen mit dem Desktop-Original und der Fixture ändern.
import { CM_SET_ALIASES } from "./cm-set-aliases.ts";

export type Version = { idProduct: number; idExpansion: number };
export interface KernIndex {
  kandidaten(name: string): Version[]; // alle Singles mit normName == name
  versionen(name: string, exp: number): number[] | undefined; // aufsteigend, wie versionIndex.byKey
}
export type Learned = (groupKey: string) => Map<number, number> | undefined;
export type Product = { idProduct?: unknown; name?: unknown; idExpansion?: unknown };
export type ExpansionIndex = Map<string, Set<number>>;
export type SinglesIndex = Map<string, Version[]>;
export type VersionIndex = { byKey: Map<string, number[]>; pos: Map<number, { exp: number; n: number; rank: number }> };

// Wie desktop/electron/cardmarket-parse.cjs normName.
export function normName(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SUFFIX_RE =
  /\s+(Booster Box|Booster|Box Set|Card Pack|Special Edition|Tin|Pack|Set|Display|Bundle|Deck|Mini Box\b.*|Case\b.*|\(\d{4} Reprint\))$/i;

export function expansionNameVariants(name: unknown): string[] {
  const out: string[] = [];
  let s = String(name ?? "").trim();
  for (let i = 0; i < 4 && s; i++) {
    const clean = s.replace(/[:\-–\s]+$/, "").trim();
    if (clean && !out.includes(clean)) out.push(clean);
    const t = s.replace(SUFFIX_RE, "").trim();
    if (t === s) break;
    s = t;
  }
  return out;
}

export function decodeEntities(s: unknown): string {
  return String(s ?? "").replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

export function tokenKey(s: unknown): string {
  const toks = decodeEntities(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort();
  return toks.length > 1 ? toks.join("|") : "";
}

export function buildExpansionIndex(nonsingles: Product[] | null | undefined): ExpansionIndex {
  const idx: ExpansionIndex = new Map();
  const add = (key: string, id: number) => {
    if (!key) return;
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key)!.add(id);
  };
  for (const p of nonsingles ?? []) {
    if (p.idExpansion == null) continue;
    const id = Number(p.idExpansion);
    for (const v of expansionNameVariants(p.name)) {
      add(normName(v), id);
      add(tokenKey(v), id);
    }
  }
  return idx;
}

export function buildSinglesIndex(singles: Product[] | null | undefined): SinglesIndex {
  const idx: SinglesIndex = new Map();
  for (const p of singles ?? []) {
    const key = normName(p.name);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key)!.push({ idProduct: Number(p.idProduct), idExpansion: Number(p.idExpansion) });
  }
  return idx;
}

// Set-Namen-Aliase (Spec 2026-11-03, Nachtrag Set-Aliase), wie Desktop buildSetAliases: normName(decodeEntities(setName))
// -> [idExpansion]. Daten: cm-set-aliases.ts (Spiegel von docs/fixtures/cm-resolve/set-aliases.json, Gleichheit per Test).
export type SetAliases = Map<string, number[]>;
export function buildSetAliases(list: readonly { setName: string; idExpansion: readonly number[] }[] | null | undefined): SetAliases {
  const m: SetAliases = new Map();
  for (const a of list ?? []) {
    const key = normName(decodeEntities(a.setName));
    if (!key) continue;
    m.set(key, [...new Set([...(m.get(key) ?? []), ...(a.idExpansion ?? []).map(Number)])]);
  }
  return m;
}
export const SET_ALIASES: SetAliases = buildSetAliases(CM_SET_ALIASES);

// Ein Alias greift nur für einen set_name, den der Namensabgleich nicht findet (Namens-Treffer haben Vorrang).
export function expansionIdsFor(
  setNames: string[] | null | undefined,
  expansionIndex: ExpansionIndex,
  aliases: SetAliases = SET_ALIASES,
): Set<number> {
  const expIds = new Set<number>();
  for (const sn of setNames ?? []) {
    const clean = decodeEntities(sn);
    const ids = expansionIndex.get(normName(clean)) || expansionIndex.get(tokenKey(clean)) || aliases.get(normName(clean));
    if (ids) for (const id of ids) expIds.add(id);
  }
  return expIds;
}

export function buildVersionIndex(singles: Product[] | null | undefined): VersionIndex {
  const byKey = new Map<string, number[]>();
  for (const p of singles ?? []) {
    const name = normName(p.name);
    if (!name || p.idExpansion == null) continue;
    const key = name + "|" + Number(p.idExpansion);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(Number(p.idProduct));
  }
  const pos: VersionIndex["pos"] = new Map();
  for (const [key, ids] of byKey) {
    ids.sort((a, b) => a - b);
    const exp = Number(key.slice(key.lastIndexOf("|") + 1));
    ids.forEach((id, rank) => pos.set(id, { exp, n: ids.length, rank }));
  }
  return { byKey, pos };
}

export function learnRanks(known: { rarity: string; idProduct: number }[] | null | undefined, versionIndex: Pick<VersionIndex, "pos">) {
  const learned = new Map<string, Map<number, number>>();
  for (const k of known ?? []) {
    const p = versionIndex.pos.get(Number(k.idProduct));
    if (!p || p.n < 2) continue;
    const key = `${p.exp}|${p.n}|${k.rarity}`;
    if (!learned.has(key)) learned.set(key, new Map());
    const m = learned.get(key)!;
    m.set(p.rank, (m.get(p.rank) || 0) + 1);
  }
  return learned;
}

export function versionsAreRarities(printingRarities: string[] | null | undefined, n: number): boolean {
  const rar = printingRarities || [];
  return rar.length === n && new Set(rar).size === n;
}

// --- Kern (Expansions-IDs) ---

export function resolveForExp(cardName: string, expIds: Set<number>, ix: KernIndex): { idProduct: number | null; reason: string } {
  if (expIds.size === 0) return { idProduct: null, reason: "no-expansion" };
  const cands = ix.kandidaten(normName(cardName)).filter((p) => expIds.has(p.idExpansion));
  if (cands.length === 0) return { idProduct: null, reason: "no-candidate" };
  if (cands.length > 1) return { idProduct: null, reason: "ambiguous" };
  return { idProduct: cands[0].idProduct, reason: "resolved" };
}

export function deriveForExp(
  p: { cardName: string; expIds: Set<number>; rarity: string; printingRarities?: string[] },
  ix: KernIndex,
  learned: Learned,
  minSamples = 2,
): { idProduct: number | null; groupKey: string | null; reason: string } {
  const name = normName(p.cardName);
  const hits: { e: number; ids: number[] }[] = [];
  for (const e of p.expIds) {
    const ids = ix.versionen(name, e);
    if (ids) hits.push({ e, ids });
  }
  if (hits.length !== 1 || hits[0].ids.length < 2) return { idProduct: null, groupKey: null, reason: "no-group" };
  const { e, ids } = hits[0];
  const groupKey = `${e}|${ids.length}|${p.rarity}`;
  const m = learned(groupKey);
  if (!m) return { idProduct: null, groupKey, reason: "no-model" };
  if (m.size !== 1) return { idProduct: null, groupKey, reason: "conflict" };
  const [[rank, count]] = m;
  if (count < minSamples) return { idProduct: null, groupKey, reason: "too-few" };
  if (p.printingRarities === undefined) return { idProduct: null, groupKey, reason: "needs-printings" };
  return versionsAreRarities(p.printingRarities, ids.length)
    ? { idProduct: ids[rank], groupKey, reason: "derived" }
    : { idProduct: null, groupKey: null, reason: "not-by-rarity" };
}

// Alle Versionen der Karte in den Expansionen von expIds, aufsteigend (Spanne auf dem Handy).
export function alleVersionen(cardName: string, expIds: Set<number>, ix: KernIndex): number[] {
  const name = normName(cardName);
  const ids: number[] = [];
  for (const e of expIds) for (const id of ix.versionen(name, e) ?? []) ids.push(id);
  return ids.sort((a, b) => a - b);
}

export function cmForExp(
  p: { cardName: string; expIds: Set<number>; rarity: string; printingRarities?: string[] | null; realId?: number | null },
  ix: KernIndex,
  learned: Learned,
): number | number[] | null {
  if (p.realId) return Number(p.realId);
  const r = resolveForExp(p.cardName, p.expIds, ix);
  if (r.idProduct) return r.idProduct;
  if (r.reason !== "ambiguous") return null;
  const d = deriveForExp({ cardName: p.cardName, expIds: p.expIds, rarity: p.rarity, printingRarities: p.printingRarities || [] }, ix, learned);
  if (d.idProduct) return d.idProduct;
  const ids = alleVersionen(p.cardName, p.expIds, ix);
  return ids.length ? ids : null;
}

// --- Kern-Quellen ---

export function kernAusDesktop(ix: { singlesIndex?: SinglesIndex; versionIndex?: Pick<VersionIndex, "byKey"> }): KernIndex {
  return {
    kandidaten: (name) => ix.singlesIndex?.get(name) ?? [],
    versionen: (name, exp) => ix.versionIndex?.byKey.get(name + "|" + exp),
  };
}

// Index-Format §5.1: s[normName] = flaches Array [idProduct, idExpansion, …]. Baut nur die Gruppen dieses Namens.
export function kernAusS(s: Record<string, number[]>, name: string): KernIndex {
  const flach = Object.hasOwn(s, name) ? s[name] : [];
  const liste: Version[] = [];
  const gruppen = new Map<number, number[]>();
  for (let i = 0; i + 1 < flach.length; i += 2) {
    const v = { idProduct: flach[i], idExpansion: flach[i + 1] };
    liste.push(v);
    if (!gruppen.has(v.idExpansion)) gruppen.set(v.idExpansion, []);
    gruppen.get(v.idExpansion)!.push(v.idProduct);
  }
  for (const ids of gruppen.values()) ids.sort((a, b) => a - b);
  return {
    kandidaten: (n) => (n === name ? liste : []),
    versionen: (n, exp) => (n === name ? gruppen.get(exp) : undefined),
  };
}

// --- Desktop-Signaturen ---

type DesktopIx = { expansionIndex: ExpansionIndex; singlesIndex?: SinglesIndex; versionIndex?: VersionIndex; learned?: Map<string, Map<number, number>> };
const learnedAus = (ix: DesktopIx): Learned => (k) => ix.learned?.get(k);

export function resolveProduct(p: { cardName: string; setNames: string[] }, ix: DesktopIx) {
  return resolveForExp(p.cardName, expansionIdsFor(p.setNames, ix.expansionIndex), kernAusDesktop(ix));
}

export function deriveProduct(
  p: { cardName: string; setNames: string[]; rarity: string; printingRarities?: string[] },
  ix: DesktopIx,
  minSamples = 2,
) {
  return deriveForExp(
    { cardName: p.cardName, expIds: expansionIdsFor(p.setNames, ix.expansionIndex), rarity: p.rarity, printingRarities: p.printingRarities },
    kernAusDesktop(ix),
    learnedAus(ix),
    minSamples,
  );
}

export function cmForPrinting(
  p: { cardName: string; setNames: string[]; rarity: string; printingRarities?: string[] | null; realId?: number | null },
  ix: DesktopIx,
) {
  return cmForExp(
    { cardName: p.cardName, expIds: expansionIdsFor(p.setNames, ix.expansionIndex), rarity: p.rarity, printingRarities: p.printingRarities, realId: p.realId },
    kernAusDesktop(ix),
    learnedAus(ix),
  );
}
