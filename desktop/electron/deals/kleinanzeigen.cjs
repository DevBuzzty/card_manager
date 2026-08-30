// Kleinanzeigen (kleinanzeigen.de) deal adapter.
// Scrapes the public search-results page. No official API -> best-effort HTML parse.
// Honest caveat: against Kleinanzeigen ToS, and they run anti-bot; this can break and
// needs polite, low-frequency polling.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

// "120 € VB" -> 120 ; "Zu verschenken" -> 0 ; "VB" / "Preis auf Anfrage" -> null
function parsePrice(raw) {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes('verschenken')) return 0;
  const m = raw.replace(/\./g, '').match(/(\d+)(?:,(\d+))?\s*€/);
  if (!m) return null;
  return parseFloat(m[2] ? `${m[1]}.${m[2]}` : m[1]);
}

async function search(query) {
  const slug = encodeURIComponent(query.trim().toLowerCase())
    .replace(/%20/g, '-').replace(/[^a-z0-9\-%]/gi, '');
  const url = `https://www.kleinanzeigen.de/s-${slug}/k0`;

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', 'Accept': 'text/html' },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, url, items: [] };
  }
  const html = await res.text();

  const items = [];
  const blocks = html.split('<article class="aditem"');
  for (const b of blocks.slice(1)) {
    const adid = (b.match(/data-adid="(\d+)"/) || [])[1];
    const href = (b.match(/data-href="([^"]+)"/) || [])[1];
    const title = decodeEntities((b.match(/class="ellipsis"[^>]*>([^<]+)</) || [])[1]);
    const priceRaw = decodeEntities(
      (b.match(/--price-shipping--price[^>]*>([^<]+)</) || [])[1]
    );
    let img = (b.match(/<img[^>]+(?:data-imgsrc|src)="([^"]+)"/) || [])[1];
    if (img && img.startsWith('data:')) img = undefined;
    if (!adid || !title || !href) continue;
    items.push({
      source: 'kleinanzeigen',
      listingId: adid,
      title,
      price: parsePrice(priceRaw),
      priceRaw,
      url: href.startsWith('http') ? href : 'https://www.kleinanzeigen.de' + href,
      imageUrl: img,
    });
  }
  return { ok: true, status: res.status, url, items };
}

module.exports = { search };

// Standalone self-test: `node kleinanzeigen.cjs "yu-gi-oh display"`
if (require.main === module) {
  const q = process.argv[2] || 'yu-gi-oh display';
  search(q).then((r) => {
    console.log(`query="${q}" ok=${r.ok} status=${r.status}`);
    console.log(`url=${r.url}`);
    console.log(`parsed ${r.items.length} listings; first 8:`);
    for (const it of r.items.slice(0, 8)) {
      console.log(`  [${it.listingId}] ${it.price ?? '—'}€  ${it.title.slice(0, 60)}`);
    }
  }).catch((e) => console.error('ERROR', e));
}
