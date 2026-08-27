# Android Card Detail + Phone-Created Rows

**Date:** 2026-08-27
**Status:** Approved (design), pending implementation plan
**Builds on:** 2026-08-26-android-cloud-sync (the Supabase sync feature)

## Goal

Let the user tap a card in the Android collection to open a detail view (large
image, stats, description) that also manages the owned printings of that card
(quantity +/-, delete) and **adds a new printing** from the phone. Adding a
printing requires the phone to create new rows in the cloud, so this spec also
reworks the desktop sync to support phone-created rows safely.

Two further phone features the user wants — "search + add cards" and a
"dashboard / statistics" view — are **separate later specs**. The sync rework
here is what unblocks the "search + add" feature later, so the phone-created-row
work is done once.

## Scope (approved decisions)

- Card detail = **view full info + manage owned printings + add a new printing**,
  all in one spec, together with the sync rework.
- **Soft-delete everywhere + remove mirror-delete** (not the racy mirror-delete
  variant): every desktop deletion becomes `deleted=1` and propagates via the
  normal push; the desktop pull inserts cloud rows it doesn't have locally.
- **Add-a-printing applies only to cards the user already owns** (the detail is
  opened from an owned card, so its shared data — name/type/desc/image/stats —
  is already loaded). Adding entirely new cards is the later "search + add" spec.
- Detail groups printings **by passcode** (`id`).

## Architecture

Unchanged transport: Android talks to Supabase over OkHttp REST; the desktop
Electron app runs the sync loop (`electron/sync.cjs`) against the same Supabase
`cards` table. This spec changes two things: the desktop sync's delete/insert
semantics, and the Android UI/model.

The Supabase `cards` table already mirrors every column the detail view needs
(`type, desc, atk, def, level, race, attribute`, plus image/name/rarity/price);
no schema change is required.

## Part 1 — Desktop sync rework (`desktop/electron/`)

### 1a. Soft-delete everywhere (`main.cjs`, `database.cjs`)

The user-facing `delete-card` is already a soft delete. Convert the remaining
hard-deletes so their deletions propagate:

- `downgrade-to-lowest-rarity`, `merge-unknown-cards`,
  `convert-unknowns-to-default`: where they currently `DELETE FROM cards …` for a
  merged-away source row, change to `UPDATE cards SET deleted=1, quantity=0 …`
  (quantity already merged into the target row). The target-row update stays.
- The `DELETE FROM cards WHERE quantity <= 0` cleanup in `database.cjs`
  `runMigrations()`: change to `UPDATE cards SET deleted=1 WHERE quantity <= 0
  AND deleted=0` so legacy zero-qty rows tombstone instead of vanishing.
- All user-facing reads already exclude `deleted=0` (collection, portfolio,
  check-exists, poller, portfolio-history sums from the prior spec). Verify the
  consolidation tools' own SELECTs skip `deleted=1` rows so they don't reprocess
  tombstones.

### 1b. Remove mirror-delete (`sync.cjs`)

Delete the mirror-delete block in `push()` (the full remote-key scan that
tombstones cloud rows absent locally). With soft-delete everywhere, deletions
propagate through the normal push, and removing this step also fixes the
phone-created-row race (a just-inserted phone row is no longer wrongly
tombstoned) and the per-cycle full-table scan.

### 1c. Pull inserts missing rows (`sync.cjs`)

Today `pull()` applies remote rows with `UPDATE … WHERE key` (only
quantity+deleted), so a phone-created row whose key doesn't exist locally is
silently dropped. New rule per pulled row (after the echo-skip check):

- **Local row exists** → apply only `quantity` + `deleted` (unchanged; the
  desktop stays authoritative for name/price/stats).
- **Local row missing** → `INSERT` the full row from the cloud (all mirrored
  columns), so a phone-created printing appears locally with complete data.

Add a `remoteToLocalFull(remoteRow)` mapper (all mirrored columns → local
insert) alongside the existing `remoteToLocalPatch`. Use `INSERT OR IGNORE`
followed by the patch, or a single `INSERT … ON CONFLICT DO UPDATE SET
quantity, deleted`, so the operation is idempotent and never clobbers
desktop-authoritative columns on an existing row.

## Part 2 — Android data model

