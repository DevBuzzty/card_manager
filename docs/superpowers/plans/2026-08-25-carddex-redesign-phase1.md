# Card Dex Redesign — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the redesign's visual foundation — design tokens, TCG fonts, a shared rarity/type utility, the reusable `CardTile`, and a restructured grouped `Sidebar` — without breaking existing navigation.

**Architecture:** Extend the existing Tailwind setup (no styling-system swap). Add color/font tokens to `tailwind.config.js`, bundle fonts via `@fontsource`, add global ground + foil styles to `index.css`. A pure `rarity.js` util is the single source of truth for card-type frame colors and rarity treatments (returns hex values, not class names, to stay safe from Tailwind purge). `CardTile` consumes it and is wired into the existing Collection grid so the deliverable is immediately visible.

**Tech Stack:** React 19 (ESM renderer), Vite, Tailwind CSS 3, `@fontsource`, better-sqlite3/Electron (unchanged this phase).

## Global Constraints

- Scope: `desktop/src/` renderer + `desktop/tailwind.config.js` + `desktop/package.json` only. No Electron main-process, backend, or DB changes.
- UI language stays **English**.
- Theme is **dark only**; do not add light mode.
- **No unit-test framework exists** (per `CLAUDE.md`). Verification = `npm run build` (must pass) + `npm run lint` (no new errors) + a described visual check. Pure logic (`rarity.js`) gets a runnable Node assertion script executed with `node`.
- All commands run from the `desktop/` directory.
- Keep existing `space-*` Tailwind tokens intact (other components still use them). Do **not** override Tailwind's built-in `violet` color scale — add new tokens under new names.
- Match existing code style (functional components, Tailwind classes, `lucide-react` icons).
- Commit after each task with the shown message.

---

### Task 1: Design tokens, fonts & global styles

**Files:**
- Modify: `desktop/package.json` (via `npm install`)
- Modify: `desktop/tailwind.config.js`
- Modify: `desktop/src/main.jsx` (font imports)
- Modify: `desktop/src/index.css` (ground background + foil keyframes)

**Interfaces:**
- Produces (Tailwind tokens usable app-wide):
  - Colors: `obsidian` (`DEFAULT #0c0a11`, `800 #16121e`, `700 #1e1829`, `600 #261e34`), `line #2c2440`, `ink` (`DEFAULT #ece8f4`, `muted #9a90b0`, `faint #6b6383`), `gold` (`DEFAULT #F5C542`, `deep #d1a02a`), `frame` (`monster/spell/trap/normal`), `rarity` (`common/rare/super/ultra/secret`), `good #39d98a`, `warn #f5c542`, `crit #ff5d6c`, `violet-soft #b957ff`. Existing `space-*` tokens retained.
  - Fonts: `font-display` (Chakra Petch), `font-sans` (Manrope, default body), `font-mono` (JetBrains Mono).
  - CSS classes: `.foil-sheen` and `.foil-sheen.secret` (animated holo overlay, reduced-motion safe).

- [ ] **Step 1: Install bundled fonts**

Run (from `desktop/`):
```bash
npm install @fontsource/chakra-petch @fontsource/manrope @fontsource/jetbrains-mono
```

- [ ] **Step 2: Import font weights in the entry**

In `desktop/src/main.jsx`, add these imports **above** the existing `import './index.css'` line:
```jsx
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
```

- [ ] **Step 3: Extend the Tailwind theme**

Replace the `theme` block in `desktop/tailwind.config.js` with:
```js
  theme: {
    extend: {
      colors: {
        'space-black': '#121212',
        'space-charcoal': '#1E1E1E',
        'space-white': '#E0E0E0',
        'space-violet': '#9D00FF',
        'space-violet-dark': '#7A00C7',
        'violet-soft': '#b957ff',
        obsidian: { DEFAULT: '#0c0a11', 800: '#16121e', 700: '#1e1829', 600: '#261e34' },
        line: '#2c2440',
        ink: { DEFAULT: '#ece8f4', muted: '#9a90b0', faint: '#6b6383' },
        gold: { DEFAULT: '#F5C542', deep: '#d1a02a' },
        frame: { monster: '#E8944A', spell: '#1DA891', trap: '#C4568A', normal: '#CBB07A' },
        rarity: { common: '#8a8594', rare: '#6db4e8', super: '#e8c76d', ultra: '#f5c542', secret: '#ff5db1' },
        good: '#39d98a',
        warn: '#f5c542',
        crit: '#ff5d6c',
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'system-ui', 'sans-serif'],
        sans: ['"Manrope"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
```

