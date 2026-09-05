// Route paths are German and stable — the sidebar, the command palette and the card panel all
// address pages through this table instead of hard-coded strings.
export const ROUTES = {
  start: '/start',
  scannen: '/scannen',
  karten: '/sammlung/karten',
  wunschliste: '/sammlung/wunschliste',
  sets: '/sammlung/sets',
  decks: '/sammlung/decks',
  deals: '/deals',
  insights: '/insights',
  einstellungen: '/einstellungen',
};

const seg = (v, fallback) => encodeURIComponent(String(v ?? '').trim() || fallback);

// A printing's 4-column key as a route. Every segment is encoded: a rarity can contain a slash
// ("Ghost/Gold Rare") and would otherwise split into two path segments.
export function cardRoute({ id, set_code, language, rarity } = {}) {
  return `/karte/${seg(id, 'Unknown')}/${seg(set_code, 'Unknown')}/${seg(language, 'DE')}/${seg(rarity, 'Unknown')}`;
}

// The inverse, for the panel's useParams().
export function printingFromParams(params = {}) {
  const dec = (v, fallback) => (v == null ? fallback : decodeURIComponent(v));
  return {
    id: dec(params.id, 'Unknown'),
    set_code: dec(params.setCode, 'Unknown'),
    language: dec(params.language, 'DE'),
    rarity: dec(params.rarity, 'Unknown'),
  };
}
