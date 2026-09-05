# Spec C, Teil 1 — Desktop: Navigation und Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Electron desktop gets real navigation (routable pages, working back/forward), the card detail becomes a side panel instead of a modal, Sammlung gathers Karten/Wunschliste/Sets/Decks under one page with segments, the collection toolbar stops being a wall of controls, Start becomes a dashboard, Settings gets sections with a danger zone, and every visible string is German.

**Architecture:** `HashRouter` (Electron loads the app from `file://`, so a browser router cannot work) wraps the existing shell. `App.jsx` stops being a `useState('activeTab')` switch and becomes a route table; the sidebar uses `NavLink`. The card detail moves to an **overlay route** rendered beside the list: the background page keeps rendering because the route table is driven by `location.state.background`, the standard React Router recipe. Nothing about the visual language changes — same Tailwind palette, same `SpaceCard`-style surfaces. This is a re-arrangement, not a redesign.

**Tech Stack:** React 19 + Vite 7 (renderer, ESM), `react-router-dom` v7 (new dependency), Tailwind 3 with the project palette, Electron main in CommonJS `.cjs` (only touched in Task 5 for the phone-connection status), Node's built-in `node --test` for pure helpers.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-spec-c-navigation-layout-design.md`. Part 2 (Android) is a separate plan; do not touch `android/` here.
- Renderer stays ESM; Electron main files stay CommonJS `.cjs`. Never convert one to the other.
- **Every user-visible string is German.** The binding vocabulary (Spec C §4): Start · Scannen · Sammlung · Karten · Wunschliste · Sets · Decks · Deals · Insights · Einstellungen · Übernehmen · Prüfen · Abbrechen · Zurück · Exemplar · Printing · Set-Code · Rarity · Passcode · Edition · Zustand. Yu-Gi-Oh terms stay English (Rarity, Set-Code, Passcode, Secret Rare, …).
- This is a layout change, not a feature change: no new IPC beyond the phone-connection events in Task 5, no new data, no behaviour change to scanning, pricing, or the copies model from Spec A.
- Keep the existing Tailwind palette and class idioms (`obsidian-*`, `line`, `ink`, `ink-muted`, `ink-faint`, `space-violet`, `violet-soft`, `gold`, `good`, `crit`, `font-display`, `font-mono`). Do not introduce new colors.
- Route paths are German and fixed: `/start`, `/scannen`, `/sammlung/karten`, `/sammlung/wunschliste`, `/sammlung/sets`, `/sammlung/decks`, `/deals`, `/insights`, `/einstellungen`, `/einstellungen/:bereich`, `/karte/:id/:setCode/:language/:rarity`.
- Printing identity stays the 4-column key `(id, set_code, language, rarity)`; route params are always `encodeURIComponent`-encoded (a rarity can contain `/`, e.g. `Ghost/Gold Rare`).
- Verification for every renderer task: `npm run lint` from `desktop/` must show **only the 5 pre-existing errors** (`CollectionList.jsx` `viewMode`/`setViewMode`, an unused `e`, `CustomSelect` `Icon`) — a task that removes one of them by accident is fine, adding one is not — and `npm run build` must succeed. `desktop/dist/` is git-ignored; never commit it.
- Pure helpers get a `node --test` unit test (`node --test src/utils/<file>.test.mjs` from `desktop/`).
- Do not start the Electron app. The controller does the visual pass in a browser against the Vite dev server after each task.
- **node_modules note:** in a worktree, `desktop/node_modules` is a directory junction to the main checkout. `npm install react-router-dom` (Task 1) therefore writes into the shared tree — that is expected and harmless; the dependency only becomes real for main when this branch merges. Never run a bare `npm install` (it would rebuild better-sqlite3 for the wrong ABI).
- Commit style: `feat(desktop): …` / `fix(desktop): …` / `refactor(desktop): …`, one commit per task, message ending with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/utils/i18n-de.js` (new) | `NAV` (route + label + icon key per nav entry) and `T` (shell strings used in more than one component). Not a framework — a constants table. |
| `desktop/src/utils/i18n-de.test.mjs` (new) | Asserts the vocabulary is complete and German. |
| `desktop/src/utils/routes.js` (new) | `ROUTES` constants, `cardRoute(printing)`, `printingFromParams(params)`. Pure. |
| `desktop/src/utils/routes.test.mjs` (new) | Round-trip incl. a rarity containing `/`. |
| `desktop/src/main.jsx` | Wraps `<App/>` in `<HashRouter>`. |
| `desktop/src/App.jsx` | Route table + shell layout + the panel slot; keeps the scan-staging state and the update-progress banner. |
| `desktop/src/components/Sidebar.jsx` | Six `NavLink` entries, no group labels, phone-status pill instead of the IP box. |
| `desktop/src/components/SammlungLayout.jsx` (new) | Segment bar (Karten · Wunschliste · Sets · Decks) + `<Outlet/>`. |
| `desktop/src/components/CardDetailPanel.jsx` (new, from `CardDetailModal.jsx`) | Right-hand panel; loads its card from the route params; prev/next through the list handed over in `location.state.list`. |
| `desktop/src/components/CollectionList.jsx` | Two-tier toolbar, `Preise` menu, collapsible filter row, active-filter chips, opens the panel by route. |
| `desktop/src/components/Start.jsx` (new, from `Dashboard.jsx`) | Value card with Δ, work lists, recently added, set progress. |
| `desktop/src/components/Settings.jsx` | Sub-navigation by `/einstellungen/:bereich`, sections, Gefahrenzone. |
| `desktop/src/components/CommandPalette.jsx` | Navigates by route; opens the panel route for a card. |
| `desktop/electron/main.cjs`, `preload.cjs` | Task 5 only: emit/expose `phone-connected` / `phone-disconnected`. |

---

### Task 1: Router foundation, vocabulary, sidebar

**Files:**
- Create: `desktop/src/utils/i18n-de.js`, `desktop/src/utils/i18n-de.test.mjs`
- Create: `desktop/src/utils/routes.js`, `desktop/src/utils/routes.test.mjs`
- Modify: `desktop/package.json` (dependency), `desktop/src/main.jsx`, `desktop/src/App.jsx`, `desktop/src/components/Sidebar.jsx`, `desktop/src/components/CommandPalette.jsx`, `desktop/src/components/Dashboard.jsx` (navigation calls only)

**Interfaces:**
- Produces: `import { ROUTES, cardRoute, printingFromParams } from '../utils/routes'`
  - `ROUTES`: `{ start, scannen, karten, wunschliste, sets, decks, deals, insights, einstellungen }` → the paths from the Global Constraints.
  - `cardRoute(printing): string` — `/karte/<id>/<set_code>/<language>/<rarity>`, each segment `encodeURIComponent`-encoded; missing values default to `Unknown`/`DE`.
  - `printingFromParams(params): { id, set_code, language, rarity }` — the inverse, decoding each segment.
- Produces: `import { NAV, T } from '../utils/i18n-de'`
  - `NAV`: ordered array `[{ key, to, label }]` for Start, Scannen, Sammlung, Deals, Insights (Einstellungen is rendered separately at the bottom).
  - `T`: shell strings, at least `{ start, scannen, sammlung, karten, wunschliste, sets, decks, deals, insights, einstellungen, uebernehmen, pruefen, abbrechen, zurueck, suchen, keineTreffer, exemplar, exemplare }`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Add the dependency**

Run (from `desktop/`): `npm install react-router-dom@^7 --save`
Expected: `package.json` gains `"react-router-dom": "^7.x"`. Do not run a bare `npm install`.

- [ ] **Step 2: Write the failing tests**

`desktop/src/utils/routes.test.mjs`:
```js
import assert from 'node:assert';
import { ROUTES, cardRoute, printingFromParams } from './routes.js';

