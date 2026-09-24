# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A hybrid Yu-Gi-Oh! card collection manager (git repo `DevBuzzty/card_manager`, branch `main`):

- **`desktop/`** — Electron + React (Vite, Tailwind, react-router) + better-sqlite3. The primary app; owns the local SQLite collection and mirrors it to Supabase (`electron/sync.cjs`).
- **`android/`** — Kotlin + Jetpack Compose app (`ui/`, `cloud/`, `ml/`). Reads/writes the collection directly in Supabase over REST (OkHttp), keeps an in-memory store with delta sync plus a cold-start snapshot (`filesDir/sammlung.bin`), and scans cards on-device (ML Kit OCR + ONNX detector). The old Socket.io bridge (`main.cjs`, port 4000, `card_scanned`) still exists on the desktop.
- **`supabase/`** — Postgres schema/migrations (`*.sql`) and Edge Functions (`functions/`, Deno). Cloud `cards.quantity`/`deleted` are trigger-derived from `card_copies` (`card_copies_schema.sql`).
- **`docs/superpowers/`** — specs, plans, acceptance ledgers and handoff notes (`uebergabe/`). **`docs/fixtures/`** — shared JSON fixtures that both the JS and the Kotlin tests read ("twin" logic: e.g. `desktop/src/utils/saleFlow.js` ↔ `android/.../ml/SaleFlow.kt`). Change a fixture → both sides must still pass.

UI text and most comments are German.

> The installed PC build lives in `%LOCALAPPDATA%\Programs\yugioh-card-manager` and its data in `%APPDATA%\yugioh-card-manager\cards.db` — edit only the source tree. `android/local.properties` holds the Supabase URL/key: never read, change or commit it; after changing it run `gradlew clean` (BuildConfig constants get inlined).

## Commands

Desktop (inside `desktop/`):

```bash
npm install            # first-time setup; needs build tools for better-sqlite3 (native)
npm run electron:dev   # main dev loop: Vite dev server (:5173) + Electron window
npm run build          # Vite production build → dist/
npm run lint           # ESLint (flat config) — 5 legacy errors are expected, don't add more
npm run dist           # vite build + electron-builder → desktop/dist-electron/ (NSIS installer)
node --test src/utils/*.test.js src/utils/*.test.mjs                               # renderer logic tests
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs     # main-process tests (native better-sqlite3 → run under Electron)
```

