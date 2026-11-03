// supabase/functions/resolve-cm-product/resolve.ts -- Spec 2026-11-03 §5.3 (Ablauf A-F) und §5.4 (Cache).
// Je angefragtem Druck: KR -> Cache -> Name -> Expansionen -> echte ID -> eindeutig -> abgeleitet -> (Block-Regel) -> Spanne.
// Live-Zuordnungen werden nur angezeigt, nie in cards.cm_product_id geschrieben (§5.5).
import { alleVersionen, deriveForExp, type KernIndex, kernAusS, normName, resolveForExp } from "../_shared/cm-parse.ts";
import { RarityNorm } from "../_shared/rarity-norm.ts";
import { CodeKey } from "../_shared/code-key.ts";
import { blockRegel } from "./blocks.ts";
import { type CacheRow, type CacheStore, tabelleFehlt } from "./cache-store.ts";
import type { CmIndexDatei, PriceFile } from "./index-file.ts";
import type { YgoKarte } from "./ygoprodeck.ts";

// Freigabe-Schranke der Block-Regel (§5.5): erst nach Gegenprobe >= 97 % richtig auf true.
// Ledger docs/superpowers/ledgers/2026-11-03-einzelscan-preis/blocks-gegenprobe.md.
export const BLOCKS_AKTIV = false;

const GUELTIG_RESOLVED_MS = 30 * 24 * 3600_000;
const KR_RE = /-KR?[A-Z]?\d/i; // wie desktop/electron/language-kr.cjs

export type Anfrage = { card_id: string; name_en: string | null; printings: { set_code: string; rarity: string }[] };
export type Ergebnis = {
  set_code: string;
  rarity: string;
  code_key: string;
  rarity_key: string;
  status: CacheRow["status"];
  how: CacheRow["how"];
  reason: string | null;
  cm: number[];
  cached: boolean;
};
export type Antwort = {
  ok: true;
  v: 1;
  index_date: string;
  price_date: string | null;
  card: { name_en: string | null; ab: number | null; ab_products: number };
  results: Ergebnis[];
  prices: Record<string, [number | null, number | null]>;
};
export class KeinIndex extends Error {
  constructor() {
    super("Cardmarket-Index fehlt.");
  }
}
export type ResolveDeps = {
  index: () => Promise<CmIndexDatei | null>;
  preise: () => Promise<PriceFile | null>;
  ygo: (cardId: string) => Promise<YgoKarte | null>;
  cache: CacheStore;
  now: () => Date;
  zustand: { tabelleFehltGemeldet: boolean }; // je Instanz (Modulspeicher in index.ts)
  log?: (...a: unknown[]) => void;
  logError?: (...a: unknown[]) => void;
  blocksAktiv?: boolean; // nur Tests; sonst BLOCKS_AKTIV
};

export const prefixOf = (setCode: string) => setCode.trim().split("-")[0].toUpperCase();
export const codeKeyOf = (setCode: string) => CodeKey.of(setCode) ?? setCode.trim().toUpperCase();

type Teil = { status: CacheRow["status"]; how: CacheRow["how"]; reason: string | null; cm: number[]; fremd: boolean; cachebar: boolean };
const nichtGefunden = (reason: string, cachebar = true): Teil => ({ status: "not_found", how: null, reason, cm: [], fremd: false, cachebar });
const aufgeloest = (how: NonNullable<CacheRow["how"]>, id: number): Teil => ({ status: "resolved", how, reason: null, cm: [id], fremd: false, cachebar: true });

