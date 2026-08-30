# Android Dashboard / Statistics

**Date:** 2026-08-30
**Status:** Approved (design), pending implementation plan
**Builds on:** the merged Android cloud-sync + collection/portfolio features.

## Goal

Grow the phone's existing "Wert" (Portfolio) tab into a full dashboard: keep the
value headline and most-valuable cards, and add four distribution breakdowns of
the collection — by rarity, card type, set, and attribute. Everything is computed
client-side from the already-loaded collection. **Pure Android feature; no
desktop, sync, or schema change; no new dependency.**

## Scope (approved decisions)

- **Extend the existing "Wert" tab** (`PortfolioScreen`), not a new bottom-nav tab.
- **No charting library** (avoids the dependency-version risk seen earlier) —
  distributions render as simple Compose horizontal bars (a `Box` with fractional
  width) plus a text label.
- Four breakdowns: **rarity, type, set, attribute.**
- **Bar length = card count** within a section (relative to the section's max);
  the text beside each bar shows "count · value €".
- Most-valuable list trimmed to **top 10** (was 20) now that more sits below it.

## Architecture

All changes are under `android/app/src/main/java/com/example/yugiohscanner/ui/`.
The dashboard reads the collection through the existing
`CollectionRepository.loadCards()` and computes everything locally from the
`CardRow` fields (`price, quantity, rarity, type, setCode, attribute`). No cloud
write, no backend.

## What it shows

Rendered top-to-bottom in one vertically-scrolling column:

1. **Headline metrics** (unchanged): total value (`Σ price·quantity`), total cards
   (`Σ quantity`), entries (`cards.size`).
2. **Teuerste Karten**: top 10 by `price·quantity`.
3. **Nach Rarität**: one bar per distinct `rarity` (null → "Unbekannt"), ordered by
   a fixed rarity rank (Common < Short Print < Rare < Super Rare < Ultra Rare <
   Secret Rare < other/unknown last). Each shows count + summed value.
4. **Nach Typ**: three groups derived from `type` — contains "Spell" → "Zauber",
   contains "Trap" → "Falle", else "Monster" (a null type falls to "Monster").
   Count + value each.
5. **Nach Set**: top 10 `setCode` groups by count (value shown alongside).
6. **Nach Attribut**: one bar per non-null `attribute` (monsters only), by count,
   with value.

## Components

### `computeDashboard(cards: List<CardRow>): Dashboard` (pure function)

Returns a `Dashboard` data object holding: `totalValue: Double`,
`totalCards: Int`, `entries: Int`, `top: List<CardRow>` (top 10 by value), and
four `List<StatGroup>` (rarity, type, set, attribute). A `StatGroup` is
`(label: String, count: Int, value: Double)`. The rarity list is ordered by the
fixed rank above; type is the fixed Monster/Zauber/Falle order; set is top-10 by
count desc; attribute is by count desc. Pure and side-effect-free so it is easy
to reason about and could be unit-tested later.

### `StatBar(label: String, count: Int, value: Double, fraction: Float)` (composable)

A row: the label, a horizontal bar whose width is `fraction` of the available
width (a `Box(Modifier.fillMaxWidth(fraction))` over a track), and a
"`count` · `%.2f €`" text. `fraction` = `count / sectionMaxCount` (guard against
divide-by-zero when the section is empty). Reused by all four sections.

### `PortfolioScreen` (rewritten to a scrollable dashboard)

Loads cards (as today), calls `computeDashboard`, and renders the metrics, the
top-10 list, and the four sections inside a single `Column` with
`verticalScroll(rememberScrollState())`. The existing nested `LazyColumn` is
replaced by plain `forEach` rows (bounded lists: 10 + a handful per section) so
they compose inside the scrolling column without nested-scroll conflicts. The
tab wiring in `MainActivity` is unchanged (same composable name).

## Data flow

`loadCards()` → `computeDashboard(cards)` → render. Read-only; nothing is written
back. A newly synced card appears on the next open/reload of the tab.

## Error handling

- Load failure is caught (as today) and leaves an empty collection → the
  dashboard shows zeros/empty sections rather than crashing.
- Empty collection: metrics show 0, sections render nothing (or a short "keine
  Daten" line); no divide-by-zero (guard the bar fraction).

## Testing / verification

- No desktop/node changes → existing node tests remain green (untouched).
- Android: user compiles in Android Studio (no SDK headless). Manual run: open the
  "Wert" tab → total value + counts match the portfolio; the four breakdowns look
  plausible (rarities/types/sets/attributes present in the collection, counts sum
  to the collection size where applicable).

## Out of scope

- Charting libraries / pie charts / time-series (value-over-time lives on the
  desktop portfolio history).
- Filtering or drilling into a breakdown (tap a rarity to see those cards) — could
  be a later enhancement.
- Any desktop or sync change.

## Known limitations carried forward (single-user, accepted)

- Value uses the synced per-row `price` (desktop-driven, cardmarket by default);
  the phone never recomputes prices. Load errors show an empty view. Unchanged
  from prior specs.
