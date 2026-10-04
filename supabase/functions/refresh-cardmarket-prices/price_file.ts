// Spec 2026-10-04 §3.1 — kompakte Tages-Preisdatei fuer das Handy (Storage catalog/cm-prices.json.gz).
// Cardmarket meldet "kein Trend" als trend: 0 (wie im Desktop, cardmarket-bulk.cjs) -> null.
export type PriceFile = { v: 1; date: string; p: Record<string, [number | null, number | null]> };

const pos = (x: unknown): number | null => (typeof x === "number" && x > 0 ? x : null);

export function buildPriceFile(guide: unknown, date: string): PriceFile {
  const arr = (guide as { priceGuides?: unknown } | null)?.priceGuides;
  const p: PriceFile["p"] = {};
  if (Array.isArray(arr)) {
    for (const g of arr as Array<Record<string, unknown>>) {
      const id = Number(g?.idProduct);
      if (!Number.isInteger(id) || id <= 0) continue;
      const trend = pos(g.trend), low = pos(g.low);
      if (trend === null && low === null) continue;
      p[String(id)] = [trend, low];
    }
  }
  return { v: 1, date, p };
}

export async function gzipJson(obj: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
