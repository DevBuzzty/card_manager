# Spec B1 — Behälter und Standort

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jedes Exemplar kann einem Behälter (Binder, Box, Deckbox) zugeordnet werden, mit Tags und Notiz — von Hand, auf beiden Geräten, mit Cloud-Sync.

**Architecture:** Eine neue Tabelle `containers` als dritter Sync-Strom neben `cards` und `card_copies`. Die Standortspalten am Exemplar existieren bereits (Spec A). Der Standort wird an genau einer Stelle geschrieben — dem Exemplar-Sheet — und an mehreren gelesen. Kein Fremdschlüssel, damit die Sync-Reihenfolge nie hart bricht; stattdessen räumt das Löschen eines Behälters seine Standorte in derselben Transaktion ab.

**Tech Stack:** Electron-Main CommonJS `.cjs` + better-sqlite3 12; Renderer React 19 / Vite (ESM) mit React Router und Tailwind; Android Kotlin 2.0 / Compose / OkHttp REST gegen Supabase; Supabase-SQL wendet der Nutzer von Hand im Dashboard an. Tests: `node:test`; SQLite-Tests unter Electrons Node.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-spec-b-binder-organisation-design.md` **in der Fassung des Nachtrags** `docs/superpowers/specs/2026-09-09-spec-b-nachtrag-b1-b2-und-einsortieren.md`. Bei Widerspruch gilt der Nachtrag.
- **B1 endet vor dem Scanner.** Kein Binder-Raster, kein Einsortier-Modus, keine `SlotMath`, keine Fach-Reservierung — das ist alles B2. Wer hier `ScanScreen.kt` anfasst, ist falsch abgebogen.
- **Die fünf Standortspalten existieren bereits** (`container_id`, `page`, `slot`, `tags`, `note` in `copies-schema.cjs`), und `sync.cjs` spiegelt sie schon (`COPY_COLS`, Zeile 13). **Nicht neu anlegen.** Es fehlt allein der Index.
- **Behälterarten sind wörtlich `binder`, `box`, `deckbox`.** `pockets_per_page` ist nur bei `binder` gesetzt und dann 4, 9 oder 12. Bei `box`/`deckbox` sind `page` und `slot` am Exemplar immer `NULL` — durchgesetzt im Code, nicht als Constraint.
- **„Nicht einsortiert" ist `container_id IS NULL`.** Kein Pseudo-Behälter, kein Systemeintrag.
- **Tags sind ein JSON-Array in einer Textspalte.** Kein eigenes Tabellenschema.
- **Printing-Identität bleibt der 4-Spalten-Schlüssel** `(id, set_code, language, rarity)`. `cards.quantity`/`deleted` sind triggergepflegte Caches und werden **nie** aus Anwendungscode geschrieben. Nur Soft-Delete, nie hartes `DELETE`.
- **Jeder IPC-Kanal muss in `desktop/electron/main.cjs` UND `desktop/electron/preload.cjs` stehen**, sonst kommt der Renderer nicht dran. Häufigste Fehlerquelle des Projekts.
- **Agenten führen kein SQL gegen Supabase aus und verbinden sich nicht dorthin.** SQL wird als Datei abgelegt; der Nutzer wendet sie im Dashboard an.
- **Jede benutzersichtbare Zeichenkette ist deutsch, mit echten Umlauten.** Niemals `ue`/`ae`/`oe` in sichtbarem Text. Yu-Gi-Oh-Begriffe bleiben englisch (Set-Code, Passcode, Rarity).
- Electron-Main bleibt CommonJS `.cjs`, der Renderer ESM. **Keine neue Abhängigkeit**, weder npm noch Gradle. **Niemals ein nacktes `npm install`.**
- Desktop-Lint-Baseline: **genau 5 Fehler**, ein sechster ist ein Fehlschlag.
- **Nie committen:** `android/local.properties`. Explizite Pfade stagen, **niemals `git add -A`**.
- Commit-Stil: `feat(desktop|android): …`, ein Commit pro Task, Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Testbefehle

| Was | Befehl (aus dem Repo-Wurzelverzeichnis) |
|---|---|
| SQLite-/Schema-Tests | `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/<datei>.test.cjs` |
| Reine Renderer-Module | `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs` |
| Desktop-Lint | `cd desktop && npm run lint` — Baseline **genau 5** |
| Kotlin-Unit-Tests | `cd android && ./gradlew :app:testDebugUnitTest` |
| Kotlin kompiliert | `cd android && ./gradlew :app:compileDebugKotlin` |

Die Verzeichnisform `node --test src/utils/` scheitert auf Node 24 mit `MODULE_NOT_FOUND` — immer die Glob-Form benutzen.

## File Structure

| Datei | Verantwortung |
|---|---|
| `desktop/electron/containers-schema.cjs` (neu) | `ensureContainersSchema(db)`: Tabelle `containers`, Standort-Index auf `card_copies`, und `deleteContainer(db, id)` als Transaktion (Soft-Delete + Standorte räumen). Nach dem Vorbild von `copies-schema.cjs`. |
| `desktop/electron/containers-schema.test.cjs` (neu) | Schema- und Transaktionstest unter Electrons Node. |
| `desktop/electron/database.cjs` | Ruft `ensureContainersSchema(db)` neben `ensureCopiesSchema(db)`. |
| `desktop/electron/sync.cjs` | Dritter Strom `containers`: `pullContainers`/`pushContainers`, Cursor, Echo-Skip, Zyklus-Reihenfolge. |
| `desktop/electron/copies.cjs` | Standort-, Tag- und Notiz-Helfer am Exemplar; Abfragen „nicht einsortiert" und „alle Tags". |
| `desktop/electron/main.cjs` + `preload.cjs` | Sieben IPC-Kanäle. |
| `supabase/containers_schema.sql` (neu) | Tabelle, RLS, `updated_at`-Trigger. Vom Nutzer im Dashboard anzuwenden. |
| `desktop/src/utils/tags.js` (neu) | Reines Modul: Tags aus dem JSON-Text lesen, schreiben, normalisieren. Zwilling zu Kotlins `Tags.kt`. |
| `desktop/src/utils/tags.test.js` (neu) | Sein Test. |
| `desktop/src/components/Binders.jsx` (neu) | Segment „Binder": Zähler „Nicht einsortiert", Behälterliste, Anlegen/Umbenennen/Löschen. |
| `desktop/src/components/CopySheet.jsx` (neu) | Exemplar-Sheet: Standort, Tags, Notiz. **Einzige Schreibstelle** für Tags und Notiz. |
| `desktop/src/utils/routes.js`, `components/SammlungLayout.jsx`, `App.jsx` | Segment und Route „Binder". |
| `desktop/src/components/CardDetailPanel.jsx` | Standort-Chip und Tag-Chips je Exemplar, Sprung ins Exemplar-Sheet. |
| `desktop/src/components/CollectionList.jsx` | Filter Behälter und Tag; Standort-Chip in der Zeile, wenn ein Behälterfilter aktiv ist. |
| `desktop/src/components/Start.jsx` | Zähler „Nicht einsortiert" mit Sprung. |
| `android/.../cloud/ContainersRepository.kt` (neu) | Behälter lesen/schreiben/löschen über REST, nach dem Muster von `DecksRepository`. |
| `android/.../cloud/CopyRow.kt` | Fünf Felder ergänzt. |
| `android/.../ml/Tags.kt` (neu) | Kotlin-Zwilling von `tags.js`. Rein, getestet. |
| `android/.../ui/BindersScreen.kt` (neu) | Segment „Binder" am Handy. |
| `android/.../ui/CopySheet.kt` (neu) | Exemplar-Sheet am Handy. |
| `android/.../cloud/CollectionRepository.kt` | Standort-/Tag-Patches, Abfrage „nicht einsortiert", Tag-Liste. |
| `android/.../ui/CardDetailScreen.kt`, `CollectionScreen.kt`, `StartScreen.kt` | Chip, Filter, Zähler. |

## Aufgabenreihenfolge und ihre Begründung

1. **Task 1** legt Schema und Löschregel hin — alles Weitere setzt die Tabelle voraus.
2. **Task 2** bringt sie in den Sync, bevor irgendein Gerät Daten erzeugt. Andersherum entstünden Behälter, die nie ankommen.
3. **Task 3** ist die reine Regel für Tags, in beiden Sprachen — sie wird von vier späteren Tasks benutzt.
4. **Task 4** liefert die Schreibwege (IPC), auf die die gesamte Desktop-Oberfläche zugreift.
5. **Tasks 5–7** bauen den Desktop: Segment, Exemplar-Sheet, dann Lesestellen.
6. **Tasks 8–10** bauen das Handy in derselben Reihenfolge.

---

### Task 1: Tabelle `containers`, Standort-Index und Löschregel

**Files:**
- Create: `desktop/electron/containers-schema.cjs`
- Create: `desktop/electron/containers-schema.test.cjs`
- Create: `supabase/containers_schema.sql`
- Modify: `desktop/electron/database.cjs` (neben dem vorhandenen `ensureCopiesSchema(db)`, ca. Zeile 277)

**Interfaces:**
- Consumes: nichts.
- Produces:
  ```js
  ensureContainersSchema(db)                    // idempotent, bei jedem Start
  deleteContainer(db, containerId) -> number    // Anzahl geräumter Exemplare
  CONTAINER_COLS                                // Spaltenliste, von Task 2 benutzt
  ```

**Hintergrund für den Umsetzenden.** Dieses Projekt legt Schemaänderungen **additiv und idempotent** an: `CREATE TABLE IF NOT EXISTS`, Spalten über `ALTER TABLE` in einem `try/catch`, alles bei jedem Start ausgeführt. Vorbild ist `desktop/electron/copies-schema.cjs` — lies es zuerst, besonders wie es Spalten nachrüstet und wie es Trigger anlegt. Die Datenbank liegt unter `userData/cards.db`.

**Wichtig:** Die fünf Standortspalten an `card_copies` sind **bereits vorhanden**. Du legst sie nicht an. Es fehlt nur der Index.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Datei `desktop/electron/containers-schema.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema, deleteContainer } = require('./containers-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown',
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,
    PRIMARY KEY (id, set_code, language, rarity));`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  return db;
}

const insertContainer = (db, id, name, kind = 'binder', pockets = 9) =>
  db.prepare(`INSERT INTO containers (container_id, name, kind, pockets_per_page)
              VALUES (?, ?, ?, ?)`).run(id, name, kind, pockets);

const insertCopy = (db, copyId, containerId, page, slot) =>
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, container_id, page, slot)
              VALUES (?, '46986414', 'LOB-DE005', 'DE', 'Common', ?, ?, ?)`)
    .run(copyId, containerId, page, slot);

