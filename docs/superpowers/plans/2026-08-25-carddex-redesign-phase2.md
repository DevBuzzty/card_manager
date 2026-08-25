# Card Dex Redesign — Phase 2 (Screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realize the redesigned screens: merge Portfolio+Statistics into an **Insights** tab, restyle the app shell to the obsidian ground, fold Unknown/Missing into **Collection segments**, and rebuild **Home** with the new visual language.

**Architecture:** Renderer-only. `App.jsx` stays a tab switcher; the tab set changes (`portfolio`/`statistics`→`insights`; `unknown`/`missing` removed, reachable as Collection segments). New `Insights.jsx` wraps the existing Portfolio and Statistics as sub-tabs. `CollectionList` gains a segment control that filters its existing grouped-card list; the Unknown segment carries the batch maintenance actions previously in `UnknownCards.jsx`. `Dashboard` is rebuilt using Phase 1's tokens/fonts and `CardTile`.

**Tech Stack:** React 19 (ESM), Vite, Tailwind (Phase 1 tokens), `lucide-react`, existing IPC via `window.api`.

## Global Constraints

- Scope: `desktop/src/` renderer only. No Electron main-process, backend, DB, or IPC-channel changes (reuse existing `window.api.*`).
- UI language **English** (existing German strings on the sidebar scanner card may stay).
- **Dark theme only.** Use Phase 1 tokens: `obsidian(.800/.700/.600)`, `line`, `ink(.muted/.faint)`, `gold`, `space-violet`, `violet-soft`, `good`, `warn`, `frame.*`, `rarity.*`; fonts `font-display` / `font-sans` / `font-mono`.
- **No test framework.** Verify with `npm run build` (must pass) + `npm run lint` (no NEW errors) + a described visual check. All commands run from `desktop/`.
- Reuse existing components where possible: `CardTile`, `SetCompletion`, `CardDetailModal`, `Portfolio`, `Statistics`. Reuse `rarity.js`.
- Match existing code style. Commit after each task with the shown message.
- Branch: work on a `redesign` branch (create from `main` at task start if not present).

---

### Task 1: App shell restyle + Insights merge

**Files:**
- Create: `desktop/src/components/Insights.jsx`
- Modify: `desktop/src/App.jsx`
- Modify: `desktop/src/components/Sidebar.jsx`

**Interfaces:**
- Produces: `Insights` default export (no props) — renders a `Value | Breakdown` sub-tab toggle showing `Portfolio` (lazy) and `Statistics`.
- Consumes: existing `Portfolio.jsx`, `Statistics.jsx`.
- After this task the `insights` tab replaces `portfolio` and `statistics`; sidebar shows one "Insights" item under Analysieren. `unknown`/`missing` tabs remain (removed in Task 2).

- [ ] **Step 1: Create `desktop/src/components/Insights.jsx`**

