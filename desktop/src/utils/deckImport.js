// Spec E2 §4/§5 — Namensaufloesung gegen den Offline-Katalog, Abschnittsregel, Vorschau-Zahlen, Notizen und Texte.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt. Beide laufen gegen
// docs/fixtures/decks/import.json. Wer eine Seite aendert, aendert beide.
import { parseDeckText } from './deckFormats.js';

export const CATALOG_MISSING = 'Katalog fehlt – Namen können nicht aufgelöst werden';
export const NOT_FOUND = 'Nicht gefunden';
export const DEFAULT_DECK_NAME = 'Importiertes Deck';
export const NOTES_HEAD = 'Nicht übernommen beim Import:';
export const AMBIGUOUS = 'Mehrdeutig – bitte wählen';
export const OPEN = 'offen';

const EXTRA_TYPES = ['fusion', 'synchro', 'xyz', 'link'];

// Spec E2 §4: Typ enthaelt Fusion/Synchro/XYZ/Link (Gross/Klein egal) -> extra, sonst main. Auch fuer "Ziel: Deck".
export function deckSectionFor(type) {
  const t = String(type || '').toLowerCase();
  return EXTRA_TYPES.some((x) => t.includes(x)) ? 'extra' : 'main';
}

// Zeilenaktion: aus dem Side-Deck "→ Deck" (Main/Extra per Typ), sonst "→ Side".
export function moveTarget(section, type) {
  return section === 'side' ? deckSectionFor(type) : 'side';
}

export const moveLabel = (section) => (section === 'side' ? '→ Deck' : '→ Side');

// Spec E3 §3: Haupt-Passcode eines (Artwork-)Passcodes -- aliases[p] ?? p. aliases: { "<Artwork>": "<Haupt>" } oder
// null/undefined (kein Katalog: jeder Passcode steht fuer sich). Gilt fuer Import-Aufloesung, Legalitaet und Kopien-Grenze.
export function canonicalPasscode(passcode, aliases) {
  const p = String(passcode);
  return aliases && Object.hasOwn(aliases, p) ? String(aliases[p]) : p;
}

// Stufe 2: klein, NFKD, Akzente/Umlaut-Punkte weg, ß -> ss, alles ausser Buchstaben/Ziffern -> ein Leerzeichen, getrimmt.
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Levenshtein auf UTF-16-Einheiten (Kotlin: Char) -- nach normalizeName praktisch immer ASCII.
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export const unknownPasscodeText = (passcode) => `Unbekannter Passcode ${passcode}`;
export const suggestionText = (name) => `Meintest du ${name}?`;
export const ambiguousOptionText = (c) => `${c.name} (${c.passcode})`;
export const failedText = (message) => `Import fehlgeschlagen: ${message}`;
export const countsText = (counts) => `Main ${counts.main} · Extra ${counts.extra} · Side ${counts.side}`;
export const skippedText = (n) => (n > 0 ? `${n} nicht übernommen` : null);
export const deckNameFor = (fileName) => (fileName && String(fileName).trim() ? String(fileName).trim() : DEFAULT_DECK_NAME);

const displayName = (c) => c.name_de || c.name_en || String(c.id);
// passcode: bei einem Artwork-Passcode bleibt der importierte Passcode stehen (Export bleibt artwork-treu), Name und
// Typ kommen von der Hauptkarte (Spec E3 §3).
const candidate = (c, passcode = String(c.id)) => ({ passcode, name: displayName(c), type: c.type || '' });
const byNameThenPasscode = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.passcode < b.passcode ? -1 : a.passcode > b.passcode ? 1 : 0);

function addTo(map, key, id) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

// catalogCards: [{ id, name_de, name_en, type }] oder null (kein Katalog). Fuer YDK/YDKE reichen die Karten der
// gelesenen Passcodes, fuer die Textliste braucht es alle.
function buildIndex(catalogCards) {
  const byId = new Map();
  const exact = new Map();
  const norm = new Map();
  const entries = [];
  for (const c of catalogCards || []) {
    const id = String(c.id);
    byId.set(id, c);
    const names = [c.name_de, c.name_en].filter((x) => x);
    const norms = [];
    for (const name of names) {
      addTo(exact, String(name).trim().toLowerCase(), id);
      const n = normalizeName(name);
      addTo(norm, n, id);
      if (n && !norms.includes(n)) norms.push(n);
    }
    entries.push({ id, norms });
  }
  return { byId, exact, norm, entries };
}