test('ensureContainersSchema ist idempotent', () => {
  const db = freshDb();
  ensureContainersSchema(db);   // zweimal aufrufen darf nicht werfen
  const cols = db.prepare('PRAGMA table_info(containers)').all().map(c => c.name);
  for (const c of ['container_id', 'name', 'kind', 'pockets_per_page', 'color',
                   'sort_order', 'created_at', 'updated_at', 'deleted']) {
    assert.ok(cols.includes(c), 'Spalte fehlt: ' + c);
  }
});

test('kind ist auf die drei erlaubten Werte beschraenkt', () => {
  const db = freshDb();
  assert.throws(() => insertContainer(db, 'c1', 'Falsch', 'karton', null));
});

test('der Standort-Index auf card_copies existiert', () => {
  const db = freshDb();
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='card_copies'")
    .all().map(r => r.name);
  assert.ok(idx.includes('card_copies_location_idx'), 'Index fehlt: ' + idx.join(', '));
});

test('deleteContainer raeumt die Standorte seiner Exemplare ab', () => {
  const db = freshDb();
  insertContainer(db, 'c1', 'Blau');
  insertCopy(db, 'k1', 'c1', 3, 7);
  insertCopy(db, 'k2', 'c1', 3, 8);
  insertCopy(db, 'k3', null, null, null);

  const geraeumt = deleteContainer(db, 'c1');
  assert.equal(geraeumt, 2);

  const row = db.prepare('SELECT deleted FROM containers WHERE container_id = ?').get('c1');
  assert.equal(row.deleted, 1, 'Behaelter muss soft-geloescht sein, nicht entfernt');

  const copies = db.prepare('SELECT copy_id, container_id, page, slot FROM card_copies ORDER BY copy_id').all();
  for (const c of copies) {
    assert.equal(c.container_id, null);
    assert.equal(c.page, null);
    assert.equal(c.slot, null);
  }
});

test('deleteContainer stempelt updated_at auf beiden Seiten neu', () => {
  const db = freshDb();
  insertContainer(db, 'c1', 'Blau');
  insertCopy(db, 'k1', 'c1', 1, 1);
  db.prepare("UPDATE containers SET updated_at = '2000-01-01 00:00:00' WHERE container_id = 'c1'").run();
  db.prepare("UPDATE card_copies SET updated_at = '2000-01-01 00:00:00' WHERE copy_id = 'k1'").run();

  deleteContainer(db, 'c1');

  const c = db.prepare('SELECT updated_at FROM containers WHERE container_id = ?').get('c1');
  const k = db.prepare('SELECT updated_at FROM card_copies WHERE copy_id = ?').get('k1');
  assert.notEqual(c.updated_at, '2000-01-01 00:00:00', 'Behaelter wuerde sonst nie gepusht');
  assert.notEqual(k.updated_at, '2000-01-01 00:00:00', 'Exemplar wuerde sonst nie gepusht');
});