```jsx
import { useState, lazy, Suspense } from 'react';
import { TrendingUp, BarChart3, Loader2 } from 'lucide-react';
import Statistics from './Statistics';

const Portfolio = lazy(() => import('./Portfolio'));

export default function Insights() {
  const [view, setView] = useState('value');

  const Tab = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setView(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-display text-sm font-medium transition-colors ${
        view === id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={1.8} /> {label}
    </button>
  );

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <div className="inline-flex self-start bg-obsidian-700 border border-line rounded-xl p-1 gap-1 mb-5">
        <Tab id="value" icon={TrendingUp} label="Value" />
        <Tab id="breakdown" icon={BarChart3} label="Breakdown" />
      </div>
      <div className="flex-1 overflow-auto">
        {view === 'value' ? (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
            <Portfolio />
          </Suspense>
        ) : (
          <Statistics />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire Insights into `App.jsx` and restyle the shell**

In `desktop/src/App.jsx`:

(a) Replace the imports block (lines 1-16) with:
```jsx
import { useState, useEffect, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import CollectionList from './components/CollectionList';
import MissingData from './components/MissingData';
import Wishlist from './components/Wishlist';
import Settings from './components/Settings';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';
import UnknownCards from './components/UnknownCards';

// Heavy tabs are code-split so the initial load stays light.
const Insights = lazy(() => import('./components/Insights'));
const DeckBuilder = lazy(() => import('./components/DeckBuilder'));
```

(b) Change the shell background. Replace the outer wrapper div opening tag:
```jsx
    <div className="flex h-screen bg-space-black text-space-white overflow-hidden font-sans">
```
with:
```jsx
    <div className="flex h-screen bg-obsidian text-ink overflow-hidden font-sans">
```
and the `<main>` opening tag:
```jsx
      <main className="flex-1 overflow-auto bg-space-black p-6 flex flex-col">
```
with:
```jsx
      <main className="flex-1 overflow-auto bg-obsidian p-6 flex flex-col">
```

(c) Replace the two tab branches for `portfolio` and `statistics`:
```jsx
                {activeTab === 'portfolio' && (
                <Portfolio />
                )}
                {activeTab === 'statistics' && (
                <Statistics />
                )}
```
with a single Insights branch:
```jsx
                {activeTab === 'insights' && (
                <Insights />
                )}
```

- [ ] **Step 3: Update the sidebar's Analysieren group**

In `desktop/src/components/Sidebar.jsx`, replace the two Analysieren nav items:
```jsx
        <GroupLabel>Analysieren</GroupLabel>
        <NavItem id="portfolio" icon={TrendingUp} label="Portfolio" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="statistics" icon={BarChart3} label="Statistics" activeTab={activeTab} setActiveTab={setActiveTab} />
```
with:
```jsx
        <GroupLabel>Analysieren</GroupLabel>
        <NavItem id="insights" icon={BarChart3} label="Insights" activeTab={activeTab} setActiveTab={setActiveTab} />
```
Leave the `TrendingUp` import in place (still imported; unused import is not a lint error here — but if `npm run lint` flags it, remove `TrendingUp` from the import on line 1).

- [ ] **Step 4: Verify build + lint**

Run: `npm run build` (must pass) and `npm run lint` (no new errors).

- [ ] **Step 5: Visual check**

Run `npm run electron:dev`. The whole app background is now the obsidian ground with the subtle violet/gold glow. The sidebar Analysieren group shows a single **Insights** item; opening it shows a **Value | Breakdown** toggle — Value renders the Portfolio charts, Breakdown renders the Statistics analytics.

- [ ] **Step 6: Commit**

```bash
git add src/components/Insights.jsx src/App.jsx src/components/Sidebar.jsx
git commit -m "feat(ui): merge Portfolio+Statistics into Insights, restyle app shell to obsidian"
```

---

### Task 2: Collection segments + retire Unknown/Missing tabs

**Files:**
- Modify: `desktop/src/components/CollectionList.jsx`
- Modify: `desktop/src/App.jsx`
- Modify: `desktop/src/components/Sidebar.jsx`
- Delete: `desktop/src/components/UnknownCards.jsx`, `desktop/src/components/MissingData.jsx`

**Interfaces:**
- Consumes: `getRarityInfo` from `../utils/rarity.js`; existing IPC `window.api.mergeUnknownCards()`, `window.api.convertUnknownsToDefault()`.
- Produces: a segment control in Collection (`All / Unknown / Incomplete / Foils`) with live counts; the Unknown segment shows a batch-action toolbar (Auto-Merge, Convert to Default). Unknown/Missing leave the sidebar and `App.jsx`.

- [ ] **Step 1: Add segment state + logic to `CollectionList.jsx`**

(a) Update the import of `rarity.js` — add it near the other imports at the top:
```jsx
import { getRarityInfo } from '../utils/rarity.js';
```

(b) Add segment state next to the other `useState` filter declarations (after `const [filterRarity, setFilterRarity] = useState('All');`):
```jsx
  const [segment, setSegment] = useState('all'); // all | unknown | incomplete | foils
  const [segmentBusy, setSegmentBusy] = useState(false);
```

(c) Add a helper predicate above the `filtered` useMemo (right after the `{ attributes, races, sets, rarities } = useMemo(...)` block):
```jsx
  // A grouped card is "incomplete" if a monster is missing atk/def/level, or anything lacks an image.
  const isIncomplete = (c) => {
      const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
      const isLink = c.type && c.type.includes('Link');
      if (isMonster) {
          if (c.atk == null) return true;
          if (!isLink && c.def == null) return true;
          if (c.level == null) return true;
          return false;
      }
      return !c.image_url;
  };
  const hasUnknownVariant = (c) => c.variants && c.variants.some(v => v.set_code === 'Unknown');
  const hasFoilVariant = (c) => Array.from(c.rarities).some(r => !!getRarityInfo(r).foil);

  const segmentCounts = useMemo(() => ({
      all: groupedCards.length,
      unknown: groupedCards.filter(hasUnknownVariant).length,
      incomplete: groupedCards.filter(isIncomplete).length,
      foils: groupedCards.filter(hasFoilVariant).length,
  }), [groupedCards]);
```

(d) In the `filtered` useMemo, add the segment filter as the FIRST check inside `.filter(c => { ... })` (before the `matchesSearch` line):
```jsx
        if (segment === 'unknown' && !hasUnknownVariant(c)) return false;
        if (segment === 'incomplete' && !isIncomplete(c)) return false;
        if (segment === 'foils' && !hasFoilVariant(c)) return false;
```
and add `segment` to that useMemo's dependency array (change the closing deps to include `segment`):
```jsx
  }, [groupedCards, filter, filterType, filterAttribute, filterRace, filterSet, filterLang, filterRarity, sortType, segment]);
