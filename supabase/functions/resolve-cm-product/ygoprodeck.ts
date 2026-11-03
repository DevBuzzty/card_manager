// supabase/functions/resolve-cm-product/ygoprodeck.ts -- Spec 2026-11-03 §5.3. Name und Drucke einer Karte von YGOPRODeck.
// HTTP 200 -> Daten; HTTP 400 (Karte unbekannt) -> { name: null, sets: [] }; Timeout/Netz/5xx -> null (Fremdfehler).
// Modulspeicher nur für Nicht-null-Ergebnisse (höchstens 500 Karten, 24 h).
export type YgoKarte = { name: string | null; sets: { set_code: string; set_rarity: string | null }[] };
export const YGO_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0";

export async function ygoAbruf(fetchFn: typeof fetch, cardId: string, timeoutMs = 2500): Promise<YgoKarte | null> {
  try {
    const res = await fetchFn(`${YGO_URL}?id=${encodeURIComponent(cardId)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 400) {
      await res.body?.cancel();
      return { name: null, sets: [] };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const d = ((await res.json()) as { data?: Record<string, unknown>[] } | null)?.data?.[0];
    if (!d) return { name: null, sets: [] };
    const sets = Array.isArray(d.card_sets)
      ? (d.card_sets as Record<string, unknown>[])
        .filter((s) => typeof s?.set_code === "string")
        .map((s) => ({ set_code: String(s.set_code), set_rarity: typeof s.set_rarity === "string" ? s.set_rarity : null }))
      : [];
    return { name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : null, sets };
  } catch {
    return null;
  }
}

export function ygoClient(p: { fetch: typeof fetch; now: () => number; ttlMs?: number; max?: number; timeoutMs?: number }) {
  const ttl = p.ttlMs ?? 24 * 3600_000;
  const max = p.max ?? 500;
  const speicher = new Map<string, { at: number; wert: YgoKarte }>();
  return async (cardId: string): Promise<YgoKarte | null> => {
    const hit = speicher.get(cardId);
    if (hit && p.now() - hit.at < ttl) return hit.wert;
    const wert = await ygoAbruf(p.fetch, cardId, p.timeoutMs);
    if (wert !== null) {
      speicher.delete(cardId);
      speicher.set(cardId, { at: p.now(), wert });
      while (speicher.size > max) speicher.delete(speicher.keys().next().value!);
    }
    return wert;
  };
}