test('deleteContainer eines unbekannten Behaelters tut nichts und wirft nicht', () => {
  const db = freshDb();
  assert.equal(deleteContainer(db, 'gibtsnicht'), 0);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/containers-schema.test.cjs`
Expected: FAIL — `Cannot find module './containers-schema.cjs'`.

- [ ] **Step 3: Das Schema schreiben**

Datei `desktop/electron/containers-schema.cjs`:

```js
// Behaelter (Binder, Box, Deckbox) und der Standort eines Exemplars darin.
//
// Die fuenf Standortspalten an card_copies (container_id, page, slot, tags, note) legt bereits
// copies-schema.cjs an -- der Spec-A-Plan hat die spec-uebergreifenden Spalten vorgezogen. Hier
// fehlt nur noch der Index darauf.
//
// KEIN Fremdschluessel von card_copies auf containers: der Sync zieht beide Stroeme getrennt, und
// ein Exemplar darf waehrend eines Zyklus kurz auf einen noch nicht angekommenen Behaelter zeigen.
// Die Aufraeumpflicht traegt stattdessen deleteContainer.

const CONTAINER_COLS = [
  'container_id', 'name', 'kind', 'pockets_per_page', 'color',
  'sort_order', 'created_at', 'updated_at', 'deleted',
];

function ensureContainersSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS containers (
      container_id     TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      kind             TEXT NOT NULL CHECK (kind IN ('binder','box','deckbox')),
      pockets_per_page INTEGER,
      color            TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS card_copies_location_idx
      ON card_copies (container_id, page, slot);
  `);
}

/**
 * Loescht einen Behaelter weich UND setzt die Standorte aller seiner Exemplare zurueck --
 * in EINER Transaktion, damit nie ein Exemplar auf einen geloeschten Behaelter zeigt.
 *
 * Beide Seiten bekommen ein frisches updated_at, sonst wuerde der Sync die Aenderung nie
 * abholen: er zieht ueber `updated_at > cursor`.
 *
 * @returns Anzahl der Exemplare, deren Standort geraeumt wurde.
 */
function deleteContainer(db, containerId) {
  return db.transaction(() => {
    const info = db.prepare(`
      UPDATE card_copies
         SET container_id = NULL, page = NULL, slot = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE container_id = ?`).run(containerId);
    db.prepare(`
      UPDATE containers
         SET deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE container_id = ?`).run(containerId);
    return info.changes;
  })();
}

module.exports = { ensureContainersSchema, deleteContainer, CONTAINER_COLS };
```

- [ ] **Step 4: In `database.cjs` einhängen**

In `desktop/electron/database.cjs` beim Import (Zeile 4) ergänzen und direkt hinter dem vorhandenen `ensureCopiesSchema(db);` (ca. Zeile 277) aufrufen:

```js
const { ensureContainersSchema } = require('./containers-schema.cjs');
```

```js
        ensureCopiesSchema(db);
        ensureContainersSchema(db);
```

Die Reihenfolge ist bindend: der Index liegt auf `card_copies`, die Tabelle muss also stehen.

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/containers-schema.test.cjs`
Expected: PASS, 6 Tests.

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs`
Expected: PASS, 7 Tests — die vorhandenen bleiben grün.

- [ ] **Step 6: Das Supabase-SQL schreiben**

Datei `supabase/containers_schema.sql`. **Nicht ausführen** — der Nutzer wendet sie im Dashboard an. Halte dich an das Muster der vorhandenen Dateien in `supabase/` (RLS über `auth.uid()`, `updated_at` server-gestempelt, `deleted boolean`):

```sql
-- Spec B1: Behaelter (Binder, Box, Deckbox). Gegenstueck zu desktop/electron/containers-schema.cjs.
-- Vom Nutzer im Supabase-Dashboard anzuwenden.

create table if not exists public.containers (
  container_id     text primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  kind             text not null check (kind in ('binder','box','deckbox')),
  pockets_per_page integer,
  color            text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);

create index if not exists containers_user_updated_idx
  on public.containers (user_id, updated_at);

alter table public.containers enable row level security;

drop policy if exists "containers sind privat" on public.containers;
create policy "containers sind privat" on public.containers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at wird IMMER serverseitig gestempelt: der Cursor des Clients liest gegen diese
-- Spalte, ein vom Client mitgeschickter Wert koennte einen Pull ueberspringen lassen.
create or replace function public.touch_containers_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists containers_touch_updated_at on public.containers;
create trigger containers_touch_updated_at
  before insert or update on public.containers
  for each row execute function public.touch_containers_updated_at();

-- Der Standort-Index auf card_copies. Die fuenf Spalten selbst existieren bereits (Spec A).
create index if not exists card_copies_location_idx
  on public.card_copies (container_id, page, slot);
```

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/containers-schema.cjs desktop/electron/containers-schema.test.cjs desktop/electron/database.cjs supabase/containers_schema.sql
git commit -m "feat(desktop): Tabelle containers, Standort-Index und Loeschregel"
```

---

### Task 2: Behälter in den Sync aufnehmen

**Files:**
- Modify: `desktop/electron/sync.cjs` (Spaltenlisten ca. Zeile 13, Mapper ca. 48–91, Zyklus ca. 266–280)
- Modify: `desktop/electron/test-sync.cjs`

**Interfaces:**
- Consumes: `CONTAINER_COLS` aus `containers-schema.cjs` (Task 1).
- Produces: nichts, was ein späterer Task aufruft — aber ohne diesen Task erreichen Behälter das Handy nie.

**Hintergrund.** `sync.cjs` führt heute zwei Ströme: `cards` und `card_copies`. Jeder hat ein Cursor-Paar in `settings` (`sync_copies_last_pull` / `sync_copies_last_push`), einen Mapper in beide Richtungen (`copyToRemote` / `remoteToLocalCopy`), eine Anwenderfunktion (`applyRemoteCopy`) und eine **Echo-Sperre**: was der Desktop gerade gepusht hat, merkt er sich in `recentlyPushedCopies`, damit der nächste Pull seine eigene Änderung nicht erneut anwendet. Lies `pullCopies`/`pushCopies` (Zeile 207–239) — dein Strom ist deren Zwilling.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ergänze in `desktop/electron/test-sync.cjs` — halte dich an die dort vorhandene Test- und Attrappen-Bauart:

```js
test('Behaelter werden VOR Exemplaren gezogen und gepusht', async () => {
  // Ein Exemplar darf nie auf einen Behaelter zeigen, den es lokal noch nicht gibt.
  const reihenfolge = [];
  const sync = makeSyncWithSpy(reihenfolge);   // Attrappe protokolliert die Aufrufnamen
  await sync.cycle();
  const iPullC = reihenfolge.indexOf('pullContainers');
  const iPullK = reihenfolge.indexOf('pullCopies');
  const iPushC = reihenfolge.indexOf('pushContainers');
  const iPushK = reihenfolge.indexOf('pushCopies');
  assert.ok(iPullC >= 0 && iPullC < iPullK, 'pullContainers muss vor pullCopies laufen');
  assert.ok(iPushC >= 0 && iPushC < iPushK, 'pushContainers muss vor pushCopies laufen');
});

test('ein gepushter Behaelter wird beim naechsten Pull nicht erneut angewandt', () => {
  // Echo-Sperre wie bei den Kopien: gleicher container_id UND gleiches updated_at -> ueberspringen.
  const db = freshSyncDb();
  const sync = makeSync(db);
  sync._recentlyPushedContainers.set('c1', '2026-09-09T10:00:00Z');
  const applied = sync._applyPulledContainers([
    { container_id: 'c1', name: 'Blau', kind: 'binder', updated_at: '2026-09-09T10:00:00Z' },
  ]);
  assert.equal(applied, 0);
  assert.equal(sync._recentlyPushedContainers.has('c1'), false, 'Echo-Eintrag muss verbraucht sein');
});

test('ein fremd geaenderter Behaelter wird angewandt', () => {
  const db = freshSyncDb();
  const sync = makeSync(db);
  sync._recentlyPushedContainers.set('c1', '2026-09-09T10:00:00Z');
  const applied = sync._applyPulledContainers([
    { container_id: 'c1', name: 'Blau neu', kind: 'binder', updated_at: '2026-09-09T11:00:00Z' },
  ]);
  assert.equal(applied, 1);
  assert.equal(db.prepare('SELECT name FROM containers WHERE container_id = ?').get('c1').name, 'Blau neu');
});

test('deleted kommt als Boolean und wird lokal zu 0/1', () => {
  const db = freshSyncDb();
  const sync = makeSync(db);
  sync._applyPulledContainers([
    { container_id: 'c1', name: 'Blau', kind: 'binder', deleted: true, updated_at: '2026-09-09T10:00:00Z' },
  ]);
  assert.equal(db.prepare('SELECT deleted FROM containers WHERE container_id = ?').get('c1').deleted, 1);
});
```

Die Hilfsfunktionen `makeSync`, `makeSyncWithSpy` und `freshSyncDb` baust du nach dem Vorbild der bereits in `test-sync.cjs` vorhandenen Attrappen. Wenn die Datei die Innereien nicht hergibt, exportiere `_recentlyPushedContainers` und `_applyPulledContainers` aus `startSync` — dasselbe Muster, das die vorhandenen Tests für die Kopien nutzen; passe dich an, was dort schon existiert, statt eine zweite Bauart einzuführen.

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/test-sync.cjs`
Expected: FAIL — die vier neuen Tests schlagen fehl, die vorhandenen bleiben grün.

- [ ] **Step 3: Den Strom schreiben**

In `sync.cjs` neben den vorhandenen Spaltenlisten:

```js
const { CONTAINER_COLS } = require('./containers-schema.cjs');
const CONTAINER_BOOLS = new Set(['deleted']);

function containerToRemote(row) {
  const out = {};
  for (const c of CONTAINER_COLS) out[c] = CONTAINER_BOOLS.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalContainer(r) {
  const out = {};
  for (const c of CONTAINER_COLS) out[c] = CONTAINER_BOOLS.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  out.container_id = String(r.container_id);
  out.name = out.name || 'Ohne Namen';
  out.kind = out.kind || 'box';
  out.sort_order = out.sort_order ?? 0;
  return out;
}
function applyRemoteContainer(db, r) {
  const l = remoteToLocalContainer(r);
  const cur = db.prepare('SELECT * FROM containers WHERE container_id = ?').get(l.container_id);
  if (!cur) {
    db.prepare(`INSERT INTO containers (${CONTAINER_COLS.join(',')})
                VALUES (${CONTAINER_COLS.map(c => '@' + c).join(',')})`).run(l);
    return;
  }
  const changed = CONTAINER_COLS.some(c => c !== 'container_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  const sets = CONTAINER_COLS.filter(c => c !== 'container_id').map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE containers SET ${sets} WHERE container_id = @container_id`).run(l);
}
```

Und die beiden Stromfunktionen, wörtlich nach dem Vorbild von `pullCopies`/`pushCopies` (Zeile 207–239), mit `recentlyPushedContainers` als eigener Echo-Sperre und den Cursorn `sync_containers_last_pull` / `sync_containers_last_push`.

- [ ] **Step 4: Die Zyklus-Reihenfolge ändern**

In `cycle()` (ca. Zeile 266) die Reihenfolge aus Spec §8 herstellen:

```js
      const pulled = await pull(c);
      const pulledContainers = await pullContainers(c);   // VOR den Kopien
      const pulledCopies = await pullCopies(c);
      await push(c);
      await pushContainers(c);                            // VOR den Kopien
      await pushCopies(c);
      await pushPriceHistory(c);
```

Der Kommentar dazu gehört in den Code: **Behälter zuerst, damit ein ankommendes Exemplar nie auf einen lokal unbekannten Behälter zeigt.** Wer die Reihenfolge später umstellt, bricht genau das.

Trage `pulledContainers` in dieselbe Ergebnismeldung ein, in der `pulled` und `pulledCopies` schon gemeldet werden.

- [ ] **Step 5: Tests laufen lassen**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/test-sync.cjs`
Expected: PASS, die vier neuen plus alle vorhandenen.

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/test-sync-copies.cjs`
Expected: PASS — der Kopien-Strom bleibt unberührt.

Run: `cd desktop && npm run lint`
Expected: **genau 5** Fehler.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/test-sync.cjs
git commit -m "feat(desktop): Behaelter als dritter Sync-Strom, vor den Exemplaren"
```

---

### Task 3: Tags als reine Regel, in beiden Sprachen

**Files:**
- Create: `desktop/src/utils/tags.js`
- Create: `desktop/src/utils/tags.test.js`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/Tags.kt`
- Test: `android/app/src/test/java/com/example/yugiohscanner/TagsTest.kt`

**Interfaces:**
- Consumes: nichts.
- Produces:
  ```js
  parseTags(text) -> string[]        // null/kaputt/kein Array -> []
  serializeTags(list) -> string|null // leer -> null, sonst JSON-Array
  addTag(list, tag) -> string[]
  removeTag(list, tag) -> string[]
  ```
  ```kotlin
  Tags.parse(text: String?): List<String>
  Tags.serialize(list: List<String>): String?
  Tags.add(list: List<String>, tag: String): List<String>
  Tags.remove(list: List<String>, tag: String): List<String>
  ```

**Warum zweimal.** Tags werden auf beiden Geräten gelesen und geschrieben, und die Spalte ist Text. Weichen die Fassungen ab, entstehen Einträge, die die jeweils andere Seite nicht wiederfindet — dasselbe Muster wie `ScanAggregator.kt` / `scanAggregate.js` aus D4. **Beide Dateien nennen einander im Kopfkommentar mit Pfad und dem Satz „Wer hier etwas ändert, ändert dort mit."**

**Die Regeln, für beide Fassungen identisch:**
- Eingabe `null`, leer, kein gültiges JSON oder kein Array → leere Liste. Niemals werfen.
- Elemente, die keine Zeichenketten sind, werden verworfen.
- Jeder Tag wird an den Rändern beschnitten; leere Tags fallen weg.
- Doppelte werden entfernt, **Groß-/Kleinschreibung ignoriert** („Tausch" und „tausch" sind derselbe Tag); es gewinnt die zuerst gesehene Schreibweise.
- Die Reihenfolge bleibt die Einfügereihenfolge — nicht sortieren, der Nutzer hat sie so angelegt.
- `serialize` einer leeren Liste ergibt `null`, nicht `"[]"` — damit „keine Tags" in der Datenbank genau eine Darstellung hat.

- [ ] **Step 1: Den fehlschlagenden JavaScript-Test schreiben**

Datei `desktop/src/utils/tags.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTags, serializeTags, addTag, removeTag } from './tags.js';

