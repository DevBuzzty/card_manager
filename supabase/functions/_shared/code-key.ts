// supabase/functions/_shared/code-key.ts -- Spec 2026-11-03 §3.2. Set-Code ohne Region und führende Nullen ("LOB-DE005" -> "LOB-5").
// Twin: android cloud/CodeKey.kt, Fixture docs/fixtures/code-key.json. null = Code ohne diese Grammatik.
const RE = /^([A-Z0-9]{2,6})-([A-Z]{1,2})?([A-Z]?\d{1,4})$/;

function of(code: string | null | undefined): string | null {
  const m = RE.exec(String(code ?? "").trim().toUpperCase());
  if (!m) return null;
  const nummer = m[3].replace(/^0+/, "") || "0";
  return `${m[1]}-${nummer}`;
}

export const CodeKey = { of };
