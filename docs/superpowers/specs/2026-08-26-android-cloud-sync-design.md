# Android Collection + Portfolio via Supabase Cloud Sync

**Date:** 2026-08-26
**Status:** Approved (design), pending implementation plan

## Goal

Extend the Android companion app so the user can view **and edit** their card
collection and see portfolio value from the phone — like the desktop — from
anywhere, even when the desktop PC is off. Data is synced through Supabase
(hosted Postgres) as a shared store between the desktop and the phone.

Scanning is unchanged: it stays on the LAN (`card_scanned` → desktop). Cloud
sync is **additive**.

## Scope (approved decisions)

- **Views on phone:** Collection (with card images, searchable, editable) and
  Portfolio (current total value + top cards by value).
- **Editing on phone:** change a card's quantity (+/-) and delete a card.
  Writes go to Supabase and propagate back to the desktop SQLite.
- **Card images:** loaded directly on the phone from YGOPRODeck image URLs
  (via Coil). Independent of the data-sync path; needs internet.
- **Sync model:** full read/write from anywhere, resolved by **Last-Write-Wins
  per card row** (each row carries `updated_at`; the newer write wins). No
  CRDT / no simultaneous-edit merge — out of scope for a single user with one
  PC + one phone.
- **Deletions:** **soft-delete tombstones** (`deleted` flag + `updated_at`),
  not hard deletes, so a delete on one device propagates. Desktop periodically
  purges old tombstones.
- **Auth:** a single shared Supabase account (email + password) used on both
  devices. Row-Level-Security ties rows to that account. No multi-user system.
- **Prices:** stay desktop-driven. The existing price poller writes prices into
  SQLite; those flow up to Supabase; the phone only displays them and never
  polls prices itself.
- **Portfolio history chart:** deferred. Phone shows current total value + top
  cards first; the recharts-style history chart can be added later.

## Architecture

```
┌─────────────┐   LAN socket (scan, unchanged)   ┌──────────┐
│  Android    │ ───────────────────────────────▶ │ Desktop  │
│  app        │                                    │ (Electron│
│             │                                    │  + SQLite│
│ Scanner /   │        Supabase (Postgres)         │  master) │
│ Collection /│ ◀───────────────────────────────▶ │          │
│ Portfolio   │   cloud sync (cards, LWW)          │ sync.cjs │
└─────────────┘ ◀──────────────────────────────▶  └──────────┘
        ▲                                                ▲
        └──── both authenticate as one shared account ───┘
```

- **Desktop SQLite remains the working master** for the desktop app itself.
  A new sync module mirrors the `cards` table to/from Supabase.
- **Phone reads/writes Supabase directly** for Collection + Portfolio.
- Both sides reconcile the same `cards` rows via Last-Write-Wins on `updated_at`.

## Data model

### Supabase `cards` table

Mirrors the desktop SQLite `cards` table, keyed by the same composite key
`(id, set_code, language)`, plus sync columns:

| Column        | Notes                                             |
|---------------|---------------------------------------------------|
| `id`          | 8-digit passcode (part of composite key)          |
| `set_code`    | printing set code (part of composite key)         |
| `language`    | defaults `'DE'` (part of composite key)           |
| `name`, `rarity`, `quantity`, `price`, `set_price`, image/url fields, … | mirrored from SQLite as-is |
| `updated_at`  | timestamp of last write; drives Last-Write-Wins   |
| `deleted`     | tombstone flag (0/1); soft delete                 |
| `owner`       | Supabase auth user id, for Row-Level-Security     |

A small `portfolio_snapshot` row/table holds the current total value written by
the desktop, so the phone need not recompute (it may still compute a simple sum
locally as a fallback).

**RLS:** every row scoped to `owner = auth.uid()`; only the shared account can
read/write.

### Desktop SQLite migrations (`database.cjs`, additive only)

- Add `updated_at` and `deleted` columns to `cards`.
- `delete-card` becomes a **soft delete** (`deleted=1, updated_at=now`); all
  collection/portfolio queries add `WHERE deleted=0`.
- Periodic purge of tombstones older than a threshold.

## Components

### Desktop

- **`electron/sync.cjs` (new):** owns the Supabase client
  (`@supabase/supabase-js`) and a sync loop (~every 20s, and/or coupled to the
  existing `price-update` emit). Each cycle: push locally-changed rows
  (`updated_at` newer than last push) up; pull remote rows newer than last pull
  down; apply Last-Write-Wins into SQLite. Emits a renderer event on change so
  the desktop UI refreshes.
- **`electron/database.cjs`:** the migrations above.
- **`electron/main.cjs` + `electron/preload.cjs`:** new IPC channels to
  configure Supabase (URL, anon key, login) and to read sync status. Every new
  channel is added in **both** files.
- **Settings UI (`src/components/Settings.jsx`):** fields for Supabase URL,
  anon key, and account login; a sync status/toggle.

### Android (`android/`)

- **Bottom navigation** with three tabs: **Scanner** (existing flow untouched),
  **Collection**, **Portfolio**.
- **Supabase access:** REST via Ktor or the Kotlin SDK; a one-time login screen;
  credentials stored in the existing `scanner_prefs`.
- **Collection screen:** image list (Coil → YGOPRODeck), search/filter, quantity
  +/- and delete → writes to Supabase (sets `updated_at`, or `deleted` on
  delete).
- **Portfolio screen:** total value + breakdown (e.g. most valuable cards).
- **Refactor:** the new screens live in their own Kotlin files rather than
  growing the single `MainActivity.kt`.

## Data flow

- **Price update:** YGOPRODeck → desktop poller → SQLite `cards.price` →
  sync.cjs push → Supabase → phone displays.
- **Phone edits quantity/deletes:** phone → Supabase (`updated_at`/`deleted`) →
  desktop sync pull → SQLite (LWW) → desktop UI refresh.
- **Desktop edits (scan commit, manual change):** SQLite → sync.cjs push →
  Supabase → phone reads.

## Error handling

- No/failed network: desktop sync loop retries next cycle; phone shows last
  known data (cached) and a "offline / not synced" indicator.
- Missing/invalid Supabase config: features degrade gracefully; desktop keeps
  working locally, phone stays on Scanner-only until configured.
- Conflicting edits: resolved deterministically by `updated_at` (later wins);
  acceptable given single-user assumption.

## Testing / verification

- Desktop migrations run idempotently on launch (existing pattern).
- Manual verification matrix: edit qty on phone → appears on desktop; delete on
  desktop → disappears on phone; price change on desktop → shows on phone;
  offline edit on phone → reconciles when back online.
- No automated test suite exists in this repo; verification is manual per the
  above matrix.

## User setup (owned by the user; Claude cannot create accounts)

1. Create a Supabase account + project (free tier).
2. Run the provided SQL snippet in the Supabase editor → `cards` table + RLS.
3. Create one login user.
4. Enter Supabase URL + anon key + login once on the desktop and once on the
   phone.

## Out of scope

- Real multi-user accounts / sharing.
- CRDT / simultaneous-edit conflict merge.
- Portfolio history chart on the phone (deferred).
- Decks and Wishlist on the phone (not requested).
- Scanning while away from the desktop / over the cloud.
