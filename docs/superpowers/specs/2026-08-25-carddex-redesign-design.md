# Card Dex — Redesign Design Spec

**Date:** 2026-08-25
**Status:** Approved direction (visual concept mockup approved by user)
**Scope:** Desktop renderer (`desktop/src/`) only. No Android, no backend/schema changes.

## Goal

Rework the Yu-Gi-Oh! card manager from a generic dark dashboard into a distinctive,
intuitive "duel cabinet": real TCG identity, a clearer navigation model, and a
collection that is a pleasure to look at.

**Decisions locked in:**
- Ambition: **bold redesign** (visuals + information architecture), features preserved.
- Mood: **Yu-Gi-Oh identity** on a dark base.
- Second accent: **Millennium gold** kept, alongside the signature violet.
- Rollout: **phased** (foundation → screens → command palette).
- UI language: **stays English** (mockup German was illustrative only).
- Theme: **dark only** (the product's world); no light mode.

## Visual system

Implemented by extending the existing Tailwind config — we keep Tailwind, we do not
switch styling systems.

**Color tokens** (add to `tailwind.config.js`):
- Ground/obsidian scale: `#0c0a11` (ground), `#16121e` (surface), `#1e1829` (surface-2), `#261e34` (surface-3), borders `#2c2440`.
- Text: `#ece8f4` / muted `#9a90b0` / faint `#6b6383`.
- Signature violet: `#9D00FF` (+ soft `#b957ff`, deep `#6a00ad`) — reuse existing `space-violet`.
- Millennium gold: `#F5C542` (+ deep `#d1a02a`).
- Semantic: good `#39d98a`, warn `#f5c542`, crit `#ff5d6c`.
- **Card-type frame colors** (authentic YGO): Monster/Effect `#E8944A`, Spell `#1DA891`, Trap `#C4568A`, Normal `#CBB07A`.
- **Rarity colors**: Common `#8a8594`, Rare `#6db4e8`, Super `#e8c76d`, Ultra `#f5c542`, Secret = rainbow holo (conic gradient).

**Typography** (bundle via `@fontsource` packages so the desktop app stays offline-safe):
- Display / labels: **Chakra Petch** (angular TCG-tech feel) — headings, nav groups, uppercase labels.
- Body: **Manrope** — all running text.
- Data: **JetBrains Mono** — passcodes, prices, IP, counts (with `tabular-nums`).

**Signature treatments:**
- **Card frame**: each card tile carries its type's frame color (inset ring + top strip).
- **Rarity gem**: small labeled gem badge (color per rarity) on the card art.
- **Foil shimmer**: animated diagonal sheen overlay for holo rarities (Super/Ultra/Secret+),
  Secret uses a rainbow variant. Must respect `prefers-reduced-motion`.
- Subtle ambient radial glows (violet top-right, faint gold bottom-left) on the app ground.

## Information architecture

New grouped sidebar (replaces the flat 9-item list):

- **Home** (standalone, top)
- **SAMMELN**: Scan (Staging) · Collection · Wishlist
- **ANALYSIEREN**: Insights
- **BAUEN**: Decks
- **Settings** (bottom) + Scanner-Link card (with live connection state)

Consolidations:
- **Unknown Cards + Missing Data → Collection segments.** They leave the sidebar and
  become segmented tabs inside Collection: `All / Unknown / Incomplete` (+ `Foils`).
  The existing filtering logic from `UnknownCards.jsx` / `MissingData.jsx` is reused as
  the content of those segments.
- **Portfolio + Statistics → "Insights"** with sub-tabs `Value | Breakdown`
  (Value = current Portfolio charts; Breakdown = current Statistics analytics).
- **Command palette** (Ctrl/⌘+K): global, jumps to any card (name/passcode/set) or action.

`App.jsx` remains a tab switcher; `activeTab` values change accordingly
(`unknown`/`missing` removed as tabs; `portfolio`+`statistics` unified under `insights`).

## Components

**New / shared:**
- `CardTile.jsx` — the reusable card, rendering a real image with type-frame color,
  rarity gem, foil shimmer, quantity badge, name/set/price. Used by Collection grid,
  Home "recently added", search results.
- `rarity.js` (util) — maps a rarity string → tier + treatment (gem color, foil on/off),
  and a card type → frame color. Single source of truth.
- `CommandPalette.jsx` — Ctrl/⌘+K modal (Phase 3).

**Reworked:**
- `Sidebar.jsx` — grouped nav, brand sigil, scanner-link with connection state, badges.
- `Dashboard.jsx` (Home) — hello header + Ctrl+K search entry, value panel w/ sparkline,
  scan-status panel + attention chips (counts from unknown/incomplete), recent strip, set completion.
- `CollectionList.jsx` — segmented control; grid switches to `CardTile`.
- New `Insights.jsx` wrapper hosting Portfolio (Value) and Statistics (Breakdown) as sub-tabs.
- `App.jsx` — updated tab wiring + global command-palette mount.

## Phasing

**Phase 1 — Foundation** (testable: app builds, sidebar + cards look new)
- Tailwind token + font setup; bundle fonts; global ground styles.
- `rarity.js` util; `CardTile.jsx`.
- `Sidebar.jsx` grouped restructure.

**Phase 2 — Screens** (testable: each screen renders, nav/segments work)
- Home redesign.
- Collection segments (fold in Unknown/Incomplete/Foils); grid uses `CardTile`.
- `Insights.jsx` merge of Portfolio + Statistics; App.jsx wiring.

**Phase 3 — Command palette**
- `CommandPalette.jsx`, global Ctrl/⌘+K, search + quick actions.

## Out of scope
- Android app, backend, DB schema.
- Light mode / theming toggle.
- German i18n (English UI retained).

## Success criteria
- `npm run build` passes after each phase.
- No sidebar entry for Unknown/Missing; their data reachable via Collection segments.
- Portfolio + Statistics reachable under a single Insights tab.
- Card tiles visibly encode type (frame color) and rarity (gem + foil).
- Ctrl/⌘+K opens a working global search/action palette.
