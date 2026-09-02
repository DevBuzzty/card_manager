# Cardmarket Bulk Prices (Hybrid) — Design

**Date:** 2026-09-02
**Status:** Approved (brainstorm), pending implementation plan
**Supersedes in part:** `2026-09-01-cardmarket-scraper-design.md` (the scraper stays, but becomes a fallback)

## Purpose

Today every per-rarity Cardmarket EUR price is obtained by scraping one Cardmarket page per card
(2–4 s each, Cloudflare-fragile, manual button or a 4-cards-per-10-min background trickle). For
~1200 printings that takes days and the user has to babysit a button.

Cardmarket publishes **free, unauthenticated, daily JSON files** (no Cloudflare):

| File | Size | Content |
|---|---|---|
| `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json` | ~10 MB, daily | per `idProduct`: `trend`, `avg`, `low`, `avg1`, `avg7`, `avg30` (+ foil variants) |
| `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_3.json` | ~15 MB | 86 809 singles: `idProduct`, `name` (EN), `idExpansion`, `idMetacard` — **no rarity, no expansion name** |
| `https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_3.json` | ~0.5 MB | boosters/decks/tins: `name` ("Legend of Blue Eyes White Dragon Booster"), `idExpansion` — covers 1031 of 1177 singles expansions |

Once a printing's `idProduct` is known, its price refreshes forever from the price guide with zero
page loads. The design therefore:

1. resolves `idProduct` **without scraping** wherever it is unambiguous (name + expansion → exactly
   one product), which covers most Commons and single-rarity printings;
