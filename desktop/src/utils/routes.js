// Route paths are German and stable — the sidebar, the command palette and the card panel all
// address pages through this table instead of hard-coded strings.
export const ROUTES = {
  start: '/start',
  scannen: '/scannen',
  karten: '/sammlung/karten',
  binder: '/sammlung/binder',
  wunschliste: '/sammlung/wunschliste',
  sets: '/sammlung/sets',
  decks: '/sammlung/decks',
  deals: '/deals',
  insights: '/insights',
  einstellungen: '/einstellungen',
};

const seg = (v, fallback) => encodeURIComponent(String(v ?? '').trim() || fallback);

// Ein aufgeschlagener Behälter (Spec B2 §7.2). Unterhalb von ROUTES.binder, damit das Segment
// „Binder" in SammlungLayout markiert bleibt (NavLink färbt auch Unterrouten ein). Die
// container_id ist eine UUID, wird aber wie jedes andere Segment kodiert — sie kommt aus der
// Datenbank und muss dort nicht für immer eine UUID bleiben.
export function binderRoute(containerId) {
  return `${ROUTES.binder}/${seg(containerId, 'Unknown')}`;
}

// A printing's 4-column key as a route. Every segment is encoded: a rarity can contain a slash
// ("Ghost/Gold Rare") and would otherwise split into two path segments.
export function cardRoute({ id, set_code, language, rarity } = {}) {
  return `/karte/${seg(id, 'Unknown')}/${seg(set_code, 'Unknown')}/${seg(language, 'DE')}/${seg(rarity, 'Unknown')}`;
}

// The inverse, for the panel's useParams(). React Router already decoded the segments (matchPath
// decodes before useParams() returns) — decoding a second time would throw URIError on a literal
// '%' and blank the panel, so take the params as they come.
export function printingFromParams(params = {}) {
  const val = (v, fallback) => (v == null ? fallback : v);
  return {
    id: val(params.id, 'Unknown'),
    set_code: val(params.setCode, 'Unknown'),
    language: val(params.language, 'DE'),
    rarity: val(params.rarity, 'Unknown'),
  };
}
