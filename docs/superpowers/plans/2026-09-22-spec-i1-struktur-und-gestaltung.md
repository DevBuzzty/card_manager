# Spec I1 — Struktur und Gestaltung: Umsetzungsplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte sind Kästchen (`- [ ]`).

**Ziel:** Die Bereiche beider Geräte neu schneiden (Verkaufen und Decks eigenständig, Sammlung entrümpelt, Unbekannte bei Scannen) und die Gestaltung auf Farbrollen mit heller Katalog-Fassung plus gleichwertiger dunkler umstellen.

**Architektur:** Eine gemeinsame Token-Datei (`docs/fixtures/design/tokens.json`) ist die einzige Quelle für Farbrollen; PC bildet sie auf CSS-Variablen und Tailwind-Namen ab, Handy auf zwei Compose-Farbschemata, je ein Zwillings-Test hält beide Seiten an der Datei fest. Die Navigation wird ebenfalls als Tabelle beschrieben (`docs/fixtures/design/nav.json`) und von beiden Seiten gegen die eigene Implementierung geprüft. Die bestehenden Listen (Duplikate, Zum Verkauf, Angebote, Verkäufe) werden **verschoben, nicht neu geschrieben**.

**Technik:** React 18 + React Router + Tailwind (Renderer, ESM), Electron-Hauptprozess (CommonJS `.cjs`), Jetpack Compose (Kotlin), Node-Test-Runner für Helfer, `electron --test` für SQLite, JUnit für Android.

**Spec:** `docs/superpowers/specs/2026-09-22-spec-i-neustruktur-und-gestaltung.md`

## Globale Vorgaben

- Alle sichtbaren Texte auf **Deutsch**, mit echten Umlauten. Commit-Nachrichten deutsch, jede endet mit `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Keine Datenänderung** außer der Einstellung `theme` (PC: Tabelle `settings`, Handy: `scanner_prefs`). Kein Cloud-Schema, keine Migration, kein neuer Sync-Strom.
- Farbrollen laut Spec §6.1: `bg surface surface-2 line text text-muted accent accent-fg good warn bad`, Werte exakt wie dort. Hell ist die Vorgabe.
- **Keine Farbverläufe, keine Leuchtränder, keine farbigen Schatten.** Eine Akzentfarbe für alles Klickbare. Set-Code und Seltenheit in `text-muted`. Preise in `text`; `good`/`bad` nur für Richtung.
- Der Electron-Hauptprozess bleibt CommonJS (`.cjs`), der Renderer ESM. Neue IPC-Kanäle immer in `electron/main.cjs` **und** `electron/preload.cjs` **und** `electron/ipc-channels.test.cjs`.
- Prüfläufe, die nach jeder Aufgabe grün bleiben müssen:
  - `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs`
  - `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
  - `cd desktop && npx eslint .` → **genau 5 Fehler** (Altlast, keine neuen)
  - `cd desktop && npx vite build`
  - `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
- Niemals `android/local.properties` lesen, ändern oder stagen. Kein `git stash`. Explizit stagen (nur die eigenen Dateien). Kein `npm install`/`npm ci`.
- Abweichung gegenüber Spec §3.1: Das Handy hat **heute keine Ansicht für unbekannte Karten** und keine Sammelaktionen dafür (bestätigt: nirgends in `android/`). Der Umzug „Unbekannt → Scannen“ betrifft in I1 deshalb nur den PC; am Handy entsteht dafür nichts Neues.

---

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/design/tokens.json` (neu) | Farbrollen, hell und dunkel, Kontrastpaare | 1 |
| `desktop/src/utils/theme.js` + `theme.test.js` (neu) | Modus auflösen, Tokens gegen CSS prüfen | 1, 2 |
| `android/.../DesignTokensTest.kt` (neu) | Zwilling: Compose-Farben gegen die Token-Datei | 1 |
| `desktop/src/index.css`, `desktop/tailwind.config.js` | CSS-Variablen je Modus, Tailwind-Rollen | 2 |
| `desktop/src/main.jsx`, `desktop/src/components/Settings.jsx` | Modus anwenden, Abschnitt „Darstellung“ | 2 |
| `docs/fixtures/design/nav.json` (neu) | Bereiche und Unterteilungen beider Geräte | 3 |
| `desktop/src/utils/routes.js`, `utils/i18n-de.js`, `components/Sidebar.jsx`, `App.jsx` + `utils/nav.test.js` (neu) | Bereiche, Gruppen, Routen, Weiterleitungen | 3 |
| `desktop/src/components/VerkaufenLayout.jsx` (neu), `Insights.jsx`, `CollectionList.jsx` | Bereich „Verkaufen“ mit vier Stationen | 4 |
| `desktop/src/utils/cardFilters.js` + `cardFilters.test.js` (neu), `CollectionList.jsx` | Kartenliste ohne Chips, gespeicherte Filter | 5 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs`, `desktop/src/components/StagingArea.jsx`, `Sidebar.jsx` | Unbekannte bei Scannen, Zähler | 6 |
| 49 Renderer-Dateien mit `space-*` | Rollen statt fester Farben | 7 |
| `android/.../ui/theme/Color.kt`, `theme/Theme.kt`, `Prefs.kt`, `ui/SettingsScreen.kt` | Rollen, zwei Schemata, Umschalter | 8 |
| `android/.../ui/AppNav.kt`, `ui/VerkaufenScreen.kt` (neu), `ui/SammlungScreen.kt`, `ui/StartScreen.kt`, `ui/SaleLists.kt` + `NavTabellenTest.kt` (neu) | Vier Ziele, Bereich Verkaufen, Decks über Start | 9 |
| `android/.../ui/CollectionScreen.kt` + `CardFilterPresetsTest.kt` (neu) | Kartenliste ohne Chips, Filter-Voreinstellungen | 10 |
| — | Bauen, installieren, Abnahme | 11 |

Reihenfolge: 1 → 11. Parallel erlaubt (getrennte Dateien, Commits nie gleichzeitig): 2 ∥ 8 (nach 1), 5 ∥ 10, 6 ∥ 9. Task 7 erst, wenn 2–6 stehen.

---

### Task 1: Token-Datei und beide Zwillings-Tests

**Dateien:**
- Erstellen: `docs/fixtures/design/tokens.json`
- Erstellen: `desktop/src/utils/theme.js`, `desktop/src/utils/theme.test.js`
- Erstellen: `android/app/src/test/java/com/example/yugiohscanner/DesignTokensTest.kt`

**Schnittstellen:**
- Liefert: `tokens.json` mit `{ roles: { <rolle>: { light, dark } }, contrast: [{ fg, bg, min }] }`; `theme.js#ROLES` (Array der Rollennamen), `theme.js#resolveMode(setting, prefersDark) -> 'light'|'dark'`, `theme.js#contrastRatio(hexA, hexB) -> number`.
- Verbraucht: nichts.

- [ ] **Schritt 1: Token-Datei anlegen**

`docs/fixtures/design/tokens.json`:

```json
{
  "_": "ZWILLING: desktop/src/utils/theme.test.js und android DesignTokensTest.kt pruefen beide Seiten gegen diese Datei. Werte aus Spec I §6.1.",
  "roles": {
    "bg":        { "light": "#f6f4ef", "dark": "#17181a" },
    "surface":   { "light": "#fffdf8", "dark": "#1d1f21" },
    "surface-2": { "light": "#f1eee7", "dark": "#232528" },
    "line":      { "light": "#e0dbd1", "dark": "#2e3134" },
    "text":      { "light": "#1b1a17", "dark": "#e9eaec" },
    "text-muted":{ "light": "#6c675e", "dark": "#9ba0a6" },
    "accent":    { "light": "#4b3f8f", "dark": "#8b6ad6" },
    "accent-fg": { "light": "#ffffff", "dark": "#14151a" },
    "good":      { "light": "#3f7d54", "dark": "#7fa88a" },
    "warn":      { "light": "#9a6b1f", "dark": "#c9a36b" },
    "bad":       { "light": "#a23b3b", "dark": "#c07a7a" }
  },
  "contrast": [
    { "fg": "text", "bg": "bg", "min": 4.5 },
    { "fg": "text", "bg": "surface", "min": 4.5 },
    { "fg": "text", "bg": "surface-2", "min": 4.5 },
    { "fg": "text-muted", "bg": "surface", "min": 4.5 },
    { "fg": "accent-fg", "bg": "accent", "min": 4.5 },
    { "fg": "line", "bg": "bg", "min": 1.2 }
  ]
}
```

- [ ] **Schritt 2: Fehlschlagenden PC-Test schreiben**

`desktop/src/utils/theme.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES, resolveMode, contrastRatio } from './theme.js';

// ZWILLING: android DesignTokensTest.kt liest dieselbe Datei.
const TOK = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/tokens.json', import.meta.url), 'utf8'));

test('ROLES nennt genau die Rollen der Token-Datei', () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(TOK.roles).sort());
});

test('resolveMode: hell ist die Vorgabe, System folgt dem Geraet', () => {
  assert.equal(resolveMode('light', true), 'light');
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('system', true), 'dark');
  assert.equal(resolveMode('system', false), 'light');
  assert.equal(resolveMode(undefined, true), 'light', 'ohne Einstellung immer hell');
  assert.equal(resolveMode('quatsch', true), 'light');
});

test('Kontrast: jedes geforderte Paar erreicht seinen Mindestwert in beiden Modi', () => {
  for (const c of TOK.contrast) {
    for (const mode of ['light', 'dark']) {
      const r = contrastRatio(TOK.roles[c.fg][mode], TOK.roles[c.bg][mode]);
      assert.ok(r >= c.min, `${c.fg} auf ${c.bg} (${mode}): ${r.toFixed(2)} < ${c.min}`);
    }
  }
});
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `cd desktop && node --test src/utils/theme.test.js`
Erwartet: FAIL, `Cannot find module './theme.js'`.

- [ ] **Schritt 4: Helfer schreiben**

`desktop/src/utils/theme.js`:

```js
// Spec I §6 -- Farbrollen. Die Werte stehen in docs/fixtures/design/tokens.json; hier steht nur
// die Logik, die beide Geraete teilen (Modus aufloesen, Kontrast rechnen).
export const ROLES = ['bg', 'surface', 'surface-2', 'line', 'text', 'text-muted', 'accent', 'accent-fg', 'good', 'warn', 'bad'];