- [ ] **Step 4: Update global ground + add foil styles**

In `desktop/src/index.css`, replace the `body { ... }` rule (lines ~5-13) with:
```css
body {
  @apply bg-obsidian text-ink;
  margin: 0;
  font-family: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background-image:
    radial-gradient(900px 500px at 82% -8%, rgba(157, 0, 255, 0.13), transparent 60%),
    radial-gradient(700px 500px at 6% 108%, rgba(245, 197, 66, 0.05), transparent 55%);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Then append to the end of `desktop/src/index.css`:
```css
/* Holographic foil sheen for high-rarity cards */
@keyframes foil-slide {
  0%   { background-position: 120% 0; }
  50%  { background-position: -20% 100%; }
  100% { background-position: 120% 0; }
}
.foil-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,.28) 45%, rgba(185,87,255,.22) 50%, rgba(109,180,232,.22) 55%, transparent 70%);
  background-size: 250% 250%;
  animation: foil-slide 4.5s ease-in-out infinite;
}
.foil-sheen.secret {
  background: linear-gradient(115deg, transparent 28%, rgba(255,93,177,.32) 42%, rgba(245,197,66,.3) 50%, rgba(57,217,138,.3) 58%, rgba(109,180,232,.32) 66%, transparent 78%);
  background-size: 260% 260%;
  animation-duration: 3.6s;
}
@media (prefers-reduced-motion: reduce) {
  .foil-sheen { animation: none; }
}
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build`
Expected: build completes with no errors; CSS bundle builds. (Chunk-size warning is pre-existing and fine.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tailwind.config.js src/main.jsx src/index.css
git commit -m "feat(ui): add redesign design tokens, TCG fonts and foil styles"
```

---

### Task 2: `rarity.js` — card type & rarity treatment utility

**Files:**
- Create: `desktop/src/utils/rarity.js`
- Create: `desktop/src/utils/rarity.test.mjs`

**Interfaces:**
- Produces:
  - `FRAME_COLORS: { monster, spell, trap, normal }` (hex strings).
  - `getFrameType(cardType: string) => 'monster' | 'spell' | 'trap' | 'normal'`
  - `getFrameColor(cardType: string) => string` (hex)
  - `getRarityInfo(rarity: string) => { key: 'common'|'rare'|'super'|'ultra'|'secret', label: string, color: string (hex), foil: false | 'holo' | 'secret' }`
- Consumers (Task 3 `CardTile`) call `getFrameColor(card.type)` and `getRarityInfo(card.rarity)`.

- [ ] **Step 1: Write the utility**

Create `desktop/src/utils/rarity.js`:
```js
// Single source of truth for how a card's type and rarity are rendered.
// Returns hex colour values (not Tailwind class names) so callers apply them via
// inline styles — safe from Tailwind's class purge.

export const FRAME_COLORS = {
  monster: '#E8944A',
  spell: '#1DA891',
  trap: '#C4568A',
  normal: '#CBB07A',
};

// Map a YGOPRODeck card `type` string to a frame category.
export function getFrameType(cardType) {
  const t = (cardType || '').toLowerCase();
  if (t.includes('spell')) return 'spell';
  if (t.includes('trap')) return 'trap';
  if (t.includes('normal') && t.includes('monster')) return 'normal';
  return 'monster'; // effect/ritual/fusion/synchro/xyz/link/token all use the monster frame
}

export function getFrameColor(cardType) {
  return FRAME_COLORS[getFrameType(cardType)];
}

const RARITY_TIERS = {
  common: { label: 'Common', color: '#8a8594', foil: false },
  rare: { label: 'Rare', color: '#6db4e8', foil: false },
  super: { label: 'Super', color: '#e8c76d', foil: 'holo' },
  ultra: { label: 'Ultra', color: '#f5c542', foil: 'holo' },
  secret: { label: 'Secret', color: '#ff5db1', foil: 'secret' },
};

// Normalise the many printed rarity strings to one of five tiers.
export function getRarityInfo(rarity) {
  const r = (rarity || '').toLowerCase();
  let key = 'common';
  if (!r || r.includes('common') || r.includes('short print') || r === 'unknown') key = 'common';
  else if (r.includes('secret') || r.includes('ultimate') || r.includes('ghost') || r.includes('starlight') || r.includes('prismatic') || r.includes('collector')) key = 'secret';
  else if (r.includes('ultra')) key = 'ultra';
  else if (r.includes('super')) key = 'super';
  else if (r.includes('rare')) key = 'rare';
  return { key, ...RARITY_TIERS[key] };
}
```

