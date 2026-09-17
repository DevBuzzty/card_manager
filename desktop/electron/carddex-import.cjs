// Spec F1 §3 -- Card-Dex-Import gegen die Datenbank: Stand fuer die Aufloesung laden, Vorschau-Sitzungen, Ausfuehrung in
// EINER Transaktion (ganz oder gar nicht) und das Protokoll. Die Regeln selbst stehen in carddex-resolve.cjs.
// cards.quantity und cards.deleted schreibt hier nichts: neue Printings entstehen ohne diese Spalten, die Trigger aus
// copies-schema.cjs zaehlen sie nach jedem Exemplar nach. Ersetzen loescht Exemplare nur weich.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const copies = require('./copies.cjs');
const { readCarddex, tagsOfCell } = require('./carddex-format.cjs');
const {
  printingKey, slotKey, resolveCarddexRows, previewHeaderText, replaceWarningText, importResultText,
} = require('./carddex-resolve.cjs');

function loadResolveContext(db, catalog) {
  const localCards = new Map();
  for (const c of db.prepare('SELECT id, name, type, image_url FROM cards ORDER BY deleted ASC').all()) {
    const id = String(c.id);
    if (!localCards.has(id)) localCards.set(id, { name: c.name ?? null, type: c.type ?? null, image_url: c.image_url ?? null });
  }
  const printings = new Map();
  for (const c of db.prepare('SELECT id, set_code, language, rarity FROM cards WHERE deleted = 0').all()) {
    printings.set(printingKey(c), { live: 0, located: 0 });
  }
  const occupied = new Map();
  const liveCopies = db.prepare(`SELECT card_id AS id, set_code, language, rarity, container_id, page, slot, tags
                                   FROM card_copies WHERE deleted = 0`).all();
  for (const cp of liveCopies) {
    const key = printingKey(cp);
    const p = printings.get(key);
    if (p) {
      p.live += 1;
      if (cp.container_id || tagsOfCell(cp.tags).length > 0) p.located += 1;
    }
    if (cp.container_id && cp.page != null && cp.slot != null) {
      const k = slotKey(cp.container_id, cp.page, cp.slot);
      if (!occupied.has(k)) occupied.set(k, new Set());
      occupied.get(k).add(key);
    }
  }
  const containers = db.prepare(`SELECT container_id, name, kind, pockets_per_page FROM containers
                                  WHERE deleted = 0 ORDER BY sort_order, name, container_id`).all();
  return { catalog: catalog || null, localCards, printings, containers, occupied, defaults: copies.defaults(db) };
}

// Eine offene Vorschau je Datei. `take` gibt die Sitzung genau einmal heraus -- ein zweiter Klick auf "Übernehmen"
// findet keine mehr (Busy-Schutz: better-sqlite3 arbeitet synchron, zwei IPC-Aufrufe laufen nacheinander, nie
// gleichzeitig; ohne das Verbrauchen liefe der zweite Aufruf nach dem ersten einfach noch einmal).
function createImportSessions() {
  const sessions = new Map();
  return {
    open(payload) {
      sessions.clear();
      const token = crypto.randomUUID();
      sessions.set(token, payload);
      return token;
    },
    peek: (token) => sessions.get(token) || null,
    take(token) {
      const s = sessions.get(token) || null;
      sessions.delete(token);
      return s;
    },
  };
}

// Vorschau fuer den Renderer: Zeilen, Zaehler und die fertigen Texte.
function previewOf(resolved) {
  return {
    rows: resolved.rows,
    summary: resolved.summary,
    headerText: previewHeaderText(resolved.summary),
    warningText: replaceWarningText(resolved.summary),
    catalogText: resolved.summary.catalogMissing ? 'Offline-Katalog fehlt' : null,
  };
}

// Datei gelesen -> Sitzung + Vorschau (Regel Hinzufuegen) | { error }.
function importOpen(db, sessions, { fileName, text }, catalog) {
  const read = readCarddex(text);
  if (!read.ok) return { error: read.text };
  const token = sessions.open({ fileName, rows: read.rows });
  return { token, fileName, preview: previewOf(resolveCarddexRows(read.rows, loadResolveContext(db, catalog), 'add')) };
}

function importResolve(db, sessions, { token, rule } = {}, catalog) {
  const s = sessions.peek(token);
  if (!s) return { error: 'Vorschau abgelaufen – Datei bitte neu öffnen.' };
  return { preview: previewOf(resolveCarddexRows(s.rows, loadResolveContext(db, catalog), rule)) };
}

const errorText = (e) => {
  if (e instanceof copies.ValidationError) return e.message;
  console.error('[import-run]', e);
  return 'Unerwarteter Datenbankfehler.';
};