test('parseTags vertraegt null, leer und Unsinn', () => {
  for (const bad of [null, undefined, '', '   ', 'kein json', '{"a":1}', '42', '"text"']) {
    assert.deepEqual(parseTags(bad), [], 'fiel um bei: ' + String(bad));
  }
});

test('parseTags liest ein Array und wirft Nicht-Zeichenketten weg', () => {
  assert.deepEqual(parseTags('["Kratzer", 7, null, "Tausch Max"]'), ['Kratzer', 'Tausch Max']);
});

test('parseTags beschneidet und entfernt Leere', () => {
  assert.deepEqual(parseTags('["  Kratzer  ", "   ", "Tausch"]'), ['Kratzer', 'Tausch']);
});

test('parseTags entfernt Doppelte ohne Ruecksicht auf Gross-Kleinschreibung, erste Schreibweise gewinnt', () => {
  assert.deepEqual(parseTags('["Tausch", "tausch", "TAUSCH"]'), ['Tausch']);
});

test('parseTags behaelt die Einfuegereihenfolge', () => {
  assert.deepEqual(parseTags('["Zebra", "Anton"]'), ['Zebra', 'Anton']);
});

test('serializeTags gibt bei leerer Liste null, nicht "[]"', () => {
  assert.equal(serializeTags([]), null);
  assert.equal(serializeTags(null), null);
});

test('serializeTags und parseTags sind zueinander invers', () => {
  const list = ['Kratzer', 'Tausch Max'];
  assert.deepEqual(parseTags(serializeTags(list)), list);
});

test('addTag haengt an, beschneidet und ignoriert Doppelte', () => {
  assert.deepEqual(addTag(['Kratzer'], '  Tausch '), ['Kratzer', 'Tausch']);
  assert.deepEqual(addTag(['Tausch'], 'tausch'), ['Tausch']);
  assert.deepEqual(addTag(['Tausch'], '   '), ['Tausch']);
});

