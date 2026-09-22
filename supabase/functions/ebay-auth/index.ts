// supabase/functions/ebay-auth/index.ts
// Spec H3b §4.3 -- Verbinden/Einrichten. Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy ebay-auth --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
// --no-verify-jwt, weil eBays Rücksprung ohne Anmeldung kommt; alle anderen Aktionen prüfen das JWT in handler.ts.
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleAuth } from "./handler.ts";

const randomState = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve((req) => {
  const s = serviceDeps();
  return handleAuth(req, { store: s.store, fetch, env: s.env, now: () => new Date(), verifyUser: s.verifyUser, randomState });
});
