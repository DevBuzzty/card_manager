// supabase/functions/ebay-sync/handler.ts
// Spec H3b §8 -- Aufruf durch pg_cron (Header x-ebay-secret = EBAY_CRON_SECRET) oder durch ein angemeldetes Gerät
// (Anstoß nach eBay-relevanter Änderung, „Jetzt abgleichen“, „Erneut versuchen“ mit { retry: listing_id }).
// Ohne gesetzten EBAY_CRON_SECRET ist der Zeitplan-Weg zu (nie offen).
import { json, safeEqual } from "../_shared/http.ts";
import type { SyncResult } from "./sync.ts";

export type SyncHandlerDeps = {
  cronSecret: string | undefined;
  verifyUser: (authorization: string | null) => Promise<boolean>;
  run: (retry: string | null) => Promise<SyncResult>;
};

export async function handleSync(req: Request, d: SyncHandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  const cron = !!d.cronSecret && safeEqual(req.headers.get("x-ebay-secret"), d.cronSecret);
  if (!cron && !(await d.verifyUser(req.headers.get("authorization")))) return json({ ok: false, error: "Nicht angemeldet." }, 401);
  const body = await req.json().catch(() => ({})) as { retry?: unknown };
  const retry = !cron && typeof body.retry === "string" && body.retry !== "" ? body.retry : null;
  return json(await d.run(retry));
}
