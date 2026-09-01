# Cardmarket Price Scraper — Design

**Date:** 2026-09-01
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/deal-scraper`

## Purpose

Give each collection printing an accurate **Cardmarket EUR price per rarity**. Today prices come from
YGOPRODeck: a single card-level Cardmarket EUR price (not per-rarity) plus spotty per-printing
TCGplayer USD `set_price`. So the same card in Ultra Rare and Secret Rare shows the *same* price,
which is wrong (their real values differ a lot).

Cardmarket has the per-rarity EUR prices, but:
- its official API is closed to new applications for this account;
- its downloadable price guide + product catalogue have prices per `idProduct` but **no rarity
  labels** — so they can't map a price to a specific rarity;
- the rarity + price together live only on the **product web pages**, behind Cloudflare.

So we scrape the product pages ourselves — small scale (only owned cards), on the user's own machine
and IP, where a real browser beats Cloudflare cheaply (commercial scrapers pay for proxy farms to do
this at scale for everyone; we don't need that).

## Non-goals

- No bulk scraping of all ~89k Cardmarket products.
- No scraping on the phone or on Supabase (no real browser / datacenter IP is Cloudflare-blocked).
- No sealed-product pricing (that's the separate deal-scraper).
- No attempt to defeat Cloudflare automatically beyond a persistent real-browser session; the user
  solves the occasional challenge/captcha manually.

## Architecture — where & how

- New Electron **main-process** module `desktop/electron/cardmarket-scraper.cjs`.
- It drives a **hidden `BrowserWindow`** (real Chromium, the user's residential IP) with its **own
  persistent `session`/partition** so the Cloudflare-clearance + login cookies survive between
  scrapes and between app runs (one challenge, then quiet).
- Triggered by a new IPC channel `scrape-cardmarket-prices` (added to both `main.cjs` handler and
  `preload.cjs` wrapper), fired by a button in the Collection view.
- Runs **sequentially** over the owned cards, one page at a time, with a polite delay.
- Emits progress on the existing `update-progress` channel (reuse the progress bar) and supports an
  abort flag.

## Matching (the core)

Per **distinct owned card** (grouped by passcode; one page scrape covers all its printings):

1. From the local row(s) we have `name` (EN) + each printing's `set_code` + `rarity`. From
   YGOPRODeck (`fetchCardData`, already cached) we resolve each `set_code` → its **set name**
   (`card_sets[].set_name`, e.g. "Structure Deck: Wave of Light").
2. The scraper navigates to the card's **Cardmarket page**: use Cardmarket's product search for the
   English `name`, land on the metacard/overview page, and read the **versions table** — rows of
   *(expansion name · rarity · trend price)* for every printing of that card.
3. For each owned printing, match `(set name, rarity)` to a table row:
   - **rarity**: exact match against Cardmarket's rarity label (normalise via a small synonym map,
     e.g. "Ultra Rare" ↔ "Ultra Rare", "Quarter Century Secret Rare" ↔ its CM label).
   - **expansion**: fuzzy match our YGOPRODeck set name against the row's expansion name (case/punct
     insensitive, contains/Levenshtein) — Cardmarket mostly uses the same English expansion names.
4. On a confident match → take the row's **Trend** price (EUR) → write it to that printing.

One scrape per card yields **rarity + price together** — the exact data missing from the download
files. The Cardmarket download files are NOT required for this design (possible future optimisation
for bulk price refresh, but they can't supply rarity, so they're out of scope here).

## Data model

Additive migration on `cards` (idempotent, in `database.cjs`):

- `cm_url TEXT` — the resolved Cardmarket product/metacard URL (cached, so re-runs skip the search).
- `cm_updated_at DATETIME` — when this printing's Cardmarket price was last set.
- `price_locked INTEGER DEFAULT 0` — 1 = a trusted price (Cardmarket scrape **or** manual override);
  the YGOPRODeck **price poller skips locked rows** so it can't overwrite them.

Scraper writes the Trend into the existing `price` column and sets `price_locked = 1` +
`cm_updated_at = now`. A bulk run **skips** printings whose `cm_updated_at` is < 7 days old (fast
repeat runs; only new/stale cards are scraped). Prices sync to Supabase via the existing dirty-row
sync, so the **phone shows them automatically without scraping** (Supabase `cards` gets the same new
columns via a migration SQL committed alongside).

## Autonomy & Cloudflare / captcha

- Window stays **hidden**; scrapes run sequentially with a **2–4 s polite delay** between pages.
- Before parsing, the scraper checks the page for a **Cloudflare / captcha challenge** (known markers
  in the DOM/title). If found: **show the window**, raise a notification/renderer event
  ("Bitte kurz das Captcha lösen"), and **poll until the real page appears**, then resume
  automatically. The persistent session means this is rare after the first clear.
- A hard per-page timeout + retry-once, then mark the card "kein CM-Treffer" and continue (one bad
  card never stalls the whole run).
- Renderer shows progress (n/total) and an **Abbrechen** button (sets the abort flag).

## UI & fallback

- **"Cardmarket-Preise aktualisieren"** button in the Collection view (own action; optionally also
  invoked by "Update All Cards" — decided at implementation, default: separate button).
- **No match** → keep the existing price, flag the printing "kein CM-Treffer" (small badge) so the
  user knows to set it manually.
- **Manual price override per printing**: a small editable EUR field on each printing (in
  `CardDetailModal`) that writes `price` + `price_locked = 1`. Always-correct fallback for anything
  the scraper can't match; also lets the user pin a value the poller won't touch.

## Error handling

- Network / timeout / Cloudflare-unsolved → skip card, log, continue; surfaced in a run summary
  ("X aktualisiert, Y ohne Treffer, Z Fehler").
- Ambiguous match (multiple plausible rows) → do NOT guess; leave unmatched → manual override.
- Scraper never throws into the poller path; the poller only gains the `price_locked` skip check.

## Testing

- **Parser unit tests** (pure functions, no network): given saved Cardmarket-page HTML fixtures →
  the versions parser returns the expected `(expansion, rarity, trend)` rows; the matcher maps a
  `(set name, rarity)` to the right row (incl. fuzzy-expansion and rarity-synonym cases, and the
  "no confident match" case). These run in CI-style `node --test` without a browser.
- **Migration**: verified idempotent (adds columns once; poller skip-check honoured).
- **Live scrape**: manual, user-driven (real Cloudflare/session); not automated.

## Risks & honest constraints (documented, accepted by user)

- **Fragile**: Cardmarket HTML or Cloudflare changes will require maintenance.
- **ToS grey area**: automated access is against Cardmarket's terms; mitigated by private, low-volume,
  human-in-the-loop use on the user's own account/IP — the user's own risk, explicitly accepted.
- **Slow**: ~2–4 s per card; a large collection is a long background run (but cached; repeat runs only
  touch new/stale cards).
- **Coverage**: cards not on Cardmarket, or with ambiguous naming/expansions, fall back to manual.

## Components (isolation)

- `cardmarket-scraper.cjs` — owns the hidden window, session, navigation, challenge handling, rate
  limiting, and the run loop. Depends on: a parser module + the DB.
- `cardmarket-parse.cjs` (pure, testable) — HTML → versions rows; `(setName, rarity)` → best row.
- `database.cjs` — the additive migration + the poller skip-check.
- `main.cjs` / `preload.cjs` — the `scrape-cardmarket-prices` IPC + progress/abort wiring.
- Renderer: the Collection button + progress + the per-printing manual price field in `CardDetailModal`.
- `supabase/cards_price_lock_migration.sql` — adds `cm_url`, `cm_updated_at`, `price_locked` to the
  cloud table so the phone renders the synced prices.
