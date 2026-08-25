# Card Dex Redesign — Phase 3 (Command Palette + Delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Ctrl/⌘+K command palette (jump to any card or action) and close the pre-existing delete gap with a real `delete-card` capability.

**Architecture:** Task 1 is renderer-only: a `CommandPalette` component mounted globally in `App.jsx`, opened by a global key listener and by the Home search affordance. Task 2 adds a backend `delete-card` IPC handler + preload wrapper, filters `get-collection` to `quantity > 0`, and wires a delete control into `CardDetailModal`.

**Tech Stack:** React 19 (ESM renderer), Vite, Tailwind (redesign tokens), `lucide-react`; Electron main (CommonJS `.cjs`) + better-sqlite3 for Task 2.

## Global Constraints

- Task 1: `desktop/src/` only. Task 2: `desktop/electron/main.cjs` + `desktop/electron/preload.cjs` + `desktop/src/components/CardDetailModal.jsx`.
- Any new IPC channel MUST be added in BOTH `main.cjs` (handler) and `preload.cjs` (exposed wrapper).
- The `cards` table primary key is composite **`(id, set_code, language)`** — delete/where clauses must use all three.
- Dark theme only; English UI. Use redesign tokens (`obsidian.*`, `line`, `ink.*`, `space-violet`, `violet-soft`, `gold`, `good`, `crit`) and `font-display`/`font-mono`.
- No test framework: verify with `npm run build` (must pass) + `npm run lint` (no NEW errors) + `node --check electron/main.cjs` for the backend file + a described visual check. Commands run from `desktop/`.
- `electron/*.cjs` stay CommonJS; `src/*` stay ESM. Do not convert either.
- Match existing style. Commit after each task with the shown message. Work on a `redesign` branch created from `main`.

---

### Task 1: Global command palette (Ctrl/⌘+K)

**Files:**
- Create: `desktop/src/components/CommandPalette.jsx`
- Modify: `desktop/src/App.jsx` (mount palette + global key listener + pass opener to Home)
- Modify: `desktop/src/components/Dashboard.jsx` (search button opens the palette)
- Modify: `desktop/src/components/Sidebar.jsx` (remove now-unused `TrendingUp` import — Phase 2 leftover)

**Interfaces:**
- Produces: `CommandPalette` default export.
  - Props: `open` (bool), `onClose` (fn), `setActiveTab` (fn).
  - Behavior: on open, fetches the collection, focuses the input; typing filters quick actions + cards (by name / passcode / set); Arrow keys move selection, Enter runs the selected item (action → runs it & closes; card → opens `CardDetailModal`), Escape closes (or closes the detail modal first).
- Consumes: `window.api.getCollection()`, `CardDetailModal`.

- [ ] **Step 1: Create `desktop/src/components/CommandPalette.jsx`**

```jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Layers, Library, TrendingUp, BookOpen, Heart, CornerDownLeft } from 'lucide-react';
import CardDetailModal from './CardDetailModal';

export default function CommandPalette({ open, onClose, setActiveTab }) {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState([]);
  const [sel, setSel] = useState(0);
  const [detail, setDetail] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSel(0);
    setDetail(null);
    if (window.api) window.api.getCollection().then(rows => setCards(rows || []));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Group raw rows by passcode into the shape CardDetailModal expects (with `variants`).
  const grouped = useMemo(() => {
    const g = {};
    cards.forEach(c => {
      if (!g[c.id]) g[c.id] = { ...c, variants: [], quantity: 0, sets: new Set() };
      g[c.id].variants.push(c);
      g[c.id].quantity += (c.quantity || 1);
      if (c.set_code) g[c.id].sets.add(c.set_code);
    });
    return Object.values(g);
  }, [cards]);

  const go = (tab) => { setActiveTab(tab); onClose(); };
  const actions = useMemo(() => [
    { id: 'a-scan', label: 'Start Scanning', icon: Layers, run: () => go('staging') },
    { id: 'a-collection', label: 'Open Collection', icon: Library, run: () => go('collection') },
    { id: 'a-insights', label: 'Open Insights', icon: TrendingUp, run: () => go('insights') },
    { id: 'a-decks', label: 'Open Deck Builder', icon: BookOpen, run: () => go('deckbuilder') },
    { id: 'a-wishlist', label: 'Open Wishlist', icon: Heart, run: () => go('wishlist') },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const actionResults = useMemo(
    () => actions.filter(a => !q || a.label.toLowerCase().includes(q)),
    [actions, q]
  );
  const cardResults = useMemo(() => {
    if (!q) return [];
    return grouped.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      String(c.id).includes(query.trim()) ||
      Array.from(c.sets).some(s => s.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [grouped, q, query]);

  const flat = useMemo(
    () => [...actionResults.map(a => ({ type: 'action', ...a })), ...cardResults.map(c => ({ type: 'card', card: c }))],
    [actionResults, cardResults]
  );

  useEffect(() => { setSel(0); }, [query]);

  const runItem = (item) => {
    if (!item) return;
    if (item.type === 'action') item.run();
    else setDetail(item.card);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (detail) setDetail(null); else onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(flat[sel]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, sel, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  let rowIndex = -1;
  const Row = ({ item, children }) => {
    rowIndex += 1;
    const i = rowIndex;
    const active = i === sel;
    return (
      <button
        onMouseEnter={() => setSel(i)}
        onClick={() => runItem(item)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${active ? 'bg-space-violet/15 text-white' : 'text-ink-muted'}`}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-[12vh] px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
      <div className="w-full max-w-xl bg-obsidian-800 border border-line rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-line">
          <Search className="w-5 h-5 text-violet-soft" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to a card, set or action…"
            className="flex-1 bg-transparent outline-none text-ink text-base"
          />
          <span className="font-mono text-[10px] text-ink-faint border border-line rounded px-1.5 py-0.5">ESC</span>
        </div>

        <div className="max-h-[52vh] overflow-y-auto custom-scrollbar py-2">
          {actionResults.length > 0 && (
            <div className="font-display text-[9.5px] tracking-[0.16em] uppercase text-ink-faint px-4 pt-2 pb-1">Actions</div>
          )}
          {actionResults.map(a => (
            <Row key={a.id} item={{ type: 'action', ...a }}>
              <a.icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
              <span className="flex-1">{a.label}</span>
            </Row>
          ))}

          {cardResults.length > 0 && (
            <div className="font-display text-[9.5px] tracking-[0.16em] uppercase text-ink-faint px-4 pt-3 pb-1">Cards</div>
          )}
          {cardResults.map(c => (
            <Row key={c.id} item={{ type: 'card', card: c }}>
              <div className="w-7 h-10 rounded overflow-hidden bg-obsidian-600 shrink-0">
                {c.image_url && <img src={c.image_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-ink truncate">{c.name}</div>
                <div className="font-mono text-[10px] text-ink-faint">{c.id} · ×{c.quantity}</div>
              </div>
              <CornerDownLeft className="w-3.5 h-3.5 opacity-40" />
            </Row>
          ))}

          {q && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-faint">No matches.</div>
          )}
          {!q && (
            <div className="px-4 py-2 text-[11px] text-ink-faint">Type to search your collection…</div>
          )}
        </div>
      </div>

      {detail && <CardDetailModal card={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Mount the palette + global shortcut in `App.jsx`**

In `desktop/src/App.jsx`:

(a) Add the lazy import next to the other lazy component imports (after the `DeckBuilder` lazy line):
```jsx
const CommandPalette = lazy(() => import('./components/CommandPalette'));
```

(b) Add palette state next to the other `useState` calls in `App()`:
```jsx
  const [paletteOpen, setPaletteOpen] = useState(false);
```

(c) Add a global keydown listener — insert this `useEffect` right after the existing scan/progress `useEffect` closing `}, []);`:
```jsx
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

(d) Pass an opener to the Home tab — change the Dashboard branch:
```jsx
                {activeTab === 'dashboard' && (
                <Dashboard setActiveTab={setActiveTab} />
                )}
```
to:
```jsx
                {activeTab === 'dashboard' && (
                <Dashboard setActiveTab={setActiveTab} onOpenPalette={() => setPaletteOpen(true)} />
                )}
```

(e) Mount the palette. Immediately AFTER the closing `</main>` tag and BEFORE the closing `</div>` of the outer wrapper, add:
```jsx
      <Suspense fallback={null}>
        {paletteOpen && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} setActiveTab={setActiveTab} />}
      </Suspense>
```

- [ ] **Step 3: Wire the Home search button to open the palette**

In `desktop/src/components/Dashboard.jsx`:
(a) Change the signature `export default function Dashboard({ setActiveTab }) {` to `export default function Dashboard({ setActiveTab, onOpenPalette }) {`.
(b) Change the search button's `onClick={() => setActiveTab('collection')}` (the button containing the "Search card, set…" text and the "Ctrl K" hint) to `onClick={() => onOpenPalette && onOpenPalette()}`.

- [ ] **Step 4: Sidebar cleanup**

In `desktop/src/components/Sidebar.jsx`, remove the now-unused `TrendingUp` from the `lucide-react` import (Phase 2 replaced the Portfolio nav item with Insights/`BarChart3`). Leave all other imports.

- [ ] **Step 5: Verify build + lint**

Run: `npm run build` (must pass) and `npm run lint` (no new errors).

- [ ] **Step 6: Visual check**

Run `npm run electron:dev`. Press **Ctrl+K** (or ⌘+K) anywhere → the palette opens, input focused. Typing shows matching Actions and Cards; Arrow keys move the highlight, Enter on an action navigates/closes, Enter on a card opens its detail modal (Escape closes the modal, then the palette). The Home page "Search card, set…" button also opens the palette.

- [ ] **Step 7: Commit**

```bash
git add src/components/CommandPalette.jsx src/App.jsx src/components/Dashboard.jsx src/components/Sidebar.jsx
git commit -m "feat(ui): global Ctrl/Cmd+K command palette for cards and actions"
```

---

### Task 2: Real `delete-card` capability

**Files:**
- Modify: `desktop/electron/main.cjs` (add `delete-card` handler; filter `get-collection`)
- Modify: `desktop/electron/preload.cjs` (expose `deleteCard`)
- Modify: `desktop/src/components/CardDetailModal.jsx` (delete control + decrement-to-zero deletes)

**Interfaces:**
- Produces: IPC `delete-card` — payload `{ id, set_code, language }`, returns `{ success: boolean, error?: string }`; `window.api.deleteCard(data)`.
- Changes: `get-collection` returns only rows with `quantity > 0` (hides any qty-0 zombies).
- Consumes (renderer): `window.api.deleteCard`.

- [ ] **Step 1: Add the backend handler + filter in `main.cjs`**

(a) Replace the existing `get-collection` handler:
```js
ipcMain.handle('get-collection', () => {
    return db.prepare('SELECT * FROM cards ORDER BY created_at DESC').all();
});
```
with:
```js
ipcMain.handle('get-collection', () => {
    return db.prepare('SELECT * FROM cards WHERE quantity > 0 ORDER BY created_at DESC').all();
});
```

(b) Add a new handler immediately after the `get-collection` handler:
```js
ipcMain.handle('delete-card', (event, { id, set_code, language }) => {
    try {
        if (!id || !set_code) return { success: false, error: 'Missing id or set_code' };
        db.prepare('DELETE FROM cards WHERE id = ? AND set_code = ? AND language = ?')
          .run(String(id), set_code, language || 'DE');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});
```

- [ ] **Step 2: Expose `deleteCard` in `preload.cjs`**

In `desktop/electron/preload.cjs`, add inside the `contextBridge.exposeInMainWorld('api', { ... })` object (next to `updateCardMeta`):
```js
  deleteCard: (data) => ipcRenderer.invoke('delete-card', data),
```

- [ ] **Step 3: Wire delete into `CardDetailModal.jsx`**

(a) In `handleUpdateQuantity`, make a decrement to zero delete the variant instead of leaving a qty-0 row. Replace the current body:
```js
  const handleUpdateQuantity = async (variant, delta) => {
      const newQty = (variant.quantity || 0) + delta;
      if (newQty < 0) return;

      const result = await window.api.updateCardMeta({
          id: card.id,
          set_code: variant.set_code,
          rarity: variant.rarity,
          quantity: newQty,
          language: variant.language || 'DE',
          price: variant.price
      });

      if (result.success) {
           setLocalVariants(prev => prev.map(v =>
               (v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
               ? { ...v, quantity: newQty }
               : v
           ));
      }
  };
```
with:
```js
  const removeVariantLocal = (variant) => {
      setLocalVariants(prev => prev.filter(v =>
          !(v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
      ));
  };

  const handleDeleteVariant = async (variant) => {
      const result = await window.api.deleteCard({
          id: card.id,
          set_code: variant.set_code,
          language: variant.language || 'DE'
      });
      if (result.success) removeVariantLocal(variant);
  };

  const handleUpdateQuantity = async (variant, delta) => {
      const newQty = (variant.quantity || 0) + delta;
      if (newQty < 0) return;
      if (newQty === 0) { await handleDeleteVariant(variant); return; }

      const result = await window.api.updateCardMeta({
          id: card.id,
          set_code: variant.set_code,
          rarity: variant.rarity,
          quantity: newQty,
          language: variant.language || 'DE',
          price: variant.price
      });

      if (result.success) {
           setLocalVariants(prev => prev.map(v =>
               (v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
               ? { ...v, quantity: newQty }
               : v
           ));
      }
  };
```

(b) Add an explicit delete button next to each variant's quantity stepper. Find the variant row's controls — the `<div className="flex items-center gap-3">` that wraps the qty stepper `<div className="flex items-center bg-[#1E1E1E] rounded border border-gray-600">...</div>`. Add a trash button as a sibling AFTER that stepper div, still inside the `flex items-center gap-3` container:
```jsx
                                <button
                                    onClick={() => { if (confirm(`Delete ${variant.set_code} (${variant.rarity})?`)) handleDeleteVariant(variant); }}
                                    className="p-1.5 bg-crit/10 hover:bg-crit/20 text-crit rounded transition-colors"
                                    title="Delete this printing"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
```
(`Trash2` is already imported in this file.)

- [ ] **Step 4: Verify**

Run (from `desktop/`):
- `node --check electron/main.cjs` → no syntax errors.
- `npm run build` → passes.
- `npm run lint` → no new errors.

- [ ] **Step 5: Visual check**

Run `npm run electron:dev`, open a card's detail modal from the Collection. Each printing now has a red trash button; clicking it (after confirm) removes that printing. Decrementing a printing's quantity to 0 also removes it. The card disappears from the Collection/Home once all its printings are gone (no lingering qty-0 rows).

- [ ] **Step 6: Commit**

```bash
git add electron/main.cjs electron/preload.cjs src/components/CardDetailModal.jsx
git commit -m "feat: add delete-card IPC and wire delete/decrement-to-zero in card modal"
```

---

## Self-Review

**Spec coverage (Phase 3):**
- Command palette (Ctrl/⌘+K), search + quick actions → Task 1. ✔
- Home search affordance wired to the palette (Phase 2 carry-forward) → Task 1 Step 3. ✔
- `delete-card` IPC + `get-collection` qty filter (Phase 2 carry-forward) → Task 2. ✔
- Sidebar unused-import cleanup (Phase 2 carry-forward) → Task 1 Step 4. ✔
- Count-semantics unification (Home vs Collection) was optional in Phase 2's carry-forward; not included here (cosmetic, no user impact). Noted, not planned.

**Placeholder scan:** No TBD/TODO. Two `eslint-disable-line react-hooks/exhaustive-deps` comments are intentional (the `actions` array and the key handler deliberately omit stable/covered deps) — real directives, not placeholders.

**Type consistency:** `CommandPalette` props (`open/onClose/setActiveTab`) match the mount in `App.jsx`. `Dashboard` new prop `onOpenPalette` passed from `App.jsx` and consumed in Step 3. `delete-card` payload `{id,set_code,language}` is identical in `main.cjs` handler, `preload.cjs` wrapper, and both call sites in `CardDetailModal.jsx`. The grouped card shape produced in the palette (`{...row, variants, quantity, sets}`) provides the `variants`/`image_url`/`name`/`id` that `CardDetailModal` reads.

**Notes:** IPC added in both `main.cjs` and `preload.cjs` (per Global Constraints). Delete WHERE uses the full composite PK `(id, set_code, language)`. `electron/*.cjs` stays CommonJS. Verification is build/lint + `node --check` + visual (no test framework).