assert.equal(ROUTES.start, '/start');
assert.equal(ROUTES.karten, '/sammlung/karten');
assert.equal(ROUTES.einstellungen, '/einstellungen');

// A printing key round-trips, including a rarity with a slash and a space.
const p = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ghost/Gold Rare' };
const route = cardRoute(p);
assert.ok(!route.includes('Ghost/Gold'), 'the slash inside a segment must be encoded');
const params = Object.fromEntries(
  ['id', 'setCode', 'language', 'rarity'].map((k, i) => [k, route.split('/').slice(2)[i]]),
);
assert.deepStrictEqual(printingFromParams(params), p);

// Defaults for a card that has no printing yet.
assert.equal(cardRoute({ id: '1' }), '/karte/1/Unknown/DE/Unknown');
console.log('routes test: PASS');
```

`desktop/src/utils/i18n-de.test.mjs`:
```js
import assert from 'node:assert';
import { NAV, T } from './i18n-de.js';

assert.deepStrictEqual(NAV.map(n => n.key), ['start', 'scannen', 'sammlung', 'deals', 'insights']);
assert.deepStrictEqual(NAV.map(n => n.to), ['/start', '/scannen', '/sammlung/karten', '/deals', '/insights']);
assert.deepStrictEqual(NAV.map(n => n.label), ['Start', 'Scannen', 'Sammlung', 'Deals', 'Insights']);

for (const k of ['start', 'scannen', 'sammlung', 'karten', 'wunschliste', 'sets', 'decks', 'deals',
                 'insights', 'einstellungen', 'uebernehmen', 'pruefen', 'abbrechen', 'zurueck',
                 'suchen', 'keineTreffer', 'exemplar', 'exemplare']) {
  assert.ok(typeof T[k] === 'string' && T[k].length > 0, `missing vocabulary key: ${k}`);
}
// The renamed terms must be gone from the shared table.
const forbidden = /\b(Collection|Settings|Wishlist|Submit|Cancel|Commit|Staging|Home)\b/;
for (const [k, v] of Object.entries(T)) assert.ok(!forbidden.test(v), `English leftover in T.${k}: ${v}`);
console.log('i18n-de test: PASS');
```

- [ ] **Step 3: Run them — expect module-not-found**

Run (from `desktop/`): `node --test src/utils/routes.test.mjs src/utils/i18n-de.test.mjs`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 4: Implement the two helpers**

`desktop/src/utils/routes.js`:
```js
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
```

`desktop/src/utils/i18n-de.js`:
```js
// The app is German. This is the shared vocabulary — strings that appear in more than one
// component — so a rename happens in one place. Single-use strings stay inline where they belong.
// Yu-Gi-Oh terms (Rarity, Set-Code, Passcode, Secret Rare …) stay English on purpose.
export const T = {
  start: 'Start',
  scannen: 'Scannen',
  sammlung: 'Sammlung',
  karten: 'Karten',
  wunschliste: 'Wunschliste',
  sets: 'Sets',
  decks: 'Decks',
  deals: 'Deals',
  insights: 'Insights',
  einstellungen: 'Einstellungen',
  uebernehmen: 'Übernehmen',
  pruefen: 'Prüfen',
  abbrechen: 'Abbrechen',
  zurueck: 'Zurück',
  suchen: 'Suchen',
  keineTreffer: 'Keine Treffer',
  exemplar: 'Exemplar',
  exemplare: 'Exemplare',
};

// Sidebar order. `key` doubles as the lucide icon lookup in Sidebar.jsx.
export const NAV = [
  { key: 'start', to: '/start', label: T.start },
  { key: 'scannen', to: '/scannen', label: T.scannen },
  { key: 'sammlung', to: '/sammlung/karten', label: T.sammlung },
  { key: 'deals', to: '/deals', label: T.deals },
  { key: 'insights', to: '/insights', label: T.insights },
];
```

- [ ] **Step 5: Run the tests — expect PASS**

Run: `node --test src/utils/routes.test.mjs src/utils/i18n-de.test.mjs`
Expected: 2 files, `pass 2`, both PASS lines printed.

- [ ] **Step 6: Wrap the app in the router**

`desktop/src/main.jsx` — add the import and the wrapper (leave the font imports untouched):
```jsx
import { HashRouter } from 'react-router-dom'
```
```jsx
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
```
`HashRouter` (not `BrowserRouter`): the packaged app loads `dist/index.html` over `file://`, where path-based routing cannot work.

- [ ] **Step 7: Turn `App.jsx` into a route table**

