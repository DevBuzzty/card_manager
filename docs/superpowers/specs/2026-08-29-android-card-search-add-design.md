# Android Card Search + Add

**Date:** 2026-08-29
**Status:** Approved (design), pending implementation plan
**Builds on:** 2026-08-27-android-card-detail (phone-created rows + `addPrinting` + `fetchSets`)

## Goal

Let the user search for any Yu-Gi-Oh! card from the phone (by name or passcode)
and add a chosen printing of it to the collection — even cards not yet owned.
This reuses the phone-created-row machinery already built (Supabase
`addPrinting`, desktop pull-inserts-missing), so it is a **pure Android
feature with no desktop, sync, or schema change.**

## Scope (approved decisions)

- **Android only.** No changes to `desktop/` or the Supabase schema.
- Search hits **YGOPRODeck directly** (`cardinfo.php`) over OkHttp — no Supabase
  auth needed for searching. Adding uses the existing `CollectionRepository.addPrinting`
  (the collection tab is already logged in).
- Entry point: a **"+" FAB** on the collection screen opens a search screen.
- Adding a found card = **pick a printing** (set/rarity) via the same picker used
  in card detail. The picker shows **only printings the user does not already own**;
  increasing the quantity of an owned printing stays in the collection/detail, not
  in search.
- The shared printing picker (`AddPrintingSection`) is **extracted** from
  `CardDetailScreen` into its own composable so both screens use one implementation.

## Architecture

All new/changed code is under `android/app/src/main/java/com/example/yugiohscanner/`.
No backend involvement beyond the existing cloud REST calls.

## Components

### `cloud/CardSearchRepository.kt` (new)

- `suspend fun search(query: String): List<CardRow>` — trims the query; if it is
  all digits, calls YGOPRODeck `cardinfo.php?id=<query>`, else
  `cardinfo.php?fname=<query>` (URL-encoded), mirroring the desktop `search-online`
  handler. Runs on `Dispatchers.IO` (OkHttp, like `PrintingRepository`).
- Maps each `data[]` entry to a `CardRow` carrying the shared detail fields
  (`id`, `name`, `imageUrl` from `card_images[0].image_url`, `type`, `desc`,
  `atk`, `def`, `level` — Link uses `linkval`, `race`, `attribute`); `setCode`,
  `rarity`, `price` are placeholders (`"Unknown"`/`null`/`null`) and `quantity=0`
  because no printing is chosen yet.
- Returns an empty list on no matches (YGOPRODeck returns an error object for
  zero hits — treat a missing `data` array as empty, not an exception).

### `ui/AddPrintingSection.kt` (extracted, shared)

Move the existing `AddPrintingSection` composable out of `CardDetailScreen.kt`
into its own file, unchanged in behavior:
`AddPrintingSection(base: CardRow, owned: List<CardRow>, onError: (String) -> Unit, onAdded: () -> Unit)`.
It fetches sets (`PrintingRepository.fetchSets`), excludes owned printings by
`setCode`, and adds via `CollectionRepository.addPrinting`. `CardDetailScreen`
imports it from the new location (no behavior change there).

### `ui/SearchScreen.kt` (new)

- A search `OutlinedTextField` (label "Name oder Passcode") + a search action.
- On search: `CardSearchRepository.search(query)` → results list (each row: Coil
  image + name + type). Errors set an inline error string; empty results show a
  "nichts gefunden" hint.
- Tapping a result opens an **add view** for that card: the card header (image +
  name) plus the shared `AddPrintingSection`, with `owned = ` the user's loaded
  collection filtered to this card's `id` (so already-owned printings are
  excluded). The screen loads the collection once (`CollectionRepository.loadCards`)
  to compute `owned`.
- A back affordance returns from the add view to the results, and from the
  results to the collection.

### `ui/CollectionScreen.kt` (modified)

Add a "+" FAB (or top action) that opens `SearchScreen`. When `SearchScreen`
reports an add happened (or on close), reload the collection so a newly added
card appears. Mirror the existing `detailId`-style short-circuit: a
`showSearch` state renders `SearchScreen` in place and returns to the list on
close. The scanner flow and existing collection behavior stay untouched.

## Data flow

1. User taps "+" in the collection → SearchScreen.
2. Types a name/passcode → YGOPRODeck search → results.
3. Taps a result → the add view loads the user's owned printings for that `id`,
   fetches the card's sets from YGOPRODeck, excludes owned ones, shows the picker.
4. Picks a set → `addPrinting` POSTs a full cloud row (built from the search
   result's shared fields + chosen set/rarity/price, `quantity=1`,
   `language="DE"`, `deleted=false`).
5. Desktop pull (next ~20s) INSERTs the new row locally — it appears on the PC.
6. Phone returns to the collection, which reloads and shows the new card.

## Error handling

- Search and set-fetch run on `Dispatchers.IO`; failures set an inline error and
  never crash (same pattern as the existing detail/collection handlers).
- `addPrinting` already routes through `executeWithReauth` (401 → re-login +
  retry), so an expired token during add is handled.
- Adding a printing the user already owns cannot happen through this flow (the
  picker excludes owned printings); a stray race would surface the existing
  "Hinzufügen fehlgeschlagen (409)" message rather than crash.

## Testing / verification

- No desktop/node changes → no new node tests. The existing desktop tests remain
  green (untouched).
- Android: user compiles in Android Studio (no SDK headless). Manual run: tap "+"
  → search by name and by passcode → tap a result → pick a set → the card appears
  in the collection and, within ~20s, on the desktop.

## Out of scope (separate later spec)

- Dashboard / statistics view.
- Adding straight to a wishlist (wishlist is not on the phone).
- Increasing the quantity of an already-owned printing from search (done in
  collection/detail instead).
- Editing card metadata from the phone (desktop stays authoritative).

## Known limitations carried forward (single-user, accepted)

- Cross-clock LWW is coarse; tombstones accumulate (no purge); single shared-account
  RLS; Android load errors show an empty list. Unchanged from prior specs.