test('removeTag entfernt ohne Ruecksicht auf Gross-Kleinschreibung', () => {
  assert.deepEqual(removeTag(['Kratzer', 'Tausch'], 'TAUSCH'), ['Kratzer']);
  assert.deepEqual(removeTag(['Kratzer'], 'gibtsnicht'), ['Kratzer']);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd desktop && node --test src/utils/tags.test.js`
Expected: FAIL — `Cannot find module './tags.js'`.

- [ ] **Step 3: Das JavaScript-Modul schreiben**

Datei `desktop/src/utils/tags.js`:

```js
// Spec B1: Tags eines Exemplars. Die Spalte card_copies.tags ist Text und traegt ein JSON-Array.
//
// Die Kotlin-Fassung derselben Regeln steht in
// android/app/src/main/java/com/example/yugiohscanner/ml/Tags.kt.
// Dass es sie zweimal gibt, ist Absicht -- beide Geraete lesen und schreiben dieselbe Spalte.
// Wer hier etwas aendert, aendert dort mit, sonst entstehen Eintraege, die die andere Seite
// nicht wiederfindet.
//
// Nie werfen: der Inhalt der Spalte stammt aus der Cloud und kann alles sein. Eine kaputte
// Zelle darf hoechstens "keine Tags" bedeuten, niemals eine leere Kartenansicht.

const norm = (t) => String(t).trim();
const key = (t) => norm(t).toLowerCase();

export function parseTags(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = norm(item);
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(t);
  }
  return out;
}

export function serializeTags(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return JSON.stringify(list);
}

export function addTag(list, tag) {
  const cur = Array.isArray(list) ? list : [];
  const t = norm(tag ?? '');
  if (!t || cur.some(x => key(x) === key(t))) return cur;
  return [...cur, t];
}

export function removeTag(list, tag) {
  const cur = Array.isArray(list) ? list : [];
  const k = key(tag ?? '');
  return cur.filter(x => key(x) !== k);
}
```

- [ ] **Step 4: JavaScript-Tests laufen lassen**

Run: `cd desktop && node --test src/utils/tags.test.js`
Expected: PASS, 9 Tests.

Run: `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs`
Expected: PASS — die vorhandenen 37 bleiben grün, plus die neuen.

- [ ] **Step 5: Den fehlschlagenden Kotlin-Test schreiben**

Datei `android/app/src/test/java/com/example/yugiohscanner/TagsTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.Tags
import org.junit.Assert.assertEquals
import org.junit.Test

class TagsTest {

    @Test fun `parse vertraegt null leer und Unsinn`() {
        for (bad in listOf(null, "", "   ", "kein json", """{"a":1}""", "42", "\"text\"")) {
            assertEquals("fiel um bei: $bad", emptyList<String>(), Tags.parse(bad))
        }
    }

    @Test fun `parse liest ein Array und wirft Nicht-Zeichenketten weg`() {
        assertEquals(listOf("Kratzer", "Tausch Max"), Tags.parse("""["Kratzer", 7, null, "Tausch Max"]"""))
    }

    @Test fun `parse beschneidet und entfernt Leere`() {
        assertEquals(listOf("Kratzer", "Tausch"), Tags.parse("""["  Kratzer  ", "   ", "Tausch"]"""))
    }

    @Test fun `parse entfernt Doppelte ohne Ruecksicht auf Gross-Kleinschreibung`() {
        assertEquals(listOf("Tausch"), Tags.parse("""["Tausch", "tausch", "TAUSCH"]"""))
    }

    @Test fun `parse behaelt die Einfuegereihenfolge`() {
        assertEquals(listOf("Zebra", "Anton"), Tags.parse("""["Zebra", "Anton"]"""))
    }

    @Test fun `serialize gibt bei leerer Liste null`() {
        assertEquals(null, Tags.serialize(emptyList()))
    }

    @Test fun `serialize und parse sind zueinander invers`() {
        val list = listOf("Kratzer", "Tausch Max")
        assertEquals(list, Tags.parse(Tags.serialize(list)))
    }

    @Test fun `add haengt an beschneidet und ignoriert Doppelte`() {
        assertEquals(listOf("Kratzer", "Tausch"), Tags.add(listOf("Kratzer"), "  Tausch "))
        assertEquals(listOf("Tausch"), Tags.add(listOf("Tausch"), "tausch"))
        assertEquals(listOf("Tausch"), Tags.add(listOf("Tausch"), "   "))
    }

    @Test fun `remove entfernt ohne Ruecksicht auf Gross-Kleinschreibung`() {
        assertEquals(listOf("Kratzer"), Tags.remove(listOf("Kratzer", "Tausch"), "TAUSCH"))
        assertEquals(listOf("Kratzer"), Tags.remove(listOf("Kratzer"), "gibtsnicht"))
    }
}
```

- [ ] **Step 6: Kotlin-Test laufen lassen und Fehlschlag bestätigen**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*TagsTest*'`
Expected: FAIL — `Unresolved reference: Tags`.

- [ ] **Step 7: Das Kotlin-Modul schreiben**

Datei `android/app/src/main/java/com/example/yugiohscanner/ml/Tags.kt`. Benutze `org.json.JSONArray` — es ist Teil des Android-Frameworks, es kommt **keine** neue Abhängigkeit dazu:

```kotlin
package com.example.yugiohscanner.ml

import org.json.JSONArray

/**
 * Spec B1: Tags eines Exemplars. Die Spalte `card_copies.tags` ist Text und traegt ein JSON-Array.
 *
 * Die JavaScript-Fassung derselben Regeln steht in `desktop/src/utils/tags.js`. Dass es sie
 * zweimal gibt, ist Absicht -- beide Geraete lesen und schreiben dieselbe Spalte. Wer hier etwas
 * aendert, aendert dort mit, sonst entstehen Eintraege, die die andere Seite nicht wiederfindet.
 *
 * Wirft nie: der Inhalt der Spalte stammt aus der Cloud und kann alles sein. Eine kaputte Zelle
 * darf hoechstens "keine Tags" bedeuten, niemals eine leere Kartenansicht.
 */
object Tags {

    private fun key(t: String) = t.trim().lowercase()

    fun parse(text: String?): List<String> {
        val raw = runCatching { JSONArray(text ?: "") }.getOrNull() ?: return emptyList()
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for (i in 0 until raw.length()) {
            // opt(i) liefert bei Zahlen und Objekten kein String -- die fallen hier heraus.
            val item = raw.opt(i) as? String ?: continue
            val t = item.trim()
            if (t.isEmpty() || !seen.add(key(t))) continue
            out.add(t)
        }
        return out
    }

    /** Leere Liste -> null, nicht "[]": "keine Tags" hat in der Datenbank genau eine Darstellung. */
    fun serialize(list: List<String>): String? =
        if (list.isEmpty()) null else JSONArray(list).toString()

    fun add(list: List<String>, tag: String): List<String> {
        val t = tag.trim()
        if (t.isEmpty() || list.any { key(it) == key(t) }) return list
        return list + t
    }

    fun remove(list: List<String>, tag: String): List<String> =
        list.filterNot { key(it) == key(tag) }
}
```

- [ ] **Step 8: Kotlin-Tests laufen lassen**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*TagsTest*'`
Expected: PASS, 9 Tests.

Run: `cd android && ./gradlew :app:testDebugUnitTest`
Expected: PASS — die vorhandenen 213 bleiben grün, plus die neuen.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/utils/tags.js desktop/src/utils/tags.test.js android/app/src/main/java/com/example/yugiohscanner/ml/Tags.kt android/app/src/test/java/com/example/yugiohscanner/TagsTest.kt
git commit -m "feat(desktop,android): Tag-Regeln als getestete Zwillinge"
```

---

### Task 4: Standort- und Tag-Helfer plus die sieben IPC-Kanäle

**Files:**
- Modify: `desktop/electron/copies.cjs`
- Create: `desktop/electron/copies-location.test.cjs`
- Modify: `desktop/electron/main.cjs` (bei den vorhandenen `ipcMain.handle`, ca. Zeile 324)
- Modify: `desktop/electron/preload.cjs`

**Interfaces:**
- Consumes: `deleteContainer` aus Task 1.
- Produces, jeweils in `main.cjs` **und** `preload.cjs`:
  ```js
  listContainers()                                  -> Container[] mit copies_count und value
  saveContainer({container_id?, name, kind, pockets_per_page, color, sort_order}) -> {success, container_id}
  deleteContainer(containerId)                      -> {success, cleared}
  setCopyLocation({copy_id, container_id, page, slot}) -> {success}
  setCopyTagsNote({copy_id, tags, note})            -> {success}
  listUnsortedCopies()                              -> Zeilen mit Kartendaten
  listTags()                                        -> string[]
  ```

**Hintergrund.** `desktop/electron/copies.cjs` hält alle Schreibwege auf `card_copies` — lies es zuerst. Es gilt ausnahmslos: **niemals** `cards.quantity` oder `cards.deleted` schreiben (Trigger), **niemals** hart löschen. Für den Wert eines Behälters gibt es bereits eine Bewertungsfunktion; suche im Projekt nach `condition-factors.json` und benutze denselben Weg wie die vorhandene Portfolio-Berechnung, statt eine zweite Formel zu erfinden.

**Regeln, die dieser Task durchsetzt:**
- `setCopyLocation` mit `container_id = null` räumt auch `page` und `slot`.
- Zeigt `container_id` auf einen Behälter der Art `box` oder `deckbox`, werden `page` und `slot` **immer** auf `null` gesetzt, egal was der Aufrufer schickt.
- Jede Änderung stempelt `updated_at` neu, sonst holt der Sync sie nie ab.
- `listTags` liefert die Tags aller **lebenden** Exemplare, entdoppelt, alphabetisch — das ist eine Vorschlagsliste, dort ist Sortierung richtig.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Datei `desktop/electron/copies-location.test.cjs`, aufgebaut wie `containers-schema.test.cjs` aus Task 1 (dieselbe `freshDb`-Hilfe, hier mit den Helfern aus `copies.cjs`):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown',
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL DEFAULT 0,
    PRIMARY KEY (id, set_code, language, rarity));`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, price)
              VALUES ('46986414','LOB-DE005','DE','Common', 2.0)`).run();
  return db;
}

const addContainer = (db, id, name, kind = 'binder', pockets = 9) =>
  db.prepare(`INSERT INTO containers (container_id, name, kind, pockets_per_page)
              VALUES (?,?,?,?)`).run(id, name, kind, pockets);

const addCopy = (db, copyId, over = {}) =>
  db.prepare(`INSERT INTO card_copies
       (copy_id, card_id, set_code, language, rarity, container_id, page, slot, tags, note, deleted)
       VALUES (@copy_id,'46986414','LOB-DE005','DE','Common',
               @container_id,@page,@slot,@tags,@note,@deleted)`)
    .run({ copy_id: copyId, container_id: null, page: null, slot: null,
           tags: null, note: null, deleted: 0, ...over });

const readCopy = (db, id) => db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(id);

test('setCopyLocation setzt Behaelter, Seite und Fach', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1');
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'c1', page: 3, slot: 7 });
  const k = readCopy(db, 'k1');
  assert.equal(k.container_id, 'c1');
  assert.equal(k.page, 3);
  assert.equal(k.slot, 7);
});

test('setCopyLocation mit null raeumt auch Seite und Fach', () => {
  // Sonst bliebe eine verwaiste Seite/Fach-Angabe an einem Exemplar ohne Behaelter stehen.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1', { container_id: 'c1', page: 3, slot: 7 });
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: null, page: 3, slot: 7 });
  const k = readCopy(db, 'k1');
  assert.equal(k.container_id, null);
  assert.equal(k.page, null);
  assert.equal(k.slot, null);
});

test('bei box und deckbox werden Seite und Fach immer verworfen', () => {
  // Der Aufrufer darf sie schicken; die Regel liegt hier, nicht in der Oberflaeche.
  const db = freshDb();
  addContainer(db, 'b1', 'Alte Box', 'box', null);
  addCopy(db, 'k1');
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'b1', page: 3, slot: 7 });
  const k = readCopy(db, 'k1');
  assert.equal(k.container_id, 'b1');
  assert.equal(k.page, null);
  assert.equal(k.slot, null);
});

test('setCopyLocation auf einen unbekannten Behaelter wirft', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  assert.throws(() => copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'gibtsnicht' }));
  assert.equal(readCopy(db, 'k1').container_id, null, 'nichts darf geschrieben worden sein');
});

test('setCopyLocation stempelt updated_at neu', () => {
  // Ohne frisches updated_at holt der Sync die Aenderung nie ab -- er zieht ueber updated_at > cursor.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1');
  db.prepare("UPDATE card_copies SET updated_at = '2000-01-01 00:00:00' WHERE copy_id = 'k1'").run();
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'c1', page: 1, slot: 1 });
  assert.notEqual(readCopy(db, 'k1').updated_at, '2000-01-01 00:00:00');
});

test('setCopyTagsNote schreibt Tags und Notiz und laesst den Standort in Ruhe', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1', { container_id: 'c1', page: 2, slot: 4 });
  copies.setCopyTagsNote(db, { copy_id: 'k1', tags: ['Kratzer', 'Tausch'], note: 'Ecke bestossen' });
  const k = readCopy(db, 'k1');
  assert.deepEqual(JSON.parse(k.tags), ['Kratzer', 'Tausch']);
  assert.equal(k.note, 'Ecke bestossen');
  assert.equal(k.container_id, 'c1', 'Standort darf nicht angefasst werden');
  assert.equal(k.page, 2);
  assert.equal(k.slot, 4);
});

test('setCopyTagsNote mit leerer Tag-Liste schreibt NULL, nicht "[]"', () => {
  // "keine Tags" muss in der Datenbank genau eine Darstellung haben.
  const db = freshDb();
  addCopy(db, 'k1', { tags: '["Alt"]' });
  copies.setCopyTagsNote(db, { copy_id: 'k1', tags: [], note: null });
  assert.equal(readCopy(db, 'k1').tags, null);
});

test('listUnsortedCopies liefert nur lebende Exemplare ohne Behaelter', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'frei1');
  addCopy(db, 'frei2');
  addCopy(db, 'einsortiert', { container_id: 'c1', page: 1, slot: 1 });
  addCopy(db, 'geloescht', { deleted: 1 });
  const ids = copies.listUnsortedCopies(db).map(r => r.copy_id).sort();
  assert.deepEqual(ids, ['frei1', 'frei2']);
});

test('listTags entdoppelt ueber Exemplare hinweg und ignoriert geloeschte', () => {
  const db = freshDb();
  addCopy(db, 'k1', { tags: '["Tausch","Kratzer"]' });
  addCopy(db, 'k2', { tags: '["tausch"]' });                 // gleiche Schreibweise ignorieren
  addCopy(db, 'k3', { tags: '["Nur im geloeschten"]', deleted: 1 });
  addCopy(db, 'k4', { tags: 'kaputt' });                      // darf nicht werfen
  const tags = copies.listTags(db);
  assert.deepEqual(tags, ['Kratzer', 'Tausch'], 'entdoppelt und alphabetisch');
});

test('listContainers zaehlt nur lebende Exemplare und ueberspringt geloeschte Behaelter', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addContainer(db, 'c2', 'Weg');
  db.prepare("UPDATE containers SET deleted = 1 WHERE container_id = 'c2'").run();
  addCopy(db, 'k1', { container_id: 'c1', page: 1, slot: 1 });
  addCopy(db, 'k2', { container_id: 'c1', page: 1, slot: 2 });
  addCopy(db, 'k3', { container_id: 'c1', page: 1, slot: 3, deleted: 1 });
  const list = copies.listContainers(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].container_id, 'c1');
  assert.equal(list[0].copies_count, 2, 'das geloeschte Exemplar zaehlt nicht mit');
});

test('kein Helfer schreibt jemals cards.quantity oder cards.deleted', () => {
  // Beide sind triggergepflegte Caches. Ein Schreibzugriff aus Anwendungscode wuerde sie
  // stillschweigend von den echten Exemplaren entkoppeln.
  const db = freshDb();
  addContainer(db, 'c1', 'Blau');
  addCopy(db, 'k1');
  const vorher = db.prepare('SELECT quantity, deleted FROM cards').get();
  copies.setCopyLocation(db, { copy_id: 'k1', container_id: 'c1', page: 1, slot: 1 });
  copies.setCopyTagsNote(db, { copy_id: 'k1', tags: ['X'], note: 'Y' });
  const nachher = db.prepare('SELECT quantity, deleted FROM cards').get();
  assert.deepEqual(nachher, vorher);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-location.test.cjs`
