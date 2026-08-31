# Android Design Refresh (desktop "space" look)

**Date:** 2026-08-31
**Status:** Approved (design), pending implementation plan
**Builds on:** the merged Android phone app (collection, detail, search, dashboard, cloud login).

## Goal

Make the Android app look like the desktop app: adopt the desktop's dark "space"
design language — its color palette, typography (Chakra Petch / Manrope /
JetBrains Mono), rounded card surfaces, and rarity/type accent colors — as a
proper Material3 theme + reusable components, applied idiomatically in Compose
(not a pixel-for-pixel port). **Pure Android; no backend, sync, or schema change.**

## Scope (approved decisions)

- **Same design language, Compose-idiomatic** (not 1:1 pixel port).
- **Bundle the desktop fonts via the Google Fonts provider** (`androidx.compose.ui:ui-text-google-fonts`, version-managed by the existing Compose BOM → no version risk). First load fetches over network (the app already needs network); falls back to the system font until available. No manual TTF bundling.
- **Restyle the screens this effort owns:** Collection, CardDetail, Search, Portfolio/Dashboard, CloudLogin.
- **Scanner and Deals tabs: theme-only uplift** — they inherit the new colors/typography automatically via `AppTheme`; their internals are NOT restyled (they belong to the parallel scanner/deals session).
- **Two shared files get minimal edits** (`MainActivity.kt`, `app/build.gradle.kts`); these are made while the parallel session is paused to avoid a shared-index collision.

## Design tokens (from the desktop `tailwind.config.js`)

Mapped into a Compose dark color scheme + extra accent colors:

- background `#121212` (space-black); surface / card `#1E1E1E` (space-charcoal); a subtle border `#2c2440` (line).
- primary `#9D00FF` (space-violet); a soft accent `#b957ff` (violet-soft).
- onBackground/onSurface `#E0E0E0` (space-white); secondary/muted text `#9a90b0` (ink-muted).
- error `#ff5d6c` (crit); good `#39d98a`; warn/gold `#F5C542`.
- **Rarity accents:** common `#8a8594`, rare `#6db4e8`, super `#e8c76d`, ultra `#f5c542`, secret `#ff5db1`.
- **Type/frame accents:** monster `#E8944A`, spell `#1DA891`, trap `#C4568A`.
- Shapes: rounded corners, medium ~12dp / large ~16dp.
- Type roles: **Chakra Petch** = display/titles; **Manrope** = body; **JetBrains Mono** = numbers, prices, passcodes, set codes.

## Components

New files, one clear responsibility each:

- `ui/theme/Type.kt` — `FontFamily`s for Chakra Petch / Manrope / JetBrains Mono via the Google Fonts provider, and a Material3 `Typography` assigning them to roles.
- `ui/theme/Color.kt` — the palette above as `Color` constants + a small `RarityColor(rarity)` / `TypeColor(type)` helper.
- `ui/theme/Theme.kt` — `@Composable fun AppTheme(content)` wrapping `MaterialTheme` with the dark color scheme, the typography, and shapes.
- `ui/components/SpaceCard.kt` — a dark rounded surface (`#1E1E1E`, ~16dp, subtle `#2c2440` border) used as the container for list rows / detail sections.
- `ui/components/Chips.kt` — `RarityChip(rarity)` and `TypeChip(type)` colored pills.
- `ui/components/Common.kt` — `SectionHeader(text)` (Chakra Petch, muted), `ValueText(euros)` (JetBrains Mono price). `StatBar` (already in `ui/Dashboard.kt`) is restyled in place to use the theme's primary/track colors.

## Screens restyled (this effort's)

Each keeps its existing behavior/logic; only presentation changes to use `AppTheme` + the components:

- **CollectionScreen** — each card becomes a `SpaceCard` row: image, name (display font), a `RarityChip`, set code (mono), `ValueText` price, and themed qty/delete controls; the "+" FAB uses the primary color.
- **CardDetailScreen** — hero image with a soft violet glow, `TypeChip`/attribute/race chips, stat tiles (ATK/DEF/level/passcode as `SpaceCard`s with mono values), description in a `SpaceCard`, owned printings as `SpaceCard` rows.
- **SearchScreen** — themed search field; results as `SpaceCard` rows; the add view reuses the themed `AddPrintingSection`.
- **PortfolioScreen (dashboard)** — value hero (large display/mono), top-10 and the four breakdowns using restyled `StatBar`s with rarity colors where applicable.
- **CloudLoginScreen** — a centered `SpaceCard` with themed fields + primary button.

## Shared-file edits (parallel-session coordination)

Done in one short window while the scanner/deals session is paused:

- `MainActivity.kt` — replace the inline `MaterialTheme(darkColorScheme(...)) { Surface { … } }` in `onCreate` with `AppTheme { Surface { … } }`. No other change to MainActivity (scanner flow, nav, Deals wiring untouched).
- `app/build.gradle.kts` — add `implementation("androidx.compose.ui:ui-text-google-fonts")` (BOM-managed, no explicit version) and the Google Fonts provider certs are the standard `com.google.android.gms:play-services-basement`-backed provider already available; no other dependency.

## Data flow / error handling

No data or control-flow change. Fonts: if the Google Fonts provider can't fetch (offline first run), Compose falls back to the default system font — the app stays fully functional, just with the fallback typeface until the font is cached.

## Testing / verification

- No desktop/node change → existing node tests stay green (untouched).
- Android: user compiles in Android Studio (no SDK headless). Manual pass: every restyled screen renders with the dark space palette, the three fonts, rounded cards, and rarity/type accent colors; Scanner and Deals tabs pick up the new colors/fonts without behavior change.

## Out of scope

- Restyling the Scanner camera overlay or the Deals screen internals (owned by the parallel session; they get the theme automatically).
- Any layout/behavior change beyond presentation (no new features; drill-down/wishlist are separate later specs).
- Light theme (the app is dark-only, matching the desktop).

## Known limitations / notes

- Google-Fonts first-load needs network; fallback is the system font. Acceptable for a personal app that already requires network for card images.
- The two shared-file edits must land while the parallel session is paused to avoid a shared-working-tree/index collision (as happened once before).