Replace the whole component (keep the scan listener and the update-progress effect exactly as they are — only the rendering changes):
```jsx
import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import CollectionList from './components/CollectionList';
import Wishlist from './components/Wishlist';
import SetCompletion from './components/SetCompletion';
import Settings from './components/Settings';
import Dashboard from './components/Dashboard';
import Deals from './components/Deals';
import ErrorBoundary from './components/ErrorBoundary';

const Insights = lazy(() => import('./components/Insights'));
const DeckBuilder = lazy(() => import('./components/DeckBuilder'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));

function App() {
  const [scannedCards, setScannedCards] = useState([]);
  const [updateProgress, setUpdateProgress] = useState(null); // { current, total } or null
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();

  // …the two existing useEffects (onCardScanned, onUpdateProgress) stay unchanged…

  // Cmd/Ctrl+K opens the palette; Alt+Arrow walks the history like a browser (Electron's
  // mouse back/forward buttons already drive the same history).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
    };
    const onMouse = (e) => {
      if (e.button === 3) { e.preventDefault(); navigate(-1); }
      if (e.button === 4) { e.preventDefault(); navigate(1); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse); };
  }, [navigate]);

  return (
    <div className="flex h-screen bg-obsidian text-ink overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-obsidian p-6 flex flex-col">
        {updateProgress && (
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-2 flex items-center justify-between text-xs text-space-violet animate-pulse">
                <span className="font-bold uppercase tracking-wider">Kartendaten werden aktualisiert…</span>
                <span>{updateProgress.current} / {updateProgress.total}</span>
            </div>
        )}
        <div className="flex-1 overflow-auto">
            <ErrorBoundary>
              <Suspense fallback={<div className="flex items-center justify-center h-full text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
                <Routes>
                  <Route path="/" element={<Navigate to="/start" replace />} />
                  <Route path="/start" element={<Dashboard onOpenPalette={() => setPaletteOpen(true)} />} />
                  <Route path="/scannen" element={<StagingArea scannedCards={scannedCards} setScannedCards={setScannedCards} isUpdating={!!updateProgress} />} />
                  <Route path="/sammlung/karten" element={<CollectionList isUpdating={!!updateProgress} setUpdateProgress={setUpdateProgress} />} />
                  <Route path="/sammlung/wunschliste" element={<Wishlist />} />
                  <Route path="/sammlung/sets" element={<SetCompletion />} />
                  <Route path="/sammlung/decks" element={<DeckBuilder />} />
                  <Route path="/deals" element={<Deals />} />
                  <Route path="/insights" element={<Insights />} />
                  <Route path="/einstellungen" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/start" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
        </div>
      </main>
      <Suspense fallback={null}>
        {paletteOpen && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />}
      </Suspense>
    </div>
  );
}

export default App;
```
`SetCompletion` renders a fixed-height panel today; wrap it so the page fills the area:
`<Route path="/sammlung/sets" element={<div className="h-full"><SetCompletion /></div>} />`.

- [ ] **Step 8: Rewrite the sidebar**

`desktop/src/components/Sidebar.jsx` — `NavItem` becomes a `NavLink`, the group labels and the four extra entries go away, the brand block and the IP box stay untouched for now (Task 5 replaces the IP box):
```jsx
import { Home, ScanLine, Library, Tag, BarChart3, Settings as SettingsIcon, Wifi } from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { NAV, T } from '../utils/i18n-de';

const ICONS = { start: Home, scannen: ScanLine, sammlung: Library, deals: Tag, insights: BarChart3 };

const NavItem = ({ to, icon: Icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) => clsx(
      'flex items-center w-full gap-3 px-3 py-2.5 rounded-[10px] transition-colors cursor-pointer text-[13.5px] font-medium relative',
      isActive
        ? 'text-white bg-gradient-to-r from-space-violet/25 to-transparent shadow-[inset_0_0_0_1px_rgba(157,0,255,0.35)]'
        : 'text-ink-muted hover:bg-obsidian-700 hover:text-ink'
    )}
  >
    {({ isActive }) => (
      <>
        {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-violet-soft shadow-[0_0_10px_#9D00FF]" />}
        <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} />
        <span>{label}</span>
      </>
    )}
  </NavLink>
);
```
The nav body becomes:
```jsx
      <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
        {NAV.map(n => <NavItem key={n.key} to={n.to} icon={ICONS[n.key]} label={n.label} />)}
      </nav>

      <NavItem to="/einstellungen" icon={SettingsIcon} label={T.einstellungen} />
```
Delete the now-unused `GroupLabel` component and the `Layers`/`BookOpen`/`Heart` imports. `Sidebar` no longer takes props.
Note: `NavLink` marks `/sammlung/karten` active only on that exact path; the Sammlung entry gets its active state for every sub-route in Task 2 (`end={false}` semantics come for free once the path is `/sammlung`), so leave it as is here.

- [ ] **Step 9: Command palette and dashboard navigate**

`CommandPalette.jsx`: drop the `setActiveTab` prop, add `import { useNavigate } from 'react-router-dom';` and `import { ROUTES } from '../utils/routes';`, then
```jsx
  const navigate = useNavigate();
  const go = (to) => { navigate(to); onClose(); };
  const actions = [
    { id: 'a-scan', label: 'Scannen', icon: Layers, run: () => go(ROUTES.scannen) },
    { id: 'a-collection', label: 'Sammlung öffnen', icon: Library, run: () => go(ROUTES.karten) },
    { id: 'a-insights', label: 'Insights öffnen', icon: TrendingUp, run: () => go(ROUTES.insights) },
    { id: 'a-decks', label: 'Decks öffnen', icon: BookOpen, run: () => go(ROUTES.decks) },
    { id: 'a-wishlist', label: 'Wunschliste öffnen', icon: Heart, run: () => go(ROUTES.wunschliste) },
  ];
```
Also translate the palette's own strings: placeholder `Karte, Set oder Aktion suchen…`, section headers `Aktionen` / `Karten`, empty state `Keine Treffer.`, hint `Tippen, um die Sammlung zu durchsuchen…`. Leave the card-detail modal it renders alone — Task 3 replaces it.

`Dashboard.jsx`: drop the `setActiveTab` prop, add `useNavigate` + `ROUTES`, and replace the four `setActiveTab('…')` calls with `navigate(ROUTES.…)` (`staging`→`scannen`, `collection`→`karten`).

- [ ] **Step 10: Verify**

Run (from `desktop/`), each as its own command:
`node --test src/utils/routes.test.mjs src/utils/i18n-de.test.mjs` → pass 2
`npm run lint` → only the 5 pre-existing errors
`npm run build` → succeeds

- [ ] **Step 11: Commit**

```bash
git add desktop/package.json desktop/package-lock.json desktop/src/main.jsx desktop/src/App.jsx desktop/src/utils/routes.js desktop/src/utils/routes.test.mjs desktop/src/utils/i18n-de.js desktop/src/utils/i18n-de.test.mjs desktop/src/components/Sidebar.jsx desktop/src/components/CommandPalette.jsx desktop/src/components/Dashboard.jsx
git commit -m "feat(desktop): hash router, German route table and vocabulary, six-entry sidebar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Sammlung as one page with segments

**Files:**
- Create: `desktop/src/components/SammlungLayout.jsx`
- Modify: `desktop/src/App.jsx` (nest the four Sammlung routes), `desktop/src/components/Sidebar.jsx` (Sammlung stays active on every sub-route)

**Interfaces:**
- Produces: `SammlungLayout` — renders the segment bar and an `<Outlet/>`; the four child routes render inside it.
- Consumes: `ROUTES`, `T` from Task 1.

- [ ] **Step 1: Write the layout**

`desktop/src/components/SammlungLayout.jsx`:
```jsx
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { ROUTES } from '../utils/routes';
import { T } from '../utils/i18n-de';