// Schreibt die aufgeloesten Zeilen in EINER Transaktion. Wirft Error('Import fehlgeschlagen: Zeile N: …'), dann ist nichts
// geaendert. -> { imported, containersCreated, omitted, skipped }
function applyCarddexImport(db, resolved, { omitLines = [] } = {}) {
  const omit = new Set((omitLines || []).map(Number));
  const rule = resolved.summary.rule;
  const todo = resolved.rows.filter((r) => r.action === 'import');
  const insPrinting = db.prepare(`INSERT OR IGNORE INTO cards (id, set_code, language, rarity, name, type, image_url)
                                  VALUES (@id, @set_code, @language, @rarity, @name, @type, @image_url)`);
  const softDelete = db.prepare(`UPDATE card_copies SET deleted = 1, updated_at = CURRENT_TIMESTAMP
                                  WHERE card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0`);
  const insCopy = db.prepare(`INSERT INTO card_copies
      (copy_id, card_id, set_code, language, rarity, edition, condition, container_id, page, slot, tags, note)
      VALUES (@copy_id, @id, @set_code, @language, @rarity, @edition, @condition, @container_id, @page, @slot, @tags, @note)`);
  let line = null;
  try {
    return db.transaction(() => {
      const open = resolved.rows.find((r) => r.action === 'red' && !omit.has(r.line));
      if (open) { line = open.line; throw new copies.ValidationError('unbekannte Zeile zuerst auslassen'); }
      if (rule === 'replace') {
        const done = new Set();
        for (const r of todo) {
          const key = printingKey(r.printing);
          if (done.has(key)) continue;
          done.add(key);
          line = r.line;
          softDelete.run(r.printing);
        }
      }
      const created = new Map();
      let imported = 0;
      for (const r of todo) {
        line = r.line;
        let containerId = null;
        if (r.container && r.container.create) {
          containerId = created.get(r.container.name)
            ?? copies.saveContainer(db, { name: r.container.name, kind: r.container.kind, pockets_per_page: r.container.pockets_per_page });
          created.set(r.container.name, containerId);
        } else if (r.container) {
          containerId = r.container.container_id;
        }
        if (r.meta) insPrinting.run({ ...r.printing, name: r.meta.name, type: r.meta.type, image_url: r.meta.image_url });
        const copy = {
          ...r.printing, edition: r.edition, condition: r.condition, container_id: containerId, page: r.page, slot: r.slot,
          tags: r.tags.length ? JSON.stringify(r.tags) : null, note: r.note,
        };
        for (let i = 0; i < r.count; i += 1) insCopy.run({ ...copy, copy_id: crypto.randomUUID() });
        imported += r.count;
      }
      return {
        imported, containersCreated: created.size,
        omitted: resolved.rows.filter((r) => r.action === 'red').length,
        skipped: resolved.rows.filter((r) => r.action === 'skip-existing').length,
      };
    })();
  } catch (e) {
    throw new Error(`Import fehlgeschlagen: ${line != null ? `Zeile ${line}: ` : ''}${errorText(e)}`);
  }
}

const importLogName = (now) => `${now.toISOString().slice(0, 19).replace(/:/g, '-')}-carddex.json`;

function writeImportLog(dir, now, entry) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, importLogName(now));
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf8');
  return file;
}

// Der ganze Kanal import-run ohne Electron. deps = { catalog, logDir, now: Date, onChanged() }.
function importRun(db, sessions, { token, rule, omitLines } = {}, deps) {
  const session = sessions.take(token);
  if (!session) return { success: false, busy: true, error: 'Dieser Import läuft bereits oder ist abgeschlossen.' };
  const resolved = resolveCarddexRows(session.rows, loadResolveContext(db, deps.catalog), rule);
  let result;
  try {
    result = applyCarddexImport(db, resolved, { omitLines });
  } catch (e) {
    return { success: false, error: e.message };
  }
  const omit = new Set((omitLines || []).map(Number));
  let logFile = null;
  try {
    logFile = writeImportLog(deps.logDir, deps.now, {
      file: session.fileName, at: deps.now.toISOString(), rule: resolved.summary.rule, result,
      rows: resolved.rows.map((r) => ({
        line: r.line, status: r.status, action: r.action === 'red' && omit.has(r.line) ? 'omitted' : r.action,
        reasons: r.reasons, passcode: r.printing.id, set_code: r.printing.set_code, rarity: r.printing.rarity,
        language: r.printing.language, count: r.count, container: r.container ? r.container.name : null,
      })),
    });
  } catch (e) {
    console.error('[import-run] Protokoll nicht geschrieben:', e);
  }
  if (deps.onChanged) deps.onChanged();
  return { success: true, ...result, text: importResultText(result), logFile };
}

module.exports = {
  loadResolveContext, createImportSessions, importOpen, importResolve, applyCarddexImport, importLogName, writeImportLog, importRun,
};