Expected: FAIL — die Helfer gibt es noch nicht.

- [ ] **Step 3: Die Helfer in `copies.cjs` schreiben**

Ergänze `setCopyLocation`, `setCopyTagsNote`, `listUnsortedCopies`, `listTags` und `listContainers` nach dem Stil der dort vorhandenen Funktionen. Der Kern von `setCopyLocation`:

```js
// Box und Deckbox haben keine Seiten. Die Regel liegt HIER und nicht in der Oberflaeche, damit
// sie fuer jeden Aufrufer gilt -- Desktop, Handy ueber die Cloud, und spaeter der Einsortier-
// Modus aus B2.
function setCopyLocation(db, { copy_id, container_id, page, slot }) {
  const kind = container_id
    ? (db.prepare('SELECT kind FROM containers WHERE container_id = ? AND deleted = 0').get(container_id) || {}).kind
    : null;
  if (container_id && !kind) throw new Error('Behaelter nicht gefunden');
  const isBinder = kind === 'binder';
  db.prepare(`UPDATE card_copies
                 SET container_id = @container_id, page = @page, slot = @slot,
                     updated_at = CURRENT_TIMESTAMP
               WHERE copy_id = @copy_id`)
    .run({
      copy_id,
      container_id: container_id ?? null,
      page: container_id && isBinder ? (page ?? null) : null,
      slot: container_id && isBinder ? (slot ?? null) : null,
    });
}
```

- [ ] **Step 4: Die IPC-Kanäle anlegen**

In `main.cjs` bei den vorhandenen Kopien-Kanälen (ca. Zeile 324) — dasselbe `{ success, … }`-Muster wie `add-copy`:

```js
ipcMain.handle('list-containers', () => copies.listContainers(db));
ipcMain.handle('save-container', (e, c) => {
  try { return { success: true, container_id: copies.saveContainer(db, c) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('delete-container', (e, containerId) => {
  try { return { success: true, cleared: deleteContainer(db, containerId) }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('set-copy-location', (e, loc) => {
  try { copies.setCopyLocation(db, loc); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('set-copy-tags-note', (e, d) => {
  try { copies.setCopyTagsNote(db, d); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('list-unsorted-copies', () => copies.listUnsortedCopies(db));
ipcMain.handle('list-tags', () => copies.listTags(db));
```

In `preload.cjs` bei den vorhandenen `invoke`-Zeilen — **ohne diese sieben Zeilen kommt der Renderer nicht dran**:

```js
  listContainers: () => ipcRenderer.invoke('list-containers'),
  saveContainer: (c) => ipcRenderer.invoke('save-container', c),
  deleteContainer: (id) => ipcRenderer.invoke('delete-container', id),
  setCopyLocation: (loc) => ipcRenderer.invoke('set-copy-location', loc),
  setCopyTagsNote: (d) => ipcRenderer.invoke('set-copy-tags-note', d),
  listUnsortedCopies: () => ipcRenderer.invoke('list-unsorted-copies'),
  listTags: () => ipcRenderer.invoke('list-tags'),
```

- [ ] **Step 5: Tests und Lint**

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-location.test.cjs`
Expected: PASS, 11 Tests.

Run: `cd desktop && npm run lint`
Expected: **genau 5** Fehler.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/copies.cjs desktop/electron/copies-location.test.cjs desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(desktop): Standort- und Tag-Helfer plus ihre IPC-Kanaele"
```

---

### Task 5: Desktop — Segment „Binder" mit Behälterliste

**Files:**
- Create: `desktop/src/components/Binders.jsx`
- Modify: `desktop/src/utils/routes.js`, `desktop/src/components/SammlungLayout.jsx`, `desktop/src/App.jsx`, `desktop/src/utils/i18n-de.js`

**Interfaces:**
- Consumes: `window.api.listContainers/saveContainer/deleteContainer/listUnsortedCopies` aus Task 4.
- Produces: Route `ROUTES.binder` = `/sammlung/binder`, von Task 7 (Start-Sprung) benutzt.

**Was gebaut wird (Spec §7.1).** Oben eine Zeile **„Nicht einsortiert: n Exemplare"**, klickbar auf eine Liste dieser Exemplare mit Sprung ins Kartendetail. Darunter die Behälter als Karten: Farbe, Name, Art, Belegung („212 Exemplare · 24 Seiten"), Wert. Ein **Plus** öffnet einen Dialog mit Name, Art, Fächer pro Seite (nur bei `binder`, Auswahl 4/9/12) und Farbe. Rechtsklick auf einen Behälter bietet Umbenennen und Löschen; das Löschen fragt nach mit **„n Exemplare werden auf ‚nicht einsortiert' gesetzt."** Sortierung über `sort_order`, umstellbar mit Pfeilen hoch/runter.