- [ ] **Step 2: Write the Node assertion test**

Create `desktop/src/utils/rarity.test.mjs`:
```js
import assert from 'node:assert';
import { getFrameType, getFrameColor, getRarityInfo } from './rarity.js';

// Frame type mapping
assert.equal(getFrameType('Normal Monster'), 'normal');
assert.equal(getFrameType('Effect Monster'), 'monster');
assert.equal(getFrameType('Link Monster'), 'monster');
assert.equal(getFrameType('Spell Card'), 'spell');
assert.equal(getFrameType('Trap Card'), 'trap');
assert.equal(getFrameType(''), 'monster');
assert.equal(getFrameColor('Spell Card'), '#1DA891');

// Rarity mapping
assert.equal(getRarityInfo('Common').key, 'common');
assert.equal(getRarityInfo('Short Print').key, 'common');
assert.equal(getRarityInfo('Rare').key, 'rare');
assert.equal(getRarityInfo('Super Rare').key, 'super');
assert.equal(getRarityInfo('Ultra Rare').key, 'ultra');
assert.equal(getRarityInfo('Secret Rare').key, 'secret');
assert.equal(getRarityInfo('Ghost Rare').key, 'secret');
assert.equal(getRarityInfo('').key, 'common');

// Foil treatment
assert.equal(getRarityInfo('Common').foil, false);
assert.equal(getRarityInfo('Ultra Rare').foil, 'holo');
assert.equal(getRarityInfo('Secret Rare').foil, 'secret');

console.log('rarity.js: all assertions passed');
```

- [ ] **Step 3: Run the test to verify it passes**

Run (from `desktop/`): `node src/utils/rarity.test.mjs`
Expected: prints `rarity.js: all assertions passed` and exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/utils/rarity.js src/utils/rarity.test.mjs
git commit -m "feat(ui): add rarity/frame treatment utility with tests"
```

---

### Task 3: `CardTile` component + wire into Collection grid

**Files:**
- Create: `desktop/src/components/CardTile.jsx`
- Modify: `desktop/src/components/CollectionList.jsx` (replace the inline card markup in `Cell` with `<CardTile>`)

**Interfaces:**
- Consumes: `getFrameColor`, `getRarityInfo` from `../utils/rarity.js`.
- Produces: `CardTile` default export.
  - Props: `card` (object with `name, id, image_url, type, rarity, set_code, price, quantity`), `onClick` (function, optional).
  - Renders: square art with real `image_url`, type-frame ring + top strip, rarity gem badge, foil sheen for holo/secret, quantity badge when `quantity > 1`, name, set code, price.

- [ ] **Step 1: Write the component**

Create `desktop/src/components/CardTile.jsx`:
```jsx
import { getFrameColor, getRarityInfo } from '../utils/rarity.js';