Android (inside `android/`, JDK = Android Studio's `jbr`):

```bash
./gradlew testDebugUnitTest   # JVM unit tests (read docs/fixtures via Fixtures.text())
./gradlew assembleRelease     # installable APK, signed with the debug keystore
```

`test_yugipedia*.js` at the repo root are throwaway API-probing scripts, not tests.

## Architecture (desktop)

The Electron **main** process files under `desktop/electron/` are CommonJS (`.cjs`) even though `package.json` sets `"type": "module"` — that's deliberate. The React **renderer** under `desktop/src/` is ESM. Don't convert one to the other.

Core main-process files (many more feature modules sit next to them, each with a `*.test.cjs`):

- **`electron/main.cjs`** — the backend. Owns: the Socket.io server on port **4000** (forwards mobile `card_scanned` → renderer `card-scanned`), **every `ipcMain.handle` handler** (collection, decks, wishlist, portfolio, settings, CSV/YDK import-export, DB backup/restore/move/reset), and a **price poller** (`startPricePoller`) that every 60s refreshes prices for the 50 stalest cards from YGOPRODeck, appends to `portfolio_history`, and emits `price-update`.
- **`electron/database.cjs`** — opens the SQLite DB (`userData/cards.db`, path overridable via `userData/config.json` → `dbPath`) and runs idempotent `CREATE TABLE IF NOT EXISTS` + column/PK **migrations** on every launch. All schema changes go here as additive migrations.
- **`electron/api-handler.cjs`** — external HTTP with a SQLite-backed cache (`api_cache` table, per-call TTL). Two upstreams: **YGOPRODeck** `cardinfo.php` for card data, and **Yugipedia** `api.php` for German set codes (parses the `de_sets` block out of wikitext).

**`electron/preload.cjs`** is the only bridge: it exposes `window.api.*` via `contextBridge` (contextIsolation on, nodeIntegration off). Any new IPC channel must be added in **both** `main.cjs` (handler) and `preload.cjs` (exposed wrapper), or the renderer can't call it.

**Renderer** (`desktop/src/`): `App.jsx` uses react-router (`/start`, `/scannen`, `/sammlung/*`, `/decks`, `/verkaufen/*`, `/deals`, `/insights`, …) inside a `ToastProvider` (`useToast()` from `components/toastContext.js`). Pure, testable logic lives in `src/utils/*.js` next to its `*.test.js`. Styling is Tailwind; colors, type scale and radii come from the design tokens in `docs/fixtures/design/tokens.json` (checked by `theme.test.js`; `noLegacyColors.test.js` forbids raw hex/`text-[Npx]`/custom fonts). Large lists use `react-window`; charts use `recharts`; icons are `lucide-react`.

## Domain model — read before touching card logic

The `cards` table primary key is composite: **`(id, set_code, language, rarity)`**. A single passcode can therefore exist as several rows — a Common printing and a Secret Rare printing of the same set code are distinct rows, each with its own `quantity` and `price`. `id` = the 8-digit passcode (= YGOPRODeck `id`); `language` defaults to `'DE'` (this is a German-collection-first app, hence the Yugipedia `de_sets` parsing).

`card_copies` (one row per physical copy, primary key a UUID `copy_id`, with an `edition` ∈ `first`/`unlimited`/`limited`/`unknown` and a `condition` ∈ `MT`/`NM`/`EX`/`GD`/`LP`/`PL`/`PO`) is the source of truth for how many copies of a printing exist. `cards.quantity` and `cards.deleted` are **trigger-maintained caches** derived from live (non-deleted) `card_copies` rows — on both SQLite (`electron/copies-schema.cjs` triggers) and Postgres. Never write `quantity` or `deleted` directly from application code, and never hard-`DELETE` a copy (soft-delete via `deleted = 1`, same as printings); always go through the `electron/copies.cjs` helpers. Valuation is price × a condition factor from `electron/condition-factors.json`, shared by the renderer and the Android `Valuation.kt`. `price_history` records one row per printing/variant/day whenever a price changes. Default edition/condition for new copies live in `settings` (`default_edition`, `default_condition`). `sync.cjs` mirrors `card_copies` to the cloud as a second stream alongside `cards`, and no longer pushes `quantity`.

- **`set_code = 'Unknown'`** is a deliberate holding bucket for cards scanned before their printing is known. Several handlers exist to resolve it: `merge-unknown-cards`, `convert-unknowns-to-default`, and `downgrade-to-lowest-rarity`. These merge quantities into the correct printing and delete the `Unknown` row.
- **"Best default set"** (`findBestDefaultSet` in `main.cjs`) picks a card's cheapest/lowest-rarity printing (Common < Short Print < Rare < … < Secret Rare, then by price). This is the app's opinion of the "canonical" printing when the exact one isn't known.
- **Price source** is user-configurable via `settings` (`price_source` ∈ cardmarket/tcgplayer/ebay/amazon); handlers map it to the matching YGOPRODeck `*_price` field. Prefer a card's `set_price` when the exact `set_code` matches, else fall back to the card-level price.
  Per-rarity **Cardmarket EUR** prices come from `electron/cardmarket-bulk.cjs`: a daily bulk refresh reads Cardmarket's free `price_guide_3.json` (`trend`) for every printing with a known `cm_product_id`, resolving ids from `products_singles_3.json` + `products_nonsingles_3.json` where unambiguous. `electron/cardmarket-scraper.cjs` only scrapes printings whose `cm_product_id` is still NULL (several rarities of one card in one expansion) and stores the id it finds. Rows with `price_locked = 1` are skipped by the YGOPRODeck poller.
  The Supabase Edge Function `refresh-cardmarket-prices` (pg_cron, daily 05:00 UTC; see `supabase/README_cardmarket_cloud.md`) applies the same `trend` to the cloud rows so the phone stays current without the desktop; `cm_product_id` and `price_locked` (0/1/2) are mirrored via `sync.cjs`.

## Conventions & gotchas

- ESLint's `no-unused-vars` ignores identifiers matching `^[A-Z_]` — so intentionally-unused capitalized imports don't error.
- SQLite timestamps are naive UTC; the cache-age check in `api-handler.cjs` appends `"Z"` before parsing. Keep that in mind for any new time math.
- The README advertises an "AI Assistant" (Gemini) tab — there is **no such code in the current source**. Treat it as not-yet-implemented, not as something to wire up unless asked.
- `restore-database` / `move-database` / `reset-database` call `app.relaunch()` + `app.exit()` — they intentionally restart the whole app.