Extend `cloud/CardRow.kt` with the fields the cloud already returns:
`type: String?, desc: String?, atk: Int?, def: Int?, level: Int?, race: String?,
attribute: String?`. Parse them in `CollectionRepository.parse()` (org.json,
null-safe, same pattern as the existing fields). These fields are identical
across printings of one passcode.

## Part 3 — Android card detail (`ui/`)

### 3a. Tap-to-open

In `CollectionScreen`, make each card tile clickable → open a detail for that
tile's `id`. The detail receives the full loaded `List<CardRow>` (or re-reads
it) and filters to the printings whose `id` matches — those are the owned
variants. Shared display fields come from the first matching row.

### 3b. Detail screen (`ui/CardDetailScreen.kt`)

Layout mirrors the desktop `CardDetailModal` intent, adapted to mobile:
- Large image (Coil), name, chips for `type` / `race` / `attribute`.
- Stat tiles: Level/Rank/Link (label depends on type — Link → `LINK-n`, XYZ →
  Rank, else Level), ATK, DEF (hidden for Link), Passcode (`id`).
- Description (`desc`), scrollable.
- **Owned printings** (grouped by `id`): each shows `set_code`, `rarity`, price,
  quantity with +/- and a delete button — calling
  `CollectionRepository.setQuantity` / `softDelete` (existing suspend funcs).
- After any mutation, reload the printings (re-query cloud by `id`, or reload the
  collection) so the view stays current; on close, the collection refreshes.

### 3c. Add a new printing

- A `PrintingRepository.fetchSets(passcode): List<SetOption>` calls YGOPRODeck
  `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=<passcode>` over OkHttp
  (Dispatchers.IO), parses `card_sets[]` → `{ setCode, rarity, price }`,
  de-duplicated by `setCode|rarity`, excluding printings the user already owns.
- The detail shows a picker of those sets + an "Add" action.
- On add: build a new `CardRow` reusing the shared fields from the current
  card (name/type/desc/image/atk/def/level/race/attribute) plus the chosen
  `setCode`, `rarity`, `price`, `quantity=1`, `language="DE"`, `deleted=false`,
  and write it to the cloud via a new
  `CollectionRepository.addPrinting(row)` that does a REST `POST … /cards` with
  header `Prefer: resolution=merge-duplicates` (upsert on the PK), or — if that
  exact printing is already owned — calls `setQuantity(existing, existing.qty+1)`.

## Data flow (add-a-printing, end to end)

1. Phone: detail → fetch sets (YGOPRODeck) → user picks → `addPrinting` POSTs a
   full row to Supabase (`updated_at` server-stamped, `deleted=false`).
2. Desktop next cycle: `pull()` sees the new key not present locally → INSERTs
   the full row into SQLite → the card appears in the desktop collection/
   portfolio (the prior spec's `collection-changed` event refreshes the views).
3. Desktop `push()` later re-pushes it (echo, skipped via the skip-list).

## Error handling

- Android write/insert and the YGOPRODeck fetch are wrapped so failures surface
  a message and never crash (same pattern as the prior spec's write handlers);
  the 401-reauth-retry helper covers the new POST too.
- YGOPRODeck fetch needs internet; on failure the add-printing picker shows an
  error and the rest of the detail still works.
- Desktop insert-on-pull is idempotent (ON CONFLICT), so a re-pulled row can't
  duplicate or clobber.

## Testing / verification

- Desktop node test (extend `electron/test-sync.cjs` or a new
  `test-sync-insert.cjs`): a pulled row with a key absent locally is INSERTed
  with all columns; a pulled row with an existing key only changes
  quantity/deleted; a soft-deleted row (deleted=1) propagates without any
  mirror-delete step.
- Desktop: existing migration test still passes; `npm run build` still compiles.
- Android: user compiles in Android Studio (no SDK headless); manual run — tap a
  card → detail shows stats/description → adjust a printing's quantity → add a
  new printing → within ~20s it appears on the desktop.

## Out of scope (separate later specs)

- "Search + add cards" (add cards not yet owned) — reuses this spec's
  phone-created-row support.
- Dashboard / statistics view.
- Wishlist, deckbuilder, staging on the phone.
- Editing card metadata (name/stats) from the phone — desktop stays authoritative.

## Known limitations carried forward (single-user, accepted)

- Cross-clock LWW is coarse (no CRDT); tombstones accumulate (no purge yet);
  RLS is single shared account. Unchanged from the prior spec.