```

(e) Add the batch-action handlers above the `return (`:
```jsx
  const runUnknownAction = async (kind) => {
      if (!window.api || segmentBusy) return;
      const msg = kind === 'merge'
          ? "Merge all 'Unknown' cards into their most common owned set variant?"
          : "Assign all 'Unknown' cards to their cheapest available set (online, may take a while)?";
      if (!confirm(msg)) return;
      setSegmentBusy(true);
      try {
          const res = kind === 'merge' ? await window.api.mergeUnknownCards() : await window.api.convertUnknownsToDefault();
          if (res.success) { alert(kind === 'merge' ? `Merged ${res.merged} cards.` : `Converted ${res.converted} cards.`); loadCollection(); }
          else alert('Failed: ' + res.error);
      } catch (e) { alert('Action failed.'); }
      finally { setSegmentBusy(false); }
  };
```

- [ ] **Step 2: Render the segment control + Unknown toolbar in `CollectionList.jsx`**

Inside the header controls card, immediately AFTER the `<div className="flex flex-col md:flex-row items-center justify-between gap-4"> ... </div>` block (the one containing the "My Collection" title and the update buttons) and BEFORE the `<div className="flex flex-wrap items-center gap-3">` filter row, insert:
```jsx
            {/* Segment control */}
            <div className="flex flex-wrap items-center gap-2">
                {[
                    { id: 'all', label: 'All' },
                    { id: 'unknown', label: 'Unknown' },
                    { id: 'incomplete', label: 'Incomplete' },
                    { id: 'foils', label: 'Foils' },
                ].map(s => (
                    <button
                        key={s.id}
                        onClick={() => setSegment(s.id)}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-display text-xs font-medium transition-colors ${
                            segment === s.id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'bg-obsidian-700 text-ink-muted hover:text-ink border border-line'
                        }`}
                    >
                        {s.label}
                        <span className={`font-mono text-[9.5px] px-1.5 rounded-full ${segment === s.id ? 'bg-black/25' : 'bg-black/30'}`}>{segmentCounts[s.id]}</span>
                    </button>
                ))}
            </div>

            {/* Unknown batch actions */}
            {segment === 'unknown' && segmentCounts.unknown > 0 && (
                <div className="flex items-center gap-3 bg-gold/5 border border-gold/25 rounded-xl px-4 py-3">
                    <span className="text-xs text-ink-muted flex-1">These cards have no specific set code — resolve them to avoid inflated values.</span>
                    <button onClick={() => runUnknownAction('convert')} disabled={segmentBusy} className="px-3 py-1.5 bg-obsidian-600 hover:bg-obsidian-700 text-ink rounded-lg text-xs font-medium border border-line disabled:opacity-50">Convert to Default</button>
                    <button onClick={() => runUnknownAction('merge')} disabled={segmentBusy} className="px-3 py-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg text-xs font-medium disabled:opacity-50">{segmentBusy ? 'Working…' : 'Auto-Merge All'}</button>
                </div>
            )}
```

- [ ] **Step 3: Remove Unknown/Missing from `App.jsx`**

In `desktop/src/App.jsx`:
(a) Remove the imports `import MissingData from './components/MissingData';` and `import UnknownCards from './components/UnknownCards';`.
(b) Remove the two tab branches:
```jsx
                {activeTab === 'unknown' && (
                <UnknownCards />
                )}
                {activeTab === 'missing' && (
                <MissingData />
                )}
```

- [ ] **Step 4: Remove the Wartung group from `Sidebar.jsx`**

In `desktop/src/components/Sidebar.jsx`, remove this whole block:
```jsx
        <GroupLabel>Wartung</GroupLabel>
        <NavItem id="unknown" icon={AlertTriangle} label="Unknown Cards" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="missing" icon={FileWarning} label="Missing Data" activeTab={activeTab} setActiveTab={setActiveTab} />
```
Then remove the now-unused `AlertTriangle` and `FileWarning` names from the `lucide-react` import on line 1 (leaving the others intact).

- [ ] **Step 5: Delete the superseded files**

```bash
git rm src/components/UnknownCards.jsx src/components/MissingData.jsx
```

- [ ] **Step 6: Verify build + lint**

Run: `npm run build` (must pass — confirms no dangling imports of the deleted files) and `npm run lint` (no new errors).

- [ ] **Step 7: Visual check**

Run `npm run electron:dev`, open **Collection**. A segment row (All / Unknown / Incomplete / Foils) with counts sits above the filters. Switching segments filters the grid. The Unknown segment shows the batch-action toolbar; clicking a card still opens the detail modal for individual fixes. The sidebar no longer has a Wartung group.

- [ ] **Step 8: Commit**

```bash
git add src/components/CollectionList.jsx src/App.jsx src/components/Sidebar.jsx
git commit -m "feat(ui): fold Unknown/Missing into Collection segments, retire their tabs"
```

---

### Task 3: Home (Dashboard) redesign

**Files:**
- Modify (full rewrite): `desktop/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `setActiveTab` prop (existing); `window.api.getPortfolio()`, `getCollection()`, `getPriceHistory()`, `manualScan()`; `CardTile`, `SetCompletion`, `getRarityInfo`.
- Produces: redesigned Home. No new exports.

- [ ] **Step 1: Rewrite `desktop/src/components/Dashboard.jsx`**

Replace the entire file with:
```jsx
import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, ScanLine, ArrowRight, Clock, TriangleAlert, FileWarning } from 'lucide-react';
import CardTile from './CardTile';
import SetCompletion from './SetCompletion';

export default function Dashboard({ setActiveTab }) {
  const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
  const [cards, setCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [quickAddCode, setQuickAddCode] = useState('');

  useEffect(() => {
    if (!window.api) return;
    window.api.getPortfolio().then(d => setStats(d || { totalValue: 0, totalCards: 0, uniqueCards: 0 }));
    window.api.getCollection().then(c => setCards(c || []));
    window.api.getPriceHistory().then(h => setHistory(h || []));
  }, []);

  const recent = useMemo(
    () => [...cards].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6),
    [cards]
  );

  const unknownCount = useMemo(
    () => cards.filter(c => c.set_code === 'Unknown').reduce((n, c) => n + (c.quantity || 1), 0),
    [cards]
  );

  const incompleteCount = useMemo(() => cards.filter(c => {
    const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
    const isLink = c.type && c.type.includes('Link');
    if (isMonster) {
      if (c.atk == null) return true;
      if (!isLink && c.def == null) return true;
      if (c.level == null) return true;
      return false;
    }
    return !c.image_url;
  }).length, [cards]);

  const spark = useMemo(() => {
    const vals = history.map(h => h.total_value).filter(v => typeof v === 'number');
    if (vals.length < 2) return null;
    const w = 400, h = 52, min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - ((v - min) / range) * (h - 6) - 3]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    return { line, area: `${line} L${w} ${h} L0 ${h} Z`, last: pts[pts.length - 1] };
  }, [history]);

  const handleQuickAdd = (e) => {
    e.preventDefault();
    if (quickAddCode.length >= 4 && window.api) {
      window.api.manualScan(quickAddCode);
      setQuickAddCode('');
      setActiveTab('staging');
    }
  };

  const money = v => `$${(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="font-display text-[11px] tracking-[0.16em] uppercase text-gold">Welcome back, Duelist</div>
          <h1 className="font-display font-semibold text-3xl text-ink mt-1">Your Collection</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('collection')}
            className="flex items-center gap-2 bg-obsidian-700 border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink-faint hover:text-ink transition-colors min-w-[260px]"
          >
            <Search className="w-4 h-4" strokeWidth={1.8} />
            Search card, set…
            <span className="ml-auto font-mono text-[10px] text-ink-muted border border-line rounded px-1.5 py-0.5">Ctrl K</span>
          </button>
          <form onSubmit={handleQuickAdd} className="flex bg-obsidian-700 border border-line rounded-xl overflow-hidden focus-within:border-space-violet transition-colors">
            <input
              type="text"
              placeholder="Passcode…"
              className="bg-transparent text-ink px-3 py-2.5 outline-none w-32 font-mono text-sm"
              value={quickAddCode}
              onChange={(e) => { if (e.target.value.length <= 8 && /^\d*$/.test(e.target.value)) setQuickAddCode(e.target.value); }}
            />
            <button type="submit" disabled={quickAddCode.length < 4} className="bg-obsidian-600 hover:bg-space-violet text-ink px-3 transition-colors disabled:opacity-40"><Plus className="w-4 h-4" /></button>
          </form>
        </div>
      </div>

      {/* Hero row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
        {/* Value panel */}
        <div className="relative overflow-hidden bg-obsidian-700 border border-line rounded-2xl p-6"
          style={{ backgroundImage: 'linear-gradient(150deg, rgba(245,197,66,.10), transparent 45%), linear-gradient(210deg, rgba(157,0,255,.12), transparent 50%)' }}>
          <div className="font-display text-[11px] tracking-[0.14em] uppercase text-ink-muted">Collection Value</div>
          <div className="font-display font-bold text-4xl text-ink mt-2">{money(stats.totalValue)}</div>
          {spark ? (
            <svg className="mt-4 w-full h-[52px]" viewBox="0 0 400 52" preserveAspectRatio="none">
              <defs><linearGradient id="dashSpark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9D00FF" stopOpacity=".35" /><stop offset="1" stopColor="#9D00FF" stopOpacity="0" /></linearGradient></defs>
              <path d={spark.area} fill="url(#dashSpark)" />
              <path d={spark.line} fill="none" stroke="#b957ff" strokeWidth="2" />
              <circle cx={spark.last[0]} cy={spark.last[1]} r="3.5" fill="#F5C542" />
            </svg>
          ) : (
            <div className="mt-4 h-[52px] flex items-center text-xs text-ink-faint">Price history will appear as values change.</div>
          )}
          <div className="flex gap-3 mt-4">
            {[{ l: 'Cards', v: stats.totalCards || 0 }, { l: 'Unique', v: stats.uniqueCards || 0 }, { l: 'Sets', v: new Set(cards.filter(c => c.set_code && c.set_code !== 'Unknown').map(c => c.set_code.split('-')[0])).size }].map(m => (
              <div key={m.l} className="flex-1 bg-obsidian-800 border border-line rounded-xl px-3.5 py-2.5">
                <div className="font-display text-[10px] uppercase tracking-wide text-ink-faint">{m.l}</div>
                <div className="font-display font-bold text-xl text-ink mt-0.5">{m.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scan + attention */}
        <div className="bg-obsidian-700 border border-line rounded-2xl p-6 flex flex-col gap-4">
          <div className="font-display text-[11px] tracking-[0.14em] uppercase text-ink-muted">Scan Status</div>
          <div className="flex items-center gap-3 bg-obsidian-800 border border-line rounded-xl px-4 py-3">
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-good/10 border border-good/30"><ScanLine className="w-5 h-5 text-good" strokeWidth={1.8} /></div>
            <div><div className="text-sm font-bold text-ink">Ready to scan</div><div className="text-xs text-ink-muted">Point your phone camera at a card</div></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setActiveTab('collection')} className="flex-1 text-left rounded-xl p-3 border border-space-violet/30 bg-space-violet/5 hover:bg-space-violet/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-violet-soft"><TriangleAlert className="w-4 h-4" />{unknownCount}</div>
              <div className="text-[11px] text-ink-muted mt-0.5">Unknown set</div>
            </button>
            <button onClick={() => setActiveTab('collection')} className="flex-1 text-left rounded-xl p-3 border border-gold/30 bg-gold/5 hover:bg-gold/10 transition-colors">
              <div className="flex items-center gap-1.5 font-display font-bold text-2xl text-gold"><FileWarning className="w-4 h-4" />{incompleteCount}</div>
              <div className="text-[11px] text-ink-muted mt-0.5">Incomplete</div>
            </button>
          </div>
          <button onClick={() => setActiveTab('staging')} className="mt-auto flex items-center justify-center gap-2 bg-gradient-to-br from-space-violet to-space-violet-dark text-white font-display font-semibold text-sm py-3 rounded-xl shadow-[0_10px_24px_-10px_#9D00FF]">
            <Plus className="w-4 h-4" strokeWidth={2} /> Start Scanning
          </button>
        </div>
      </div>

      {/* Recently added */}
      <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm tracking-[0.12em] uppercase text-ink-muted flex items-center gap-2"><Clock className="w-4 h-4" strokeWidth={1.8} /> Recently Added</h3>
          <button onClick={() => setActiveTab('collection')} className="text-xs text-violet-soft hover:underline flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></button>
        </div>
        {recent.length === 0 ? (
          <div className="text-center text-ink-faint py-8">No cards yet — start scanning to build your collection.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {recent.map((card, idx) => (
              <CardTile key={`${card.id}-${card.set_code}-${idx}`} card={card} onClick={() => setActiveTab('collection')} />
            ))}
          </div>
        )}
      </div>

      {/* Set completion */}
      <div className="h-[380px]"><SetCompletion /></div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build` (must pass) and `npm run lint` (no new errors — confirm all imported lucide icons `Search, Plus, ScanLine, ArrowRight, Clock, TriangleAlert, FileWarning` exist; if any name is invalid the build fails).

- [ ] **Step 3: Visual check**

Run `npm run electron:dev` on **Home**. Expected: gold eyebrow + "Your Collection" heading; a search affordance (Ctrl K hint) + passcode quick-add; a gold/violet-tinted value panel with a sparkline (or a graceful empty note) and Cards/Unique/Sets mini-stats; a scan-status panel with Unknown/Incomplete attention chips (real counts) and a Start Scanning button; a "Recently Added" strip of `CardTile`s; the Top Collected Sets widget below. Buttons navigate (chips/search → Collection, Start Scanning/quick-add → Scan).

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.jsx
git commit -m "feat(ui): redesign Home with value panel, scan status, attention chips and CardTile strip"
```

---

## Self-Review

**Spec coverage (Phase 2 items):**
- Insights merge (Portfolio+Statistics) → Task 1. ✔
- App shell restyle to obsidian (deferred minor #1) → Task 1. ✔
- Collection segments (All/Unknown/Incomplete/Foils) folding in Unknown/Missing → Task 2. ✔
- Retire Unknown/Missing tabs + sidebar items → Task 2. ✔
- Preserve Unknown maintenance actions (merge/convert) → Task 2 toolbar. ✔ (Per-card delete is available via the detail modal; the batch actions cover the bulk workflow.)
- Home redesign → Task 3. ✔
- Command palette is Phase 3 (the Home search affordance is a placeholder navigating to Collection; Ctrl+K wired in Phase 3). Noted.
- Deferred minor #2 (unused frame/rarity config tokens): not addressed here; `CardTile` still uses inline hex — carry forward, not blocking.

**Placeholder scan:** No TBD/TODO; all code complete. The Home "Ctrl K" hint is an intentional visual affordance for Phase 3, documented — not a code placeholder.

**Type consistency:** `Insights` default export consumed by `App.jsx` lazy import. `getRarityInfo(r).foil` used in Task 2 matches Phase 1's `rarity.js` return shape. `CardTile` `card`/`onClick` props (Phase 1) match usage in Task 3. Segment ids (`all/unknown/incomplete/foils`) consistent between state, counts, control, and filter. `hasUnknownVariant`/`isIncomplete`/`hasFoilVariant` defined once (Task 2 Step 1c) and reused in counts + filter.

**Notes:** No test framework (per Global Constraints); verification is build + lint + visual. Deleting `UnknownCards.jsx`/`MissingData.jsx` is safe once Task 2 removes their only references (App.jsx tabs); Step 6 build catches any dangling import.
