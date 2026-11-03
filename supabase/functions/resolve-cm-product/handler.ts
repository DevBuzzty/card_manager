// supabase/functions/resolve-cm-product/handler.ts -- Spec 2026-11-03 §5.2. Nur POST, nur angemeldete Geräte (Nutzer-JWT,
// verifyUser wie ebay-sold-prices), Validierung nach Vertragstabelle. Fehler immer { ok: false, code, error } mit deutschem Text.
import { json } from "../_shared/http.ts";
import { type Anfrage, type Antwort, KeinIndex } from "./resolve.ts";

export type HandlerDeps = {
  verifyUser: (authorization: string | null) => Promise<boolean>;
  resolve: (a: Anfrage) => Promise<Antwort>;
  logError?: (...a: unknown[]) => void;
};

const fehler = (status: number, code: string, error: string) => json({ ok: false, code, error }, status);

export function pruefeAnfrage(body: unknown): { anfrage: Anfrage } | { feld: string } {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return { feld: "body" };
  if (b.v !== 1) return { feld: "v" };
  if (typeof b.card_id !== "string" || !/^\d{1,10}$/.test(b.card_id)) return { feld: "card_id" };
  let name_en: string | null = null;
  if (b.name_en !== undefined && b.name_en !== null) {
    if (typeof b.name_en !== "string") return { feld: "name_en" };
    const t = b.name_en.trim();
    if (t.length > 200) return { feld: "name_en" };
    name_en = t || null;
  }
  if (!Array.isArray(b.printings) || b.printings.length < 1 || b.printings.length > 10) return { feld: "printings" };
  const printings: Anfrage["printings"] = [];
  for (let i = 0; i < b.printings.length; i++) {
    const p = b.printings[i] as Record<string, unknown> | null;
    if (!p || typeof p !== "object" || Array.isArray(p)) return { feld: `printings[${i}]` };
    const sc = typeof p.set_code === "string" ? p.set_code.trim() : null;
    if (!sc || sc.length > 20 || sc.toLowerCase() === "unknown") return { feld: `printings[${i}].set_code` };
    if (typeof p.rarity !== "string" || p.rarity.length > 60) return { feld: `printings[${i}].rarity` };
    printings.push({ set_code: sc, rarity: p.rarity });
  }
  return { anfrage: { card_id: b.card_id, name_en, printings } };
}

export async function handleResolve(req: Request, d: HandlerDeps): Promise<Response> {
  const logError = d.logError ?? ((...a: unknown[]) => console.error(...a));
  if (req.method !== "POST") return fehler(405, "method", "Nur POST.");
  if (!(await d.verifyUser(req.headers.get("authorization")))) return fehler(401, "auth", "Nicht angemeldet.");
  const raw = await req.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch { /* kein JSON -> 400 (Vertrag §5.2: Body kein JSON-Objekt) */ }
  const g = pruefeAnfrage(body);
  if ("feld" in g) return fehler(400, "bad_request", `Anfrage ungültig: ${g.feld}`);
  try {
    return json(await d.resolve(g.anfrage));
  } catch (e) {
    if (e instanceof KeinIndex) return fehler(503, "no_index", "Cardmarket-Index fehlt.");
    logError("[resolve-cm-product]", (e as Error)?.stack ?? String(e));
    return fehler(500, "internal", "Interner Fehler.");
  }
}
