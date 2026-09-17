const crypto = require('crypto');
const { CONDITIONS, EDITIONS, conditionFactor, factorCaseSql, unitPriceCaseSql } = require('./valuation.cjs');

// Erwartete, benutzersichtbare Fehler (falsche Eingabe, unbekannte ID) -- main.cjs erkennt sie an
// dieser Klasse und reicht ihre deutsche Meldung unveraendert durch. Alles andere (z.B. ein
// rohes better-sqlite3-Fehlerobjekt) gilt dort als unerwartet und wird durch eine generische
// deutsche Meldung ersetzt, der Originaltext landet in der Konsole.
class ValidationError extends Error {}

const norm = (p) => ({ id: String(p.id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown' });
const KEY = 'card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity';

function defaults(db) {
  const get = (k) => { try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; } catch { return null; } };
  const edition = get('default_edition'), condition = get('default_condition');
  return {
    edition: EDITIONS.includes(edition) ? edition : 'unknown',
    condition: CONDITIONS.includes(condition) ? condition : 'NM',
  };
}

function listCopies(db, printing) {
  return db.prepare(`SELECT * FROM card_copies WHERE ${KEY} AND deleted = 0 ORDER BY created_at, copy_id`).all(norm(printing));
}

function groupCopies(rows) {
  const m = new Map();
  for (const c of rows || []) {
    const k = `${c.edition || 'unknown'}|${c.condition || 'NM'}`;
    m.set(k, (m.get(k) || 0) + (Number(c.count) || 1));
  }
  return Array.from(m.entries())
    .map(([k, count]) => { const [edition, condition] = k.split('|'); return { edition, condition, count }; })
    .sort((a, b) => (EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)) || (CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)));
}