export async function resolveAnfrage(a: Anfrage, d: ResolveDeps): Promise<Antwort> {
  const log = d.log ?? ((...x: unknown[]) => console.log(...x));
  const logError = d.logError ?? ((...x: unknown[]) => console.error(...x));
  const blocksAktiv = d.blocksAktiv ?? BLOCKS_AKTIV;
  const cacheFehler = (e: unknown) => {
    if (tabelleFehlt(e)) {
      if (!d.zustand.tabelleFehltGemeldet) log("[resolve-cm-product] cm_resolve_cache fehlt -- ohne Cache weiter:", (e as Error).message);
      d.zustand.tabelleFehltGemeldet = true;
    } else logError("[resolve-cm-product] Cache:", (e as Error).message);
  };

  // A. Index (Pflicht), Preisdatei (optional).
  const geladen = await d.index();
  if (!geladen) throw new KeinIndex();
  const ix: CmIndexDatei = geladen;
  const preise = await d.preise();
  const jetzt = d.now();

  // YGOPRODeck höchstens einmal je Anfrage und nur bei Bedarf.
  let ygoP: Promise<YgoKarte | null> | undefined;
  const ygo = () => (ygoP ??= d.ygo(a.card_id));
  let nameP: Promise<string | null> | undefined;
  const name = () => (nameP ??= a.name_en ? Promise.resolve(a.name_en) : ygo().then((k) => k?.name ?? null));
  const prMerk = new Map<string, Promise<string[] | null>>();
  const printingRarities = (prefix: string) => {
    if (!prMerk.has(prefix)) {
      prMerk.set(prefix, ygo().then((k) => k === null ? null : k.sets
        .filter((s) => prefixOf(s.set_code) === prefix)
        .map((s) => RarityNorm.key(s.set_rarity) ?? "?" + (s.set_rarity ?? "").trim().toLowerCase())));
    }
    return prMerk.get(prefix)!;
  };
  const learned = (k: string) => {
    const o = Object.hasOwn(ix.learned, k) ? ix.learned[k] : undefined;
    return o ? new Map(Object.entries(o).map(([rank, n]) => [Number(rank), n])) : undefined;
  };
  let kern: { name: string; kern: KernIndex } | undefined;
  const kernFuer = (n: string) => (kern?.name === n ? kern.kern : (kern = { name: n, kern: kernAusS(ix.s, n) }).kern);

  const eintraege = a.printings.map((p) => ({
    p,
    kr: KR_RE.test(p.set_code),
    code_key: codeKeyOf(p.set_code),
    rarity_key: RarityNorm.key(p.rarity) ?? "",
  }));

  // B. Cache: EINE Abfrage für alle Nicht-KR-Einträge.
  const keys = [...new Set(eintraege.filter((e) => !e.kr).map((e) => e.code_key))];
  const cacheZeilen = new Map<string, CacheRow>();
  if (keys.length) {
    try {
      for (const z of await d.cache.lesen(a.card_id, keys)) cacheZeilen.set(`${z.code_key}|${z.rarity_key}`, z);
    } catch (e) {
      cacheFehler(e);
    }
  }
  // Gültig (§5.4) und mit demselben Namen berechnet (Review-Nachtrag 2: name_en kommt vom Client, der Schlüssel enthält ihn nicht).
  const gueltig = (z: CacheRow, nn: string) =>
    !!z.name_norm && z.name_norm === nn &&
    ((z.status === "resolved" && jetzt.getTime() - Date.parse(z.checked_at) < GUELTIG_RESOLVED_MS) || z.index_date === ix.date);

  // C. je Eintrag.
  async function einer(e: typeof eintraege[number]): Promise<Teil> {
    if (e.kr) return nichtGefunden("kr", false); // 0
    const n = await name(); // 2
    if (!n) return nichtGefunden("no-name", false);
    const prefix = prefixOf(e.p.set_code); // 3
    const exp = new Set<number>(Object.hasOwn(ix.x, prefix) ? ix.x[prefix] : []);
    if (exp.size === 0) return nichtGefunden("no-expansion");
    const rk = RarityNorm.key(e.p.rarity); // 4
    const nn = normName(n);
    const k = kernFuer(nn);
    // 5 (Review-Nachtrag 2): real ist druckgenau je CodeKey (mit Nummer), nie je Präfix. Nur, wenn die ID eine Version der
    // Karte in den Expansionen des Präfixes ist und die Karte dort in genau EINER Expansion steht (sonst Reprint/Neuauflage
    // hinter demselben Präfix, z. B. LOB und LOB 25th).
    const realKey = `${e.code_key}|${nn}|${rk}`;
    if (rk !== null && Object.hasOwn(ix.real, realKey)) {
      const id = ix.real[realKey];
      const mitKarte = [...exp].filter((x) => (k.versionen(nn, x) ?? []).length > 0);
      if (mitKarte.length === 1 && (k.versionen(nn, mitKarte[0]) ?? []).includes(id)) return aufgeloest("real", id);
    }
    const r = resolveForExp(n, exp, k); // 6
    if (r.reason === "no-candidate") return nichtGefunden("no-candidate");
    if (r.idProduct !== null) return aufgeloest("unique", r.idProduct);
    const alle = alleVersionen(n, exp, k); // für Schritt 7/10
    const mehrdeutig = (reason: string, fremd = false): Teil => ({ status: "ambiguous", how: null, reason, cm: alle, fremd, cachebar: !fremd });
    if (rk === null) return mehrdeutig("rarity-unknown"); // 7
    let dd = deriveForExp({ cardName: n, expIds: exp, rarity: rk }, k, learned); // 8
    let pr: string[] | null | undefined;
    if (dd.reason === "needs-printings") {
      pr = await printingRarities(prefix);
      if (pr === null) return mehrdeutig("no-printings", true);
      dd = deriveForExp({ cardName: n, expIds: exp, rarity: rk, printingRarities: pr }, k, learned);
    }
    if (dd.reason === "derived" && dd.idProduct !== null) return aufgeloest("derived", dd.idProduct);
    if (blocksAktiv) { // 9
      if (pr === undefined) pr = await printingRarities(prefix);
      if (pr === null) return mehrdeutig(dd.reason, true);
      const gruppen = new Map<number, number[]>();
      for (const x of exp) {
        const ids = k.versionen(nn, x);
        if (ids) gruppen.set(x, ids);
      }
      const b = blockRegel({ gruppen, printingRarities: pr, rk, blocks: ix.blocks });
      if (b.idProduct !== null) return aufgeloest("blocks", b.idProduct);
    }
    return mehrdeutig(dd.reason); // 10
  }

  const results: Ergebnis[] = [];
  const zuSchreiben = new Map<string, CacheRow>();
  for (const e of eintraege) {
    const basis = { set_code: e.p.set_code, rarity: e.p.rarity, code_key: e.code_key, rarity_key: e.rarity_key };
    const z = e.kr ? undefined : cacheZeilen.get(`${e.code_key}|${e.rarity_key}`);
    const nz = z ? await name() : null; // Name nur holen, wenn eine Zeile zu prüfen ist (ohne name_en: YGOPRODeck)
    if (z && nz && gueltig(z, normName(nz))) { // 1
      results.push({ ...basis, status: z.status, how: z.how, reason: z.reason, cm: [...z.cm], cached: true });
      continue;
    }
    const t = await einer(e);
    results.push({ ...basis, status: t.status, how: t.how, reason: t.reason, cm: t.cm, cached: false });
    const nGenutzt = t.cachebar ? await name() : null; // cachebar setzt einen Namen voraus (no-name ist nie cachebar)
    if (t.cachebar && nGenutzt) {
      zuSchreiben.set(`${e.code_key}|${e.rarity_key}`, {
        card_id: a.card_id, code_key: e.code_key, rarity_key: e.rarity_key, status: t.status, how: t.how, reason: t.reason, cm: t.cm,
        index_date: ix.date, checked_at: jetzt.toISOString(), name_norm: normName(nGenutzt),
      });
    }
  }

  // D. Richtwert über alle Singles dieses Namens (jede Expansion).
  const n = await name();
  let ab: number | null = null, abProducts = 0;
  if (n) {
    const kandidaten = kernFuer(normName(n)).kandidaten(normName(n));
    abProducts = kandidaten.length;
    if (preise) {
      for (const c of kandidaten) {
        const t = preise.p[String(c.idProduct)]?.[0];
        if (typeof t === "number" && t > 0 && (ab === null || t < ab)) ab = t;
      }
    }
  }

  // E. Preise nur für gelieferte IDs.
  const prices: Antwort["prices"] = {};
  if (preise) {
    for (const r of results) {
      for (const id of r.cm) {
        const p = Object.hasOwn(preise.p, String(id)) ? preise.p[String(id)] : undefined;
        if (p) prices[String(id)] = p;
      }
    }
  }

  // F. EIN Upsert, nach Primärschlüssel entdoppelt (letzter gewinnt).
  if (zuSchreiben.size) {
    try {
      await d.cache.schreiben([...zuSchreiben.values()]);
    } catch (e) {
      cacheFehler(e);
    }
  }

  return {
    ok: true,
    v: 1,
    index_date: ix.date,
    price_date: preise?.date ?? null,
    card: { name_en: n, ab, ab_products: abProducts },
    results,
    prices,
  };
}