2. lets the existing scraper resolve the remaining ambiguous printings (several rarities of the
   same card in the same expansion — 36 % of all Cardmarket products, but a small share of the
   user's collection) and store their `idProduct`;
3. refreshes **all** resolved printings daily from the price guide, using the **`trend`** field
   (user decision; Cardmarket's own smoothed price, replaces the current scraped "Ab"/from price).

## Non-goals

- No sealed-product pricing (deal-scraper territory).
- No guessing of rarity by price rank when several products share name + expansion. Ambiguous →
  scraper or manual; never a guess.
- No new columns synced to Supabase; only `price` continues to sync as today. `cm_product_id`
  stays desktop-only.
- No change to how prices are displayed or aggregated in the renderer.
- No removal of the scraper, the manual per-printing price field, or `price_locked` semantics.

## Architecture

New Electron **main-process** module `desktop/electron/cardmarket-bulk.cjs` (I/O, DB, scheduling)
plus a **pure** module `desktop/electron/cardmarket-bulk-parse.cjs` (matching/normalisation, unit
tested with `node --test`, mirroring the existing `cardmarket-parse.cjs` split).

```
app start / every 24 h / "Jetzt aktualisieren"
        │
        ▼
 ensureFiles()  ── downloads price_guide (if cache > 24 h), singles+nonsingles (if cache > 7 d)
        │           into userData/cardmarket/*.json; on any failure keep old cache, abort run
        ▼
 resolveMissing()  ── Step A: cards with cm_product_id IS NULL → try file-only resolution
        ▼
 applyPrices()     ── Step B: cards with cm_product_id → price = trend, one transaction
        ▼
 renderer gets 'price-update' + new bulk status
```

`runBulkRefresh(db, { force })` is the single entry point; it returns
`{ resolved, priced, unresolved, skipped, error }`.

### Step A — file-only resolver

Inputs per printing: `id` (passcode), `name` (EN, from the row or `fetchCardData`), `set_code`
(e.g. `LOB-DE001`), `rarity`.

1. **Set-code prefix → set name.** One call to YGOPRODeck
   `https://db.ygoprodeck.com/api/v7/cardsets.php` (cached via the existing `cachedFetch`, TTL 7 d)
   gives `{ set_name, set_code }` for every set. Map by prefix (`set_code.split('-')[0]`). Prefix is
   identical for DE and EN codes (the region infix differs, the prefix does not).
2. **Set name → idExpansion.** From the nonsingles file, derive an expansion name per `idExpansion`
   by stripping the product-type suffix from booster/deck product names (`" Booster Box"`,
   `" Booster"`, `" Case (…)"`, `" Display"`, `" Structure Deck"`, `" Starter Deck"`, `" Special Edition"`,
   `" Tin"`, `"(Reprint)"` …). Normalise both sides (lowercase, strip punctuation/articles/whitespace)
   and match exactly on the normalised string. If several `idExpansion` share a normalised name
   (e.g. "Duelist Pack: Yugi" and its reprint) → treat as ambiguous for this printing (leave NULL).
3. **Candidates.** `singles.filter(p => normName(p.name) === normName(cardName) && p.idExpansion === exp)`.
   - exactly **1** → `cm_product_id = idProduct` (confident)
   - **0** or **>1** → stay NULL; the printing is left to the scraper

The resolver is a pure function `resolveProduct({ cardName, setName }, indexes) → idProduct | null`
with the file indexes built once per run (Maps keyed by normalised name).

### Step B — price update

```sql
UPDATE cards SET price = ?, price_locked = 1, cm_updated_at = CURRENT_TIMESTAMP
WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?
```
for every row with `cm_product_id` whose guide entry has a non-null `trend`, inside one
`db.transaction`. Rows whose `idProduct` is missing from the guide or has `trend: null` are left
unchanged (counted as `skipped`). Then `settings.cm_bulk_last_run = now` and, if anything changed,
`mainWindow.webContents.send('price-update', { updates: [], totalValue })` exactly like the
existing pollers.

### Scraper changes (`cardmarket-scraper.cjs`)

- `EXTRACT_JS` additionally returns `idProduct` per `.card-column`, parsed from the product image
  URL (`product-images.s3.cardmarket.com/<cat>/<set>/<idProduct>/<idProduct>.jpg`). **Verified as
  the first plan step against a live page**; fallback if absent: follow the `/Products/Singles/`
  link and read the id from the product page (one extra page load, only for that printing).
- On a match the UPDATE also writes `cm_product_id = ?`.
- Work selection changes from "priced > 7 days ago" to **`cm_product_id IS NULL`** (manual and
  background runs alike; `force` keeps meaning "ignore freshness" for the remaining NULL rows).
  Result: the scraper's backlog is the unresolved remainder and shrinks to zero on its own.
- Everything else (hidden window, challenge handling, `minRank` threshold, `maxCards`) unchanged.

### Scheduling & guards (`main.cjs`)

- `startCardmarketBulkScheduler()`: run once ~30 s after `ready` if `cm_bulk_last_run` is older
  than 24 h (or never), then every 60 min check the same condition (cheap; makes "daily" robust
  against the app not being open at a fixed time). On download failure retry at the next hourly tick.
- Reuses the existing `cmRunning` guard: bulk and scraper never run concurrently; whichever is
  running makes the other return `{ busy: true }` / skip the tick.
- New IPC (both `main.cjs` and `preload.cjs`):
  - `cardmarket-bulk-refresh` → `runBulkRefresh(db, { force: true })`
  - `cardmarket-bulk-status` → `{ lastRun, resolvedCount, unresolvedCount }` from DB/settings

### Data model (`database.cjs`, additive, idempotent)

- `cards.cm_product_id INTEGER` (NULL = not yet resolved), added with the same
  `existingCols.includes` pattern as the price-lock columns.
- `settings` keys: `cm_bulk_last_run` (ISO string).
- No Supabase migration (column is not in `MIRROR_COLS`).

### File cache

`userData/cardmarket/{price_guide_3,products_singles_3,products_nonsingles_3}.json`. Freshness by
file mtime: price guide 24 h, product lists 7 d. Downloads go to a `.tmp` and are renamed on
success so a failed download never destroys a good cache. JSON parse failure = treat as download
failure (delete the bad file, keep going with the previous run's data if any, else abort run).

## UI (`CollectionList`)

- The "Cardmarket-Preise aktualisieren" button becomes **"Jetzt aktualisieren"** and calls
  `cardmarket-bulk-refresh` (seconds, shows a spinner, no progress bar needed).
- Status line next to it: `Letztes Update: <relative time> · <n> per Datei · <m> offen`
  (from `cardmarket-bulk-status`; "offen" = printings with `cm_product_id IS NULL`).
- The existing "Auto" checkbox + rarity-threshold dropdown remain and now govern only the
  scraper's work on the "offen" remainder. Label tweak: "Auto (Rest per Scraper)".
- The `CardDetailModal` manual price field is unchanged.

## Error handling

| Situation | Behaviour |
|---|---|
| Download / network error | keep old cache; if no cache at all → abort run with `error`, retry next hourly tick; never throws into `main.cjs` |
| Corrupt JSON | delete file, same as download error |
| `cardsets.php` unavailable | Step A skipped this run (resolver needs set names); Step B still runs |
| `idProduct` missing from guide / `trend` null | row unchanged, counted `skipped` |
| Ambiguous name or expansion | leave `cm_product_id` NULL, no guess |
| Scraper running | bulk returns `{ busy: true }`; scheduler retries next tick |

## Testing

- `cardmarket-bulk-parse.test.cjs` (`node --test`, no network, no Electron):
  - `expansionNameFromProduct("Legend of Blue Eyes White Dragon Booster Box")` → `"Legend of Blue Eyes White Dragon"`; same for Structure/Starter Deck, Tin, Case, "(Reprint)".
  - `buildExpansionIndex(nonsingles)` → Map normalised name → `idExpansion`, with duplicates marked ambiguous.
  - `resolveProduct` for the three cases 0 / 1 / n candidates, using small fixtures cut from the real files (Dark Magician: several expansions, one product each; a Rarity Collection card with several products in one expansion).
  - `idProductFromImageUrl` for the live URL shape and for a non-matching URL (→ null).
- Migration test (`migration.test.cjs` pattern): `cm_product_id` added once, second run no-op.
- Live: manual run on the user's collection; success = most Commons priced in the first run without
  the scraper, status line shows a small "offen" remainder, scraper backlog shrinks over time.

## Risks & constraints

- **File-format drift**: Cardmarket may change the download JSON shape or URL. Mitigation: the
  loader validates the top-level keys (`priceGuides`, `products`) and treats mismatch as corrupt.
- **Set-name mismatch** between YGOPRODeck and Cardmarket booster names for some sets (146
  expansions have no nonsingle product at all). Those printings simply remain for the scraper —
  a coverage gap, not a correctness risk.
- **Price semantics change**: switching from the scraped "Ab" (lowest offer) to `trend` raises
  most displayed prices slightly. Accepted by the user.
- **Memory**: the singles file is ~15 MB / 87 k objects; parsed once per run and released.
- ToS grey area of the scraper is unchanged and now exercised far less.

## Components (isolation)

- `cardmarket-bulk-parse.cjs` — pure: name normalisation, expansion index, candidate resolution, image-URL id parse.
- `cardmarket-bulk.cjs` — file cache + download, run orchestration (Steps A/B), status query.
- `cardmarket-scraper.cjs` — returns/stores `idProduct`; selects only unresolved printings.
- `database.cjs` — `cm_product_id` migration.
- `main.cjs` / `preload.cjs` — scheduler, two IPC channels, shared `cmRunning` guard.
- `CollectionList.jsx` — button rename + status line.
