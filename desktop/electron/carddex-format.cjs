// Spec F1 §2 -- das eigene, verlustfreie Format: eine Zeile je Exemplar-Gruppe (gleiches Printing, Edition, Zustand,
// Behaelter, Seite, Fach, Tags, Notiz). Schreiben (Export) und Lesen (Import) wohnen zusammen, damit der Rundlauf an
// genau einer Spaltenliste haengt. Preise, price_locked, Cardmarket-IDs, Preisverlauf, Sealed, Decks und Wunschliste
// stehen absichtlich nicht drin.
const { parseCsv, toCsv } = require('./csv.cjs');
const { EDITIONS, CONDITIONS } = require('./valuation.cjs');
const { normalizeTagList } = require('./copies.cjs');

const CARDDEX_VERSION = 1;
const CARDDEX_COLUMNS = [
  'carddex_version', 'passcode', 'name', 'set_code', 'rarity', 'language', 'count', 'edition', 'condition',
  'container', 'container_kind', 'pockets_per_page', 'page', 'slot', 'tags', 'note',
];
const READ_ERRORS = {
  unreadable: 'Datei nicht lesbar',
  'not-carddex': 'Nur Card-Dex-CSV – andere Formate folgen',
  'newer-version': 'Datei stammt aus einer neueren Card-Dex-Version',
};

// card_copies.tags ist ein JSON-Array als Text; eine kaputte Zelle heisst "keine Tags" (wie tags.js#parseTags).
function tagsOfCell(text) {
  if (text == null || text === '') return [];
  try { return normalizeTagList(JSON.parse(text)); } catch { return []; }
}

const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'de');
const byNullableNumber = (a, b) => (a == null) - (b == null) || (Number(a) || 0) - (Number(b) || 0);

// copies: Zeilen aus collection-export.cjs#loadExportCopies. Ein Exemplar ohne lebenden Behaelter hat keinen Standort;
// Seite/Fach und Faecher je Seite gibt es nur bei einem Binder. -> Gruppen, sortiert nach Spec §2.
function carddexGroups(copies) {
  const groups = new Map();
  for (const cp of copies || []) {
    const inContainer = !!cp.container_id && !!cp.container_name;
    const binder = inContainer && cp.container_kind === 'binder';
    const tags = tagsOfCell(cp.tags);
    const g = {
      passcode: String(cp.card_id), name: cp.name ?? '', set_code: cp.set_code, rarity: cp.rarity, language: cp.language,
      edition: cp.edition, condition: cp.condition,
      container_id: inContainer ? cp.container_id : null,
      container: inContainer ? cp.container_name : null,
      container_kind: inContainer ? cp.container_kind : null,
      pockets_per_page: binder ? (cp.pockets_per_page ?? null) : null,
      page: binder ? (cp.page ?? null) : null,
      slot: binder ? (cp.slot ?? null) : null,
      tags, note: cp.note == null || cp.note === '' ? null : String(cp.note),
    };
    const key = JSON.stringify([g.passcode, g.set_code, g.rarity, g.language, g.edition, g.condition, g.container_id, g.page, g.slot, tags, g.note]);
    const hit = groups.get(key);
    if (hit) hit.count += 1; else groups.set(key, { ...g, count: 1 });
  }
  return [...groups.values()].sort((a, b) => (a.container == null) - (b.container == null)
    || byText(a.container, b.container)
    || byNullableNumber(a.page, b.page)
    || byNullableNumber(a.slot, b.slot)
    || byText(a.name, b.name)
    || byText(a.set_code, b.set_code)
    || byText(a.rarity, b.rarity)
    || byText(a.language, b.language)
    || EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)
    || CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition));
}

function writeCarddex(groups) {
  const blank = (v) => (v == null ? '' : v);
  return toCsv([CARDDEX_COLUMNS, ...groups.map((g) => [
    CARDDEX_VERSION, g.passcode, g.name, g.set_code, g.rarity, g.language, g.count, g.edition, g.condition,
    blank(g.container), blank(g.container_kind), blank(g.pockets_per_page), blank(g.page), blank(g.slot),
    g.tags.join('|'), blank(g.note),
  ])]);
}

// -> { ok: true, rows: [{ line, passcode, name, set_code, rarity, language, count, edition, condition, container,
//      container_kind, pockets_per_page, page, slot, tags: string[], note }] } (alles Text ausser tags)
//    | { ok: false, error: 'unreadable'|'not-carddex'|'newer-version', text }
function readCarddex(text) {
  const fail = (error) => ({ ok: false, error, text: READ_ERRORS[error] });
  const { rows } = parseCsv(text);
  if (rows.length === 0) return fail('unreadable');
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  if (header[0] !== 'carddex_version') return fail('not-carddex');
  const col = Object.fromEntries(CARDDEX_COLUMNS.map((c) => [c, header.indexOf(c)]));
  if (col.passcode < 0 || col.count < 0 || rows.length < 2) return fail('unreadable');
  const out = [];
  for (const r of rows.slice(1)) {
    const get = (c) => (col[c] >= 0 ? String(r.cells[col[c]] ?? '').trim() : '');
    const version = Number(get('carddex_version'));
    if (Number.isFinite(version) && version > CARDDEX_VERSION) return fail('newer-version');
    const row = { line: r.line };
    for (const c of CARDDEX_COLUMNS.slice(1)) row[c] = get(c);
    row.tags = normalizeTagList(row.tags.split('|'));
    out.push(row);
  }
  return { ok: true, rows: out };
}

module.exports = { CARDDEX_VERSION, CARDDEX_COLUMNS, READ_ERRORS, tagsOfCell, carddexGroups, writeCarddex, readCarddex };
