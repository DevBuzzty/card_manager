const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDatabase } = require('./database.cjs');
const copies = require('./copies.cjs');
const { tagsOfCell } = require('./carddex-format.cjs');
const { createImportSessions, importOpen, importResolve, importRun, importLogName } = require('./carddex-import.cjs');
const { buildExport, loadExportCopies, exportCount, exportResultText } = require('./collection-export.cjs');
const { deleteContainer } = require('./containers-schema.cjs');

// Spec F1 §6 -- import-run gegen eine echte SQLite-Datenbank mit dem vollen Schema aus database.cjs (Trigger inklusive).
function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carddex-'));
  const log = console.log;
  console.log = () => {};
  const db = initDatabase(dir);
  console.log = log;
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, dir };
}

const DM = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare' };
const DM_ALT = { id: '46986415', set_code: 'CT13-DE003', language: 'DE', rarity: 'Ultra Rare' };
const BEWD = { id: '89631139', set_code: 'SDK-DE001', language: 'DE', rarity: 'Ultra Rare' };
const POT = { id: '55144522', set_code: 'Unknown', language: 'DE', rarity: 'Unknown' };
const META = {
  46986414: { name: 'Dunkler Magier', type: 'Normal Monster', image: 'img-dm' },
  46986415: { name: 'Dunkler Magier', type: 'Normal Monster', image: 'img-dm2' },
  89631139: { name: 'Blauäugiger w. Drache', type: 'Normal Monster', image: 'img-bewd' },
  55144522: { name: 'Topf der Gier', type: 'Spell Card', image: 'img-pot' },
};
const catalog = { card: (p) => (META[p] ? { name_de: META[p].name, name_en: '', type: META[p].type, image: META[p].image } : null) };

