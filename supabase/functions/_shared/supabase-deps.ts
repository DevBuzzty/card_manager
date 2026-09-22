// supabase/functions/_shared/supabase-deps.ts -- echte Abhängigkeiten der eBay-Funktionen (nicht unit-getestet; deno check).
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase selbst bereit.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearer } from "./http.ts";
import { supabaseStore } from "./ebay-store.ts";

export function serviceDeps() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // JWT eines angemeldeten Nutzers prüfen (Einzelnutzer-Modell: jede gültige Anmeldung dieses Projekts).
  const verifyUser = async (authorization: string | null) => {
    const jwt = bearer(authorization);
    if (!jwt) return false;
    const { data, error } = await sb.auth.getUser(jwt);
    return !error && !!data?.user;
  };
  return { store: supabaseStore(sb, url), verifyUser, env: (k: string) => Deno.env.get(k) };
}
