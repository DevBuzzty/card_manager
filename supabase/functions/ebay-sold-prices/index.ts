// supabase/functions/ebay-sold-prices/index.ts
// Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy ebay-sold-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
// Secrets: EBAY_PROD_CLIENT_ID/_SECRET/_RUNAME und EBAY_CRON_SECRET (wie ebay-sync). Keine Tokens in Protokollen.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleSold } from "./handler.ts";
import { runSold } from "./run.ts";
import { supabaseSoldStore } from "./sold-store.ts";

Deno.serve((req) => {
  const s = serviceDeps();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return handleSold(req, {
    cronSecret: Deno.env.get("EBAY_CRON_SECRET"),
    verifyUser: s.verifyUser,
    run: (o) => runSold({ store: supabaseSoldStore(sb), fetch, env: (k) => Deno.env.get(k), now: () => new Date() }, o),
  });
});