function addCopies(db, printing, { edition, condition, count = 1 } = {}) {
  const p = norm(printing);
  const d = defaults(db);
  const ed = EDITIONS.includes(edition) ? edition : d.edition;
  const co = CONDITIONS.includes(condition) ? condition : d.condition;
  const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition)
    VALUES (@copy_id, @id, @set_code, @language, @rarity, @edition, @condition)`);
  const ids = [];
  db.transaction(() => {
    for (let i = 0; i < Math.max(1, Number(count) || 1); i++) {
      const copy_id = crypto.randomUUID();
      ins.run({ ...p, copy_id, edition: ed, condition: co });
      ids.push(copy_id);
    }
  })();
  return ids;
}

// Standard-first: the default group goes first, then the remaining copies ordered so that the
// most valuable (highest factor, non-default edition) are removed LAST.
function removeCopies(db, printing, { edition, condition, count = 1 } = {}) {
  const p = norm(printing);
  const n = Math.max(1, Number(count) || 1);
  let rows;
  if (edition || condition) {
    rows = db.prepare(`SELECT copy_id FROM card_copies WHERE ${KEY} AND deleted = 0
      AND (@edition IS NULL OR edition = @edition) AND (@condition IS NULL OR condition = @condition)
      ORDER BY created_at DESC, copy_id LIMIT @n`).all({ ...p, edition: edition || null, condition: condition || null, n });
  } else {
    const d = defaults(db);
    const all = db.prepare(`SELECT copy_id, edition, condition, created_at FROM card_copies WHERE ${KEY} AND deleted = 0`).all(p);
    all.sort((a, b) => {
      const sa = (a.edition === d.edition && a.condition === d.condition) ? 0 : 1;
      const sb = (b.edition === d.edition && b.condition === d.condition) ? 0 : 1;
      if (sa !== sb) return sa - sb;                                   // standard first
      const fa = conditionFactor(a.condition), fb = conditionFactor(b.condition);
      if (fa !== fb) return fa - fb;                                   // cheaper condition first
      const ea = a.edition === 'first' ? 1 : 0, eb = b.edition === 'first' ? 1 : 0;
      if (ea !== eb) return ea - eb;                                   // 1st edition last
      return String(b.created_at).localeCompare(String(a.created_at)); // newest first
    });
    rows = all.slice(0, n);
  }
  const upd = db.prepare('UPDATE card_copies SET deleted = 1 WHERE copy_id = ?');
  db.transaction(() => { for (const r of rows) upd.run(r.copy_id); })();
  return rows.length;
}

function moveCopies(db, from, to) {
  const f = norm(from), t = norm(to);
  const info = db.prepare(`UPDATE card_copies SET set_code = @t_set_code, language = @t_language, rarity = @t_rarity
    WHERE card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0`)
    .run({ ...f, t_set_code: t.set_code, t_language: t.language, t_rarity: t.rarity });
  return info.changes;
}

function updateCopyGroup(db, printing, from, to) {
  const p = norm(printing);
  if (!EDITIONS.includes(to.edition) || !CONDITIONS.includes(to.condition)) throw new Error('invalid edition/condition');
  const info = db.prepare(`UPDATE card_copies SET edition = @to_edition, condition = @to_condition
    WHERE ${KEY} AND deleted = 0 AND edition = @from_edition AND condition = @from_condition`)
    .run({ ...p, to_edition: to.edition, to_condition: to.condition, from_edition: from.edition, from_condition: from.condition });
  return info.changes;
}

function softDeletePrinting(db, printing) {
  const p = norm(printing);
  db.prepare(`UPDATE card_copies SET deleted = 1 WHERE ${KEY} AND deleted = 0`).run(p);
  // The trigger tombstones the card row; make it explicit for printings that had no copies.
  db.prepare('UPDATE cards SET deleted = 1, quantity = 0 WHERE id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0').run(p);
}

// Box und Deckbox haben keine Seiten. Die Regel liegt HIER und nicht in der Oberflaeche, damit
// sie fuer jeden Aufrufer gilt -- Desktop, Handy ueber die Cloud, und spaeter der Einsortier-
// Modus aus B2.
function setCopyLocation(db, { copy_id, container_id, page, slot }) {
  const kind = container_id
    ? (db.prepare('SELECT kind FROM containers WHERE container_id = ? AND deleted = 0').get(container_id) || {}).kind
    : null;
  if (container_id && !kind) throw new ValidationError('Behälter nicht gefunden.');
  const isBinder = kind === 'binder';
  const info = db.prepare(`UPDATE card_copies
                 SET container_id = @container_id, page = @page, slot = @slot,
                     updated_at = CURRENT_TIMESTAMP
               WHERE copy_id = @copy_id`)
    .run({
      copy_id,
      container_id: container_id ?? null,
      page: container_id && isBinder ? (page ?? null) : null,
      slot: container_id && isBinder ? (slot ?? null) : null,
    });
  if (info.changes === 0) throw new ValidationError('Exemplar nicht gefunden.');
}

// Copy_id-genauer Soft-Delete -- das exemplarbezogene Gegenstueck zu removeCopies() (Gruppe nach
// Edition/Zustand/Erstellzeit), nicht dessen Ersatz. Seit jedes Exemplar eigene Standort-, Tag-
// und Notizdaten traegt, ist es NICHT mehr egal, welches physische Exemplar einer Gruppe geloescht
// wird -- CopySheet.jsx kennt die copy_id des geoeffneten Exemplars und muss genau dieses treffen.
// Folgt exakt dem Muster von setCopyLocation oben: stempelt updated_at neu, prueft info.changes,
// wirft bei null getroffenen Zeilen mit deutscher Meldung.
function deleteCopy(db, { copy_id }) {
  const info = db.prepare('UPDATE card_copies SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE copy_id = @copy_id')
    .run({ copy_id });
  if (info.changes === 0) throw new ValidationError('Exemplar nicht gefunden.');
}

// Dieselbe Normalisierung wie parseTags()/serializeTags() in ../src/utils/tags.js (ESM,
// Renderer) und android/app/src/main/java/com/example/yugiohscanner/ml/Tags.kt: Raender
// trimmen, Duplikate ohne Ruecksicht auf Gross-/Kleinschreibung verwerfen, Einfuegereihenfolge
// behalten, nie werfen. Hier absichtlich dupliziert -- der Hauptprozess ist CommonJS und kann
// das ESM-Modul des Renderers nicht importieren.
function normalizeTagList(tags) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(tags) ? tags : []) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

// `tags` ist ein ROHES string[], NICHT vorserialisiert -- normalizeTagList()/JSON.stringify()
// erledigen die Serialisierung erst hier. Ein bereits serialisierter JSON-String faellt bei
// Array.isArray(tags) durch und wuerde als leere Liste gespeichert, alle Tags waeren weg.
function setCopyTagsNote(db, { copy_id, tags, note }) {
  const clean = normalizeTagList(tags);
  const info = db.prepare(`UPDATE card_copies
                 SET tags = @tags, note = @note, updated_at = CURRENT_TIMESTAMP
               WHERE copy_id = @copy_id`)
    .run({
      copy_id,
      tags: clean.length ? JSON.stringify(clean) : null,
      note: note ?? null,
    });
  if (info.changes === 0) throw new ValidationError('Exemplar nicht gefunden.');
}

// Lebende Exemplare ohne Behaelter, mit den zugehoerigen Kartendaten (fuer den Einsortier-Modus).
// AUSGESCHRIEBENE Spaltenliste statt `cp.*, c.*`: beide Tabellen haben created_at, updated_at
// und deleted, und better-sqlite3 baut das Ergebnisobjekt spaltenweise auf -- die spaeter
// selektierten c.*-Spalten wuerden die gleichnamigen cp.*-Spalten stillschweigend ueberschreiben.
// Das Exemplar behaelt seine eigenen Namen (created_at/updated_at/deleted MUESSEN die des
// Exemplars sein, nicht der Karte); die paar Kartenfelder, die die Oberflaeche fuer den
// Einsortier-Modus braucht, bekommen ein card_-Praefix, damit nichts mehrdeutig ist.
function listUnsortedCopies(db) {
  return db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity,
           cp.edition, cp.condition, cp.container_id, cp.page, cp.slot,
           cp.tags, cp.note, cp.needs_review, cp.review_reason, cp.for_sale,
           cp.created_at, cp.updated_at, cp.deleted,
           c.name AS card_name, c.image_url AS card_image_url, c.price AS card_price
      FROM card_copies cp
      JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code
                  AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.deleted = 0 AND c.deleted = 0 AND cp.container_id IS NULL
     ORDER BY cp.created_at, cp.copy_id`).all();
}

