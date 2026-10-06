// supabase/functions/ebay-sold-prices/handler.ts
// eBay „zuletzt verkauft" §6 -- pg_cron (x-ebay-secret = EBAY_CRON_SECRET) startet den Zeitplan-Lauf; angemeldete Geräte
// nur den Einzelabruf eines Drucks. Ohne gesetzten EBAY_CRON_SECRET ist der Zeitplan-Weg zu (nie offen).
import { json, jsonBody, safeEqual } from "../_shared/http.ts";
import type { Printing } from "./match.ts";
import type { RunOpts, RunResult } from "./run.ts";

export type SoldHandlerDeps = {
  cronSecret: string | undefined;
  verifyUser: (authorization: string | null) => Promise<boolean>;
  run: (o: RunOpts) => Promise<RunResult>;
};
const intIn = (v: unknown, def: number, lo: number, hi: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, n)) : def;
};
const str = (v: unknown) => typeof v === "string" && v.trim() !== "";
function printingOf(v: unknown): Printing | null {
  const p = v as Record<string, unknown> | null;
  if (!p || !str(p.card_id) || !str(p.set_code) || !str(p.language) || !str(p.rarity)) return null;
  return { card_id: String(p.card_id), set_code: String(p.set_code), language: String(p.language), rarity: String(p.rarity) };
}

export async function handleSold(req: Request, d: SoldHandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  const cron = !!d.cronSecret && safeEqual(req.headers.get("x-ebay-secret"), d.cronSecret);
  if (!cron && !(await d.verifyUser(req.headers.get("authorization")))) return json({ ok: false, error: "Nicht angemeldet." }, 401);
  const body = await jsonBody(req) as Record<string, unknown>;
  if (cron) return json(await d.run({ mode: "cron", minPrice: intIn(body.minPrice, 5, 0, 100000), budget: intIn(body.budget, 50, 1, 500) }));
  const printing = printingOf(body.printing);
  if (!printing) return json({ ok: false, error: "Druck fehlt." }, 400);
  return json(await d.run({ mode: "single", printing }));
}
