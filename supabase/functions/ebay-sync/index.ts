// supabase/functions/ebay-sync/index.ts
// Spec H3b §8 -- Abgleicher. Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy ebay-sync --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
// Secrets: EBAY_SANDBOX_*/EBAY_PROD_* und EBAY_CRON_SECRET (supabase/README_ebay_cloud.md). Keine Tokens in Protokollen.
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleSync } from "./handler.ts";
import { runSync } from "./sync.ts";

Deno.serve((req) => {
  const s = serviceDeps();
  return handleSync(req, {
    cronSecret: Deno.env.get("EBAY_CRON_SECRET"),
    verifyUser: s.verifyUser,
    run: (retry) => runSync({ store: s.store, fetch, env: s.env, now: () => new Date(), holder: crypto.randomUUID() }, { retry }),
  });
});