**Wie es auszusehen hat.** Halte dich an die vorhandene Bauart: das Segment reiht sich in `SEGMENTS` in `SammlungLayout.jsx` ein (dort stehen heute Karten · Wunschliste · Sets · Decks), die Route kommt in `ROUTES` und in die `<Routes>` in `App.jsx`, die Beschriftung in `i18n-de.js`. Für die Karten nimm dieselben Tailwind-Klassen, die `CollectionList.jsx` für seine Zeilen benutzt — **keine neuen Farben**, die Palette steht in `tailwind.config.js`.

**Die Reihenfolge der Segmente lautet Karten · Binder · Wunschliste · Sets · Decks**, damit die beiden häufigsten vorn stehen (Spec §11).

- [ ] **Step 1: Route und Segment eintragen**

In `desktop/src/utils/routes.js`:

```js
  binder: '/sammlung/binder',
```

In `desktop/src/components/SammlungLayout.jsx` in `SEGMENTS`, an **zweiter** Stelle:

```js
  { to: ROUTES.binder, label: T.binder },
```

In `desktop/src/utils/i18n-de.js` bei den übrigen Beschriftungen: `binder: 'Binder',`.

In `desktop/src/App.jsx` innerhalb der Sammlung-Route, neben den vorhandenen Segment-Routen:

```jsx
            <Route path="binder" element={<Binders />} />
```

- [ ] **Step 2: `Binders.jsx` schreiben**

Datei `desktop/src/components/Binders.jsx`. Zustand über `useState` + `useEffect`, geladen aus `window.api.listContainers()` und `window.api.listUnsortedCopies()`; nach jedem Schreiben neu laden. **Greife defensiv auf `window.api` zu** (`window.api?.…`) — im reinen Browser-Modus (`npm run dev`) fehlt es, und die Seite muss dort bedienbar bleiben statt weiß zu werden.

Das Anlegen erzeugt die `container_id` im Renderer als UUID; nimm `crypto.randomUUID()`, das im Renderer verfügbar ist und keine Abhängigkeit braucht.

**Fächer pro Seite** ist nur bei Art `binder` sichtbar und dann eine Auswahl aus 4, 9 und 12 — keine freie Eingabe, die Spec nennt genau diese drei.

- [ ] **Step 3: Bauen und Lint**

Run: `cd desktop && npm run build`
Expected: erfolgreich.

Run: `cd desktop && npm run lint`
Expected: **genau 5** Fehler.

- [ ] **Step 4: Von Hand nachsehen**

Starte den Renderer (`cd desktop && npm run build`, dann Electron aus dem Arbeitsordner starten — **nicht** `npm run electron:dev`, das Vite-Gespann kommt in diesem Projekt nicht zuverlässig hoch). Prüfe: Segment erscheint an zweiter Stelle; Behälter anlegen, umbenennen, löschen; die Löschabfrage nennt die richtige Anzahl; „Nicht einsortiert" zählt richtig; das Fenster lässt sich schmal ziehen, **ohne dass die Seite seitlich scrollt**.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/Binders.jsx desktop/src/utils/routes.js desktop/src/components/SammlungLayout.jsx desktop/src/App.jsx desktop/src/utils/i18n-de.js
git commit -m "feat(desktop): Segment Binder mit Behaelterliste"
```

---

### Task 6: Desktop — Exemplar-Sheet und Standort-Chip im Kartendetail

**Files:**
- Create: `desktop/src/components/CopySheet.jsx`
- Modify: `desktop/src/components/CardDetailPanel.jsx`

**Interfaces:**
- Consumes: `parseTags`/`serializeTags`/`addTag`/`removeTag` aus Task 3; `window.api.setCopyLocation/setCopyTagsNote/listContainers/listTags` aus Task 4.
- Produces: `<CopySheet copy={…} onClose={…} onSaved={…} />`, von Task 9 (Handy) **nicht** benutzt — das ist eine eigene Datei.

**Was gebaut wird (Spec §7.3).** Im Kartendetail zeigt jedes Exemplar innerhalb seiner Gruppe eine Zeile mit **Standort-Chip** („Blau · S3 · F7", „Box Alt", „—") und den Tag-Chips. Ein Klick öffnet das **Exemplar-Sheet**:

- **Standort:** Behälter-Auswahl; bei einem Binder zusätzlich Seite und Fach. In B1 gibt es **keinen** Vorschlag für das nächste freie Fach — `SlotMath` kommt erst in B2. Leer lassen ist erlaubt.
- **Tags:** Chip-Eingabe mit Vorschlägen aus `listTags()`; Enter legt an, ein X entfernt.
- **Notiz:** mehrzeiliges Feld.
- **Entfernen:** Soft-Delete des Exemplars mit Rückfrage.

**Das Sheet ist die einzige Stelle, an der Tags und Notiz geschrieben werden** (Spec §7.3). Baue keinen zweiten Schreibweg.

- [ ] **Step 1: `CopySheet.jsx` schreiben**

Nimm als Vorbild die vorhandenen Modal-Komponenten des Projekts (`CardSearchModal.jsx`, `RarityGuide.jsx`) — gleiche Überlagerung, gleiche Schließen-Geste, gleiche Tailwind-Klassen.

Die Tag-Eingabe arbeitet **ausschließlich** über die vier Funktionen aus `tags.js`; baue kein eigenes Zerlegen oder Zusammensetzen. Beim Speichern geht `serializeTags(list)` an `setCopyTagsNote`.

Ändert sich die Behälterart auf `box` oder `deckbox`, blende Seite und Fach aus. Der Helfer aus Task 4 verwirft sie ohnehin — die Oberfläche soll aber nicht anbieten, was verworfen wird.

- [ ] **Step 2: Standort- und Tag-Chips ins Kartendetail einbauen**

In `CardDetailPanel.jsx` innerhalb der vorhandenen Exemplar-Gruppen je Exemplar eine Zeile ergänzen. Der Standort-Chip zeigt:

- Behälter der Art `binder` mit Seite und Fach → **„<Name> · S<page> · F<slot>"**
- Behälter ohne Seite/Fach → **„<Name>"**
- kein Behälter → **„—"**

Zieh die Formatierung in eine kleine reine Funktion in derselben Datei, damit sie an einer Stelle steht — Task 7 braucht dieselbe Darstellung in der Sammlungsliste und importiert sie von dort.

- [ ] **Step 3: Bauen, Lint, von Hand nachsehen**

Run: `cd desktop && npm run build && npm run lint`
Expected: Bau erfolgreich, **genau 5** Lint-Fehler.

Von Hand: Standort setzen, Tags anlegen und entfernen, Notiz schreiben, Sheet schließen und wieder öffnen — alles muss stehen. Ein Exemplar in eine Box legen → Seite und Fach verschwinden.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/CopySheet.jsx desktop/src/components/CardDetailPanel.jsx
git commit -m "feat(desktop): Exemplar-Sheet fuer Standort, Tags und Notiz"
```

---

### Task 7: Desktop — Filter nach Behälter und Tag, Zähler auf der Startseite

**Files:**
- Modify: `desktop/src/components/CollectionList.jsx`
- Modify: `desktop/src/components/Start.jsx`

**Interfaces:**
- Consumes: `window.api.listContainers/listTags` aus Task 4; die Chip-Formatierung aus Task 6.
- Produces: nichts.

**Was gebaut wird (Spec §7.4 und §7.5).** Das Filter-Sheet der Sammlung bekommt **Behälter** und **Tag**, beide mehrfach wählbar. Ist ein Behälterfilter aktiv, zeigt jede Zeile ihren Standort-Chip. Die Textsuche findet zusätzlich Tags und Notizen. Auf der Startseite kommt zu den Arbeitslisten-Zählern **„Nicht einsortiert"** mit Sprung auf `/sammlung/binder`.

**Achtung, echte Falle:** Die Sammlungsliste gruppiert nach **Printing**, die Filter greifen aber am **Exemplar**. Ein Printing muss also angezeigt werden, sobald **mindestens ein** lebendes Exemplar den Filter erfüllt — und der Standort-Chip in der Zeile gehört dann zu diesem Exemplar, nicht zum Printing. Halte das in einem Kommentar fest.

- [ ] **Step 1: Filter einbauen**

Erweitere die vorhandene Filterstruktur in `CollectionList.jsx` um `containers: string[]` und `tags: string[]`. Leer heißt „nicht filtern". Nutze `parseTags` aus Task 3 zum Lesen der Tag-Spalte — **kein eigenes `JSON.parse`**.

- [ ] **Step 2: Start-Zähler einbauen**

In `Start.jsx` neben den vorhandenen Zählern (`set_code === 'Unknown'` steht dort schon als Vorbild, ca. Zeile 30) einen Zähler „Nicht einsortiert" ergänzen, der auf `ROUTES.binder` springt.

