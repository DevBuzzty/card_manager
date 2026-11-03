// supabase/functions/resolve-cm-product/index.ts -- Spec 2026-11-03 §5 (Option D): druckgenaue Cardmarket-Zuordnung on demand
// für die Ergebnis-Seite des Handys. Index aus refresh-cardmarket-prices (Schritt "cm-index"), Preise aus catalog/cm-prices.json.gz.
// Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy resolve-cm-product --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
//   (--no-verify-jwt: die Funktion prüft das Nutzer-JWT selbst über verifyUser, wie ebay-sold-prices)
// Vorher: supabase/cm_resolve_schema.sql einspielen und den Index einmal bauen (supabase/README_cardmarket_cloud.md).
// Secrets: keine neuen; SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase selbst bereit.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleResolve } from "./handler.ts";
import { resolveAnfrage } from "./resolve.ts";
import { dateiLader } from "./index-file.ts";
import { supabaseCacheStore } from "./cache-store.ts";
import { ygoClient } from "./ygoprodeck.ts";

// Modulspeicher je Instanz: Index/Preisdatei (1 h), YGOPRODeck (24 h), Hinweis "Tabelle fehlt" (einmal).
const s = serviceDeps();
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const lader = dateiLader({
  download: async (bucket, path) => {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },
  now: () => Date.now(),
});
const ygo = ygoClient({ fetch, now: () => Date.now() });
const cache = supabaseCacheStore(sb);
const zustand = { tabelleFehltGemeldet: false };

Deno.serve((req) =>
  handleResolve(req, {
    verifyUser: s.verifyUser,
    resolve: (a) => resolveAnfrage(a, { index: lader.index, preise: lader.preise, ygo, cache, now: () => new Date(), zustand }),
  })
);