export default function CardTile({ card, onClick }) {
  const frame = getFrameColor(card.type);
  const rarity = getRarityInfo(card.rarity);
  const qty = card.quantity || 1;
  const price = card.price || 0;

  return (
    <div
      onClick={onClick}
      className="group relative rounded-xl overflow-hidden bg-obsidian-600 border border-line cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: `inset 0 0 0 1.5px ${frame}55` }}
    >
      {/* Art */}
      <div className="relative aspect-square bg-obsidian-800 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 z-10" style={{ backgroundColor: frame }} />
        {card.image_url ? (
          <img src={card.image_url} alt={card.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-ink-faint text-2xl">?</div>
        )}
        {rarity.foil && <span className={`foil-sheen${rarity.foil === 'secret' ? ' secret' : ''}`} />}

        {qty > 1 && (
          <span className="absolute top-2 right-2 z-10 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-obsidian/80 text-good border border-good/40">
            ×{qty}
          </span>
        )}
        <span
          className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1.5 font-display text-[9px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-obsidian/70"
          style={{ color: rarity.color }}
        >
          <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: rarity.color, boxShadow: rarity.foil ? `0 0 6px ${rarity.color}` : 'none' }} />
          {rarity.label}
        </span>
      </div>

      {/* Meta */}
      <div className="p-2.5">
        <h4 className="text-xs font-bold text-ink leading-tight truncate">{card.name}</h4>
        <div className="flex justify-between items-center mt-1.5">
          <span className="font-mono text-[9.5px] text-ink-faint">{card.set_code}</span>
          <span className="font-mono text-[11px] font-semibold text-gold">${price.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Collection grid**

In `desktop/src/components/CollectionList.jsx`:

Add the import near the other component imports at the top:
```jsx
import CardTile from './CardTile';
```

Then replace the returned JSX inside the `Cell` component (the `return ( <div style={{ ...style, padding: 8 }}> ... </div> )` block) with:
```jsx
      return (
          <div style={{ ...style, padding: 8 }}>
              <CardTile
                  card={{ ...card, price: card.variants && card.variants.length > 1 ? Math.min(...card.variants.map(v => v.price || 0)) : (card.price || 0) }}
                  onClick={() => setSelectedCard(card)}
              />
          </div>
      );
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: build completes, no errors, new `CardTile` chunk folded into the bundle.

- [ ] **Step 4: Verify lint**

Run: `npm run lint`
Expected: no new errors introduced by `CardTile.jsx` / `CollectionList.jsx`.

- [ ] **Step 5: Visual check**

Run: `npm run electron:dev`, open **My Collection**.
Expected: cards now show type-coloured frames (Monster orange / Spell teal / Trap magenta), a rarity gem badge, an animated foil sheen on Super/Ultra/Secret printings, quantity badge, name/set/price. Clicking a card still opens the detail modal.

- [ ] **Step 6: Commit**

```bash
git add src/components/CardTile.jsx src/components/CollectionList.jsx
git commit -m "feat(ui): add CardTile with type/rarity/foil treatment, use in Collection"
```

---

### Task 4: Grouped `Sidebar` restructure

**Files:**
- Modify: `desktop/src/components/Sidebar.jsx` (full rewrite)

**Interfaces:**
- Consumes: same props as today — `activeTab` (string), `setActiveTab` (function). Nav item ids unchanged this phase (`dashboard, staging, collection, portfolio, statistics, deckbuilder, unknown, missing, wishlist, settings`) so navigation keeps working; consolidation happens in Phase 2.
- Produces: restyled grouped sidebar (brand sigil, section labels, scanner-link card, `window.api.getIpAddress()` unchanged).

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `desktop/src/components/Sidebar.jsx` with:
```jsx
import { Home, Layers, Library, TrendingUp, BarChart3, BookOpen, AlertTriangle, FileWarning, Settings, Heart, Wifi } from 'lucide-react';
import { useState, useEffect } from 'react';
import clsx from 'clsx';

const NavItem = ({ id, icon: Icon, label, badge, badgeTone, activeTab, setActiveTab }) => (
  <button
    onClick={() => setActiveTab(id)}
    className={clsx(
      'flex items-center w-full gap-3 px-3 py-2.5 rounded-[10px] transition-colors cursor-pointer text-[13.5px] font-medium relative',
      activeTab === id
        ? 'text-white bg-gradient-to-r from-space-violet/25 to-transparent shadow-[inset_0_0_0_1px_rgba(157,0,255,0.35)]'
        : 'text-ink-muted hover:bg-obsidian-700 hover:text-ink'
    )}
  >
    {activeTab === id && (
      <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded bg-violet-soft shadow-[0_0_10px_#9D00FF]" />
    )}
    <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.8} />
    <span>{label}</span>
    {badge != null && (
      <span className={clsx(
        'ml-auto font-mono text-[10px] px-[7px] py-px rounded-full',
        badgeTone === 'warn' ? 'bg-gold/15 text-gold' : 'bg-obsidian-600 text-ink-muted'
      )}>{badge}</span>
    )}
  </button>
);

const GroupLabel = ({ children }) => (
  <div className="font-display text-[9.5px] tracking-[0.2em] uppercase text-ink-faint px-2.5 pt-3 pb-1.5">{children}</div>
);

export default function Sidebar({ activeTab, setActiveTab }) {
  const [ipAddress, setIpAddress] = useState('Loading...');

  useEffect(() => {
    if (window.api) window.api.getIpAddress().then(setIpAddress);
  }, []);

  return (
    <div className="w-64 bg-obsidian-800 border-r border-line flex flex-col p-3.5 shrink-0">
      <div className="flex items-center gap-3 px-2 pt-2 pb-4">
        <div className="w-[34px] h-[34px] rounded-[9px] grid place-items-center font-display font-bold text-obsidian bg-gradient-to-br from-gold to-[#ffe08a] shadow-[0_0_18px_rgba(245,197,66,0.4)]">CD</div>
        <div>
          <h1 className="font-display font-bold tracking-[0.08em] text-[16px] text-transparent bg-clip-text bg-gradient-to-r from-white to-violet-soft">CARD DEX</h1>
          <span className="block text-[9px] tracking-[0.24em] text-ink-faint uppercase font-display">Duel Manager</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar">
        <NavItem id="dashboard" icon={Home} label="Home" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Sammeln</GroupLabel>
        <NavItem id="staging" icon={Layers} label="Scan" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="collection" icon={Library} label="Collection" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="wishlist" icon={Heart} label="Wishlist" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Analysieren</GroupLabel>
        <NavItem id="portfolio" icon={TrendingUp} label="Portfolio" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="statistics" icon={BarChart3} label="Statistics" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Bauen</GroupLabel>
        <NavItem id="deckbuilder" icon={BookOpen} label="Deck Builder" activeTab={activeTab} setActiveTab={setActiveTab} />

        <GroupLabel>Wartung</GroupLabel>
        <NavItem id="unknown" icon={AlertTriangle} label="Unknown Cards" activeTab={activeTab} setActiveTab={setActiveTab} />
        <NavItem id="missing" icon={FileWarning} label="Missing Data" activeTab={activeTab} setActiveTab={setActiveTab} />
      </nav>

      <NavItem id="settings" icon={Settings} label="Settings" activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="mt-3 bg-gradient-to-br from-obsidian-700 to-obsidian-800 border border-line rounded-[13px] p-3.5">
        <div className="flex items-center gap-2 font-display text-[10px] tracking-[0.14em] uppercase text-good">
          <Wifi className="w-4 h-4" strokeWidth={1.8} /> Scanner-Server aktiv
        </div>
        <code
          className="block bg-obsidian border border-line rounded-lg px-2.5 py-2 text-center font-mono text-[13px] text-ink mt-2.5 select-all cursor-pointer hover:bg-black/60 transition-colors"
          title="Zum Kopieren klicken"
          onClick={() => navigator.clipboard.writeText(ipAddress)}
        >{ipAddress}</code>
        <div className="text-[10px] text-ink-faint mt-1.5 text-center">Handy-App mit dieser Adresse verbinden</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: build completes, no errors (all `lucide-react` icons imported exist).

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Visual check**

Run: `npm run electron:dev`.
Expected: sidebar shows a gold "CD" sigil + gradient wordmark, grouped sections (Sammeln / Analysieren / Bauen / Wartung), the active tab has a violet rail + glow, Settings pinned at the bottom above the scanner-link card. Every nav item still switches its tab correctly (Home→dashboard, Scan→staging, etc.). Clicking the IP copies it.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.jsx
git commit -m "feat(ui): grouped sidebar with brand sigil and scanner-link card"
```

---

## Self-Review

**Spec coverage (Phase 1 items):**
- Tailwind token + font setup → Task 1. ✔
- Global ground styles + foil treatment → Task 1. ✔
- `rarity.js` util → Task 2. ✔
- `CardTile.jsx` → Task 3. ✔
- Sidebar grouped restructure → Task 4. ✔
- Phase 1 explicitly excludes Home/Collection-segments/Insights/CommandPalette (Phases 2–3). Sidebar keeps all current nav ids so nothing breaks before Phase 2 consolidation — noted in Task 4 interface.

**Placeholder scan:** No TBD/TODO; every code step contains full content. ✔

**Type consistency:** `getFrameColor`/`getRarityInfo` signatures defined in Task 2 are used exactly in Task 3. `CardTile` prop shape (Task 3 Produces) matches the object passed from `CollectionList`. Sidebar props unchanged. ✔

**Notes / deviations from default TDD:** No test framework in this project (per Global Constraints). Logic-only `rarity.js` uses a runnable Node assertion (Task 2); visual components are verified via `npm run build` + `npm run lint` + a described visual check, consistent with the project's existing workflow.