- [ ] **Step 3: Bauen, Lint, von Hand nachsehen**

Run: `cd desktop && npm run build && npm run lint`
Expected: Bau erfolgreich, **genau 5** Lint-Fehler.

Von Hand: nach einem Behälter filtern → nur dessen Karten, jede mit Chip. Nach einem Tag filtern. Beides zugleich. Filter leeren → alles wieder da. Nach einem Notiztext suchen → die Karte wird gefunden. Start-Zähler stimmt und springt richtig.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/CollectionList.jsx desktop/src/components/Start.jsx
git commit -m "feat(desktop): Filter nach Behaelter und Tag, Zaehler auf der Startseite"
```

---

### Task 8: Android — Behälter-Repository und die fünf Felder am Exemplar

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/ContainersRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt`

**Interfaces:**
- Consumes: `Tags` aus Task 3.
- Produces:
  ```kotlin
  data class ContainerRow(val containerId: String, val name: String, val kind: String,
                          val pocketsPerPage: Int?, val color: String?, val sortOrder: Int)
  ContainersRepository.list(): List<ContainerRow>
  ContainersRepository.save(row: ContainerRow)
  ContainersRepository.delete(containerId: String)      // raeumt zuerst die Standorte
  CollectionRepository.setCopyLocation(copyId, containerId, page, slot)
  CollectionRepository.setCopyTagsNote(copyId, tags: List<String>, note: String?)
  CollectionRepository.listUnsortedCopies(): List<CopyRow>
  CollectionRepository.listTags(): List<String>
  ```
  Tasks 9 und 10 rufen das auf.

**Hintergrund.** Das Handy spricht **direkt** mit Supabase über REST (OkHttp), nicht über den Desktop. Vorbild für ein Repository mit Auth und Neuanmeldung ist `DecksRepository.kt` — lies es zuerst und übernimm sein Muster für Fehlerbehandlung und Wiederholung. **Der Agent verbindet sich nicht selbst mit Supabase und führt kein SQL aus.**

**Bindend beim Löschen:** Erst **alle Exemplare** dieses Behälters auf `container_id/page/slot = NULL` setzen, **dann** den Behälter auf `deleted = true`. Zwei REST-Aufrufe in dieser Reihenfolge. Bricht der zweite ab, stehen Exemplare ohne Behälter da — unschön, aber harmlos. Andersherum zeigten Exemplare auf einen gelöschten Behälter (Spec §8).

- [ ] **Step 1: `CopyRow` erweitern**

```kotlin
    val containerId: String?,
    val page: Int?,
    val slot: Int?,
    val tags: String?,      // JSON-Array-Text, ueber Tags.parse lesen -- nie selbst zerlegen
    val note: String?,
```

Alle Stellen anpassen, die `CopyRow` bauen. Lass die Felder in der Zerlegung der Serverantwort nullbar; ein älterer Server-Stand liefert sie nicht.

- [ ] **Step 2: `ContainersRepository` schreiben**

Nach dem Muster von `DecksRepository.kt`. `list()` filtert `deleted = false` und sortiert nach `sort_order`.

- [ ] **Step 3: `CollectionRepository` erweitern**

Die vier neuen Funktionen. `setCopyTagsNote` schreibt `Tags.serialize(tags)` — **nie** eine selbst gebaute Zeichenkette. Die Regel „Box und Deckbox haben keine Seiten" gilt auch hier: setzt der Aufrufer einen Behälter, der kein `binder` ist, gehen `page` und `slot` als `null` raus.

- [ ] **Step 4: Kompilieren und Testsuite**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides erfolgreich; die vorhandenen Tests bleiben grün.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/ContainersRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt
git commit -m "feat(android): Behaelter-Repository und Standortfelder am Exemplar"
```

---

### Task 9: Android — Segment „Binder" mit Behälterliste

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/BindersScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt` (Segmentleiste), `AppNav.kt` (Route)

**Interfaces:**
- Consumes: `ContainersRepository`, `CollectionRepository.listUnsortedCopies` aus Task 8.
- Produces: die Route auf das Binder-Segment, von Task 10 (Start-Sprung) benutzt.

**Was gebaut wird.** Dasselbe wie Task 5, in Compose: Zähler „Nicht einsortiert", Behälterliste als `SpaceCard` mit Farbe, Name, Art, Belegung und Wert, Anlegen über einen Dialog, Umbenennen und Löschen über Langdruck. **Umsortieren per Langdruck gehört nicht zu B1** (Spec §7.1).

**Die Segmentleiste wird scrollbar.** Mit „Binder" sind es fünf Segmente; die Spec nennt das ausdrücklich als Risiko (§11) und schreibt eine scrollbare `TabRow` vor, Reihenfolge **Karten · Binder · Wunschliste · Sets · Decks**.

- [ ] **Step 1: Segment und Route eintragen**

Die Route folgt dem vorhandenen Muster `sammlung/{segment}` (siehe `AppNav.kt`, Kommentar bei Zeile 50).

- [ ] **Step 2: `BindersScreen.kt` schreiben**

Halte dich an den Stil von `DecksScreen.kt` — gleiche Ladezustände, gleiche Fehlermeldungen, gleiche `SpaceCard`-Verwendung. Farben aus dem vorhandenen Theme, **keine neuen**.

- [ ] **Step 3: Kompilieren und Testsuite**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides erfolgreich.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/BindersScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt
git commit -m "feat(android): Segment Binder mit Behaelterliste"
```

---

### Task 10: Android — Exemplar-Sheet, Standort-Chip, Filter und Start-Zähler

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt`, `CollectionScreen.kt`, `StartScreen.kt`

**Interfaces:**
- Consumes: `Tags` aus Task 3; `CollectionRepository`/`ContainersRepository` aus Task 8; die Route aus Task 9.
- Produces: nichts.

**Was gebaut wird.** Das Gegenstück zu den Tasks 6 und 7, in Compose: Exemplar-Sheet als `ModalBottomSheet` für Standort, Tags und Notiz — **einzige Schreibstelle** für Tags und Notiz; Standort-Chip und Tag-Chips je Exemplar im Kartendetail; Filter nach Behälter und Tag im vorhandenen Filter-Sheet der Sammlung; Zähler „Nicht einsortiert" auf der Startseite mit Sprung.

**Die Chip-Beschriftung muss zeichengleich zur Desktop-Fassung sein** („<Name> · S<page> · F<slot>", „<Name>", „—"). Zwei Geräte, die denselben Standort verschieden schreiben, kosten den Nutzer jedes Mal einen Moment.

Für die Gruppierungsfalle gilt dasselbe wie in Task 7: die Liste gruppiert nach Printing, die Filter greifen am Exemplar.

- [ ] **Step 1: `CopySheet.kt` schreiben**

Vorbild ist das vorhandene Staging-Sheet (`ScanStagingScreen.kt`) für Aufbau und Bedienung — **nicht** dessen Inhalt kopieren. Tags ausschließlich über `Tags.add`/`Tags.remove`/`Tags.serialize`.

- [ ] **Step 2: Chip, Filter und Zähler einbauen**

- [ ] **Step 3: Kompilieren und Testsuite**

Run: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest`
Expected: beides erfolgreich.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt
git commit -m "feat(android): Exemplar-Sheet, Standort-Chip, Filter und Start-Zaehler"
```

---

## Abschluss

**Vor der Geräteabnahme muss der Nutzer `supabase/containers_schema.sql` im Supabase-Dashboard anwenden.** Ohne die Tabelle scheitert jeder Sync-Zyklus, und das Handy sieht keinen einzigen Behälter. Kein Agent führt dieses SQL aus.

**Abnahme (Spec §10, für B1):**

1. Behälter anlegen (Binder mit 9 Fächern, Box), umbenennen, löschen — die Löschabfrage nennt die richtige Anzahl.
2. Ein Exemplar von Hand einem Binder zuordnen, mit Seite und Fach; ein zweites einer Box — dort verschwinden Seite und Fach.
3. Tags anlegen und entfernen, Notiz schreiben; nach Schließen und Öffnen steht alles.
4. Nach Behälter filtern, nach Tag filtern, beides zugleich; die Textsuche findet einen Notiztext.
5. Der Zähler „Nicht einsortiert" stimmt auf beiden Geräten und springt richtig.
6. **Beide Geräte zeigen dieselben Zuordnungen** — am Handy zuweisen, am PC nachsehen und umgekehrt.
7. Behälter löschen → seine Exemplare stehen auf beiden Geräten auf „nicht einsortiert", der Behälter ist auf beiden weg.

Danach `superpowers:finishing-a-development-branch`.