// Alle lebenden Exemplare der ganzen Sammlung in EINER Abfrage (Spec B1 Task 7, Fix-Durchlauf 1,
// Befund 2) -- Ersatz fuer den frueheren Weg, listCopies(printing) je Printing einzeln aufzurufen
// (bei mehreren tausend Printings entsprechend viele IPC-Rundreisen auf dem Single-Thread-
// Hauptprozess). KEIN JOIN mit cards: card_copies und cards haben beide created_at, updated_at
// und deleted, ein Join haette (wie schon einmal in listUnsortedCopies, siehe Kommentar dort) die
// Exemplarwerte durch die Kartenwerte ueberschrieben. Die Printing-Identitaet (card_id, set_code,
// language, rarity) reicht dem Aufrufer, um die Zeilen im Renderer nach Printing zu gruppieren.
// edition und condition stehen seit Spec B2 Task 8 mit dabei: die Binder-Ansicht rechnet den Wert
// EINER Ordnerseite aus (Preis x Zustandsfaktor, dieselbe Formel wie valuation.cjs#totalValue) und
// reicht dieselbe Zeile an CopySheet weiter, das beide Felder im Kopf zeigt. Ohne sie haette der
// Renderer je Fach einen zweiten Aufruf (list-copies) gebraucht -- oder den Zustandsfaktor stumm
// auf 1 geschaetzt. Zusaetzliche Spalten DERSELBEN Tabelle, kein JOIN: die Kollisionsgefahr aus
// dem Absatz darueber besteht hier nicht.
function listAllCopies(db) {
  return db.prepare(`
    SELECT copy_id, card_id, set_code, language, rarity, edition, condition,
           container_id, page, slot, tags, note, created_at
      FROM card_copies
     WHERE deleted = 0
     ORDER BY created_at, copy_id`).all();
}

