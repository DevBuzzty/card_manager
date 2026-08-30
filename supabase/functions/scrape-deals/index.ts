// Supabase Edge Function: scrape active deal watches and insert new listings.
// Runs on a schedule (cron) so the phone gets deals without the desktop.
// Deploy:  supabase functions deploy scrape-deals --no-verify-jwt
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// This is a Deno port of desktop/electron/deals/{kleinanzeigen,poller}.cjs. Keep the
// scraping regexes and the matchesQuery logic in sync with those files.

import { createClient } from "jsr:@supabase/supabase-js@2";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function decodeEntities(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

// "120 € VB" -> 120 ; "Zu verschenken" -> 0 ; "VB"/"1 € VB" -> null
function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("verschenken")) return 0;
  const m = raw.replace(/\./g, "").match(/(\d+)(?:,(\d+))?\s*€/);
  if (!m) return null;
  const val = parseFloat(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  if (t.includes("vb") && val <= 2) return null;
  return val;
}

type Item = {
  source: string; listingId: string; title: string;
  price: number | null; url: string; imageUrl?: string;
};

async function scrapeKleinanzeigen(query: string): Promise<Item[]> {
  const slug = encodeURIComponent(query.trim().toLowerCase())
    .replace(/%20/g, "-").replace(/[^a-z0-9\-%]/gi, "");
  const url = `https://www.kleinanzeigen.de/s-${slug}/k0`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9", "Accept": "text/html" },
  });
  if (!res.ok) {
    console.error(`[scrape] kleinanzeigen HTTP ${res.status} for "${query}"`);
    return [];
  }
  const html = await res.text();
  const items: Item[] = [];
  for (const b of html.split('<article class="aditem"').slice(1)) {
    const adid = (b.match(/data-adid="(\d+)"/) || [])[1];
    const href = (b.match(/data-href="([^"]+)"/) || [])[1];
    const title = decodeEntities((b.match(/class="ellipsis"[^>]*>([^<]+)</) || [])[1]);
    const priceRaw = decodeEntities((b.match(/--price-shipping--price[^>]*>([^<]+)</) || [])[1]);
    let img: string | undefined = (b.match(/<img[^>]+(?:data-imgsrc|src)="([^"]+)"/) || [])[1];
    if (img && img.startsWith("data:")) img = undefined;
    if (!adid || !title || !href) continue;
    items.push({
      source: "kleinanzeigen", listingId: adid, title, price: parsePrice(priceRaw),
      url: href.startsWith("http") ? href : "https://www.kleinanzeigen.de" + href,
      imageUrl: img,
    });
  }
  return items;
}

const ADAPTERS: Record<string, (q: string) => Promise<Item[]>> = {
  kleinanzeigen: scrapeKleinanzeigen,
};

const STOPWORDS = new Set(["of", "the", "und", "der", "die", "das", "de", "en", "für", "mit"]);
const normalize = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9äöü\s]/gi, " ").replace(/\s+/g, " ").trim();

/** The title must contain every significant word of the query (site search is too fuzzy). */
function matchesQuery(title: string, query: string): boolean {
  const tokens = normalize(query).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const t = " " + normalize(title) + " ";
  return tokens.length === 0 || tokens.every((tok) => t.includes(tok));
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: watches, error: wErr } = await supabase
    .from("deal_watches").select("*").eq("active", true);
  if (wErr) return json({ error: wErr.message }, 500);

  let scanned = 0, inserted = 0;
  const newAlerts: Array<Record<string, unknown>> = [];

  for (const w of watches ?? []) {
    const sources: string[] = w.sources ? JSON.parse(w.sources) : Object.keys(ADAPTERS);
    for (const src of sources) {
      const adapter = ADAPTERS[src];
      if (!adapter) continue;
      let items: Item[] = [];
      try { items = await adapter(w.query); }
      catch (e) { console.error(`[scrape] ${src} failed:`, (e as Error).message); continue; }

      for (const it of items) {
        scanned++;
        if (it.price == null || it.price > Number(w.max_price)) continue;
        if (!matchesQuery(it.title, w.query)) continue;
        // unique(source, listing_id) makes this idempotent; ignoreDuplicates returns only new rows.
        const { data, error } = await supabase.from("deal_alerts").upsert({
          watch_id: w.id, user_id: w.user_id, source: it.source, listing_id: it.listingId,
          title: it.title, price: it.price, url: it.url, image_url: it.imageUrl ?? null,
        }, { onConflict: "source,listing_id", ignoreDuplicates: true }).select();
        if (error) { console.error("[insert]", error.message); continue; }
        if (data && data.length) { inserted += data.length; newAlerts.push(...data); }
      }
    }
  }

  console.log(`[scrape-deals] watches=${watches?.length ?? 0} scanned=${scanned} new=${inserted}`);
  return json({ watches: watches?.length ?? 0, scanned, inserted, newAlerts });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