function fuzzy(index, n) {
  if (n.length < 6) return [];
  const hits = [];
  for (const e of index.entries) {
    let best = Infinity;
    for (const x of e.norms) {
      if (Math.abs(x.length - n.length) > 2) continue;   // folgt aus Abstand <= 2; spart die Rechnung
      best = Math.min(best, levenshtein(n, x));
    }
    if (best <= 2) hits.push({ ...candidate(index.byId.get(e.id)), distance: best });
  }
  hits.sort((a, b) => a.distance - b.distance || byNameThenPasscode(a, b));
  return hits.slice(0, 3).map((h) => ({ passcode: h.passcode, name: h.name, type: h.type }));
}

const candidatesOf = (index, ids) => ids.map((id) => candidate(index.byId.get(id))).sort(byNameThenPasscode);

// parsed: Ergebnis von parseDeckText (ohne error). Ergebnis-Zeilen:
// { status: ok|ambiguous|suggest|notFound|unknownPasscode, count, section, source, candidates: [{passcode,name,type}] }
// source = Passcode (YDK/YDKE) bzw. Rohzeile (Textliste). aliases (Spec E3 §3): Passcodes laufen ueber canonicalPasscode.
export function resolveImport(parsed, catalogCards, aliases = null) {
  const index = buildIndex(catalogCards);
  const rows = parsed.cards.map((card) => {
    const base = { count: card.count, section: card.section };
    if (card.passcode != null) {
      const c = index.byId.get(canonicalPasscode(card.passcode, aliases));
      return c
        ? { status: 'ok', ...base, source: card.passcode, candidates: [candidate(c, String(card.passcode))] }
        : { status: 'unknownPasscode', ...base, source: card.passcode, candidates: [] };
    }
    const source = card.line;
    const exactIds = index.exact.get(String(card.name).trim().toLowerCase());
    const n = normalizeName(card.name);
    const ids = exactIds || (n ? index.norm.get(n) : undefined);
    if (ids) return { status: ids.length === 1 ? 'ok' : 'ambiguous', ...base, source, candidates: candidatesOf(index, ids) };
    const suggestions = fuzzy(index, n);
    return suggestions.length
      ? { status: 'suggest', ...base, source, candidates: suggestions }
      : { status: 'notFound', ...base, source, candidates: [] };
  });
  return { catalogMissing: catalogCards == null, rows, unresolved: parsed.unresolved.slice() };
}

// choices: { [Zeilenindex]: passcode } -- Auswahl bei Vorschlag/Mehrdeutig. Offene Zeilen werden nicht uebernommen.
export function importPlan(resolved, choices = {}) {
  const cards = [];
  const counts = { main: 0, extra: 0, side: 0 };
  const skipped = resolved.unresolved.slice();
  const skippedLabels = resolved.unresolved.slice();   // Anzeige im Block "Nicht übernommen"
  resolved.rows.forEach((row, i) => {
    let chosen = null;
    if (row.status === 'ok') chosen = row.candidates[0];
    else if (row.status === 'ambiguous' || row.status === 'suggest') {
      const pick = choices[i];
      chosen = row.candidates.find((c) => c.passcode === pick) || null;
    }
    if (!chosen) {
      skipped.push(row.status === 'unknownPasscode' ? unknownPasscodeText(row.source) : row.source);
      skippedLabels.push(row.status === 'unknownPasscode' ? unknownPasscodeText(row.source)
        : `${row.source} · ${row.status === 'notFound' ? NOT_FOUND : OPEN}`);
      return;
    }
    const section = row.section === 'unknown' ? deckSectionFor(chosen.type) : row.section;
    const hit = cards.find((c) => c.card_id === chosen.passcode && c.section === section);
    if (hit) hit.count += row.count;
    else cards.push({ card_id: chosen.passcode, name: chosen.name, count: row.count, section });
    counts[section] += row.count;
  });
  const notes = skipped.length ? [NOTES_HEAD, ...skipped].join('\n') : null;
  return { cards, counts, skipped, skippedLabels, notes };
}

// Einstieg der Vorschau (Einfuegen, YDK-Datei; Handy auch Teilen): lesen mit dem gemeinsamen Parser, dann den Katalog
// laden -- fuer YDK/YDKE nur die gelesenen Passcodes, fuer die Textliste alle Karten -- und aufloesen.
// loadCatalog(ids | null) -> { available, cards, aliases? }; mit ids liefert der Lader fuer Artwork-Passcodes die
// Hauptkarte und die Zuordnung in `aliases` (Spec E3 §3). Ergebnis { error } oder { resolved }.
export async function prepareImport(text, format, loadCatalog) {
  const parsed = format ? parseDeckText(text, format) : parseDeckText(text);
  if (parsed.error) return { error: parsed.error };
  const ids = parsed.format === 'text' ? null : parsed.cards.map((c) => c.passcode);
  const catalog = await loadCatalog(ids);
  const available = !!(catalog && catalog.available);
  return { resolved: resolveImport(parsed, available ? catalog.cards : null, available ? catalog.aliases || null : null) };
}
