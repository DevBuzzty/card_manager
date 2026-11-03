// supabase/functions/resolve-cm-product/index-file.ts -- Spec 2026-11-03 §5.3 "Laden". Index (privater Bucket cm-index) und
// Preisdatei (Bucket catalog) per Storage-API mit Service-Rolle, gzip-JSON, Modulspeicher mit 1 h TTL je Instanz.
// Fehlt eine Datei oder ist sie unlesbar, wird nichts gemerkt (die nächste Anfrage versucht es erneut).
// Format des Index: refresh-cardmarket-prices/cm_index.ts (CmIndex).
export type CmIndexDatei = {
  v: 1;
  date: string;
  built_at: string;
  s: Record<string, number[]>;
  x: Record<string, number[]>;
  real: Record<string, number>;
  learned: Record<string, Record<string, number>>;
  blocks: Record<string, Record<string, number>>;
  stats: Record<string, unknown>;
};
export type PriceFile = { v: 1; date: string; p: Record<string, [number | null, number | null]> };

export async function entpackeJson(bytes: Uint8Array): Promise<unknown> {
  const st = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(st).text());
}
const istObjekt = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function alsIndex(j: unknown): CmIndexDatei | null {
  if (!istObjekt(j) || j.v !== 1 || typeof j.date !== "string" || !istObjekt(j.s) || !istObjekt(j.x)) return null;
  return {
    built_at: "",
    ...j,
    real: istObjekt(j.real) ? j.real : {},
    learned: istObjekt(j.learned) ? j.learned : {},
    blocks: istObjekt(j.blocks) ? j.blocks : {},
    stats: istObjekt(j.stats) ? j.stats : {},
  } as CmIndexDatei;
}
function alsPreise(j: unknown): PriceFile | null {
  return istObjekt(j) && j.v === 1 && typeof j.date === "string" && istObjekt(j.p) ? j as unknown as PriceFile : null;
}

export function dateiLader(p: {
  download: (bucket: string, path: string) => Promise<Uint8Array | null>;
  now: () => number;
  ttlMs?: number;
  logError?: (...a: unknown[]) => void;
}) {
  const ttl = p.ttlMs ?? 3600_000;
  const logError = p.logError ?? ((...a: unknown[]) => console.error(...a));
  function geladen<T>(bucket: string, path: string, pruefe: (j: unknown) => T | null) {
    let merk: { at: number; wert: Promise<T | null> } | null = null;
    return (): Promise<T | null> => {
      if (merk && p.now() - merk.at < ttl) return merk.wert;
      const at = p.now();
      const wert = (async () => {
        try {
          const bytes = await p.download(bucket, path);
          if (!bytes) return null;
          const v = pruefe(await entpackeJson(bytes));
          if (!v) logError(`[resolve-cm-product] ${bucket}/${path} unlesbar oder falsche Version`);
          return v;
        } catch (e) {
          logError(`[resolve-cm-product] ${bucket}/${path}:`, (e as Error).message);
          return null;
        }
      })();
      merk = { at, wert };
      // Fehlschlag nicht merken; gleichzeitige Anfragen teilen sich trotzdem denselben Ladevorgang.
      wert.then((v) => {
        if (v === null && merk?.wert === wert) merk = null;
      });
      return wert;
    };
  }
  return {
    index: geladen("cm-index", "cm-index.json.gz", alsIndex),
    preise: geladen("catalog", "cm-prices.json.gz", alsPreise),
  };
}