// Spec E1 §4/§7: lebende Exemplare LEBENDER Printings mit Standort und den Preisfeldern, die der Abgleich und
// "Box befüllen" brauchen (unitPrice x Zustandsfaktor, G4). Ausgeschriebene Spaltenliste wie listUnsortedCopies:
// cards und card_copies teilen sich created_at/updated_at/deleted. Ein Exemplar eines Unknown-Printings zaehlt mit.
function listDeckCopies(db) {
  return db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.container_id, cp.page, cp.slot,
           c.name AS card_name, c.price AS price, c.price_first_ed AS price_first_ed
      FROM card_copies cp
      JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code
                  AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.deleted = 0 AND c.deleted = 0
     ORDER BY cp.card_id, cp.copy_id`).all();
}

// Vorschlagsliste ueber alle lebenden Exemplare: entdoppelt (ohne Ruecksicht auf
// Gross-/Kleinschreibung, erste Schreibweise gewinnt), alphabetisch sortiert. Eine kaputte
// tags-Zelle wird uebersprungen statt zu werfen -- der Inhalt kann aus der Cloud stammen.
function listTags(db) {
  const rows = db.prepare(`SELECT tags FROM card_copies WHERE deleted = 0 AND tags IS NOT NULL
                            ORDER BY created_at, copy_id`).all();
  const seen = new Map(); // lowercase -> erste gesehene Schreibweise
  for (const row of rows) {
    let arr;
    try { arr = JSON.parse(row.tags); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item !== 'string') continue;
      const t = item.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'de'));
}

// Behaelter mit Belegung: Anzahl lebender Exemplare und ihr Wert (Preis x Zustandsfaktor,
// derselbe Weg wie valuation.cjs#totalValue -- keine zweite Formel).
// Seit Spec G4: unitPrice (1st-Ed-Preis fuer edition = 'first') x Zustandsfaktor.
//
// max_page ist die hoechste belegte Seite eines Behaelters (Spec 5.3: "die hoechste belegte Seite
// bestimmt die Anzeige") -- NULL, wenn kein lebendes Exemplar in einem darstellbaren Fach liegt
// (kein Ordner, oder ein leerer). Der Aufrufer zeigt dann eine (leere) erste Seite; einen
// ceil(copies_count / pockets_per_page)-Rueckfall gibt es NICHT mehr: er liess die Liste "2
// Seiten" melden, wo der aufgeschlagene Ordner "Seite 1 von 1" zeigte.
//
// Das CASE ist die SQL-Fassung von src/utils/binderGrid.js#isPlaced (Zwilling: BinderGrid.kt) und
// muss ihr Wort fuer Wort folgen -- sonst zaehlt die Liste Seiten, die das Raster nicht zeigen
// kann. Zwei Teile:
// - Seite >= 1 UND Fach >= 1 UND Fach <= Fachzahl: ein Fach jenseits der heutigen Ordnergroesse
//   (Rest einer frueheren, groesseren) ist im Raster unsichtbar und zaehlt darum auch hier nicht.
// - Die Zurechtrueckung der Fachzahl ist slotMath.js#clampPockets: alles, was nicht > 0 ist
//   (auch NULL), gilt als 4er-Ordner. In SQLite faellt eine NULL-Bedingung in den ELSE-Zweig.
// Kein zusaetzlicher Test auf ct.kind: Box und Deckbox haben keine Seiten, weil setCopyLocation
// page/slot dort gar nicht erst schreibt (und saveContainer sie beim Umstellen raeumt) -- isPlaced
// kennt die Behaelterart aus demselben Grund nicht.
function listContainers(db) {
  const rows = db.prepare(`
    SELECT ct.*,
           COUNT(cp.copy_id) AS copies_count,
           MAX(CASE WHEN cp.page >= 1 AND cp.slot >= 1
                     AND cp.slot <= (CASE WHEN ct.pockets_per_page > 0 THEN ct.pockets_per_page ELSE 4 END)
                    THEN cp.page END) AS max_page,
           COALESCE(SUM(${unitPriceCaseSql('c', 'cp')} * ${factorCaseSql('cp.condition')}), 0) AS value
      FROM containers ct
      LEFT JOIN card_copies cp ON cp.container_id = ct.container_id AND cp.deleted = 0
      LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code
                       AND c.language = cp.language AND c.rarity = cp.rarity AND c.deleted = 0
     WHERE ct.deleted = 0
     GROUP BY ct.container_id
     ORDER BY ct.sort_order, ct.name`).all();
  return rows.map((r) => ({ ...r, value: Math.round((r.value || 0) * 100) / 100 }));
}

const CONTAINER_KINDS = ['binder', 'box', 'deckbox'];
const BINDER_POCKETS = [4, 9, 12];

// Die Pruefung wohnt HIER, im Anwendungscode, nicht als CHECK in containers-schema.cjs: die
// containers-Tabelle ist in Supabase bereits von Hand angelegt, ein neues CHECK bräuchte dort
// eine zweite, von Hand nachzuziehende Migration -- und CREATE TABLE IF NOT EXISTS wuerde eine
// bereits bestehende lokale Tabelle ohnehin nicht mehr aendern. Der Helfer ist der Ort, an dem
// die Regel fuer jeden Aufrufer (Desktop, Sync, spaetere B2-Oberflaeche) gleichermassen gilt.
function saveContainer(db, { container_id, name, kind, pockets_per_page, color, sort_order }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new ValidationError('Der Behälter braucht einen Namen.');
  if (!CONTAINER_KINDS.includes(kind)) throw new ValidationError('Unbekannte Behälterart.');

  // Box und Deckbox haben keine Seiten: pockets_per_page wird verworfen, nicht abgelehnt --
  // dieselbe Bauart wie setCopyLocation es mit page/slot bei Nicht-Ordnern macht.
  let pockets = null;
  if (kind === 'binder') {
    const p = Number(pockets_per_page);
    if (!BINDER_POCKETS.includes(p)) throw new ValidationError('Ein Ordner hat 4, 9 oder 12 Fächer pro Seite.');
    pockets = p;
  }

  const data = {
    container_id: container_id || crypto.randomUUID(),
    name: cleanName,
    kind,
    pockets_per_page: pockets,
    color: color ?? null,
    sort_order: sort_order ?? 0,
  };
  if (container_id) {
    db.transaction(() => {
      const info = db.prepare(`UPDATE containers
                     SET name = @name, kind = @kind, pockets_per_page = @pockets_per_page,
                         color = @color, sort_order = @sort_order, updated_at = CURRENT_TIMESTAMP
                   WHERE container_id = @container_id AND deleted = 0`).run(data);
      if (info.changes === 0) throw new ValidationError('Behälter nicht gefunden.');
      // Wechselt die Art auf nicht-binder, tragen die Exemplare dieses Behaelters unter
      // Umstaenden noch Seite/Fach aus der Zeit, als er ein Ordner war -- setCopyLocation
      // verwirft page/slot nur bei EINEM einzelnen Exemplar in DEM Moment, in dem es geschrieben
      // wird, raeumt aber nichts bei den anderen nach. Ohne das hier zeigt der Standort-Chip
      // "S2 · F3" fuer eine Box, und stellt der Nutzer die Art zurueck auf binder, tauchen
      // Phantom-Belegungen in Faechern auf, in die nie jemand etwas gelegt hat.
      if (kind !== 'binder') {
        db.prepare(`UPDATE card_copies SET page = NULL, slot = NULL, updated_at = CURRENT_TIMESTAMP
                     WHERE container_id = ? AND (page IS NOT NULL OR slot IS NOT NULL)`).run(container_id);
      }
    })();
  } else {
    db.prepare(`INSERT INTO containers (container_id, name, kind, pockets_per_page, color, sort_order)
                VALUES (@container_id, @name, @kind, @pockets_per_page, @color, @sort_order)`).run(data);
  }
  return data.container_id;
}

module.exports = {
  ValidationError,
  defaults, listCopies, listAllCopies, groupCopies, addCopies, removeCopies, moveCopies, updateCopyGroup, softDeletePrinting,
  setCopyLocation, deleteCopy, setCopyTagsNote, listUnsortedCopies, listDeckCopies, listTags, listContainers, saveContainer,
  normalizeTagList, CONTAINER_KINDS, BINDER_POCKETS,
};
