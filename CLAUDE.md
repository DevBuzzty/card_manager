# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A hybrid Yu-Gi-Oh! card collection manager:

- **`desktop/`** — Electron + React (Vite) + better-sqlite3. This is the primary app and acts as the **server**. Almost all development happens here.
- **`android/`** — Android/Kotlin companion (single `MainActivity.kt`). Uses ML Kit OCR to read a card's 8-digit passcode and pushes it to the desktop over a WebSocket. Built/run from Android Studio, not npm.

The desktop app runs a Socket.io server; the phone connects to `<desktop-ip>:4000` and emits `card_scanned` events with a passcode. The desktop looks the card up, shows it in a Staging Area, and lets the user commit it to a local SQLite collection.

> **Note:** The packaged/installed build lives at `C:\Users\Buzzty\AppData\Local\Programs\yugioh-card-manager` (that's just the compiled output — `app.asar`). Do all editing here in the source tree. This repo is **not** a git repository yet.

## Commands (run inside `desktop/`)

```bash
npm install            # first-time setup; needs build tools for better-sqlite3 (native)
npm run electron:dev   # main dev loop: Vite dev server (:5173) + Electron window
npm run dev            # Vite only, browser — window.api is undefined, so IPC features are dead
npm run build          # Vite production build → dist/
npm run lint           # ESLint (flat config)
npm run dist           # vite build + electron-builder → desktop/dist-electron/ (NSIS installer + exe)
```

There is **no test suite**. `test_yugipedia*.js` at the repo root are throwaway API-probing scripts, not tests.

## Architecture (desktop)

The Electron **main** process files under `desktop/electron/` are CommonJS (`.cjs`) even though `package.json` sets `"type": "module"` — that's deliberate. The React **renderer** under `desktop/src/` is ESM. Don't convert one to the other.

Three main-process files:

- **`electron/main.cjs`** — the backend. Owns: the Socket.io server on port **4000** (forwards mobile `card_scanned` → renderer `card-scanned`), **every `ipcMain.handle` handler** (collection, decks, wishlist, portfolio, settings, CSV/YDK import-export, DB backup/restore/move/reset), and a **price poller** (`startPricePoller`) that every 60s refreshes prices for the 50 stalest cards from YGOPRODeck, appends to `portfolio_history`, and emits `price-update`.
- **`electron/database.cjs`** — opens the SQLite DB (`userData/cards.db`, path overridable via `userData/config.json` → `dbPath`) and runs idempotent `CREATE TABLE IF NOT EXISTS` + column/PK **migrations** on every launch. All schema changes go here as additive migrations.
- **`electron/api-handler.cjs`** — external HTTP with a SQLite-backed cache (`api_cache` table, per-call TTL). Two upstreams: **YGOPRODeck** `cardinfo.php` for card data, and **Yugipedia** `api.php` for German set codes (parses the `de_sets` block out of wikitext).

**`electron/preload.cjs`** is the only bridge: it exposes `window.api.*` via `contextBridge` (contextIsolation on, nodeIntegration off). Any new IPC channel must be added in **both** `main.cjs` (handler) and `preload.cjs` (exposed wrapper), or the renderer can't call it.

**Renderer** (`desktop/src/`): `App.jsx` is a plain `useState('activeTab')` tab switcher — **no router**. Tabs: dashboard, staging, collection, portfolio, deckbuilder, unknown, missing, wishlist, settings. Each maps to a component in `src/components/`. Non-tab components (`CardDetailModal`, `CardSearchModal`, `CustomSelect`, `RarityGuide`, `SetCompletion`) are composed inside those. Styling is Tailwind with a custom `space-*` palette defined in `tailwind.config.js` (`space-black #121212`, `space-violet #9D00FF`, etc.). Large lists use `react-window`; portfolio charts use `recharts`; icons are `lucide-react`.

## Domain model — read before touching card logic

The `cards` table primary key is composite: **`(id, set_code, language)`**. A single passcode can therefore exist as several rows — a Common printing and a Secret Rare printing are distinct rows, each with its own `quantity` and `price`. `id` = the 8-digit passcode (= YGOPRODeck `id`); `language` defaults to `'DE'` (this is a German-collection-first app, hence the Yugipedia `de_sets` parsing).

- **`set_code = 'Unknown'`** is a deliberate holding bucket for cards scanned before their printing is known. Several handlers exist to resolve it: `merge-unknown-cards`, `convert-unknowns-to-default`, and `downgrade-to-lowest-rarity`. These merge quantities into the correct printing and delete the `Unknown` row.
- **"Best default set"** (`findBestDefaultSet` in `main.cjs`) picks a card's cheapest/lowest-rarity printing (Common < Short Print < Rare < … < Secret Rare, then by price). This is the app's opinion of the "canonical" printing when the exact one isn't known.
- **Price source** is user-configurable via `settings` (`price_source` ∈ cardmarket/tcgplayer/ebay/amazon); handlers map it to the matching YGOPRODeck `*_price` field. Prefer a card's `set_price` when the exact `set_code` matches, else fall back to the card-level price.

## Conventions & gotchas

- ESLint's `no-unused-vars` ignores identifiers matching `^[A-Z_]` — so intentionally-unused capitalized imports don't error.
- SQLite timestamps are naive UTC; the cache-age check in `api-handler.cjs` appends `"Z"` before parsing. Keep that in mind for any new time math.
- The README advertises an "AI Assistant" (Gemini) tab — there is **no such code in the current source**. Treat it as not-yet-implemented, not as something to wire up unless asked.
- `restore-database` / `move-database` / `reset-database` call `app.relaunch()` + `app.exit()` — they intentionally restart the whole app.
