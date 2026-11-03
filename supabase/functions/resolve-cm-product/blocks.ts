// supabase/functions/resolve-cm-product/blocks.ts -- Spec 2026-11-03 §5.5 Regel 2 (rein). Cardmarket legt die Versionen eines Sets
// seltenheitsweise in Blöcken an; index.blocks[exp][rarityKey] = unterer Median der bekannten idProducts dieser Seltenheit.
// Ordnet die n Seltenheiten des Drucks nach Median und nimmt die Version an derselben Stelle. Jede Unklarheit -> null.
// Schalter BLOCKS_AKTIV in resolve.ts (Freigabe nur nach Gegenprobe, Ledger blocks-gegenprobe.md).
export type BlockErgebnis = { idProduct: number | null; reason: string };

export function blockRegel(p: {
  gruppen: Map<number, number[]>; // je Expansion aus exp die IDs der Karte (nur Expansionen mit Versionen)
  printingRarities: string[]; // RarityNorm.key bzw. "?roh"
  rk: string;
  blocks: Record<string, Record<string, number>>;
}): BlockErgebnis {
  const mit = [...p.gruppen].filter(([, ids]) => ids.length > 0);
  // Genau eine Expansion mit Versionen (wie deriveForExp "no-group"), dort n >= 2.
  if (mit.length !== 1 || mit[0][1].length < 2) return { idProduct: null, reason: "no-group" };
  const [e, roh] = mit[0];
  const ids = [...roh].sort((a, b) => a - b);
  const pr = p.printingRarities;
  if (pr.length !== ids.length) return { idProduct: null, reason: "count-mismatch" };
  if (new Set(pr).size !== ids.length) return { idProduct: null, reason: "duplicate-rarity" };
  if (!pr.includes(p.rk)) return { idProduct: null, reason: "rarity-not-listed" };
  const med = Object.hasOwn(p.blocks, String(e)) ? p.blocks[String(e)] : undefined;
  if (!med || pr.some((r) => typeof med[r] !== "number")) return { idProduct: null, reason: "no-median" };
  if (new Set(pr.map((r) => med[r])).size !== pr.length) return { idProduct: null, reason: "equal-medians" };
  const ordnung = [...pr].sort((a, b) => med[a] - med[b]);
  return { idProduct: ids[ordnung.indexOf(p.rk)], reason: "blocks" };
}