// 'light' | 'dark' | 'system' -> tatsaechlicher Modus. Alles Unbekannte faellt auf hell zurueck.
export function resolveMode(setting, prefersDark) {
  if (setting === 'dark') return 'dark';
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return 'light';
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Kein Farbwert: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// WCAG-Kontrastverhaeltnis, 1 bis 21.
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
```

- [ ] **Schritt 5: Test laufen lassen, grün**

Ausführen: `cd desktop && node --test src/utils/theme.test.js`
Erwartet: PASS, 3 Tests.

- [ ] **Schritt 6: Fehlschlagenden Handy-Zwilling schreiben**

`android/app/src/test/java/com/example/yugiohscanner/DesignTokensTest.kt`:

```kotlin
package com.example.yugiohscanner

import androidx.compose.ui.graphics.Color
import com.example.yugiohscanner.ui.theme.AppColors
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/theme.test.js -- dieselbe Datei docs/fixtures/design/tokens.json. */
class DesignTokensTest {
    private val roles = JSONObject(Fixtures.text("docs/fixtures/design/tokens.json")).getJSONObject("roles")

    private fun hex(c: Color): String {
        val v = c.value.toULong() shr 32
        return "#%06x".format((v and 0xFFFFFFu).toLong())
    }

    @Test
    fun helleFassungStimmtMitDerTokenDateiUeberein() = pruefe("light", AppColors.light)

    @Test
    fun dunkleFassungStimmtMitDerTokenDateiUeberein() = pruefe("dark", AppColors.dark)

    private fun pruefe(modus: String, rollen: Map<String, Color>) {
        val erwartet = roles.keys().asSequence().associateWith { roles.getJSONObject(it).getString(modus) }
        assertEquals("Rollennamen", erwartet.keys.sorted(), rollen.keys.sorted())
        for ((name, wert) in erwartet) assertEquals("$modus/$name", wert, hex(rollen.getValue(name)))
    }
}
```

- [ ] **Schritt 7: Handy-Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "*DesignTokensTest*"`
Erwartet: Übersetzungsfehler, `AppColors` gibt es noch nicht. Dieser Test wird in **Task 8** grün — hier bleibt er absichtlich rot und wird deshalb **noch nicht committet**.

- [ ] **Schritt 8: Commit (nur PC-Teil und Token-Datei)**

```bash
git add docs/fixtures/design/tokens.json desktop/src/utils/theme.js desktop/src/utils/theme.test.js
git commit -m "feat(i1): Farbrollen als gemeinsame Token-Datei mit Kontrastpruefung"
```

Die Datei `DesignTokensTest.kt` bleibt ungestaged liegen und wird in Task 8 zusammen mit `AppColors` committet.

---

### Task 2: PC — Rollen als CSS-Variablen, Umschalter in den Einstellungen

**Dateien:**
- Ändern: `desktop/src/index.css` (Anfang), `desktop/tailwind.config.js`, `desktop/src/main.jsx`, `desktop/src/components/Settings.jsx` (`SECTIONS` Z. 15–22 und Inhalts-Weiche)
- Ändern: `desktop/src/utils/theme.js` (Anwenden im Browser), `desktop/src/utils/theme.test.js` (CSS-Abgleich)

**Schnittstellen:**
- Verbraucht: `theme.js#ROLES, resolveMode` (Task 1), IPC `window.api.getSettings()` / `window.api.saveSetting({key, value})` (vorhanden, `preload.cjs:149-150`).
- Liefert: Tailwind-Klassen `bg-bg bg-surface bg-surface-2 border-line text-text text-muted bg-accent text-accent-fg text-good text-warn text-bad`; `theme.js#applyTheme(doc, setting, prefersDark) -> 'light'|'dark'`; `theme.js#startTheme(doc, setting) -> () => void` (Abmelden).

- [ ] **Schritt 1: Fehlschlagenden Test ergänzen**

An `desktop/src/utils/theme.test.js` anhängen:

```js
import { applyTheme } from './theme.js';

const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('index.css traegt jede Rolle in beiden Modi mit dem Token-Wert', () => {
  const block = (sel) => {
    const i = CSS.indexOf(sel);
    assert.ok(i >= 0, `${sel} fehlt in index.css`);
    return CSS.slice(i, CSS.indexOf('}', i));
  };
  const hell = block(':root');
  const dunkel = block('[data-theme="dark"]');
  for (const [name, werte] of Object.entries(TOK.roles)) {
    assert.match(hell, new RegExp(`--${name}:\\s*${werte.light}\\s*;`, 'i'), `hell: ${name}`);
    assert.match(dunkel, new RegExp(`--${name}:\\s*${werte.dark}\\s*;`, 'i'), `dunkel: ${name}`);
  }
});

test('applyTheme setzt data-theme am Dokument', () => {
  const doc = { documentElement: { dataset: {} } };
  assert.equal(applyTheme(doc, 'system', true), 'dark');
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(applyTheme(doc, 'light', true), 'light');
  assert.equal(doc.documentElement.dataset.theme, 'light');
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `cd desktop && node --test src/utils/theme.test.js`
Erwartet: FAIL — `applyTheme` fehlt und `:root` trägt die Variablen noch nicht.

- [ ] **Schritt 3: `applyTheme` und `startTheme` ergänzen**

An `desktop/src/utils/theme.js` anhängen:

```js
// Setzt data-theme am <html>. Der Renderer liest die Einstellung aus der settings-Tabelle.
export function applyTheme(doc, setting, prefersDark) {
  const mode = resolveMode(setting, prefersDark);
  doc.documentElement.dataset.theme = mode;
  return mode;
}

// Wendet die Einstellung an und folgt dem System, solange 'system' gewaehlt ist.
export function startTheme(doc, setting) {
  const mq = typeof doc.defaultView?.matchMedia === 'function'
    ? doc.defaultView.matchMedia('(prefers-color-scheme: dark)') : null;
  applyTheme(doc, setting, !!mq?.matches);
  if (!mq || setting !== 'system') return () => {};
  const on = () => applyTheme(doc, setting, mq.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}
```

- [ ] **Schritt 4: CSS-Variablen anlegen**

Am Anfang von `desktop/src/index.css`, vor den bestehenden Regeln:

```css
/* Spec I §6.1 -- Farbrollen. Werte gespiegelt aus docs/fixtures/design/tokens.json
   (desktop/src/utils/theme.test.js prueft die Gleichheit). Hell ist die Vorgabe. */
:root {
  --bg: #f6f4ef;
  --surface: #fffdf8;
  --surface-2: #f1eee7;
  --line: #e0dbd1;
  --text: #1b1a17;
  --text-muted: #6c675e;
  --accent: #4b3f8f;
  --accent-fg: #ffffff;
  --good: #3f7d54;
  --warn: #9a6b1f;
  --bad: #a23b3b;
}
[data-theme="dark"] {
  --bg: #17181a;
  --surface: #1d1f21;
  --surface-2: #232528;
  --line: #2e3134;
  --text: #e9eaec;
  --text-muted: #9ba0a6;
  --accent: #8b6ad6;
  --accent-fg: #14151a;
  --good: #7fa88a;
  --warn: #c9a36b;
  --bad: #c07a7a;
}
body { background: var(--bg); color: var(--text); }
```

Vorhandene Regeln in `index.css`, die einen Farbverlauf auf `body` legen, ersatzlos entfernen (Spec §6.2: keine Verläufe).

- [ ] **Schritt 5: Tailwind auf Rollen umstellen**

In `desktop/tailwind.config.js` den `colors`-Block um die Rollen **ergänzen** (die alten `space-*`-Namen bleiben vorerst stehen, Task 7 räumt sie ab):

```js
colors: {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  'surface-2': 'var(--surface-2)',
  line: 'var(--line)',
  text: 'var(--text)',
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
  'accent-fg': 'var(--accent-fg)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  // ... bestehende Einträge unverändert darunter
}
```

Achtung: `line` und `good` gibt es bereits als feste Werte — die neuen Einträge ersetzen sie (gleicher Name, Wert jetzt Variable). `warn` zeigte bisher auf `#f5c542`, `crit` bleibt vorerst und wird in Task 7 durch `bad` ersetzt.

- [ ] **Schritt 6: Test laufen lassen, grün**

Ausführen: `cd desktop && node --test src/utils/theme.test.js`
Erwartet: PASS, 5 Tests.

- [ ] **Schritt 7: Modus beim Start anwenden**

In `desktop/src/main.jsx` vor dem Rendern:

```jsx
import { startTheme } from './utils/theme';

// Spec I §6.4 -- Darstellung gilt je Geraet; die Einstellung steht lokal in der settings-Tabelle.
window.api?.getSettings?.().then((s) => startTheme(document, s?.theme ?? 'light')).catch(() => {});
startTheme(document, 'light');
```

- [ ] **Schritt 8: Abschnitt „Darstellung“ in den Einstellungen**

In `desktop/src/components/Settings.jsx` `SECTIONS` (Z. 15–22) um einen Eintrag an zweiter Stelle erweitern:

```js
{ id: 'darstellung', label: 'Darstellung' },
```

und einen Inhaltsblock nach dem Muster der anderen Abschnitte ergänzen:

```jsx
{active === 'darstellung' && (
  <div className="bg-surface border border-line rounded-2xl p-6">
    <h3 className="font-display text-lg text-text mb-1">Darstellung</h3>
    <p className="text-sm text-muted mb-4">Gilt nur auf diesem Gerät.</p>
    <div className="flex gap-2">
      {[['light', 'Hell'], ['dark', 'Dunkel'], ['system', 'Wie das System']].map(([id, label]) => (
        <button key={id} type="button"
          onClick={async () => { setTheme(id); startTheme(document, id); await window.api?.saveSetting?.({ key: 'theme', value: id }); }}
          className={clsx('px-4 py-2 rounded-lg text-sm border',
            theme === id ? 'bg-accent text-accent-fg border-transparent' : 'bg-surface-2 text-muted border-line')}>
          {label}
        </button>
      ))}
    </div>
  </div>
)}
```

Dazu oben in der Komponente `const [theme, setTheme] = useState('light');` und im vorhandenen `getSettings`-Effekt (Z. 52–58) `if (settings?.theme) setTheme(settings.theme);`.

- [ ] **Schritt 9: Prüfläufe**

```bash
cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs && npx eslint . ; npx vite build
```
Erwartet: Helfer-Tests grün, ESLint genau 5 Fehler, Build ohne Fehler.

- [ ] **Schritt 10: Commit**

```bash
git add desktop/src/utils/theme.js desktop/src/utils/theme.test.js desktop/src/index.css desktop/tailwind.config.js desktop/src/main.jsx desktop/src/components/Settings.jsx
git commit -m "feat(i1): PC-Farbrollen als CSS-Variablen, Umschalter Hell/Dunkel/System"
```

---

### Task 3: PC — Bereiche, Gruppen, Routen, Weiterleitungen

**Dateien:**
- Erstellen: `docs/fixtures/design/nav.json`, `desktop/src/utils/nav.test.js`
- Ändern: `desktop/src/utils/routes.js`, `desktop/src/utils/i18n-de.js` (Z. 4–33), `desktop/src/components/Sidebar.jsx`, `desktop/src/App.jsx` (Routen Z. 112–137)

**Schnittstellen:**
- Verbraucht: nichts aus Task 1/2.
- Liefert: `ROUTES.verkaufen*`, `ROUTES.decks`; `NAV_GROUPS` aus `i18n-de.js`: `[{ group: string, items: [{ key, to, label }] }]`; `nav.json` als gemeinsame Beschreibung für Task 9.

- [ ] **Schritt 1: Navigationstabelle anlegen**

`docs/fixtures/design/nav.json`:

```json
{
  "_": "ZWILLING: desktop/src/utils/nav.test.js und android NavTabellenTest.kt pruefen ihre Navigation gegen diese Tabelle. Spec I §3.",
  "groups": [
    { "group": "Alltag",     "items": ["start", "scannen"] },
    { "group": "Bestand",    "items": ["sammlung", "decks"] },
    { "group": "Handel",     "items": ["verkaufen", "deals"] },
    { "group": "Auswertung", "items": ["insights", "einstellungen"] }
  ],
  "labels": {
    "start": "Start", "scannen": "Scannen", "sammlung": "Sammlung", "decks": "Decks",
    "verkaufen": "Verkaufen", "deals": "Deals", "insights": "Insights", "einstellungen": "Einstellungen"
  },
  "segments": {
    "sammlung": [["karten", "Karten"], ["binder", "Binder"], ["sets", "Sets"], ["wunschliste", "Wunschliste"], ["sealed", "Sealed"]],
    "verkaufen": [["kandidaten", "Kandidaten"], ["zum-verkauf", "Zum Verkauf"], ["angebote", "Angebote"], ["verkaeufe", "Verkäufe"]]
  },
  "handyLeiste": ["start", "sammlung", "verkaufen", "deals"],
  "handyUeberStart": ["decks", "insights", "einstellungen"]
}
```

- [ ] **Schritt 2: Fehlschlagenden Test schreiben**

`desktop/src/utils/nav.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTES } from './routes.js';
import { NAV_GROUPS, SAMMLUNG_SEGMENTS, VERKAUFEN_SEGMENTS } from './i18n-de.js';

// ZWILLING: android NavTabellenTest.kt liest dieselbe Tabelle.
const N = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/nav.json', import.meta.url), 'utf8'));

test('Die Seitenleiste zeigt die Gruppen der Tabelle in ihrer Reihenfolge', () => {
  assert.deepEqual(NAV_GROUPS.map(g => g.group), N.groups.map(g => g.group));
  assert.deepEqual(NAV_GROUPS.map(g => g.items.map(i => i.key)), N.groups.map(g => g.items));
});

test('Jeder Eintrag traegt den Text der Tabelle und eine bekannte Route', () => {
  for (const g of NAV_GROUPS) for (const i of g.items) {
    assert.equal(i.label, N.labels[i.key], i.key);
    assert.ok(typeof i.to === 'string' && i.to.startsWith('/'), `${i.key}: ${i.to}`);
  }
});

test('Die Unterteilungen stimmen mit der Tabelle ueberein', () => {
  assert.deepEqual(SAMMLUNG_SEGMENTS.map(s => [s.id, s.label]), N.segments.sammlung);
  assert.deepEqual(VERKAUFEN_SEGMENTS.map(s => [s.id, s.label]), N.segments.verkaufen);
});

test('Decks und Verkaufen haben eigene Routen', () => {
  assert.equal(ROUTES.decks, '/decks');
  assert.equal(ROUTES.verkaufen, '/verkaufen/kandidaten');
  assert.equal(ROUTES.zumVerkauf, '/verkaufen/zum-verkauf');
  assert.equal(ROUTES.angebote, '/verkaufen/angebote');
  assert.equal(ROUTES.verkaeufe, '/verkaufen/verkaeufe');
});
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `cd desktop && node --test src/utils/nav.test.js`
Erwartet: FAIL, `NAV_GROUPS` gibt es nicht.

- [ ] **Schritt 4: Routen ergänzen**

In `desktop/src/utils/routes.js` den `ROUTES`-Block erweitern (die alten Einträge bleiben unverändert stehen, `decks` zeigt jetzt nach oben):

```js
export const ROUTES = {
  start: '/start',
  scannen: '/scannen',
  karten: '/sammlung/karten',
  binder: '/sammlung/binder',
  wunschliste: '/sammlung/wunschliste',
  sets: '/sammlung/sets',
  sealed: '/sammlung/sealed',
  decks: '/decks',
  verkaufen: '/verkaufen/kandidaten',
  kandidaten: '/verkaufen/kandidaten',
  zumVerkauf: '/verkaufen/zum-verkauf',
  angebote: '/verkaufen/angebote',
  verkaeufe: '/verkaufen/verkaeufe',
  deals: '/deals',
  insights: '/insights',
  einstellungen: '/einstellungen',
};
```

- [ ] **Schritt 5: Texte und Gruppen**

In `desktop/src/utils/i18n-de.js` `T` um `verkaufen: 'Verkaufen'`, `kandidaten: 'Kandidaten'`, `zumVerkauf: 'Zum Verkauf'`, `angebote: 'Angebote'`, `verkaeufe: 'Verkäufe'`, `darstellung: 'Darstellung'` erweitern und `NAV` durch Gruppen ersetzen:

```js
export const NAV_GROUPS = [
  { group: 'Alltag', items: [
    { key: 'start', to: ROUTES.start, label: T.start },
    { key: 'scannen', to: ROUTES.scannen, label: T.scannen },
  ] },
  { group: 'Bestand', items: [
    { key: 'sammlung', to: ROUTES.karten, label: T.sammlung },
    { key: 'decks', to: ROUTES.decks, label: T.decks },
  ] },
  { group: 'Handel', items: [
    { key: 'verkaufen', to: ROUTES.verkaufen, label: T.verkaufen },
    { key: 'deals', to: ROUTES.deals, label: T.deals },
  ] },
  { group: 'Auswertung', items: [
    { key: 'insights', to: ROUTES.insights, label: T.insights },
    { key: 'einstellungen', to: ROUTES.einstellungen, label: T.einstellungen },
  ] },
];

export const SAMMLUNG_SEGMENTS = [
  { id: 'karten', to: ROUTES.karten, label: T.karten },
  { id: 'binder', to: ROUTES.binder, label: T.binder },
  { id: 'sets', to: ROUTES.sets, label: T.sets },
  { id: 'wunschliste', to: ROUTES.wunschliste, label: T.wunschliste },
  { id: 'sealed', to: ROUTES.sealed, label: T.sealed },
];

export const VERKAUFEN_SEGMENTS = [
  { id: 'kandidaten', to: ROUTES.kandidaten, label: T.kandidaten },
  { id: 'zum-verkauf', to: ROUTES.zumVerkauf, label: T.zumVerkauf },
  { id: 'angebote', to: ROUTES.angebote, label: T.angebote },
  { id: 'verkaeufe', to: ROUTES.verkaeufe, label: T.verkaeufe },
];
```

`routes.js` dafür in `i18n-de.js` importieren: `import { ROUTES } from './routes';`. Das alte `NAV` entfällt.

- [ ] **Schritt 6: Seitenleiste mit Gruppen**

In `desktop/src/components/Sidebar.jsx` den Import auf `NAV_GROUPS` umstellen, die Icon-Tabelle ergänzen und die Liste gruppiert rendern:

```jsx
import { Home, ScanLine, Library, Layers, Tag, BarChart3, Settings as SettingsIcon, Banknote } from 'lucide-react';
const ICONS = { start: Home, scannen: ScanLine, sammlung: Library, decks: Layers, verkaufen: Banknote, deals: Tag, insights: BarChart3, einstellungen: SettingsIcon };

<nav className="flex-1 overflow-y-auto custom-scrollbar">
  {NAV_GROUPS.map(g => (
    <div key={g.group} className="mb-4">
      <div className="px-3 mb-1 text-[11px] uppercase tracking-wider text-muted">{g.group}</div>
      <div className="space-y-0.5">
        {g.items.map(n => (
          <NavItem key={n.key} to={n.to} icon={ICONS[n.key]} label={n.label}
            match={n.key === 'sammlung' ? '/sammlung' : n.key === 'verkaufen' ? '/verkaufen' : n.key === 'einstellungen' ? '/einstellungen' : undefined} />
        ))}
      </div>
    </div>
  ))}
</nav>
```

- [ ] **Schritt 7: Routen und Weiterleitungen**

In `desktop/src/App.jsx` im Routen-Block: `decks` aus dem `sammlung`-Zweig entfernen und diese Routen ergänzen (die Weiterleitungen halten alte Lesezeichen und den Rückkanal vom Handy am Leben):

```jsx
<Route path="/decks" element={<DeckBuilder />} />
<Route path="/sammlung/decks" element={<Navigate to="/decks" replace />} />
<Route path="/verkaufen" element={<VerkaufenLayout />}>
  <Route index element={<Navigate to="/verkaufen/kandidaten" replace />} />
  <Route path="kandidaten" element={<KandidatenPanel />} />
  <Route path="zum-verkauf" element={<ZumVerkaufPanel />} />
  <Route path="angebote" element={<AngebotePanel />} />
  <Route path="verkaeufe" element={<VerkaeufePanel />} />
</Route>
```

Die vier Panels entstehen in Task 4; damit dieser Schritt für sich lauffähig bleibt, zunächst `VerkaufenLayout` mit `<Outlet />` und vier Platzhalter-Komponenten in **einer** Datei anlegen, die Task 4 füllt:

```jsx
// desktop/src/components/VerkaufenLayout.jsx -- Spec I §5.3. Die vier Stationen ziehen in Task 4 hier ein.
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { VERKAUFEN_SEGMENTS, T } from '../utils/i18n-de';

export default function VerkaufenLayout() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-text">{T.verkaufen}</h1>
        <div className="flex flex-wrap bg-surface-2 border border-line rounded-xl p-1 gap-1">
          {VERKAUFEN_SEGMENTS.map(s => (
            <NavLink key={s.id} to={s.to}
              className={({ isActive }) => clsx('px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text')}>
              {s.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0"><Outlet /></div>
    </div>
  );
}
```

`SammlungLayout.jsx` auf `SAMMLUNG_SEGMENTS` umstellen (Decks fällt dort weg) und die aktive Kennzeichnung auf `bg-accent text-accent-fg` ohne Schatten ändern.

- [ ] **Schritt 8: Tests laufen lassen, grün**

Ausführen: `cd desktop && node --test src/utils/nav.test.js && npx vite build`
Erwartet: 4 Tests grün, Build ohne Fehler.

- [ ] **Schritt 9: Commit**

```bash
git add docs/fixtures/design/nav.json desktop/src/utils/nav.test.js desktop/src/utils/routes.js desktop/src/utils/i18n-de.js desktop/src/components/Sidebar.jsx desktop/src/components/SammlungLayout.jsx desktop/src/components/VerkaufenLayout.jsx desktop/src/App.jsx
git commit -m "feat(i1): PC-Bereiche in vier Gruppen, Verkaufen und Decks eigenstaendig"
```

---

### Task 4: PC — die vier Stationen von „Verkaufen“ füllen

**Dateien:**
- Ändern: `desktop/src/components/VerkaufenLayout.jsx` (Panels), `desktop/src/components/CollectionList.jsx` (Segmente `duplicates`, `forsale`, `listings` entfernen), `desktop/src/components/Insights.jsx` (Reiter „Verkäufe“ entfernen), `desktop/src/components/Start.jsx` (Kachel-Ziele Z. 213–219)

**Schnittstellen:**
- Verbraucht: `VERKAUFEN_SEGMENTS`, `ROUTES` (Task 3); bestehende Komponenten `DuplicatesList`, `ForSaleList`, `ListingsList`, `SalesPanel`.
- Liefert: Bereich `/verkaufen/*` mit echten Inhalten.

- [ ] **Schritt 1: Panels bauen**

In `desktop/src/components/VerkaufenLayout.jsx` ergänzen und aus `App.jsx` importieren:

```jsx
// Die Daten-Hooks kommen unveraendert aus CollectionList: useSaleData laedt Exemplare mit for_sale,
// useListings die Angebote. Beide liegen bereits in src/hooks/ bzw. als lokale Hooks in CollectionList
// -- beim Umzug in src/hooks/useSaleData.js bzw. useListings.js verschieben, Verhalten unveraendert.
export function KandidatenPanel() { /* <DuplicatesList … /> wie bisher in CollectionList Z. 688 */ }
export function ZumVerkaufPanel() { /* <ForSaleList … /> wie bisher Z. 690 */ }
export function AngebotePanel() { /* <ListingsList … /> wie bisher Z. 692 */ }
export function VerkaeufePanel() { /* <SalesPanel … /> wie bisher im Insights-Reiter 'verkaeufe' */ }
```

Beim Verschieben gilt: Die Komponenten selbst (`DuplicatesList.jsx`, `ForSaleList.jsx`, `ListingsList.jsx`, `SalesPanel.jsx`) werden **nicht** verändert. Nur ihr Aufrufort und die Datenbeschaffung ziehen um. Die in `CollectionList.jsx` lokal definierten Lade-Hooks für Verkaufsdaten wandern nach `desktop/src/hooks/useSaleData.js` und `desktop/src/hooks/useListings.js` und werden dort exportiert.

- [ ] **Schritt 2: Kartenliste entkernen**

In `desktop/src/components/CollectionList.jsx` entfernen: die Chips `duplicates`, `forsale`, `listings` aus der Chip-Definition (Z. 592–600), die zugehörigen Zweige der Render-Weiche (Z. 687–692), die Verkaufs-Hooks und die daraus stammenden Zähler in `segmentCounts` (Z. 324–326). `openSaleCopy` bleibt, solange die Kartenliste selbst es nutzt; andernfalls ebenfalls entfernen.

- [ ] **Schritt 3: Insights aufräumen**

In `desktop/src/components/Insights.jsx` den Reiter `verkaeufe` aus der Reiterliste und der Weiche entfernen. `SalesPanel` und `SaleDetail` bleiben als Dateien bestehen und werden künftig aus `VerkaeufePanel` benutzt. Wer `/insights?tab=verkaeufe` aufruft (Handy-Rückkanal), wird auf `/verkaufen/verkaeufe` umgeleitet.

- [ ] **Schritt 4: Start-Kacheln umhängen**

In `desktop/src/components/Start.jsx`:

```jsx
// vorher: navigate(ROUTES.karten, { state: { segment: 'forsale' } })
navigate(ROUTES.zumVerkauf);
// vorher: segment 'duplicates'
navigate(ROUTES.kandidaten);
// vorher: segment 'listings'
navigate(ROUTES.angebote);
```

- [ ] **Schritt 5: Prüfläufe**

```bash
cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs && npx eslint . ; npx vite build
```
Erwartet: Tests grün, ESLint genau 5 Fehler, Build ohne Fehler.

- [ ] **Schritt 6: Sichtprüfung im Dev-Modus**

Ausführen: `cd desktop && npm run electron:dev`
Prüfen: Verkaufen zeigt vier Stationen mit den Listen wie vorher; Sammlung → Karten hat keine Verkaufs-Chips mehr; Insights hat keinen Verkäufe-Reiter; die drei Start-Kacheln landen an den neuen Orten.

- [ ] **Schritt 7: Commit**

```bash
git add desktop/src/components/VerkaufenLayout.jsx desktop/src/components/CollectionList.jsx desktop/src/components/Insights.jsx desktop/src/components/Start.jsx desktop/src/hooks/useSaleData.js desktop/src/hooks/useListings.js desktop/src/App.jsx
git commit -m "feat(i1): Verkaufen mit Kandidaten, Zum Verkauf, Angeboten und Verkaeufen"
```

---

### Task 5: PC — Kartenliste ohne Chips, zwei gespeicherte Filter

**Dateien:**
- Erstellen: `desktop/src/utils/cardFilters.js`, `desktop/src/utils/cardFilters.test.js`, `docs/fixtures/design/filter-presets.json`
- Ändern: `desktop/src/components/CollectionList.jsx` (Chip-Zeile Z. 590–612 entfällt, Filterblock Z. 624–664)

**Schnittstellen:**
- Verbraucht: nichts.
- Liefert: `cardFilters.js#PRESETS` (`[{ id, label }]`), `matchesPreset(card, id) -> boolean`.

- [ ] **Schritt 1: Fixture anlegen**

`docs/fixtures/design/filter-presets.json`:

```json
{
  "_": "ZWILLING: desktop/src/utils/cardFilters.test.js und android CardFilterPresetsTest.kt. Spec I §3.3.",
  "presets": [["unvollstaendig", "Unvollständige Daten"], ["foils", "Nur Foils"]],
  "faelle": [
    { "name": "vollstaendig, kein Foil", "karte": { "set_code": "LOB-DE001", "rarity": "Common", "price": 0.5 }, "unvollstaendig": false, "foils": false },
    { "name": "ohne Set-Code", "karte": { "set_code": "Unknown", "rarity": "Common", "price": 0.5 }, "unvollstaendig": true, "foils": false },
    { "name": "ohne Seltenheit", "karte": { "set_code": "LOB-DE001", "rarity": "", "price": 0.5 }, "unvollstaendig": true, "foils": false },
    { "name": "ohne Preis", "karte": { "set_code": "LOB-DE001", "rarity": "Common", "price": 0 }, "unvollstaendig": true, "foils": false },
    { "name": "Secret Rare ist Foil", "karte": { "set_code": "LOB-DE001", "rarity": "Secret Rare", "price": 12 }, "unvollstaendig": false, "foils": true },
    { "name": "Ultra Rare ist Foil", "karte": { "set_code": "LOB-DE001", "rarity": "Ultra Rare", "price": 3 }, "unvollstaendig": false, "foils": true },
    { "name": "Super Rare ist Foil", "karte": { "set_code": "LOB-DE001", "rarity": "Super Rare", "price": 1 }, "unvollstaendig": false, "foils": true },
    { "name": "Rare ist kein Foil", "karte": { "set_code": "LOB-DE001", "rarity": "Rare", "price": 1 }, "unvollstaendig": false, "foils": false }
  ]
}
```

- [ ] **Schritt 2: Fehlschlagenden Test schreiben**

`desktop/src/utils/cardFilters.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, matchesPreset } from './cardFilters.js';

// ZWILLING: android CardFilterPresetsTest.kt liest dieselbe Fixture.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/design/filter-presets.json', import.meta.url), 'utf8'));

test('Die Voreinstellungen heissen wie in der Fixture', () => {
  assert.deepEqual(PRESETS.map(p => [p.id, p.label]), F.presets);
});

test('Jeder Fixture-Fall trifft die erwartete Voreinstellung', () => {
  for (const c of F.faelle) {
    assert.equal(matchesPreset(c.karte, 'unvollstaendig'), c.unvollstaendig, `${c.name}: unvollstaendig`);
    assert.equal(matchesPreset(c.karte, 'foils'), c.foils, `${c.name}: foils`);
  }
});

test('Unbekannte Voreinstellung trifft nichts', () => {
  assert.equal(matchesPreset(F.faelle[0].karte, 'quatsch'), false);
});
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `cd desktop && node --test src/utils/cardFilters.test.js`
Erwartet: FAIL, `./cardFilters.js` fehlt.

- [ ] **Schritt 4: Helfer schreiben**

`desktop/src/utils/cardFilters.js`:

```js
// Spec I §3.3 -- aus den fruehereren Chips "Unvollstaendig" und "Foils" werden gespeicherte Filter.
export const PRESETS = [
  { id: 'unvollstaendig', label: 'Unvollständige Daten' },
  { id: 'foils', label: 'Nur Foils' },
];

const FOIL_RARITIES = ['Super Rare', 'Ultra Rare', 'Secret Rare', 'Ultimate Rare', 'Ghost Rare', 'Starlight Rare', 'Collector\u2019s Rare'];

export function matchesPreset(card, id) {
  if (!card) return false;
  if (id === 'unvollstaendig') {
    const ohneSet = !card.set_code || card.set_code === 'Unknown';
    const ohneRarity = !card.rarity;
    const ohnePreis = !Number(card.price);
    return ohneSet || ohneRarity || ohnePreis;
  }
  if (id === 'foils') return FOIL_RARITIES.includes(String(card.rarity || ''));
  return false;
}
```

- [ ] **Schritt 5: Test laufen lassen, grün**

Ausführen: `cd desktop && node --test src/utils/cardFilters.test.js`
Erwartet: PASS, 3 Tests.

- [ ] **Schritt 6: Kartenliste umbauen**

In `desktop/src/components/CollectionList.jsx`:
- Die gesamte Chip-Zeile (Z. 590–612) und den Banner-Block für Unbekannte (Z. 615–621) entfernen, ebenso `segment`/`setSegment` (Z. 92), die Segmentfilter (Z. 348–350) und `segmentCounts`.
- Im Filterblock oberhalb der Dropdowns eine Zeile mit den Voreinstellungen einfügen:

```jsx
<div className="flex flex-wrap gap-2 mb-3">
  {PRESETS.map(p => (
    <button key={p.id} type="button" onClick={() => togglePreset(p.id)}
      className={clsx('px-3 py-1.5 rounded-full text-xs border',
        presets.includes(p.id) ? 'bg-accent text-accent-fg border-transparent' : 'bg-surface-2 text-muted border-line')}>
      {p.label}
    </button>
  ))}
</div>
```

mit `const [presets, setPresets] = useState([]);`, `const togglePreset = (id) => setPresets(ps => ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id]);` und in der Filterschleife `if (presets.some(p => !matchesPreset(card, p))) continue;`. Aktive Voreinstellungen erscheinen zusätzlich in der bestehenden Zeile der aktiven Filter-Chips (Z. 667–677) und lassen sich dort einzeln entfernen.

- [ ] **Schritt 7: Prüfläufe und Sichtprüfung**

```bash
cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs && npx eslint . ; npx vite build
```
Dev-Modus: Die Kartenliste hat keine Chip-Zeile mehr; beide Voreinstellungen filtern und lassen sich als Chip wieder entfernen.

- [ ] **Schritt 8: Commit**

```bash
git add docs/fixtures/design/filter-presets.json desktop/src/utils/cardFilters.js desktop/src/utils/cardFilters.test.js desktop/src/components/CollectionList.jsx
git commit -m "feat(i1): Kartenliste ohne Chipwand, Unvollstaendig und Foils als Filter"
```

---

### Task 6: PC — Unbekannte bei Scannen, Zähler in der Seitenleiste

**Dateien:**
- Ändern: `desktop/electron/main.cjs` (neuer Handler), `desktop/electron/preload.cjs` (Z. 149–150 Umgebung), `desktop/electron/ipc-channels.test.cjs`, `desktop/src/components/StagingArea.jsx`, `desktop/src/components/Sidebar.jsx`

**Schnittstellen:**
- Verbraucht: `NAV_GROUPS` (Task 3).
- Liefert: IPC-Kanal `nav-counts` → `{ unknown: number, forSale: number, listingsOpen: number }`; `window.api.navCounts()`.

- [ ] **Schritt 1: Fehlschlagenden Kanal-Test ergänzen**

In `desktop/electron/ipc-channels.test.cjs` den Kanal `nav-counts` zur erwarteten Liste hinzufügen (die Datei prüft, dass jeder Kanal in `main.cjs` und `preload.cjs` vorkommt).

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/ipc-channels.test.cjs`
Erwartet: FAIL — `nav-counts` fehlt in `main.cjs` und `preload.cjs`.

- [ ] **Schritt 3: Handler schreiben**

In `desktop/electron/main.cjs` neben den anderen Handlern:

```js
// Spec I §3.1 -- Zaehler der Seitenleiste: offene Unbekannte, vorgemerkte Exemplare, laufende Angebote.
ipcMain.handle('nav-counts', () => {
  const zahl = (sql) => { try { return db.prepare(sql).get().n | 0; } catch { return 0; } };
  return {
    unknown: zahl("SELECT COUNT(*) AS n FROM cards WHERE set_code = 'Unknown' AND deleted = 0"),
    forSale: zahl('SELECT COUNT(*) AS n FROM card_copies WHERE for_sale = 1 AND deleted = 0 AND sold_in IS NULL'),
    listingsOpen: zahl("SELECT COUNT(*) AS n FROM listings WHERE deleted = 0 AND status = 'aktiv'"),
  };
});
```

In `desktop/electron/preload.cjs` daneben: `navCounts: () => ipcRenderer.invoke('nav-counts'),`

- [ ] **Schritt 4: Test laufen lassen, grün**

Ausführen: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
Erwartet: alle Tests grün.

- [ ] **Schritt 5: Unbekannte in Scannen einbauen**

In `desktop/src/components/StagingArea.jsx` unterhalb des bestehenden Inhalts einen Abschnitt ergänzen:

```jsx
<section className="mt-8">
  <h2 className="font-display text-lg text-text mb-1">Unbekannte Karten</h2>
  <p className="text-sm text-muted mb-3">
    Karten ohne Set-Code. Ordne sie zu, bevor Preise und Set-Fortschritt stimmen.
  </p>
  <div className="flex gap-2">
    <button type="button" className="px-3 py-2 rounded-lg text-sm bg-surface-2 border border-line text-text"
      disabled={busy} onClick={() => runUnknownAction('convert')}>Auf Standard-Set setzen</button>
    <button type="button" className="px-3 py-2 rounded-lg text-sm bg-surface-2 border border-line text-text"
      disabled={busy} onClick={() => runUnknownAction('merge')}>Alle zusammenführen</button>
  </div>
</section>
```

`runUnknownAction` wird dabei **wortgleich** aus `CollectionList.jsx` (Z. 486–499) hierher übernommen (inklusive der beiden Rückfragen und der Aufrufe `window.api.mergeUnknownCards()` bzw. `window.api.convertUnknownsToDefault()`) und dort entfernt. Die Liste der betroffenen Karten zeigt derselbe Abschnitt über die bestehende Kachelansicht; ist die Zahl null, entfällt der Abschnitt ganz.

- [ ] **Schritt 6: Zähler in der Seitenleiste**

In `desktop/src/components/Sidebar.jsx`:

```jsx
const [counts, setCounts] = useState({ unknown: 0, forSale: 0, listingsOpen: 0 });
useEffect(() => {
  let lebt = true;
  const laden = () => window.api?.navCounts?.().then(c => { if (lebt && c) setCounts(c); }).catch(() => {});
  laden();
  const ab = window.api?.onListingsChanged?.(laden);
  return () => { lebt = false; if (typeof ab === 'function') ab(); };
}, []);
const badge = (key) => (key === 'scannen' ? counts.unknown : key === 'verkaufen' ? counts.forSale + counts.listingsOpen : 0);
```

und im `NavItem`-Aufruf `badge={badge(n.key)}` übergeben; `NavItem` zeigt die Zahl rechts in `text-muted`, wenn sie größer als null ist.

- [ ] **Schritt 7: Prüfläufe**

```bash
cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs && node --test src/utils/*.test.js src/utils/*.test.mjs && npx eslint . ; npx vite build
```

- [ ] **Schritt 8: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs desktop/src/components/StagingArea.jsx desktop/src/components/CollectionList.jsx desktop/src/components/Sidebar.jsx
git commit -m "feat(i1): Unbekannte Karten bei Scannen, Zaehler in der Seitenleiste"
```

---

### Task 7: PC — feste Farben durch Rollen ersetzen

**Dateien:**
- Ändern: alle Renderer-Dateien mit `space-*`-Klassen (49 Dateien; die größten: `Settings.jsx` 35 Treffer, `StagingArea.jsx` 16, `DeckBuilder.jsx` 14, `CollectionList.jsx` 13, `Statistics.jsx` 10, `CardDetailPanel.jsx` 10)
- Ändern: `desktop/tailwind.config.js` (alte Namen entfernen), `desktop/src/index.css` (Reste)
- Erstellen: `desktop/src/utils/noLegacyColors.test.js`

**Schnittstellen:**
- Verbraucht: Rollen aus Task 2.
- Liefert: keine neuen Schnittstellen.

- [ ] **Schritt 1: Ersetzungstabelle festhalten**

| alt | neu |
|---|---|
| `bg-space-black`, `bg-obsidian`, `bg-obsidian-800` | `bg-bg` |
| `bg-space-charcoal`, `bg-obsidian-700` | `bg-surface` |
| `bg-obsidian-600` | `bg-surface-2` |
| `border-line`, `divide-line` | unverändert (zeigt jetzt auf `var(--line)`) |
| `text-ink` | `text-text` |
| `text-ink-muted`, `text-ink-faint` | `text-muted` |
| `bg-space-violet`, `bg-violet-soft` | `bg-accent` |
| `text-space-violet`, `text-violet-soft` | `text-accent` |
| `text-white` auf Akzentflächen | `text-accent-fg` |
| `text-gold`, `bg-gold`, `text-warn` | `text-warn` / `bg-warn` |
| `text-crit`, `bg-crit` | `text-bad` / `bg-bad` |
| `text-good`, `bg-good` | unverändert (zeigt jetzt auf `var(--good)`) |
| `text-rarity-*` | `text-muted` (Spec §6.2 Regel 3) |
| `shadow-[…#9D00FF…]`, `shadow-[0_6px_16px_-8px_…]`, `bg-gradient-*` auf Flächen | ersatzlos entfernen |

- [ ] **Schritt 2: Fehlschlagenden Wächter-Test schreiben**

`desktop/src/utils/noLegacyColors.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WURZEL = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dateien = [];
(function sammeln(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sammeln(p);
    else if (/\.(jsx?|css)$/.test(e) && !e.endsWith('.test.js')) dateien.push(p);
  }
})(WURZEL);

// Spec I §6.2 -- nach dem Umbau darf keine feste Farbe und kein Leuchteffekt mehr im Renderer stehen.
const VERBOTEN = [/\bspace-(black|charcoal|white|violet)/, /\bobsidian\b/, /\btext-ink\b/, /\bink-muted\b/,
  /\bcrit\b/, /\brarity-(common|rare|super|ultra|secret)\b/, /#9D00FF/i, /bg-gradient-/];

test('Kein Renderer-Code nutzt mehr die alte Palette oder Leuchteffekte', () => {
  const treffer = [];
  for (const f of dateien) {
    const t = readFileSync(f, 'utf8');
    for (const r of VERBOTEN) if (r.test(t)) treffer.push(`${f.split('src')[1]}: ${r}`);
  }
  assert.deepEqual(treffer, []);
});
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `cd desktop && node --test src/utils/noLegacyColors.test.js`
Erwartet: FAIL mit einer langen Trefferliste (49 Dateien).

- [ ] **Schritt 4: Dateien umstellen**

Datei für Datei nach der Tabelle aus Schritt 1 ersetzen. Reihenfolge nach Trefferzahl absteigend, damit die großen Brocken zuerst fallen. Nach jeweils etwa zehn Dateien `npx vite build` laufen lassen, damit Tippfehler früh auffallen. Bei jeder Datei zusätzlich prüfen: kein `shadow-[…]` mit Farbe, kein Verlauf, höchstens eine Fläche in `bg-accent` je Bildschirm.

- [ ] **Schritt 5: Alte Palette entfernen**

In `desktop/tailwind.config.js` die Einträge `space-black`, `space-charcoal`, `space-white`, `space-violet`, `space-violet-dark`, `violet-soft`, `obsidian`, `ink`, `gold`, `rarity`, `crit` löschen. `frame` (Kartenrahmen-Farben für Monster/Zauber/Falle) bleibt: Das sind Spielfarben, keine Oberflächenfarben.

- [ ] **Schritt 6: Tests laufen lassen, grün**

```bash
cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs && npx eslint . ; npx vite build
```
Erwartet: Wächter-Test grün, ESLint genau 5 Fehler, Build ohne Fehler.

- [ ] **Schritt 7: Sichtprüfung hell und dunkel**

`npm run electron:dev`, dann in Einstellungen → Darstellung zwischen Hell und Dunkel wechseln und jeden Bereich einmal öffnen (Start, Scannen, Sammlung mit allen fünf Unterseiten, Decks, Verkaufen mit allen vier, Deals, Insights, Einstellungen). Auf unlesbare Stellen achten, besonders Knöpfe auf Akzentflächen.

- [ ] **Schritt 8: Commit**

```bash
git add desktop/src desktop/tailwind.config.js
git commit -m "feat(i1): PC durchgehend auf Farbrollen umgestellt, Leuchteffekte entfernt"
```

---

### Task 8: Handy — Rollen, zwei Farbschemata, Umschalter

**Dateien:**
- Ändern: `android/app/src/main/java/com/example/yugiohscanner/ui/theme/Color.kt`, `ui/theme/Theme.kt`, `Prefs.kt`, `ui/SettingsScreen.kt`
- Ändern (mitcommitten): `android/app/src/test/java/com/example/yugiohscanner/DesignTokensTest.kt` (aus Task 1)
- Erstellen: `android/app/src/test/java/com/example/yugiohscanner/ThemeModusTest.kt`

**Schnittstellen:**
- Verbraucht: `docs/fixtures/design/tokens.json` (Task 1).
- Liefert: `ui.theme.AppColors` (`light`/`dark` als `Map<String, Color>`), `ui.theme.themeMode(setting: String?, systemDark: Boolean): String`, `Prefs.theme(ctx)` / `Prefs.setTheme(ctx, v)`.

- [ ] **Schritt 1: Fehlschlagenden Modus-Test schreiben**

`android/app/src/test/java/com/example/yugiohscanner/ThemeModusTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ui.theme.themeMode
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/theme.test.js (resolveMode). */
class ThemeModusTest {
    @Test fun hellIstDieVorgabe() {
        assertEquals("light", themeMode(null, true))
        assertEquals("light", themeMode("quatsch", true))
        assertEquals("light", themeMode("light", true))
    }
    @Test fun dunkelUndSystem() {
        assertEquals("dark", themeMode("dark", false))
        assertEquals("dark", themeMode("system", true))
        assertEquals("light", themeMode("system", false))
    }
}
```

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

Ausführen: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "*ThemeModusTest*" --tests "*DesignTokensTest*"`
Erwartet: Übersetzungsfehler (`themeMode`, `AppColors` fehlen).

- [ ] **Schritt 3: Rollen definieren**

`ui/theme/Color.kt` um die Rollen ergänzen (die alten Namen bleiben zunächst, damit nichts bricht):

```kotlin
// Spec I §6.1 -- Farbrollen, Werte gespiegelt aus docs/fixtures/design/tokens.json
// (DesignTokensTest.kt prueft die Gleichheit).
object AppColors {
    val light: Map<String, Color> = mapOf(
        "bg" to Color(0xFFF6F4EF), "surface" to Color(0xFFFFFDF8), "surface-2" to Color(0xFFF1EEE7),
        "line" to Color(0xFFE0DBD1), "text" to Color(0xFF1B1A17), "text-muted" to Color(0xFF6C675E),
        "accent" to Color(0xFF4B3F8F), "accent-fg" to Color(0xFFFFFFFF),
        "good" to Color(0xFF3F7D54), "warn" to Color(0xFF9A6B1F), "bad" to Color(0xFFA23B3B),
    )
    val dark: Map<String, Color> = mapOf(
        "bg" to Color(0xFF17181A), "surface" to Color(0xFF1D1F21), "surface-2" to Color(0xFF232528),
        "line" to Color(0xFF2E3134), "text" to Color(0xFFE9EAEC), "text-muted" to Color(0xFF9BA0A6),
        "accent" to Color(0xFF8B6AD6), "accent-fg" to Color(0xFF14151A),
        "good" to Color(0xFF7FA88A), "warn" to Color(0xFFC9A36B), "bad" to Color(0xFFC07A7A),
    )
}
```

- [ ] **Schritt 4: Zwei Schemata und Modus-Logik**

`ui/theme/Theme.kt`:

```kotlin
// 'light' | 'dark' | 'system' -> tatsaechlicher Modus; alles Unbekannte faellt auf hell zurueck.
fun themeMode(setting: String?, systemDark: Boolean): String = when (setting) {
    "dark" -> "dark"
    "system" -> if (systemDark) "dark" else "light"
    else -> "light"
}

private fun schema(r: Map<String, Color>, dunkel: Boolean) = (if (dunkel) darkColorScheme() else lightColorScheme()).copy(
    primary = r.getValue("accent"), onPrimary = r.getValue("accent-fg"),
    secondary = r.getValue("accent"), onSecondary = r.getValue("accent-fg"),
    background = r.getValue("bg"), onBackground = r.getValue("text"),
    surface = r.getValue("surface"), onSurface = r.getValue("text"),
    surfaceVariant = r.getValue("surface-2"), onSurfaceVariant = r.getValue("text-muted"),
    outline = r.getValue("line"), error = r.getValue("bad"), onError = r.getValue("accent-fg"),
)

@Composable
fun AppTheme(setting: String?, content: @Composable () -> Unit) {
    val dunkel = themeMode(setting, isSystemInDarkTheme()) == "dark"
    MaterialTheme(colorScheme = schema(if (dunkel) AppColors.dark else AppColors.light, dunkel), content = content)
}
```

Die bisherigen Einzelkonstanten (`Background`, `SurfaceColor`, `Line`, `Primary`, `Muted`, `Good`, `Gold`, `ErrorColor`) werden zu Ablesungen aus dem laufenden Schema; wo sie als Konstante nötig bleiben, zeigen sie auf `AppColors.light`. Die Rarity- und Typ-Farben bleiben unverändert (Spielfarben, keine Oberflächenfarben) — außer dort, wo sie Text einfärben: dort `MaterialTheme.colorScheme.onSurfaceVariant` (Spec §6.2 Regel 3).

- [ ] **Schritt 5: Einstellung speichern**

In `Prefs.kt`:

```kotlin
fun theme(ctx: Context): String = p(ctx).getString("theme", null)?.takeIf { it in setOf("light", "dark", "system") } ?: "light"
fun setTheme(ctx: Context, v: String) = p(ctx).edit().putString("theme", v).apply()
```

In `MainActivity`/`AppNav` den gespeicherten Wert als Zustand halten und an `AppTheme(setting = ...)` geben, damit ein Wechsel sofort wirkt.

- [ ] **Schritt 6: Abschnitt „Darstellung“**

In `ui/SettingsScreen.kt` vor „Über“:

```kotlin
SectionHeader("Darstellung")
Text("Gilt nur auf diesem Gerät.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    listOf("light" to "Hell", "dark" to "Dunkel", "system" to "Wie das System").forEach { (id, label) ->
        FilterChip(selected = theme == id, onClick = { theme = id; Prefs.setTheme(ctx, id); onTheme(id) }, label = { Text(label) })
    }
}
```

- [ ] **Schritt 7: Tests laufen lassen, grün**

```bash
ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug
```
Erwartet: BUILD SUCCESSFUL, `DesignTokensTest` und `ThemeModusTest` grün.

- [ ] **Schritt 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/theme android/app/src/main/java/com/example/yugiohscanner/Prefs.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt android/app/src/test/java/com/example/yugiohscanner/DesignTokensTest.kt android/app/src/test/java/com/example/yugiohscanner/ThemeModusTest.kt
git commit -m "feat(i1): Handy-Farbrollen aus der Token-Datei, Hell und Dunkel umschaltbar"
```

---

### Task 9: Handy — vier Ziele, Bereich „Verkaufen“, Decks über Start

**Dateien:**
- Erstellen: `android/.../ui/VerkaufenScreen.kt`, `android/app/src/test/java/com/example/yugiohscanner/NavTabellenTest.kt`
- Ändern: `android/.../ui/AppNav.kt` (Routen Z. 47–78, `TOP_LEVEL` Z. 84–89, Start-Kacheln Z. 218–234, Bottom-Bar Z. 337–357), `ui/SammlungScreen.kt` (Segmente Z. 17–24), `ui/StartScreen.kt` (Kacheln), `ui/SaleLists.kt` (`CollectionChip` Z. 50–61)

**Schnittstellen:**
- Verbraucht: `docs/fixtures/design/nav.json` (Task 3).
- Liefert: `Routes.verkaufen(segment: String = "kandidaten")`, `Routes.DECKS`; `NavTabellen.LEISTE`, `NavTabellen.SAMMLUNG`, `NavTabellen.VERKAUFEN` als geprüfte Tabellen.

- [ ] **Schritt 1: Fehlschlagenden Zwilling schreiben**

`android/app/src/test/java/com/example/yugiohscanner/NavTabellenTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ui.NavTabellen
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/nav.test.js -- dieselbe Tabelle docs/fixtures/design/nav.json. */
class NavTabellenTest {
    private val n = JSONObject(Fixtures.text("docs/fixtures/design/nav.json"))

    private fun paare(schluessel: String): List<Pair<String, String>> {
        val a = n.getJSONObject("segments").getJSONArray(schluessel)
        return (0 until a.length()).map { a.getJSONArray(it).getString(0) to a.getJSONArray(it).getString(1) }
    }

    @Test fun untereLeisteZeigtVierZiele() {
        val a = n.getJSONArray("handyLeiste")
        assertEquals((0 until a.length()).map { a.getString(it) }, NavTabellen.LEISTE.map { it.first })
        assertEquals(4, NavTabellen.LEISTE.size)
    }

    @Test fun beschriftungenStimmen() {
        val labels = n.getJSONObject("labels")
        for ((key, label) in NavTabellen.LEISTE) assertEquals(key, labels.getString(key), label)
    }

    @Test fun unterteilungenStimmen() {
        assertEquals(paare("sammlung"), NavTabellen.SAMMLUNG)
        assertEquals(paare("verkaufen"), NavTabellen.VERKAUFEN)
    }
}
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "*NavTabellenTest*"`
Erwartet: Übersetzungsfehler, `NavTabellen` fehlt.

- [ ] **Schritt 3: Tabellen anlegen**

In `android/.../ui/AppNav.kt` (oberhalb von `TOP_LEVEL`):

```kotlin
// Spec I §3 -- die Tabellen stehen in docs/fixtures/design/nav.json; NavTabellenTest haelt beide Seiten gleich.
object NavTabellen {
    val LEISTE = listOf("start" to "Start", "sammlung" to "Sammlung", "verkaufen" to "Verkaufen", "deals" to "Deals")
    val SAMMLUNG = listOf("karten" to "Karten", "binder" to "Binder", "sets" to "Sets", "wunschliste" to "Wunschliste", "sealed" to "Sealed")
    val VERKAUFEN = listOf("kandidaten" to "Kandidaten", "zum-verkauf" to "Zum Verkauf", "angebote" to "Angebote", "verkaeufe" to "Verkäufe")
}
```

- [ ] **Schritt 4: Bereich „Verkaufen“ bauen**

`android/.../ui/VerkaufenScreen.kt`:

```kotlin
// Spec I §5.3 -- vier Stationen in der Reihenfolge des Vorgangs. Die Listen selbst bleiben unveraendert.
@Composable
fun VerkaufenScreen(segment: String, onSegment: (String) -> Unit, onOpenKarte: (String) -> Unit) {
    val gewaehlt = NavTabellen.VERKAUFEN.indexOfFirst { it.first == segment }.coerceAtLeast(0)
    Column(Modifier.fillMaxSize()) {
        ScrollableTabRow(selectedTabIndex = gewaehlt, edgePadding = 16.dp) {
            NavTabellen.VERKAUFEN.forEachIndexed { i, (id, label) ->
                Tab(selected = i == gewaehlt, onClick = { onSegment(id) }, text = { Text(label) })
            }
        }
        when (segment) {
            "zum-verkauf" -> ForSaleList(onOpenKarte)
            "angebote" -> ListingsScreen(onOpenKarte)
            "verkaeufe" -> SalesScreen(onOpenKarte)
            else -> DuplicatesList(onOpenKarte)
        }
    }
}
```

Die aufgerufenen Bausteine sind die vorhandenen aus `SaleLists.kt`, `ListingsScreen.kt` und `SalesScreen.kt`; ihre Signaturen bleiben unverändert, nur der Aufrufort wechselt.

- [ ] **Schritt 5: Navigation umbauen**

In `AppNav.kt`:
- `Routes` um `const val DECKS = "decks"` und `fun verkaufen(segment: String = "kandidaten") = "verkaufen/$segment"` ergänzen.
- `TOP_LEVEL` um den Eintrag `TopLevel(Routes.verkaufen(), "verkaufen", "Verkaufen", Icons.Default.Payments)` erweitern (Reihenfolge wie `NavTabellen.LEISTE`).
- `AppBottomBar`: vier `NavItem` plus Lücke für den Scan-Knopf:

```kotlin
Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
    NavItem(Modifier.weight(1f), TOP_LEVEL[0], current, nav)   // Start
    NavItem(Modifier.weight(1f), TOP_LEVEL[1], current, nav)   // Sammlung
    Spacer(Modifier.weight(0.6f))                              // Luecke unter dem Scan-Knopf
    NavItem(Modifier.weight(1f), TOP_LEVEL[2], current, nav)   // Verkaufen
    NavItem(Modifier.weight(1f), TOP_LEVEL[3], current, nav)   // Deals
}
```

- Routen registrieren: `composable(Routes.DECKS) { DecksScreen() }` und `composable("verkaufen/{segment}") { VerkaufenScreen(...) }`.
- Start-Kacheln: `onOpenForSale`, `onOpenDuplicates`, `onOpenListings` navigieren künftig direkt (`nav.navigateTop(Routes.verkaufen("zum-verkauf"))` usw.), `onOpenDecks` neu für die Decks-Kachel.

- [ ] **Schritt 6: Sammlung und CollectionChip aufräumen**

`SammlungScreen.kt`: `SEGMENTS` durch `NavTabellen.SAMMLUNG` ersetzen (Decks fällt weg), den `"decks"`-Zweig der `when`-Weiche entfernen.
`SaleLists.kt`: `CollectionChip` ersatzlos entfernen, samt der Aufrufe in `CollectionScreen.kt` — die Sprünge laufen jetzt über echte Routen.

- [ ] **Schritt 7: Decks-Kachel auf Start**

In `StartScreen.kt` eine Kachel „Decks“ neben „Scannen/Sammlung/Deals“ ergänzen, die `onOpenDecks()` aufruft.

- [ ] **Schritt 8: Tests und Bau, grün**

```bash
ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug
```
Erwartet: BUILD SUCCESSFUL, `NavTabellenTest` grün.

- [ ] **Schritt 9: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui android/app/src/test/java/com/example/yugiohscanner/NavTabellenTest.kt
git commit -m "feat(i1): Handy mit vier Zielen, eigenem Bereich Verkaufen und Decks ueber Start"
```

---

### Task 10: Handy — Kartenliste ohne Chips, Filter-Voreinstellungen

**Dateien:**
- Erstellen: `android/.../ml/CardFilterPresets.kt`, `android/app/src/test/java/com/example/yugiohscanner/CardFilterPresetsTest.kt`
- Ändern: `android/.../ui/CollectionScreen.kt` (Chip-Zeile Z. 223–229, Filter-Sheet Z. 291–320)

**Schnittstellen:**
- Verbraucht: `docs/fixtures/design/filter-presets.json` (Task 5).
- Liefert: `CardFilterPresets.ALLE: List<Pair<String, String>>`, `CardFilterPresets.trifft(karte: CardRow, id: String): Boolean`.

- [ ] **Schritt 1: Fehlschlagenden Zwilling schreiben**

`android/app/src/test/java/com/example/yugiohscanner/CardFilterPresetsTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.CardFilterPresets
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/cardFilters.test.js -- dieselbe Fixture docs/fixtures/design/filter-presets.json. */
class CardFilterPresetsTest {
    private val f = JSONObject(Fixtures.text("docs/fixtures/design/filter-presets.json"))

    @Test fun voreinstellungenHeissenGleich() {
        val a = f.getJSONArray("presets")
        assertEquals((0 until a.length()).map { a.getJSONArray(it).getString(0) to a.getJSONArray(it).getString(1) },
            CardFilterPresets.ALLE)
    }

    @Test fun alleFaelleTreffen() {
        val a = f.getJSONArray("faelle")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            val k = c.getJSONObject("karte")
            val name = c.getString("name")
            assertEquals("$name: unvollstaendig", c.getBoolean("unvollstaendig"),
                CardFilterPresets.trifft(k.optString("set_code"), k.optString("rarity"), k.optDouble("price", 0.0), "unvollstaendig"))
            assertEquals("$name: foils", c.getBoolean("foils"),
                CardFilterPresets.trifft(k.optString("set_code"), k.optString("rarity"), k.optDouble("price", 0.0), "foils"))
        }
    }
}
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "*CardFilterPresetsTest*"`
Erwartet: Übersetzungsfehler, `CardFilterPresets` fehlt.

- [ ] **Schritt 3: Helfer schreiben**

`android/.../ml/CardFilterPresets.kt`:

```kotlin
package com.example.yugiohscanner.ml

// Spec I §3.3 -- Zwilling zu desktop/src/utils/cardFilters.js. Werte kommen aus der gemeinsamen Fixture.
object CardFilterPresets {
    val ALLE = listOf("unvollstaendig" to "Unvollständige Daten", "foils" to "Nur Foils")

    private val FOILS = setOf("Super Rare", "Ultra Rare", "Secret Rare", "Ultimate Rare", "Ghost Rare", "Starlight Rare", "Collector\u2019s Rare")

    fun trifft(setCode: String?, rarity: String?, price: Double, id: String): Boolean = when (id) {
        "unvollstaendig" -> setCode.isNullOrBlank() || setCode == "Unknown" || rarity.isNullOrBlank() || price <= 0.0
        "foils" -> rarity in FOILS
        else -> false
    }
}
```

- [ ] **Schritt 4: Kartenliste umbauen**

In `ui/CollectionScreen.kt` die Chip-Zeile (Z. 223–229) ersatzlos entfernen — samt `chip`-Zustand und `CollectionChip`-Anbindung — und im Filter-Sheet oben eine Zeile mit den Voreinstellungen ergänzen:

```kotlin
Text("Voreinstellungen", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    CardFilterPresets.ALLE.forEach { (id, label) ->
        FilterChip(selected = id in presets, onClick = { presets = if (id in presets) presets - id else presets + id }, label = { Text(label) })
    }
}
```

mit `var presets by rememberSaveable { mutableStateOf(setOf<String>()) }` und in der Filterschleife `if (presets.any { !CardFilterPresets.trifft(k.setCode, k.rarity, k.price, it) }) return@filter false`.

- [ ] **Schritt 5: Tests und Bau, grün**

```bash
ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug
```

- [ ] **Schritt 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/CardFilterPresets.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/test/java/com/example/yugiohscanner/CardFilterPresetsTest.kt
git commit -m "feat(i1): Handy-Kartenliste ohne Chipzeile, Voreinstellungen im Filter"
```

---

### Task 11: Bauen, aufspielen, abnehmen

**Dateien:** keine Quelländerung; nur Bauen und Prüfen.

- [ ] **Schritt 1: Alle Prüfläufe am Stück**

```bash
cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs && npx eslint . ; npx vite build
```
Erwartet: Helfer-Tests grün, SQLite-Tests grün, ESLint genau 5 Fehler, Build ohne Fehler.

```bash
ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug
```
Erwartet: BUILD SUCCESSFUL.

- [ ] **Schritt 2: Installer bauen und prüfen**

```bash
cd desktop && npm run dist
```
Danach im gebauten Paket nachsehen, dass der neue Kanal wirklich drin ist:

```bash
cd desktop && node -e "const s=require('fs').readFileSync('dist-electron/win-unpacked/resources/app.asar');console.log('nav-counts', s.includes(Buffer.from('nav-counts')));"
```
Erwartet: `nav-counts true`. Den Installer zusätzlich nach `desktop/dist-installer/i1/` kopieren.

- [ ] **Schritt 3: Handy aufspielen**

```bash
export MSYS_NO_PATHCONV=1
"/c/Users/Buzzty/AppData/Local/Android/Sdk/platform-tools/adb.exe" install -r "C:/Users/Buzzty/Downloads/yugi/android/app/build/outputs/apk/debug/app-debug.apk"
"/c/Users/Buzzty/AppData/Local/Android/Sdk/platform-tools/adb.exe" shell monkey -p com.example.yugiohscanner -c android.intent.category.LAUNCHER 1
"/c/Users/Buzzty/AppData/Local/Android/Sdk/platform-tools/adb.exe" logcat -b crash -d -t 40
```
Erwartet: „Success“, App startet, kein Absturzprotokoll.

- [ ] **Schritt 4: Abnahme mit dem Nutzer**

Die für I1 zuständigen Punkte aus Spec §8 durchgehen: 1 (Gruppen und Zähler), 2 (Kartenliste ohne Chips, beide Voreinstellungen), 3 (Unbekannte bei Scannen), 7 (vier Stationen, Verkäufe nicht mehr in Insights), 8 (Hell/Dunkel, keine Verläufe), 9 (Handy: vier Ziele, gleiche Wörter), 10 (Testsuiten grün). Die Punkte 4, 5 und 6 betreffen Exemplarzeile, Dialog und Verkaufsweg — die kommen erst mit I2.

---

## Selbstprüfung

**Spec-Abdeckung:** §3.1 Bereiche → Task 3; §3.1 Umzüge → Task 4 (Verkaufen, Verkäufe), Task 6 (Unbekannte), Task 3 (Decks); §3.2 Handy → Task 9; §3.3 Kartenliste → Task 5 und 10; §6.1 Rollen → Task 1, 2, 8; §6.2 Regeln → Task 7 (Wächter-Test); §6.3 Schrift und Raster → Task 7 (Sichtprüfung, keine eigene Prüfung — bewusst, weil Abstände und Schriftgrößen beim Umstellen mitlaufen); §6.4 Umsetzung und Umschalter → Task 2 und 8; §7 Verträglichkeit → Task 3 (Weiterleitungen) und Task 4 (Insights-Weiterleitung); §8 Abnahme → Task 11.

**Nicht in diesem Plan** (gehört zu I2): Spec §4 (Exemplarzeile, Exemplar-Dialog) und §5 (Verkaufsweg, Fluss-Regeln, Rückgängig-Leiste).

**Offene Annahme:** Die Spalten in `nav-counts` (`cards.set_code`, `card_copies.for_sale`, `listings.status`) entsprechen dem heutigen Schema; falls eine Abfrage im SQLite-Test scheitert, ist die Abfrage anzupassen, nicht das Schema.