const SEGMENTS = [
  { to: ROUTES.karten, label: T.karten },
  { to: ROUTES.wunschliste, label: T.wunschliste },
  { to: ROUTES.sets, label: T.sets },
  { to: ROUTES.decks, label: T.decks },
];

// Everything that is "my collection" lives on one page; the segments swap the content below.
export default function SammlungLayout() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-4 mb-5 shrink-0">
        <h1 className="font-display font-semibold text-2xl text-ink">{T.sammlung}</h1>
        <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
          {SEGMENTS.map(s => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) => clsx(
                'px-4 py-1.5 rounded-lg font-display text-sm font-medium transition-colors',
                isActive ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'text-ink-muted hover:text-ink'
              )}
            >
              {s.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Nest the routes**

In `App.jsx`, replace the four flat `/sammlung/...` routes with:
```jsx
                  <Route path="/sammlung" element={<SammlungLayout />}>
                    <Route index element={<Navigate to="/sammlung/karten" replace />} />
                    <Route path="karten" element={<CollectionList isUpdating={!!updateProgress} setUpdateProgress={setUpdateProgress} />} />
                    <Route path="wunschliste" element={<Wishlist />} />
                    <Route path="sets" element={<SetCompletion />} />
                    <Route path="decks" element={<DeckBuilder />} />
                  </Route>
```
Add `import SammlungLayout from './components/SammlungLayout';`. Remove the `<div className="h-full">` wrapper added around `SetCompletion` in Task 1 — the layout's `flex-1 min-h-0` now owns the height.

- [ ] **Step 3: Sammlung stays highlighted on every segment**

In `Sidebar.jsx`, the Sammlung entry must light up for `/sammlung/*`, not only for `/sammlung/karten`. Give `NavItem` an optional `match` prop and use `useLocation`:
```jsx
import { NavLink, useLocation } from 'react-router-dom';
```
```jsx
const NavItem = ({ to, icon: Icon, label, match }) => {
  const { pathname } = useLocation();
  const forcedActive = match ? pathname.startsWith(match) : false;
  return (
    <NavLink to={to} className={({ isActive }) => clsx(/* …same classes, using (isActive || forcedActive)… */)}>
      {({ isActive }) => { const active = isActive || forcedActive; return (<>{active && <span …/>}<Icon …/><span>{label}</span></>); }}
    </NavLink>
  );
};
```
and render the Sammlung entry with `match="/sammlung"` (derive it in the `NAV.map` as `n.key === 'sammlung' ? '/sammlung' : undefined`).

- [ ] **Step 4: Titles that are now duplicated**

`Wishlist.jsx`, `SetCompletion.jsx`, `DeckBuilder.jsx` and `CollectionList.jsx` each print their own page heading. The segment bar names the page now, so remove the redundant top-level `<h2>`/`<h1>` in `Wishlist.jsx` and `SetCompletion.jsx` (keep any counter next to it by moving it into the remaining toolbar row). `CollectionList.jsx`'s header is rebuilt in Task 4 — leave it. `DeckBuilder.jsx` keeps its internal two-pane heading.

- [ ] **Step 5: Verify**

`npm run lint` (only the 5 pre-existing) and `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/App.jsx desktop/src/components/SammlungLayout.jsx desktop/src/components/Sidebar.jsx desktop/src/components/Wishlist.jsx desktop/src/components/SetCompletion.jsx
git commit -m "feat(desktop): Sammlung hosts Karten/Wunschliste/Sets/Decks as segments

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Card detail as a side panel on an overlay route

**Files:**
- Create: `desktop/src/components/CardDetailPanel.jsx` (moved from `CardDetailModal.jsx`)
- Delete: `desktop/src/components/CardDetailModal.jsx`
- Modify: `desktop/src/App.jsx`, `desktop/src/components/CollectionList.jsx`, `desktop/src/components/CommandPalette.jsx`

**Interfaces:**
- Route: `/karte/:id/:setCode/:language/:rarity`, always navigated **with** `state.background` (the current location) and optionally `state.list` (an array of card routes for prev/next).
- `CardDetailPanel` takes no props: it reads `useParams()` → `printingFromParams`, loads the card's grouped data itself via `window.api.getCollection()`, and closes with `navigate(-1)`.
- After any mutation the panel dispatches `window.dispatchEvent(new Event('collection-dirty'))`; `CollectionList` listens and reloads. This replaces the old `onClose={() => { …; loadCollection(); }}` callback that a route cannot carry.

- [ ] **Step 1: Move the component**

`git mv desktop/src/components/CardDetailModal.jsx desktop/src/components/CardDetailPanel.jsx` and rename the exported function to `CardDetailPanel`.

- [ ] **Step 2: Make it route-driven**

Replace the component's signature and data loading. It previously received a grouped `card` object (with `card.variants`); now it rebuilds that from the collection:
```jsx
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { printingFromParams, cardRoute } from '../utils/routes';
```
```jsx
export default function CardDetailPanel() {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const printing = printingFromParams(params);
  const list = location.state?.list || [];          // ordered card routes of the list behind us
  const [card, setCard] = useState(null);           // { …first row, variants: [rows of this passcode] }

  // Rebuild the grouped card for this passcode from the collection.
  const loadCard = async () => {
    if (!window.api) return;
    const rows = (await window.api.getCollection()).filter(r => String(r.id) === String(printing.id));
    if (rows.length === 0) { setCard(null); return; }
    const primary = rows.find(r => r.set_code === printing.set_code && r.rarity === printing.rarity) || rows[0];
    setCard({ ...primary, variants: rows });
  };
  useEffect(() => { loadCard(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [params.id]);

  const close = () => navigate(-1);
  const idx = list.indexOf(cardRoute(printing));
  const goRelative = (delta) => {
    const next = list[idx + delta];
    if (next) navigate(next, { replace: true, state: location.state });
  };
```
Keep every existing body part (copy groups, `changeGroup`, `addStandardCopy`, `moveGroup`, `refreshVariant`, `handleAddVariant`, the manual price field, delete) unchanged apart from two things:
1. wherever the old code called `setLocalVariants` after a mutation, additionally dispatch `window.dispatchEvent(new Event('collection-dirty'));`
2. `localVariants` initialises from `card?.variants` — it must reset when `card` changes: `useEffect(() => { setLocalVariants(card?.variants || []); }, [card]);`

- [ ] **Step 3: Panel chrome instead of modal chrome**

Replace the outer two `<div>`s (the `fixed inset-0 … bg-black/80` backdrop and the `max-w-4xl` dialog) with a column that sits in the layout:
```jsx
  if (!card) return null;
  return (
    <aside className="w-[420px] shrink-0 h-full overflow-y-auto custom-scrollbar bg-obsidian-800 border-l border-line p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <button onClick={() => goRelative(-1)} disabled={idx <= 0}
          className="p-1.5 rounded-lg bg-obsidian-700 border border-line text-ink-muted hover:text-ink disabled:opacity-30" title="Vorherige Karte">
          <ChevronUp className="w-4 h-4" />
        </button>
        <button onClick={() => goRelative(1)} disabled={idx < 0 || idx >= list.length - 1}
          className="p-1.5 rounded-lg bg-obsidian-700 border border-line text-ink-muted hover:text-ink disabled:opacity-30" title="Nächste Karte">
          <ChevronDown className="w-4 h-4" />
        </button>
        <span className="ml-auto" />
        <button onClick={close} className="p-1.5 rounded-lg bg-obsidian-700 border border-line text-ink-muted hover:text-ink" title={T.zurueck}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <img src={card.image_url} alt={card.name} className="w-full rounded-xl shadow-[0_0_30px_rgba(157,0,255,0.2)]" />
      {/* …name, chips, „Deine Exemplare" block, add-printing block, stats grid, description — all as before, stacked… */}
    </aside>
  );
```
Import `ChevronUp`, `ChevronDown`, `X` from lucide-react and `T` from the vocabulary. The two-column `md:flex-row` split goes away; everything stacks in the single narrow column. Keep the section wording German: `Deine Exemplare`, `Gesamt: n`, `Exemplar hinzufügen`, `Weiteres Printing hinzufügen`, `Beschreibung`.
Esc closes: 
```jsx
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
```

- [ ] **Step 4: Render the panel beside the page**

In `App.jsx`, drive the main `<Routes>` from the background location and render the panel next to it:
```jsx
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import CardDetailPanel from './components/CardDetailPanel';
```
```jsx
  const location = useLocation();
  const background = location.state?.background;
  const panelOpen = /^\/karte\//.test(location.pathname);
```
and in the layout, wrap the routed content and the panel in a row:
```jsx
        <div className="flex-1 overflow-hidden flex gap-6 min-h-0">
            <div className="flex-1 min-w-0 overflow-auto">
              <ErrorBoundary>
                <Suspense fallback={…}>
                  <Routes location={background || location}>
                    …all page routes unchanged…
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
            {panelOpen && (
              <ErrorBoundary>
                <CardDetailPanel />
              </ErrorBoundary>
            )}
        </div>
```
A reload straight onto `/karte/...` has no background: the `Routes` then match nothing and render an empty page beside the panel. Guard it by falling back to the collection:
```jsx
                  <Routes location={background || (panelOpen ? { ...location, pathname: '/sammlung/karten' } : location)}>
```

- [ ] **Step 5: Open the panel from the list and the palette**

`CollectionList.jsx`: remove the `selectedCard` state, the `CardDetailModal` import and its render at the bottom. Add:
```jsx
import { useNavigate, useLocation } from 'react-router-dom';
import { cardRoute } from '../utils/routes';
```
```jsx
  const navigate = useNavigate();
  const location = useLocation();
  // The panel walks the list with the arrow buttons, so it gets the current order handed over.
  const openCard = (card) => {
    const first = (card.variants && card.variants[0]) || card;
    const list = filtered.map(c => cardRoute((c.variants && c.variants[0]) || c));
    navigate(cardRoute(first), { state: { background: location, list } });
  };
```
and use `onClick={() => openCard(card)}` in the grid `Cell`. Add the reload listener next to the existing `onCollectionChanged` effect:
```jsx
  useEffect(() => {
    const onDirty = () => loadCollection();
    window.addEventListener('collection-dirty', onDirty);
    return () => window.removeEventListener('collection-dirty', onDirty);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

`CommandPalette.jsx`: remove the `detail` state and the `CardDetailModal` render; `runItem` for a card becomes
```jsx
    else { navigate(cardRoute(item.card.variants?.[0] || item.card), { state: { background: location } }); onClose(); }
```
with `useLocation` imported and `cardRoute` from the route helpers. The palette's key handler loses its `if (detail)` branch.

- [ ] **Step 6: Verify**

`npm run lint` — the pre-existing unused `e` in `CollectionList.jsx` may disappear with the removed code; that is fine, fewer errors are allowed. `npm run build` must succeed.

- [ ] **Step 7: Commit**

```bash
git add -A desktop/src
git commit -m "feat(desktop): card detail as a routed side panel with prev/next through the list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Collection toolbar in two tiers

**Files:**
- Modify: `desktop/src/components/CollectionList.jsx`

**Interfaces:**
- No new exports. The page keeps its behaviour (segments, filters, sorting, Cardmarket actions); only the arrangement and the wording change.
- Layout after this task: **row 1** = count · search · view toggle · sort · `Filter` button (with the number of active filters) · `Preise` menu. **row 2** = the work-list chips (Alle · Unbekannt · Unvollständig · Foils). **row 3** = the filter dropdowns, only when the filter row is open. **row 4** = active-filter chips with an X each, always visible when a filter is set.

- [ ] **Step 1: State and derived values**

Add:
```jsx
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);

  // Which filters are set, as removable chips.
  const activeFilters = [
    filterType !== 'All' && { key: 'type', label: filterType, clear: () => setFilterType('All') },
    filterLang !== 'All' && { key: 'lang', label: filterLang, clear: () => setFilterLang('All') },
    filterAttribute !== 'All' && { key: 'attr', label: filterAttribute, clear: () => setFilterAttribute('All') },
    filterRace !== 'All' && { key: 'race', label: filterRace, clear: () => setFilterRace('All') },
    filterRarity !== 'All' && { key: 'rarity', label: filterRarity, clear: () => setFilterRarity('All') },
    filterCondition !== 'All' && { key: 'cond', label: `Zustand ${filterCondition}`, clear: () => setFilterCondition('All') },
    filterEdition !== 'All' && { key: 'ed', label: EDITION_LABELS[filterEdition] || filterEdition, clear: () => setFilterEdition('All') },
    filterSet !== 'All' && { key: 'set', label: filterSet, clear: () => setFilterSet('All') },
  ].filter(Boolean);
```

- [ ] **Step 2: Row 1**

Replace the current header row (`My Collection` + the six Cardmarket controls) with:
```jsx
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink-muted text-sm shrink-0">{filtered.length} Karten</span>
                <div className="relative group flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                    <input type="text" placeholder="Suchen…" className="bg-obsidian border border-line text-ink pl-10 pr-4 py-2 rounded-lg w-full focus:border-space-violet outline-none"
                           value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <CustomSelect value={sortType} onChange={setSortType} placeholder="Sortierung" className="w-[170px]" options={[
                    { value: 'newest', label: 'Neueste' }, { value: 'total', label: 'Wert (gesamt)' }, { value: 'price', label: 'Preis (einzeln)' },
                    { value: 'name', label: 'Name' }, { value: 'atk', label: 'ATK' }, { value: 'def', label: 'DEF' }, { value: 'level', label: 'Level' }]} />
                <button onClick={() => setFiltersOpen(o => !o)}
                        className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
                          filtersOpen || activeFilters.length ? 'bg-space-violet/15 border-space-violet/40 text-ink' : 'bg-obsidian-700 border-line text-ink-muted hover:text-ink')}>
                    <SlidersHorizontal className="w-4 h-4" /> Filter
                    {activeFilters.length > 0 && <span className="font-mono text-[10px] bg-space-violet text-white rounded-full px-1.5">{activeFilters.length}</span>}
                </button>
                <div className="relative">
                    <button onClick={() => setPricesOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-obsidian-700 border border-line text-ink-muted hover:text-ink">
                        <Coins className="w-4 h-4" /> Preise
                    </button>
                    {pricesOpen && (/* Step 3 */)}
                </div>
            </div>
```
Import `clsx`, and `SlidersHorizontal`, `Coins` from lucide-react. Keep the `viewMode` state unused as it is today (a pre-existing lint error) — do not add a view toggle in this task; the grid stays.

- [ ] **Step 3: The `Preise` menu**

Everything Cardmarket-related moves in here, wording German:
```jsx
                    {pricesOpen && (
                      <div className="absolute right-0 top-11 z-30 w-[320px] bg-obsidian-800 border border-line rounded-xl shadow-2xl p-3 space-y-2"
                           onMouseLeave={() => setPricesOpen(false)}>
                        <button onClick={runBulk} disabled={cmBulkBusy || cmRunning}
                                className="w-full text-left px-3 py-2 rounded-lg bg-space-violet/80 hover:bg-space-violet text-white text-sm disabled:opacity-50">
                          {cmBulkBusy ? 'Aktualisiere…' : 'Jetzt aktualisieren (Preisdatei)'}
                        </button>
                        <button onClick={cmRunning ? () => window.api.abortCardmarketScrape() : runCardmarket}
                                className="w-full text-left px-3 py-2 rounded-lg bg-obsidian-700 border border-line text-ink text-sm hover:border-space-violet/40">
                          {cmRunning ? `Abbrechen${cmProgress ? ` (${cmProgress.current}/${cmProgress.total})` : ''}` : 'Rest scrapen'}
                        </button>
                        <label className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted cursor-pointer select-none">
                          <input type="checkbox" checked={cmAuto} onChange={toggleCmAuto} className="accent-space-violet" />
                          Automatisch im Hintergrund
                        </label>
                        <div className="px-3">
                          <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">Ab Rarity</div>
                          <select value={cmMinRank} onChange={(e) => { const v = Number(e.target.value); setCmMinRank(v); if (cmAuto) window.api?.saveSetting?.({ key: 'cm_auto_min_rank', value: String(v) }); }}
                                  className="w-full px-2 py-1.5 rounded bg-obsidian border border-line text-ink text-sm">
                            {/* the eight existing options, unchanged */}
                          </select>
                        </div>
                        <div className="border-t border-line pt-2 px-3 space-y-1">
                          <button onClick={() => handleUpdate('missing')} disabled={updating} className="text-sm text-ink-muted hover:text-ink">Fehlende Daten holen</button>
                          <button onClick={() => handleUpdate('all')} disabled={updating} className="block text-sm text-ink-muted hover:text-ink">Alle Karten aktualisieren</button>
                          {cmStatus && (
                            <div className="text-[11px] text-ink-faint pt-1">
                              Letztes Update {relTime(cmStatus.lastRun)} · {cmStatus.resolvedCount} per Datei · {cmStatus.unresolvedCount} offen
                            </div>
                          )}
                        </div>
                      </div>
                    )}
```
Translate the two `confirm()` texts in `handleUpdate` (`Alle Karten aktualisieren?` / `Fehlende Daten nachladen?`) and the result `alert`s (`… Karten aktualisiert.`).

- [ ] **Step 4: Rows 2–4**

The work-list chips keep their markup but get German labels: `Alle`, `Unbekannt`, `Unvollständig`, `Foils`. The Unknown hint becomes: `Diesen Karten fehlt der Set-Code — auflösen, damit der Wert stimmt.` with the buttons `Auf Standard-Set setzen` and `Alle zusammenführen`. Translate the two `confirm()` texts in `runUnknownAction` accordingly.

The filter dropdowns row is wrapped in `{filtersOpen && ( … )}`; inside, translate the placeholders to `Typ`, `Sprache`, `Attribut`, `Rasse/Typ`, `Rarity`, `Zustand`, `Edition`, `Set` and keep the `FilterX` reset button (title `Filter zurücksetzen`).

Below it, always render the chips:
```jsx
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {activeFilters.map(f => (
                  <button key={f.key} onClick={f.clear}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-space-violet/15 border border-space-violet/30 text-ink text-xs">
                    {f.label} <X className="w-3 h-3 opacity-60" />
                  </button>
                ))}
                <button onClick={clearFilters} className="text-xs text-ink-faint hover:text-crit">Alle entfernen</button>
              </div>
            )}
```
Import `X` from lucide-react. Also translate the empty state to `Keine Karten gefunden.`

- [ ] **Step 5: Verify**

`npm run lint` and `npm run build`. Then grep for leftovers:
`grep -n "My Collection\|Fetch Missing\|Add All\|Search\.\.\." src/components/CollectionList.jsx` → no hits.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/components/CollectionList.jsx
git commit -m "feat(desktop): two-tier collection toolbar with a Preise menu and active-filter chips

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Start page and the phone-connection status

**Files:**
- Create: `desktop/src/components/Start.jsx` (from `Dashboard.jsx`)
- Delete: `desktop/src/components/Dashboard.jsx`
- Modify: `desktop/src/App.jsx` (route), `desktop/src/components/Sidebar.jsx` (status pill), `desktop/electron/main.cjs`, `desktop/electron/preload.cjs`

**Interfaces:**
- Main → renderer events: `phone-connected` and `phone-disconnected`, both payload-free; exposed as `window.api.onPhoneStatus(cb)` where `cb(connected: boolean)` and the return value removes both listeners.
- `Start` takes `{ onOpenPalette }` only.

- [ ] **Step 1: Emit the socket status**

`desktop/electron/main.cjs`, inside `startSocketServer`'s `io.on('connection', …)`:
```js
    if (mainWindow) mainWindow.webContents.send('phone-connected');
    socket.on('disconnect', () => {
      if (mainWindow) mainWindow.webContents.send('phone-disconnected');
    });
```
(Keep the existing `card_scanned` handler and the comment about the removed deal handlers.)

`desktop/electron/preload.cjs`, next to the other listeners:
```js
  onPhoneStatus: (cb) => {
    const on = () => cb(true);
    const off = () => cb(false);
    ipcRenderer.on('phone-connected', on);
    ipcRenderer.on('phone-disconnected', off);
    return () => { ipcRenderer.removeListener('phone-connected', on); ipcRenderer.removeListener('phone-disconnected', off); };
  },
```

- [ ] **Step 2: Status pill in the sidebar**

Replace the IP box at the bottom of `Sidebar.jsx` with:
```jsx
  const [phoneOnline, setPhoneOnline] = useState(false);
  useEffect(() => window.api?.onPhoneStatus?.(setPhoneOnline), []);
```
```jsx
      <NavLink to="/einstellungen"
        className="mt-3 flex items-center gap-2.5 bg-obsidian-700 border border-line rounded-xl px-3 py-2.5 hover:border-space-violet/40 transition-colors">
        <span className={clsx('w-2 h-2 rounded-full', phoneOnline ? 'bg-good shadow-[0_0_8px_#39d98a]' : 'bg-ink-faint')} />
        <span className="text-[12px] text-ink-muted">{phoneOnline ? 'Handy verbunden' : 'Kein Handy'}</span>
        <Wifi className="w-3.5 h-3.5 ml-auto text-ink-faint" strokeWidth={1.8} />
      </NavLink>
```
The `ipAddress` state and its effect move out of the sidebar (Task 6 shows the address under Einstellungen › Verbindung; `StagingArea`'s empty state gets it too — see Step 4).

- [ ] **Step 3: Start page**

`git mv desktop/src/components/Dashboard.jsx desktop/src/components/Start.jsx`, rename the export to `Start`, drop the `Welcome back, Duelist` eyebrow and the `Your Collection` headline, and rebuild the header as:
```jsx
        <div>
          <h1 className="font-display font-semibold text-3xl text-ink">{T.start}</h1>
        </div>
```
Then:
- The value panel keeps the sparkline and gains the change over 7 and 30 days, computed from `history` (`portfolio_history` rows, ascending):
```jsx
  const delta = useMemo(() => {
    const pts = history.filter(h => typeof h.total_value === 'number');
    const at = (days) => {
      const cutoff = Date.now() - days * 86400000;
      const before = pts.filter(h => new Date(String(h.timestamp).replace(' ', 'T') + 'Z').getTime() <= cutoff);
      return before.length ? before[before.length - 1].total_value : (pts[0]?.total_value ?? null);
    };
    const now = stats.totalValue || 0;
    const mk = (base) => (base == null || base === 0 ? null : { abs: now - base, pct: ((now - base) / base) * 100 });
    return { d7: mk(at(7)), d30: mk(at(30)) };
  }, [history, stats.totalValue]);
```
  rendered under the total as two small figures (`fmtSignedEUR` + percent, `text-good` when positive, `text-crit` when negative, `—` when there is no history yet).
- The three metric tiles keep their numbers but get German labels: `Karten`, `Einzigartig`, `Sets`.
- The scan panel's texts become `Scan-Status`, `Bereit zum Scannen`, `Handy-Kamera auf eine Karte richten`, button `Scannen`.
- The two attention buttons become the work lists `Unbekanntes Set` and `Fehlende Daten` and navigate to `/sammlung/karten` (the segment stays a follow-up; a plain navigate is enough here).
- `Recently Added` → `Zuletzt hinzugefügt`, `View all` → `Alle ansehen` (navigates to `ROUTES.karten`); the empty state → `Noch keine Karten — scanne welche, um zu starten.`
- The quick-add form keeps working; placeholder `Passcode…`, and the palette button label becomes `Karte, Set oder Aktion suchen…`.
- Keep the `SetCompletion` panel at the bottom.

Update the route in `App.jsx` (`import Start from './components/Start';`, `element={<Start onOpenPalette={…} />}`).

- [ ] **Step 4: The IP moves into the scan page's empty state**

In `StagingArea.jsx`, load the address (`window.api.getIpAddress()`), translate the page title to `Scannen`, the buttons to `CSV importieren`, `Anleitung`, `Suchen`, `Alle übernehmen`, `Erkannte übernehmen`, `Alles verwerfen`, the per-card button to `Übernehmen`, and replace the empty state with:
```jsx
            <div className="flex flex-col items-center justify-center h-64 text-ink-muted border-2 border-dashed border-line rounded-xl bg-obsidian-800/50 gap-2">
                <p className="text-lg font-medium text-ink">Bereit zum Scannen</p>
                <p className="text-sm">Gescannte Karten erscheinen hier.</p>
                <code className="mt-2 bg-obsidian border border-line rounded-lg px-3 py-1.5 font-mono text-[13px] text-ink select-all cursor-pointer"
                      title="Zum Kopieren klicken" onClick={() => navigator.clipboard.writeText(ipAddress)}>{ipAddress}</code>
                <p className="text-[11px] text-ink-faint">Handy-App mit dieser Adresse verbinden</p>
            </div>
```
Also translate the remaining English strings in the file (`Clear All`, `Add All Detected`, `Add All`, `Import CSV`, `Guide`, `Search`, `Owned: x`, `Failed to fetch details.`, the `alert`/`confirm` texts).

- [ ] **Step 5: Verify**

`npm run lint`, `npm run build`. Then:
`grep -rn "Welcome back\|Recently Added\|View all\|Ready to Scan" src/` → no hits.

- [ ] **Step 6: Commit**

```bash
git add -A desktop/src desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(desktop): Start dashboard with 7/30-day change, phone-status pill, German scan page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Settings with sections and a danger zone

**Files:**
- Modify: `desktop/src/components/Settings.jsx`, `desktop/src/App.jsx` (route with `:bereich`)

**Interfaces:**
- Route: `/einstellungen/:bereich` with `bereich ∈ konto | preise | verbindung | daten | standards | gefahrenzone`; `/einstellungen` redirects to `/einstellungen/konto`.
- `Settings` reads `useParams().bereich` and renders exactly one section; the left sub-navigation uses `NavLink`.

- [ ] **Step 1: Route**

In `App.jsx`:
```jsx
                  <Route path="/einstellungen" element={<Navigate to="/einstellungen/konto" replace />} />
                  <Route path="/einstellungen/:bereich" element={<Settings />} />
```

- [ ] **Step 2: Shell with sub-navigation**

Rebuild `Settings.jsx`'s return as a two-column layout; every existing handler (`saveSync`, `handleSaveSource`, `handleUpdatePrices`, `handleBackup`, `handleRestore`, `handleMoveDb`, `handleReset`, `handleDowngrade`, `saveDefault`) stays exactly as it is:
```jsx
const SECTIONS = [
  { id: 'konto', label: 'Konto & Sync' },
  { id: 'preise', label: 'Preise' },
  { id: 'verbindung', label: 'Verbindung' },
  { id: 'daten', label: 'Daten' },
  { id: 'standards', label: 'Standards' },
  { id: 'gefahrenzone', label: 'Gefahrenzone' },
];
```
```jsx
    const { bereich } = useParams();
    const active = SECTIONS.some(s => s.id === bereich) ? bereich : 'konto';
    …
    return (
      <div className="max-w-5xl mx-auto h-full flex gap-6">
        <nav className="w-52 shrink-0 space-y-1">
          <h1 className="font-display font-semibold text-2xl text-ink mb-4">{T.einstellungen}</h1>
          {SECTIONS.map(s => (
            <NavLink key={s.id} to={`/einstellungen/${s.id}`}
              className={({ isActive }) => clsx('block px-3 py-2 rounded-lg text-sm transition-colors',
                isActive ? 'bg-space-violet/15 text-ink shadow-[inset_0_0_0_1px_rgba(157,0,255,0.35)]'
                         : (s.id === 'gefahrenzone' ? 'text-crit/70 hover:text-crit' : 'text-ink-muted hover:text-ink'))}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar space-y-6 pb-8">
          {active === 'konto' && (/* the Cloud-Sync card, heading „Konto & Sync" */)}
          {active === 'preise' && (/* the Market-Data card, heading „Preise" */)}
          {active === 'verbindung' && (/* Step 3 */)}
          {active === 'daten' && (/* Backup / Wiederherstellen / Verschieben / Duplikate zusammenführen */)}
          {active === 'standards' && (/* the Standards card from Spec A, unchanged */)}
          {active === 'gefahrenzone' && (/* Step 4 */)}
        </div>
      </div>
    );
```
Translate every heading and helper text: `Preisquelle`, `Preise jetzt aktualisieren`, `Datenbank sichern`, `Sicherung wiederherstellen`, `Speicherort verschieben`, `Duplikate zusammenführen`, `Cloud-Sync (Supabase)`, `Sync aktivieren`, the Supabase field placeholders (`Projekt-URL`, `Anon Key`, `E-Mail`, `Passwort`), and the sync status line (`Fehler:` / `Status:`).

- [ ] **Step 3: The Verbindung section**

New section, content only:
```jsx
            <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
              <h3 className="font-display text-lg text-ink mb-1">Verbindung zum Handy</h3>
              <p className="text-sm text-ink-muted mb-4">Die Handy-App verbindet sich mit dieser Adresse (Port 4000). Beide Geräte müssen im selben WLAN sein.</p>
              <code className="block bg-obsidian border border-line rounded-lg px-4 py-3 text-center font-mono text-lg text-ink select-all cursor-pointer hover:bg-black/40 transition-colors"
                    title="Zum Kopieren klicken" onClick={() => navigator.clipboard.writeText(ipAddress)}>{ipAddress}</code>
            </div>
```
with `const [ipAddress, setIpAddress] = useState('…');` + `useEffect(() => { window.api?.getIpAddress?.().then(setIpAddress); }, []);`.

- [ ] **Step 4: Gefahrenzone**

`Factory Reset`, `Optimize Collection (Downgrade)` and any other irreversible action move here, styled with `border-crit/30`, red headings, each with a spelled-out confirmation:
- `Alles zurücksetzen` — `confirm('Wirklich ALLES löschen? Sammlung, Decks und Einstellungen sind danach weg. Das kann nicht rückgängig gemacht werden.')`
- `Auf günstigste Rarity umstellen` — keep the existing explanation, translated: `Setzt jede Karte auf ihre günstigste Druckvariante. Manuell gesetzte Rarities werden überschrieben.`
Keep `Duplikate zusammenführen` under **Daten** (it is not destructive).

- [ ] **Step 5: Point the sidebar pill at the new section**

Task 5 linked the phone-status pill to `/einstellungen` because the section routes did not exist yet. Now change it to the section it means: `<NavLink to="/einstellungen/verbindung" …>` in `Sidebar.jsx`.

- [ ] **Step 6: Verify**

`npm run lint`, `npm run build`, and `grep -n "Settings\|Data Management\|Market Data\|Factory Reset" src/components/Settings.jsx` → no hits outside identifiers/imports.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/Settings.jsx desktop/src/App.jsx desktop/src/components/Sidebar.jsx
git commit -m "feat(desktop): settings with section sub-navigation and a separated danger zone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec coverage check (self-review)

| Spec C section (desktop) | Task |
|---|---|
| §4 vocabulary table | 1 (shared table) + 2–6 (per screen) |
| §6.1 sidebar: six entries, no groups, status pill | 1 (entries), 5 (pill) |
| §6.2 router, German paths, back/forward, palette on routes | 1 |
| §6.3 detail as side panel, overlay route, prev/next, all callers | 3 |
| §6.4 two-tier toolbar, Preise menu, filter chips, work-list chips | 4 |
| §6.5 Start with Δ 7/30 days, work lists, recently added, set progress | 5 |
| §6.6 settings sections + danger zone | 6 |
| §6.7 scan page: German, empty state with the IP | 5 |
| §6.8 Insights: German labels | — see deviations |

**Deliberate deviations (record them in the ledger):**
1. **No Liste/Grid toggle** in Task 4. `viewMode` exists unused today (one of the pre-existing lint errors) and the spec's list view is not described anywhere; adding a second rendering path is a feature, not a re-arrangement. The grid stays; the toggle belongs to a later spec.
2. **Insights (§6.8) is untouched.** Its labels are English (`Value`, `Breakdown`, `Collection Statistics`, …), but Spec G rebuilds that page entirely (movers, allocation switch, sealed). Translating it now would be thrown away; the ledger records it as an open vocabulary gap.
3. **`/sammlung/decks/:id`** from the spec's route list is not implemented: `DeckBuilder` keeps its own internal deck selection. A deep link per deck belongs with the Deckbuilder rework (Spec E).
4. **Mouse back/forward** is handled in the renderer (`mouseup` buttons 3/4) rather than through Electron's `app-command`, which keeps the change inside the renderer.
