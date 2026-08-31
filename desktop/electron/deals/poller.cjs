// Deal poller: for each active watch, run every source adapter, and surface NEW listings
// priced at/below the watch's max price. Mirrors startPricePoller's setInterval pattern.

const kleinanzeigen = require('./kleinanzeigen.cjs');

// Multi-source registry — add adapters here (eBay, Cardmarket, Willhaben, Shpock, FB, ...).
const ADAPTERS = { kleinanzeigen };

const STOPWORDS = new Set(['of', 'the', 'und', 'der', 'die', 'das', 'de', 'en', 'für', 'mit']);
// Fold ß->ss and umlauts/accents to ASCII (applied to both title and query). Kept in sync
// with supabase/functions/scrape-deals/index.ts.
const normalize = (s) => (s || '').toLowerCase()
  .replace(/ß/g, 'ss')
  .replace(/[äáàâã]/g, 'a').replace(/[öóòôõ]/g, 'o').replace(/[üúùû]/g, 'u')
  .replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i').replace(/ç/g, 'c').replace(/ñ/g, 'n')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** The title must contain every significant word of the query (site search is too fuzzy). */
function matchesQuery(title, query) {
  const nt = ' ' + normalize(title) + ' ';
  const tokens = normalize(query).split(' ').filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  // A query with no significant tokens (e.g. "Ra") must NOT match everything.
  if (tokens.length === 0) {
    const raw = normalize(query);
    return raw.length > 0 && nt.includes(raw);
  }
  return tokens.every((tok) => nt.includes(tok));
}

/** Run the watch's sources and return listings at/below max_price that actually match the query. */
async function findDeals(watch, adapters = ADAPTERS) {
  const sources = (watch.sources && watch.sources.length)
    ? watch.sources : Object.keys(adapters);
  const deals = [];
  for (const src of sources) {
    const adapter = adapters[src];
    if (!adapter) continue;
    try {
      const r = await adapter.search(watch.query);
      for (const it of r.items) {
        if (it.price == null || it.price > watch.max_price) continue;
        if (!matchesQuery(it.title, watch.query)) continue;   // reject fuzzy word matches
        deals.push({ ...it, watchId: watch.id });
      }
    } catch (e) {
      console.error(`[deals] ${src} search failed for "${watch.query}":`, e.message);
    }
  }
  return deals;
}

/**
 * Poll active watches on an interval. `db` is the better-sqlite3 handle; `notify(alert)` is
 * called for each newly-seen deal (to push to the renderer + phone + OS notification).
 * Requires the deal_watches / deal_alerts tables (see database.cjs migrations).
 */
function startDealPoller(db, notify, intervalMs = 5 * 60 * 1000) {
  const tick = async () => {
    let watches;
    try {
      watches = db.prepare('SELECT * FROM deal_watches WHERE active = 1').all();
    } catch (e) { return; }  // tables not migrated yet
    for (const watch of watches) {
      const w = { ...watch, sources: watch.sources ? JSON.parse(watch.sources) : null };
      const deals = await findDeals(w);
      const insert = db.prepare(
        `INSERT OR IGNORE INTO deal_alerts
           (watch_id, source, listing_id, title, price, url, image_url, found_at, notified)
         VALUES (@watch_id, @source, @listing_id, @title, @price, @url, @image_url, CURRENT_TIMESTAMP, 0)`
      );
      for (const d of deals) {
        const info = insert.run({
          watch_id: watch.id, source: d.source, listing_id: d.listingId,
          title: d.title, price: d.price, url: d.url, image_url: d.imageUrl || null,
        });
        if (info.changes > 0) {  // genuinely new listing
          const alert = { watchId: watch.id, query: watch.query, ...d };
          try { notify(alert); } catch (e) { console.error('[deals] notify failed', e); }
        }
      }
    }
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return { stop: () => clearInterval(id), pollNow: tick };
}

module.exports = { ADAPTERS, findDeals, startDealPoller };

// Standalone self-test: `node poller.cjs "yu-gi-oh display" 80`
if (require.main === module) {
  const query = process.argv[2] || 'yu-gi-oh display';
  const maxPrice = parseFloat(process.argv[3] || '80');
  findDeals({ id: 1, query, max_price: maxPrice }).then((deals) => {
    console.log(`watch: "${query}" <= ${maxPrice}€  ->  ${deals.length} deal(s):`);
    for (const d of deals) console.log(`  ${d.price}€  ${d.title.slice(0, 60)}  ${d.url}`);
  }).catch((e) => console.error('ERROR', e));
}