function addPrinting(db, p, price = 1) {
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, type, image_url, price)
              VALUES (@id, @set_code, @language, @rarity, @name, @type, @image_url, @price)`)
    .run({ ...p, name: META[p.id].name, type: META[p.id].type, image_url: META[p.id].image, price });
}

// Sammlung mit Binder, Box, Tags, Notizen, Unknown-Printing und Artwork-Passcode.
function seedCollection(db) {
  for (const p of [DM, DM_ALT, BEWD, POT]) addPrinting(db, p, 5);
  const binder = copies.saveContainer(db, { name: 'Binder Blau', kind: 'binder', pockets_per_page: 9 });
  const box = copies.saveContainer(db, { name: 'Box Tausch', kind: 'box' });
  const place = (ids, loc, tags, note) => ids.forEach((copy_id) => {
    if (loc) copies.setCopyLocation(db, { copy_id, ...loc });
    if (tags || note) copies.setCopyTagsNote(db, { copy_id, tags: tags || [], note: note || null });
  });
  place(copies.addCopies(db, DM, { edition: 'first', condition: 'NM', count: 2 }), { container_id: binder, page: 1, slot: 1 }, ['Deck', 'Tausch']);
  place(copies.addCopies(db, DM, { edition: 'unknown', condition: 'EX', count: 1 }), null, null, 'Kante, "leicht" bestoßen\nzweite Zeile');
  place(copies.addCopies(db, BEWD, { edition: 'unlimited', condition: 'GD', count: 2 }), { container_id: box }, ['verkauf']);
  place(copies.addCopies(db, DM_ALT, { edition: 'limited', condition: 'PO', count: 1 }), { container_id: binder, page: 1, slot: 2 });
  copies.addCopies(db, POT, { edition: 'unknown', condition: 'NM', count: 1 });
  return { binder, box };
}

// Vergleichbare Sicht auf alle lebenden Exemplare (ohne copy_id und Behaelter-ID).
function copySignature(db) {
  return db.prepare(`SELECT cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition, cp.page, cp.slot, cp.tags, cp.note,
                            ct.name AS container, ct.kind, ct.pockets_per_page
                       FROM card_copies cp LEFT JOIN containers ct ON ct.container_id = cp.container_id AND ct.deleted = 0
                      WHERE cp.deleted = 0`).all()
    .map((r) => JSON.stringify({ ...r, tags: tagsOfCell(r.tags) }))
    .sort();
}
const quantities = (db) => db.prepare('SELECT id, set_code, rarity, quantity, deleted FROM cards ORDER BY id, set_code').all();
const deps = (dir, extra = {}) => ({ catalog, logDir: path.join(dir, 'imports'), now: new Date('2026-09-16T14:03:22Z'), ...extra });
const csv = (lines) => `carddex_version,passcode,name,set_code,rarity,language,count,edition,condition,container,container_kind,pockets_per_page,page,slot,tags,note\n${lines.join('\n')}\n`;

test('Rundlauf: Card-Dex-Export einer Sammlung, Import in eine leere Datenbank ergibt dieselben Exemplare', (t) => {
  const a = tempDb(t);
  seedCollection(a.db);
  const exported = buildExport(a.db, { format: 'carddex', scope: { kind: 'all' } });
  assert.equal(exported.count, 7);

  const b = tempDb(t);
  const sessions = createImportSessions();
  let changed = 0;
  const opened = importOpen(b.db, sessions, { fileName: 'carddex.csv', text: exported.content }, catalog);
  assert.equal(opened.preview.summary.red, 0);
  assert.equal(opened.preview.headerText, '5 Zeilen · 0 bereit · 5 mit Hinweis · 0 unbekannt · 2 Behälter werden angelegt');
  const res = importRun(b.db, sessions, { token: opened.token, rule: 'add', omitLines: [] }, deps(b.dir, { onChanged: () => { changed += 1; } }));
  assert.equal(res.success, true, res.error);
  assert.equal(res.text, '7 Exemplare importiert · 2 Behälter angelegt · 0 ausgelassen');
  assert.equal(changed, 1);
  assert.deepEqual(copySignature(b.db), copySignature(a.db));
  assert.deepEqual(quantities(b.db).map((r) => [r.id, r.set_code, r.quantity, r.deleted]), quantities(a.db).map((r) => [r.id, r.set_code, r.quantity, r.deleted]));
  const newCard = b.db.prepare('SELECT name, type, image_url, price FROM cards WHERE id = ?').get(DM_ALT.id);
  assert.deepEqual(newCard, { name: 'Dunkler Magier', type: 'Normal Monster', image_url: 'img-dm2', price: null }, 'Stammdaten aus dem Katalog, Preis kommt später');
  const log = JSON.parse(fs.readFileSync(res.logFile, 'utf8'));
  assert.equal(path.basename(res.logFile), '2026-09-16T14-03-22-carddex.json');
  assert.equal(log.file, 'carddex.csv');
  assert.equal(log.rows.length, 5);
});

test('Rollback: ein Fehler in Zeile N lässt die Datenbank unverändert und nennt die Zeile', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, BEWD);
  copies.addCopies(db, BEWD, { count: 1 });
  db.exec(`CREATE TRIGGER boom BEFORE INSERT ON card_copies WHEN NEW.note = 'BOOM' BEGIN SELECT RAISE(ABORT, 'kaputt'); END;`);
  const before = { sig: copySignature(db), q: quantities(db), containers: db.prepare('SELECT COUNT(*) AS n FROM containers').get().n };
  const sessions = createImportSessions();
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv([
    '1,46986414,,LOB-DE005,Ultra Rare,DE,2,first,NM,Neu,binder,9,1,1,,',
    '1,89631139,,SDK-DE001,Ultra Rare,DE,1,first,NM,,,,,,,',
    '1,55144522,,Unknown,Unknown,DE,1,unknown,NM,,,,,,,BOOM',
  ]) }, catalog);
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  const res = importRun(db, sessions, { token: opened.token, rule: 'replace' }, deps(dir));
  console.error = orig;
  assert.deepEqual(res, { success: false, error: 'Import fehlgeschlagen: Zeile 4: Unerwarteter Datenbankfehler.' });
  assert.ok(String(errors[0][1]).includes('kaputt'), 'Rohmeldung in der Konsole');
  assert.deepEqual(copySignature(db), before.sig);
  assert.deepEqual(quantities(db), before.q);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM containers').get().n, before.containers);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_copies WHERE deleted = 1").get().n, 0, 'Ersetzen zurückgerollt');
  assert.ok(!fs.existsSync(path.join(dir, 'imports')), 'kein Protokoll bei Fehler');
});

test('Ersetzen löscht nur weich: alte Exemplare bleiben als deleted = 1, Menge folgt der Datei', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, DM);
  const binder = copies.saveContainer(db, { name: 'Binder Blau', kind: 'binder', pockets_per_page: 9 });
  const old = copies.addCopies(db, DM, { edition: 'unknown', condition: 'NM', count: 3 });
  copies.setCopyLocation(db, { copy_id: old[0], container_id: binder, page: 1, slot: 1 });
  copies.setCopyTagsNote(db, { copy_id: old[1], tags: ['Deck'], note: null });
  const sessions = createImportSessions();
  const text = csv(['1,46986414,,LOB-DE005,Ultra Rare,DE,2,first,MT,Binder Blau,binder,9,1,1,,']);
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text }, catalog);
  assert.ok(opened.preview.rows[0].reasons.includes('Fach belegt – ohne Seite/Fach'), 'Hinzufügen: Fach belegt');
  const replace = importResolve(db, sessions, { token: opened.token, rule: 'replace' }, catalog).preview;
  assert.equal(replace.warningText, '3 vorhandene Exemplare werden ersetzt, davon 2 mit Standort oder Tags');
  assert.equal(replace.rows[0].status, 'green');
  const res = importRun(db, sessions, { token: opened.token, rule: 'replace' }, deps(dir));
  assert.equal(res.success, true, res.error);
  const rows = db.prepare('SELECT copy_id, deleted, edition, condition, page, slot FROM card_copies ORDER BY deleted DESC, copy_id').all();
  assert.equal(rows.length, 5, 'keine Zeile hart gelöscht');
  assert.deepEqual(rows.filter((r) => r.deleted === 1).map((r) => r.copy_id).sort(), [...old].sort());
  assert.deepEqual(rows.filter((r) => r.deleted === 0).map((r) => [r.edition, r.condition, r.page, r.slot]), [['first', 'MT', 1, 1], ['first', 'MT', 1, 1]]);
  assert.deepEqual(db.prepare('SELECT quantity, deleted FROM cards WHERE id = ?').get(DM.id), { quantity: 2, deleted: 0 });
});

test('Busy-Schutz: ein zweiter Aufruf mit derselben Vorschau importiert nichts', (t) => {
  const { db, dir } = tempDb(t);
  const sessions = createImportSessions();
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv(['1,46986414,,LOB-DE005,Ultra Rare,DE,3,first,NM,,,,,,,']) }, catalog);
  const first = importRun(db, sessions, { token: opened.token }, deps(dir));
  const second = importRun(db, sessions, { token: opened.token }, deps(dir));
  assert.equal(first.imported, 3);
  assert.deepEqual(second, { success: false, busy: true, error: 'Dieser Import läuft bereits oder ist abgeschlossen.' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 3);
  assert.deepEqual(importResolve(db, sessions, { token: opened.token, rule: 'add' }, catalog), { error: 'Vorschau abgelaufen – Datei bitte neu öffnen.' });
});

test('cards.quantity und cards.deleted schreibt der Import nie (Anweisungen mitgeschnitten)', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, BEWD);
  copies.addCopies(db, BEWD, { count: 2 });
  const sessions = createImportSessions();
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv([
    '1,46986414,,LOB-DE005,Ultra Rare,DE,1,first,NM,Neu,box,,,,,',
    '1,89631139,,SDK-DE001,Ultra Rare,DE,1,first,NM,,,,,,,',
  ]) }, catalog);
  const seen = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  const res = importRun(db, sessions, { token: opened.token, rule: 'replace' }, deps(dir));
  db.prepare = prepare;
  assert.equal(res.success, true, res.error);
  const writesCards = seen.filter((sql) => /\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE)\s+cards\b/i.test(sql));
  assert.ok(writesCards.length > 0, 'neues Printing wurde angelegt');
  for (const sql of writesCards) assert.ok(!/\b(quantity|deleted)\b/i.test(sql), sql);
  assert.deepEqual(db.prepare('SELECT id, quantity, deleted FROM cards ORDER BY id').all(),
    [{ id: '46986414', quantity: 1, deleted: 0 }, { id: '89631139', quantity: 1, deleted: 0 }]);
});

test('Rote Zeilen: ohne Auslassen kein Import, mit Auslassen importiert und im Protokoll; Überspringen lässt Vorhandenes', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, BEWD);
  copies.addCopies(db, BEWD, { count: 1 });
  const text = csv([
    '1,46986414,,LOB-DE005,Ultra Rare,DE,1,first,NM,,,,,,,',
    '1,12345678,,XXX-DE001,Common,DE,1,first,NM,,,,,,,',
    '1,89631139,,SDK-DE001,Ultra Rare,DE,5,first,NM,,,,,,,',
  ]);
  const sessions = createImportSessions();
  let opened = importOpen(db, sessions, { fileName: 'x.csv', text }, catalog);
  assert.deepEqual(importRun(db, sessions, { token: opened.token, rule: 'skip', omitLines: [] }, deps(dir)),
    { success: false, error: 'Import fehlgeschlagen: Zeile 3: unbekannte Zeile zuerst auslassen' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 1);

  opened = importOpen(db, sessions, { fileName: 'x.csv', text }, catalog);
  const res = importRun(db, sessions, { token: opened.token, rule: 'skip', omitLines: [3] }, deps(dir));
  assert.equal(res.text, '1 Exemplar importiert · 0 Behälter angelegt · 1 ausgelassen · 1 übersprungen');
  assert.deepEqual(db.prepare('SELECT id, quantity FROM cards ORDER BY id').all(), [{ id: '46986414', quantity: 1 }, { id: '89631139', quantity: 1 }]);
  const log = JSON.parse(fs.readFileSync(res.logFile, 'utf8'));
  assert.deepEqual(log.rows.map((r) => [r.line, r.action]), [[2, 'import'], [3, 'omitted'], [4, 'skip-existing']]);
  assert.equal(importLogName(new Date('2026-01-02T03:04:05.678Z')), '2026-01-02T03-04-05-carddex.json');
});

test('Datei nicht lesbar / fremdes Format / Offline-Katalog fehlt', (t) => {
  const { db } = tempDb(t);
  const sessions = createImportSessions();
  assert.deepEqual(importOpen(db, sessions, { fileName: 'x.csv', text: '' }, catalog), { error: 'Datei nicht lesbar' });
  assert.deepEqual(importOpen(db, sessions, { fileName: 'x.csv', text: 'a,b\n1,2\n' }, catalog), { error: 'Nur Card-Dex-CSV – andere Formate folgen' });
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv(['1,46986414,,LOB-DE005,Ultra Rare,DE,1,first,NM,,,,,,,']) }, null);
  assert.equal(opened.preview.catalogText, 'Offline-Katalog fehlt');
  assert.equal(opened.preview.rows[0].status, 'red');
});

test('Export-Umfang: ganze Sammlung, ein Behälter, aktueller Filter; Wantslist aus der Wunschliste; Ergebnistext', (t) => {
  const { db } = tempDb(t);
  const { binder } = seedCollection(db);
  assert.equal(loadExportCopies(db, { kind: 'all' }).length, 7);
  assert.equal(loadExportCopies(db, { kind: 'container', containerId: binder }).length, 3);
  const some = loadExportCopies(db).slice(0, 2).map((r) => r.copy_id);
  assert.deepEqual(loadExportCopies(db, { kind: 'copies', copyIds: [...some, 'weg'] }).map((r) => r.copy_id), some);
  const box = db.prepare("SELECT container_id FROM containers WHERE name = 'Box Tausch'").get().container_id;
  deleteContainer(db, box);
  assert.equal(loadExportCopies(db).filter((r) => r.container_id).length, 3, 'gelöschter Behälter zählt nicht');

  const sale = buildExport(db, { format: 'salelist', scope: { kind: 'all' } }, { now: new Date('2026-09-16T10:00:00Z') });
  assert.deepEqual([sale.count, sale.omitted, sale.defaultName], [6, 1, 'verkaufsliste-2026-09-16.txt']);
  assert.equal(exportResultText(sale), '6 Exemplare exportiert · 1 Exemplar ohne Set-Code weggelassen');
  const wants = buildExport(db, { format: 'wantslist' }, { wishlist: [{ card_id: '46986414', name: 'Dunkler Magier' }], nameEn: () => 'Dark Magician' });
  assert.deepEqual([wants.content, wants.count], ['1 Dark Magician\n', 1]);
  assert.equal(exportResultText(wants), '1 Wunsch exportiert');
  assert.equal(buildExport(db, { format: 'carddex', scope: { kind: 'copies', copyIds: [] } }).count, 0);
  assert.throws(() => buildExport(db, { format: 'pdf' }), /Unbekanntes Exportformat/);
});

// I1 -- export-count baut nicht mehr den ganzen Inhalt: exportCount liefert fuer alle Formate dieselbe Zahl wie
// buildExport(...).count, ohne CSV/Text zu bauen.
test('I1: exportCount zaehlt wie buildExport(...).count, fuer alle 5 Formate', (t) => {
  const { db } = tempDb(t);
  seedCollection(db);
  const wishlist = [{ card_id: '46986414', name: 'Dunkler Magier' }];
  for (const format of ['carddex', 'dragonshield', 'ygoprodeck', 'wantslist', 'salelist']) {
    const scope = { kind: 'all' };
    assert.equal(exportCount(db, { format, scope }, { wishlist }), buildExport(db, { format, scope }, { wishlist }).count, format);
  }
  assert.throws(() => exportCount(db, { format: 'pdf' }), /Unbekanntes Exportformat/);
});
