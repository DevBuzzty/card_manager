// supabase/functions/_shared/http.ts -- Antworten und Prüfungen, die ebay-auth und ebay-sync teilen.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
// Abweichung 1: Supabase schreibt text/html auf der Standard-Domain zu text/plain um -> die Rücksprung-Seite ist Text.
export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
// Vergleich ohne frühen Abbruch (Geheimwert, OAuth-state).
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m ? m[1].trim() : null;
}
// Fixrunde 1 (Task 5) Minor 6: kaputtes JSON, `null`, ein Array oder ein Primitiv als Body zählen wie ein leeres
// Objekt -- sonst wirft z.B. `body.retry` auf `null` eine rohe TypeError statt einer sauberen Antwort.
export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const v = await req.json().catch(() => null);
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
