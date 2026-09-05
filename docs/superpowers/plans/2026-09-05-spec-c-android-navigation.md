# Spec C, Teil 2 — Handy: Navigation und Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android app gets the same map as the desktop (Start · Sammlung · Scan · Deals, plus Einstellungen behind a profile icon), a real back stack, a first start that asks for e-mail and password instead of a Supabase URL and an anon key, a scan screen that is a camera with a review sheet instead of a status-text console, and one German vocabulary.

**Architecture:** A single `NavHost` (Navigation Compose) replaces the `var tab by remember` switch and the `var sub` full-screen sub-views. Top-level destinations keep their own back stacks (`saveState`/`restoreState`), detail destinations (card, set, deck, settings, search) sit above them, and the system back button finally does what the on-screen arrow does. "Mehr" disappears: Wunschliste, Sets and Decks become segments of Sammlung, Einstellungen moves behind the profile icon on Start. The camera screen keeps its ML pipeline untouched — only its chrome changes, and the phone staging becomes a `ModalBottomSheet` over the running camera.

**Tech Stack:** Kotlin 2.0.0, AGP 8.2.2, compileSdk 34, minSdk 26, Jetpack Compose (BOM 2024.02.02) with Material3, CameraX 1.3.1, ONNX Runtime, OkHttp REST against Supabase. New dependency: `androidx.navigation:navigation-compose:2.7.7` (the last 2.7.x, built against Kotlin 1.9/2.0 — do **not** take 2.8.x, it needs a newer Compose BOM).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-spec-c-navigation-layout-design.md`. Part 1 (desktop) is a separate plan; do not touch `desktop/` here.
- **Every user-visible string is German.** Binding vocabulary (Spec C §4): Start · Scannen · Sammlung · Karten · Wunschliste · Sets · Decks · Deals · Einstellungen · Übernehmen · Prüfen · Abbrechen · Zurück · Exemplar · Printing · Set-Code · Rarity · Passcode · Edition · Zustand. Yu-Gi-Oh terms stay English.
- Keep the existing theme: `ui/theme/Color.kt` (`Primary`, `Gold`, `Good`, `Muted`, `OnSurface`, `Background`, `SurfaceColor`, `Line`, `ErrorColor`), `MonoFontFamily`, and the components `SpaceCard`, `SectionHeader`, `ValueText`, `RarityChip`, `TypeChip`, `CopyChip`. Do not introduce new colors or a new card style.
- Do not touch the ML pipeline (`ml/**`), the repositories under `cloud/**` (except where a task names one), or anything from Spec A (copies, `CopyChip`, `Prefs`, `Valuation`).
- Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34: add no dependency other than the navigation artifact named above.
- Verification for every task: `./gradlew :app:compileDebugKotlin` and `./gradlew :app:testDebugUnitTest` from `android/` must both be BUILD SUCCESSFUL. There is no Compose UI test harness in this project — behaviour is verified on the device by the controller/user at the end of each task, not by the implementer.
- `adb devices` may list a phone (`22X0219322003405`). Run `./gradlew :app:installDebug` only when a task's step says so.
- Secrets: `android/local.properties` is git-ignored and holds `sdk.dir`; Task 2 adds `supabase.url` / `supabase.key` there. Never commit real values; `local.properties.example` documents the keys.
- Commit style: `feat(android): …` / `refactor(android): …`, one commit per task, message ending with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt` (new) | Route constants, the `NavHost`, the bottom bar with the raised Scan button. Owns the app shell. |
| `.../ui/SammlungScreen.kt` (new) | Segment bar (Karten · Wunschliste · Sets · Decks) hosting the four existing screens. |
| `.../ui/StartScreen.kt` (new, replaces `UebersichtScreen.kt` as a tab) | Value card with chart + Δ, quick actions, recently scanned, deal hits, set progress, profile icon. |
| `.../ui/ScanScreen.kt` (new; camera body moves out of `MainActivity.kt`) | Camera + overlay + header/footer chrome + the staging bottom sheet. |
| `.../MainActivity.kt` | Shrinks to the activity, the theme, and a call to `AppNav()`. `MainScreen`, `ConfigScreen` and the scan-history state disappear. |
| `.../ui/MoreScreen.kt` | Deleted. |
| `.../ui/CloudLoginScreen.kt` | E-mail + password; URL/key come from `BuildConfig`, with an "Erweitert" section as an override. |
| `.../ui/CollectionScreen.kt` | Search behind a magnifier, filter sheet, list/grid toggle, add-FAB; no longer owns sub-navigation. |
| `.../ui/CardDetailScreen.kt` | Order per Spec C §5.7 (image, name, printing line, price, Deine Exemplare, weiteres Printing, collapsed text/stats), heart in the top bar. |
| `.../ui/SettingsScreen.kt` | Konto · Desktop-Verbindung · Preise · Standards · Über. |
| `.../ui/WishlistScreen.kt`, `SetCompletionScreen.kt`, `DecksScreen.kt` | `onClose` becomes optional so they can render inside a segment without a back arrow. |
| `android/app/build.gradle.kts` | navigation-compose; `buildConfigField`s (Task 2). |

---

### Task 1: NavHost, four tabs, Sammlung segments, no more "Mehr"

**Files:**
- Create: `.../ui/AppNav.kt`, `.../ui/SammlungScreen.kt`
- Delete: `.../ui/MoreScreen.kt`
- Modify: `android/app/build.gradle.kts`, `.../MainActivity.kt`, `.../ui/WishlistScreen.kt`, `.../ui/SetCompletionScreen.kt`, `.../ui/DecksScreen.kt`, `.../ui/CollectionScreen.kt`, `.../ui/SearchScreen.kt`

**Interfaces:**
- Produces `object Routes { const val START = "start"; const val SAMMLUNG = "sammlung/{segment}"; const val SCAN = "scan"; const val DEALS = "deals"; const val EINSTELLUNGEN = "einstellungen"; const val SUCHE = "suche"; fun sammlung(segment: String) = "sammlung/$segment" }` — segments: `karten`, `wunschliste`, `sets`, `decks`.
- Produces `@Composable fun AppNav()` — the whole shell; `MainActivity.setContent { YuGiOhScannerTheme { AppNav() } }`.
- Card detail, set detail and deck detail stay **inside** their hosting screens for now (they are already implemented that way after Spec A); Task 6 does not change that either. Only the top-level structure becomes routed.
- `CollectionScreen`, `WishlistScreen`, `SetCompletionScreen`, `DecksScreen` render inside the Sammlung segment host and must not draw their own page title or back arrow.

- [ ] **Step 1: Dependency**

`android/app/build.gradle.kts`, next to the other AndroidX entries:
```kotlin
    implementation("androidx.navigation:navigation-compose:2.7.7")
```

- [ ] **Step 2: The shell**

Create `.../ui/AppNav.kt`:
```kotlin
package com.example.yugiohscanner.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.SurfaceColor

object Routes {
    const val START = "start"
    const val SCAN = "scan"
    const val DEALS = "deals"
    const val EINSTELLUNGEN = "einstellungen"
    const val SUCHE = "suche"
    const val SAMMLUNG = "sammlung/{segment}"
    fun sammlung(segment: String = "karten") = "sammlung/$segment"
}

// Top-level destinations: the bottom bar switches between them and each keeps its own back stack.
private data class TopLevel(val route: String, val label: String, val icon: ImageVector)
private val TOP_LEVEL = listOf(
    TopLevel(Routes.START, "Start", Icons.Default.Home),
    TopLevel(Routes.sammlung(), "Sammlung", Icons.Default.Style),
    TopLevel(Routes.DEALS, "Deals", Icons.Default.Sell),
)

@Composable
fun AppNav() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE) }
    val nav = rememberNavController()
    var cloudReady by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (SupabaseCloud.isConfigured(prefs)) {
            try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); cloudReady = true } catch (_: Exception) {}
        }
    }

    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    // The camera owns the whole screen; every other destination keeps the bar.
    val showBar = route != Routes.SCAN

    Scaffold(bottomBar = { if (showBar) AppBottomBar(nav) }) { padding ->
        NavHost(
            navController = nav,
            startDestination = Routes.START,
            modifier = Modifier.padding(if (showBar) padding else PaddingValues(0.dp)),
        ) {
            // Task 4 replaces this with StartScreen and drops the temporary "wert" destination;
            // until then the existing Übersicht keeps working and Wert stays reachable from it.
            composable(Routes.START) {
                if (cloudReady) UebersichtScreen(
                    onOpenWert = { nav.navigate("wert") },
                    onOpenScan = { nav.navigate(Routes.SCAN) },
                    onOpenDeals = { nav.navigateTop(Routes.DEALS) },
                    onOpenSammlung = { nav.navigateTop(Routes.sammlung()) },
                ) else CloudLoginScreen(prefs) { cloudReady = true }
            }
            composable("wert") { PortfolioScreen() }
            composable(
                Routes.SAMMLUNG,
                arguments = listOf(navArgument("segment") { type = NavType.StringType; defaultValue = "karten" }),
            ) { backStackEntry ->
                if (cloudReady) SammlungScreen(
                    segment = backStackEntry.arguments?.getString("segment") ?: "karten",
                    onSegment = { nav.navigate(Routes.sammlung(it)) { popUpTo(Routes.SAMMLUNG) { inclusive = true } } },
                    onOpenSuche = { nav.navigate(Routes.SUCHE) },
                ) else CloudLoginScreen(prefs) { cloudReady = true }
            }
            // Task 3 swaps this for ScanScreen(onClose = …); the existing MainScreen already
            // owns the permission gate, the socket and the camera, so nothing regresses here.
            composable(Routes.SCAN) { MainScreen() }
            composable(Routes.DEALS) {
                if (cloudReady) DealsScreen() else CloudLoginScreen(prefs) { cloudReady = true }
            }
            // Task 6 gives SettingsScreen its own back arrow (onBack); today it has none.
            composable(Routes.EINSTELLUNGEN) {
                SettingsScreen(prefs) { cloudReady = false; nav.popBackStack() }
            }
            composable(Routes.SUCHE) { SearchScreen(onClose = { nav.popBackStack() }, onAdded = {}) }
        }
    }
}

// Switching tabs must not stack them: pop to the graph's start, keep each tab's own state.
private fun NavHostController.navigateTop(route: String) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

@Composable
private fun AppBottomBar(nav: NavHostController) {
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination
    Box(Modifier.fillMaxWidth().height(84.dp)) {
        Surface(Modifier.fillMaxWidth().height(64.dp).align(Alignment.BottomCenter), color = SurfaceColor) {
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                NavItem(Modifier.weight(1f), TOP_LEVEL[0], current, nav)   // Start
                NavItem(Modifier.weight(1f), TOP_LEVEL[1], current, nav)   // Sammlung
                Spacer(Modifier.weight(1f))                                // gap under the FAB
                NavItem(Modifier.weight(1f), TOP_LEVEL[2], current, nav)   // Deals
                Spacer(Modifier.weight(1f))
            }
        }
        Box(
            Modifier.align(Alignment.TopCenter).size(60.dp).clip(CircleShape)
                .background(Primary).clickable { nav.navigate(Routes.SCAN) },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.CameraAlt, "Scannen", tint = Color.White, modifier = Modifier.size(28.dp)) }
    }
}

@Composable
private fun NavItem(modifier: Modifier, item: TopLevel, current: androidx.navigation.NavDestination?, nav: NavHostController) {
    val selected = current?.hierarchy?.any { it.route == item.route } == true
    val tint = if (selected) Primary else Muted
    Column(
        modifier.fillMaxHeight().clickable { nav.navigateTop(item.route) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(item.icon, item.label, tint = tint, modifier = Modifier.size(24.dp))
        Text(item.label, color = tint, style = MaterialTheme.typography.labelSmall)
    }
}
```
The fourth bottom slot is intentionally empty (`Spacer`) so the three labels stay symmetric around the raised button; the previous bar had five items and a cramped gap.

- [ ] **Step 3: The Sammlung host**

Create `.../ui/SammlungScreen.kt`:
```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ui.theme.OnSurface

private val SEGMENTS = listOf(
    "karten" to "Karten",
    "wunschliste" to "Wunschliste",
    "sets" to "Sets",
    "decks" to "Decks",
)

// Everything that is "my collection" lives on one tab; the chips swap the content below.
@Composable
fun SammlungScreen(segment: String, onSegment: (String) -> Unit, onOpenSuche: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Text("Sammlung", style = MaterialTheme.typography.headlineSmall, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SEGMENTS.forEach { (id, label) ->
                FilterChip(selected = segment == id, onClick = { onSegment(id) }, label = { Text(label) })
            }
        }
        Box(Modifier.weight(1f)) {
            when (segment) {
                "wunschliste" -> WishlistScreen()
                "sets" -> SetCompletionScreen()
                "decks" -> DecksScreen()
                else -> CollectionScreen(onOpenSuche = onOpenSuche)
            }
        }
    }
}
```

- [ ] **Step 4: The hosted screens lose their own chrome**

In `WishlistScreen.kt`, `SetCompletionScreen.kt` and `DecksScreen.kt`: change the signature to `onClose: (() -> Unit)? = null` and render the back `IconButton` (and, where present, the screen's own big title) only when `onClose != null`:
```kotlin
            if (onClose != null) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface) }
            }
```
`DecksScreen`'s internal deck editor keeps its own back arrow (it is a sub-view of the segment, not of the tab).

`CollectionScreen.kt`: it currently owns `showSearch` and renders `SearchScreen` full-screen. Replace that with a parameter — `fun CollectionScreen(onOpenSuche: () -> Unit)` — drop the `showSearch` state and the early-return block, and make the FAB call `onOpenSuche()`. The card-detail sub-view (`detailId`) stays as it is.

`SearchScreen.kt`: `onAdded` may now be a no-op; keep the signature.

- [ ] **Step 5: MainActivity shrinks**

Delete only the old shell from `MainActivity.kt`: `enum class Tab`, `MainScaffold`, its private `AppBottomBar` and `NavItem`. `MainScreen`, `ConfigScreen`, `ScannerScreen` and `CardAnalyzer` stay exactly as they are — Task 3 moves the camera into its own file and deletes them there. Delete `ui/MoreScreen.kt`.

Set the activity's content to the new shell:
```kotlin
        setContent { YuGiOhScannerTheme { AppNav() } }
```
(keep whatever the theme wrapper is called in the current file).

- [ ] **Step 6: Verify**

Run (from `android/`), each as its own command:
`./gradlew :app:compileDebugKotlin` → BUILD SUCCESSFUL
`./gradlew :app:testDebugUnitTest` → BUILD SUCCESSFUL
Then grep: `grep -rn "MoreScreen\|MainScaffold" app/src/main/java` → no hits (`Tab` is gone with `MainScaffold`; the word still appears in `TabRow`-style Compose APIs, so grep for the two names only).

- [ ] **Step 7: Commit**

```bash
git add -A android/app
git commit -m "feat(android): NavHost shell with Start/Sammlung/Scan/Deals, Sammlung segments, Mehr removed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Login with e-mail and password only

**Files:**
- Modify: `android/app/build.gradle.kts`, `.../ui/CloudLoginScreen.kt`, `.../cloud/SupabaseCloud.kt`
- Create: `android/local.properties.example`

**Interfaces:**
- `BuildConfig.SUPABASE_URL` / `BuildConfig.SUPABASE_KEY`, fed from `local.properties` keys `supabase.url` / `supabase.key`, empty string when absent.
- `SupabaseCloud.isConfigured(prefs)` returns true when e-mail is set **and** a URL/key is available from either the prefs or `BuildConfig`; `SupabaseCloud.init(prefs)` prefers the prefs value and falls back to `BuildConfig`.
- `CloudLoginScreen(prefs, onReady)` keeps its signature.

- [ ] **Step 1: Gradle reads local.properties**

At the top of `android/app/build.gradle.kts`:
```kotlin
import java.util.Properties

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
```
inside `defaultConfig`:
```kotlin
        buildConfigField("String", "SUPABASE_URL", "\"${localProps.getProperty("supabase.url", "")}\"")
        buildConfigField("String", "SUPABASE_KEY", "\"${localProps.getProperty("supabase.key", "")}\"")
```
and in `buildFeatures`:
```kotlin
        buildConfig = true
```

Create `android/local.properties.example`:
```properties
# Copy to local.properties (git-ignored) and fill in.
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
# Supabase project (Settings -> Data API). The publishable/anon key is fine here.
supabase.url=https://<project-ref>.supabase.co
supabase.key=sb_publishable_...
```
Tell the user (report) to add the two `supabase.` lines to their own `android/local.properties`; without them the login screen falls back to the "Erweitert" fields.

- [ ] **Step 2: SupabaseCloud falls back to BuildConfig**

In `.../cloud/SupabaseCloud.kt`, replace the two config readers:
```kotlin
    // The project URL and the publishable key are build config (local.properties); the prefs only
    // override them when the user pointed the app at a different project under "Erweitert".
    private fun cfgUrl(prefs: SharedPreferences): String =
        (prefs.getString("supabase_url", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL)
            .trim().trimEnd('/').removeSuffix("/rest/v1")

    private fun cfgKey(prefs: SharedPreferences): String =
        (prefs.getString("supabase_key", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_KEY).trim()

    fun isConfigured(prefs: SharedPreferences): Boolean =
        cfgUrl(prefs).isNotBlank() && cfgKey(prefs).isNotBlank() &&
            !prefs.getString("supabase_email", "").isNullOrBlank()

    fun init(prefs: SharedPreferences) {
        baseUrl = cfgUrl(prefs)
        apiKey = cfgKey(prefs)
        email = prefs.getString("supabase_email", "")!!.trim()
        password = prefs.getString("supabase_password", "")!!
        accessToken = null
    }
```
Add `import com.example.yugiohscanner.BuildConfig`.

- [ ] **Step 3: The login screen**

Rewrite `CloudLoginScreen.kt`'s card body: app name, two fields, one button, an error line, and a collapsed "Erweitert" block holding the URL and key fields (prefilled from the prefs, blank when the build config supplies them):
```kotlin
@Composable
fun CloudLoginScreen(prefs: SharedPreferences, onReady: () -> Unit) {
    var email by remember { mutableStateOf(prefs.getString("supabase_email", "") ?: "") }
    var password by remember { mutableStateOf(prefs.getString("supabase_password", "") ?: "") }
    var url by remember { mutableStateOf(prefs.getString("supabase_url", "") ?: "") }
    var key by remember { mutableStateOf(prefs.getString("supabase_key", "") ?: "") }
    var advanced by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    …
                Text("Card Dex", style = MaterialTheme.typography.headlineMedium, color = OnSurface)
                Text("Yu-Gi-Oh! Sammlung · Wert · Deals", style = MaterialTheme.typography.bodySmall, color = Muted)
                …
                OutlinedTextField(email, { email = it }, label = { Text("E-Mail") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), …)
                OutlinedTextField(password, { password = it }, label = { Text("Passwort") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), …)
                Button(enabled = !busy && email.isNotBlank() && password.isNotBlank(), onClick = { … }) {
                    Text(if (busy) "Anmelden…" else "Anmelden")
                }
                TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Erweitert ausblenden" else "Erweitert") }
                if (advanced) { /* the two old fields, labels „Projekt-URL" and „Anon Key",
                                   with the hint: „Nur nötig, um ein anderes Supabase-Projekt zu verwenden." */ }
```
The button's `onClick` writes e-mail and password to the prefs (and URL/key only when the advanced fields are non-blank), then `SupabaseCloud.init(prefs); SupabaseCloud.signIn(); onReady()` inside the existing `scope.launch`, setting `busy` around it and putting the exception message into `error`. Keep the German error text as the message from the exception.
Imports to add: `androidx.compose.foundation.text.KeyboardOptions`, `androidx.compose.ui.text.input.KeyboardType`, `androidx.compose.ui.text.input.PasswordVisualTransformation`.

- [ ] **Step 4: Verify**

`./gradlew :app:compileDebugKotlin` and `./gradlew :app:testDebugUnitTest`. Note in the report that `BuildConfig.SUPABASE_*` are empty until the user adds the two lines to `local.properties`.

- [ ] **Step 5: Commit**

```bash
git add android/app/build.gradle.kts android/local.properties.example android/app/src/main/java/com/example/yugiohscanner/cloud/SupabaseCloud.kt android/app/src/main/java/com/example/yugiohscanner/ui/CloudLoginScreen.kt
git commit -m "feat(android): login asks only for e-mail and password; project URL/key come from BuildConfig

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Scan screen — camera chrome and the review sheet

**Files:**
- Create: `.../ui/ScanScreen.kt` (the camera composable moves here from `MainActivity.kt`)
- Modify: `.../MainActivity.kt` (delete `ScannerScreen`, the history state and the bridge from Task 1), `.../ui/ScanStagingScreen.kt` (becomes the sheet's content)

**Interfaces:**
- `@Composable fun ScanScreen(onClose: () -> Unit)` — owns the camera permission gate, the socket auto-connect, the ML pipeline wiring (all moved verbatim), the staging list and the sheet.
- `@Composable fun ScanStagingSheet(entries: SnapshotStateList<ScanStagingEntry>, onCommitted: () -> Unit)` — the current `ScanStagingScreen` body without its own `Surface`/top bar/close button, so it can live inside a `ModalBottomSheet`. Keep `ScanStagingScreen` deleted once nothing calls it.

- [ ] **Step 1: Move the camera composable**

Create `ScanScreen.kt` and move `ScannerScreen`'s entire body into it, renamed to `ScanScreen(onClose: () -> Unit)`, plus the parts of the old `MainScreen` that it needs: the prefs, the socket state and the auto-connect `LaunchedEffect`, and the camera-permission gate. Drop from the moved code: `scanHistory`, `onAddHistory`, `onClearHistory`, `saveHistory`, the history overlay and its `showHistory` state, and the `Neu` button. Everything ML-related (`pipeline`, `analyzer`, `setEvidence`, `BoxTracker`, the `Canvas` overlay, `onConfirmed`, `onDetected`, `onProgress`, the `DisposableEffect` teardown) moves unchanged.

- [ ] **Step 2: Header**

Replace the old "Top Controls Row" with one row pinned to the top:
```kotlin
        Row(
            Modifier.fillMaxWidth().align(Alignment.TopCenter)
                .background(Color.Black.copy(alpha = 0.35f)).statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Schließen", tint = Color.White) }
            Text("Scannen", color = Color.White, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.width(8.dp))
            // Desktop status: green = mirroring scans to the PC, grey = phone only.
            Box(
                Modifier.size(9.dp).clip(CircleShape)
                    .background(if (connected) Good else Muted)
                    .clickable {
                        scope.launch {
                            snackbar.showSnackbar(
                                if (connected) "Desktop verbunden – Scans gehen zusätzlich an den PC."
                                else "Kein Desktop – Scans bleiben am Handy."
                            )
                        }
                    },
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { /* existing flash toggle */ }) { Icon(…, "Blitz", tint = Color.White) }
            IconButton(onClick = { /* existing focus toggle */ }) { Icon(…, "Fokus", tint = Color.White) }
            IconButton(onClick = { showManualEntry = true }) { Icon(Icons.Default.Keyboard, "Passcode eingeben", tint = Color.White) }
        }
```
Keep the existing flash and focus `IconButton` bodies verbatim (only their `contentDescription`s become German). The `Toast`s they show become German too (`Dauer-Autofokus`, `Fokussiere…`). Add a `SnackbarHost` at the bottom of the `Box` bound to a `remember { SnackbarHostState() }`.

- [ ] **Step 3: Footer and sheet**

Replace the old "Status Bar" column with a bottom bar that only counts and opens the sheet:
```kotlin
        if (stagingCards.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .background(Color.Black.copy(alpha = 0.55f)).navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${stagingCards.size} Karten erkannt", color = Color.White, modifier = Modifier.weight(1f))
                Button(onClick = { showSheet = true }) { Text("Prüfen (${stagingCards.size})") }
            }
        }
        if (showSheet) {
            ModalBottomSheet(onDismissRequest = { showSheet = false }, sheetState = sheetState) {
                ScanStagingSheet(entries = stagingCards, onCommitted = { showSheet = false })
            }
        }
```
with `var showSheet by remember { mutableStateOf(false) }` and `val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)`. `ModalBottomSheet` needs `@OptIn(ExperimentalMaterial3Api::class)` on the composable.

- [ ] **Step 4: The sheet content**

In `ScanStagingScreen.kt`, rename `ScanStagingScreen` to `ScanStagingSheet`, drop the `onClose` parameter, the outer `Surface`, and the top row with the back arrow; keep everything else (the entries list, `StagingRow`, `QtyStepper`, `SetPicker`, the `CopyChip` from Spec A, the commit button). Give the sheet a small header instead:
```kotlin
        Text("Prüfen & übernehmen", style = MaterialTheme.typography.titleLarge, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 4.dp, bottom = 8.dp))
```
The commit button keeps its logic and calls `onCommitted()` after `entries.clear()`.

- [ ] **Step 5: Scans always land in the phone staging**

In the moved `onConfirmed` handler, the current code branches: with a desktop connected it only emits over the socket, otherwise it stages locally. Spec C §5.3 requires both. Restructure so the staging entry is always created, and the socket emit becomes an additional mirror:
```kotlin
            // Always stage on the phone; a connected desktop additionally gets a mirror of the scan.
            if (connected && socket != null) {
                val data = JSONObject().put("passcode", pc)
                val cand = com.example.yugiohscanner.ml.SetCodeOcr.extract(evidence.joinToString(" "))
                if (cand.isNotEmpty()) { data.put("setCode", cand.first()); data.put("setCodeCandidates", JSONArray(cand)) }
                socket.emit("card_scanned", data)
            }
            val entry = ScanStagingEntry(System.nanoTime(), pc).apply {
                edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
                condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
            }
            stagingCards.add(entry)
            scanStatus = "＋ $pc"
            scope.launch { /* the existing base/knownSets/selectedSet resolution, unchanged */ }
```

- [ ] **Step 6: Permission empty state**

When the camera permission is missing, show a plain state instead of the old IP form:
```kotlin
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center,
               horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Kamera-Berechtigung nötig", style = MaterialTheme.typography.titleMedium, color = OnSurface)
            Spacer(Modifier.height(8.dp))
            Text("Zum Scannen braucht die App Zugriff auf die Kamera.", color = Muted,
                 style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Kamera erlauben") }
        }
```

- [ ] **Step 7: Clean up MainActivity and point the route at the new screen**

Delete `MainScreen`, `ConfigScreen`, `ScannerScreen`, the scan-history helpers and every import that becomes unused from `MainActivity.kt`; move `CardAnalyzer` into `ScanScreen.kt` (nothing else uses it). In `AppNav.kt`, replace the placeholder route with the real one:
```kotlin
            composable(Routes.SCAN) { ScanScreen(onClose = { nav.popBackStack() }) }
```
(and drop the comment above it that announced this task).

- [ ] **Step 8: Verify**

`./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`, then `grep -rn "scan_history\|showHistory\|ConfigScreen" app/src/main/java` → no hits.

- [ ] **Step 9: Commit**

```bash
git add -A android/app/src/main/java
git commit -m "feat(android): scan screen with a slim header, a review bottom sheet and always-on phone staging

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Start screen

**Files:**
- Create: `.../ui/StartScreen.kt`
- Delete: `.../ui/UebersichtScreen.kt`, `.../ui/PortfolioScreen.kt`
- Modify: `.../ui/AppNav.kt` (already routes to `StartScreen`), `.../ui/Dashboard.kt` (keep `computeDashboard`, `StatBar`, `printingValue` — they move nowhere)

**Interfaces:**
- `@Composable fun StartScreen(onOpenSammlung: () -> Unit, onOpenScan: () -> Unit, onOpenDeals: () -> Unit, onOpenEinstellungen: () -> Unit)`.
- Value section = the `PortfolioScreen` content (snapshot chart, timeframe chips, Δ, the four `StatSection` breakdowns) merged into the Start page; `UebersichtScreen`'s quick actions, recent cards, deal preview and set progress keep their markup.

- [ ] **Step 1: Merge the two screens**

Create `StartScreen.kt` from `UebersichtScreen.kt`'s structure and fill the value card from `PortfolioScreen.kt`:
- Load once: `cards = CollectionRepository.loadCards()`, `copies = CollectionRepository.loadCopies()`, `SnapshotsRepository.upsertToday(...)`, `snapshots = SnapshotsRepository.loadSnapshots()` (all inside the existing `try` shape, non-fatal).
- Header row: `Text("Start", headlineSmall)` on the left, a profile `IconButton(Icons.Default.AccountCircle)` on the right calling `onOpenEinstellungen()`.
- Value card: total (`ValueText`/`displaySmall` in `Gold`), the `${d.totalCards} Karten · ${d.entries} Einträge` line, the Δ line, the timeframe chips (7/30/90/365/Alles) and `ValueChart` — all copied verbatim from `PortfolioScreen`, including its private `ValueChart` and `dayOrdinal` helpers (move them into `StartScreen.kt`).
- Below: the quick-action row (`Scannen`, `Sammlung`, `Deals`), `Zuletzt gescannt` (the 5 newest cards), the deal preview card, the set-progress card — from `UebersichtScreen`, with German labels.
- Keep the four `StatSection` breakdowns (Nach Rarität / Typ / Set / Attribut) at the bottom of the page so nothing from the Wert tab is lost.

- [ ] **Step 2: Delete the two old screens and rewire the route**

Remove `UebersichtScreen.kt` and `PortfolioScreen.kt`. `Dashboard.kt` (the pure `computeDashboard`, `printingValue`, `StatGroup`, `StatBar`) stays untouched and is now used only by `StartScreen`. In `AppNav.kt`, replace the temporary Start block and delete the `"wert"` destination:
```kotlin
            composable(Routes.START) {
                if (cloudReady) StartScreen(
                    onOpenSammlung = { nav.navigateTop(Routes.sammlung()) },
                    onOpenScan = { nav.navigate(Routes.SCAN) },
                    onOpenDeals = { nav.navigateTop(Routes.DEALS) },
                    onOpenEinstellungen = { nav.navigate(Routes.EINSTELLUNGEN) },
                ) else CloudLoginScreen(prefs) { cloudReady = true }
            }
```

- [ ] **Step 3: Verify**

`./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`, then `grep -rn "UebersichtScreen\|PortfolioScreen" app/src/main/java` → no hits.

- [ ] **Step 4: Commit**

```bash
git add -A android/app/src/main/java
git commit -m "feat(android): Start merges Übersicht and Wert into one page with the profile entry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Sammlung › Karten — search, filters, grid

**Files:**
- Modify: `.../ui/CollectionScreen.kt`

**Interfaces:**
- No new exports. `CollectionScreen(onOpenSuche: () -> Unit)` gains: a magnifier that reveals the search field, a filter bottom sheet (Set · Rarity · Typ · Sprache · Zustand · Edition), active-filter chips, and a list/grid toggle.
- Filter state lives in the screen; the filtering itself extends the existing `groups` `remember` block.

- [ ] **Step 1: State**

```kotlin
    var searchOpen by remember { mutableStateOf(false) }
    var filterOpen by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(false) }
    var fSet by remember { mutableStateOf<String?>(null) }
    var fRarity by remember { mutableStateOf<String?>(null) }
    var fType by remember { mutableStateOf<String?>(null) }
    var fLang by remember { mutableStateOf<String?>(null) }
    var fCondition by remember { mutableStateOf<String?>(null) }
    var fEdition by remember { mutableStateOf<String?>(null) }
```
The option lists come from the loaded data (`cards.mapNotNull { it.rarity }.distinct().sorted()`, set prefixes via `it.setCode.substringBefore('-')`, `Valuation.CONDITIONS`, `Valuation.EDITIONS`); a copy-based filter (`fCondition`/`fEdition`) matches when any copy of the group carries that value (`byKey[...]`, already available from Spec A).

- [ ] **Step 2: Header row**

Replace the always-visible `OutlinedTextField` with:
```kotlin
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (searchOpen) {
                OutlinedTextField(query, { query = it }, singleLine = true, modifier = Modifier.weight(1f),
                    placeholder = { Text("Suchen") },
                    trailingIcon = { IconButton(onClick = { query = ""; searchOpen = false }) { Icon(Icons.Default.Close, "Suche schließen") } })
            } else {
                Text("${groups.size} Karten", color = Muted, modifier = Modifier.weight(1f))
                IconButton(onClick = { searchOpen = true }) { Icon(Icons.Default.Search, "Suchen", tint = OnSurface) }
            }
            IconButton(onClick = { grid = !grid }) {
                Icon(if (grid) Icons.AutoMirrored.Filled.List else Icons.Default.GridView, "Ansicht wechseln", tint = OnSurface)
            }
            BadgedBox(badge = { if (activeFilterCount > 0) Badge { Text("$activeFilterCount") } }) {
                IconButton(onClick = { filterOpen = true }) { Icon(Icons.Default.FilterList, "Filter", tint = OnSurface) }
            }
        }
```
Keep the existing sort chips row (Wert · Preis · Name) underneath.

- [ ] **Step 3: Filter sheet**

```kotlin
        if (filterOpen) {
            ModalBottomSheet(onDismissRequest = { filterOpen = false }) {
                Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
                       verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Filter", style = MaterialTheme.typography.titleLarge, color = OnSurface)
                    FilterGroup("Set", setOptions, fSet) { fSet = it }
                    FilterGroup("Rarity", rarityOptions, fRarity) { fRarity = it }
                    FilterGroup("Typ", typeOptions, fType) { fType = it }
                    FilterGroup("Sprache", langOptions, fLang) { fLang = it }
                    FilterGroup("Zustand", Valuation.CONDITIONS, fCondition) { fCondition = it }
                    FilterGroup("Edition", Valuation.EDITIONS, fEdition, { Valuation.EDITION_LABELS[it] ?: it }) { fEdition = it }
                    TextButton(onClick = { fSet = null; fRarity = null; fType = null; fLang = null; fCondition = null; fEdition = null }) {
                        Text("Alle Filter entfernen")
                    }
                }
            }
        }
```
with a small private helper in the same file:
```kotlin
// One filter row: a scrollable chip per option, tapping the active chip clears it.
@Composable
private fun FilterGroup(title: String, options: List<String>, selected: String?, label: (String) -> String = { it }, onSelect: (String?) -> Unit) {
    Column {
        Text(title, style = MaterialTheme.typography.labelMedium, color = Muted)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { o ->
                FilterChip(selected == o, { onSelect(if (selected == o) null else o) }, label = { Text(label(o)) })
            }
        }
    }
}
```

- [ ] **Step 4: Active chips and the grid**

Above the list, render one removable chip per set filter (`InputChip` with a trailing `Close` icon calling the setter with `null`).
The grid variant renders the same `groups` in a `LazyVerticalGrid(GridCells.Fixed(3))`: the card image (`AsyncImage`, `aspectRatio(0.68f)`), the quantity bottom-left and the value bottom-right as small overlays, tapping opens the same `detailId`. The list variant keeps `CardGroupItem` unchanged.
The add-FAB stays and calls `onOpenSuche()`.

- [ ] **Step 5: Verify**

`./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt
git commit -m "feat(android): collection with a reveal search, filter sheet, active chips and a grid view

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Card detail order, settings sections, vocabulary sweep

**Files:**
- Modify: `.../ui/CardDetailScreen.kt`, `.../ui/SettingsScreen.kt`, plus every screen still holding an English string

**Interfaces:**
- `SettingsScreen(prefs, onBack: () -> Unit, onLoggedOut: () -> Unit)` — gains the back arrow it needs as a routed destination (Task 1 already calls it that way).
- Card detail order per Spec C §5.7: image → name → `Set-Code · Rarity · Sprache` → price → **Deine Exemplare** → **Weiteres Printing hinzufügen** → collapsed **Kartentext** and **Stats**; back arrow left, wishlist heart right.

- [ ] **Step 1: Card detail**

Reorder `CardDetailScreen`'s column: keep the existing top row (back arrow + name) and add a heart `IconButton` on the right that calls `WishlistRepository`'s add function for this card (the repository already exists; if no single-card add is available, hide the heart and note it in the report rather than inventing an API). Move the price line directly under the printing line, keep the Spec A "Deine Exemplare" block and `AddPrintingSection` where they are, and wrap the description and the stat tiles in expandable sections:
```kotlin
        var showText by remember { mutableStateOf(false) }
        TextButton(onClick = { showText = !showText }) { Text(if (showText) "Kartentext ausblenden" else "Kartentext anzeigen") }
        if (showText) { /* the existing SpaceCard with base.desc */ }
        var showStats by remember { mutableStateOf(false) }
        TextButton(onClick = { showStats = !showStats }) { Text(if (showStats) "Stats ausblenden" else "Stats anzeigen") }
        if (showStats) { /* the existing StatTile row */ }
```

- [ ] **Step 2: Settings**

Change the signature to `SettingsScreen(prefs: SharedPreferences, onBack: () -> Unit, onLoggedOut: () -> Unit)` and update the call site in `AppNav.kt` accordingly:
```kotlin
            composable(Routes.EINSTELLUNGEN) {
                SettingsScreen(prefs, onBack = { nav.popBackStack() }) { cloudReady = false; nav.popBackStack() }
            }
```
Add the back arrow row at the top (`IconButton(onBack)` + `Text("Einstellungen")`, replacing the current bare headline) and keep the existing sections in this order with these headings: **Konto** (e-mail, Abmelden), **Desktop-Verbindung** (IP field + the explanatory line), **Preise** (price source chips), **Standards** (the Spec A chips), **Über** (name, version line). No new settings.

- [ ] **Step 3: Vocabulary sweep**

Run, from `android/`:
`grep -rn "Wishlist\|Collection\|Settings\|Submit\|Cancel\|Scan History\|Manual Entry\|Connect to Desktop\|Scanning\.\.\." app/src/main/java --include=*.kt`
Every hit that is a **user-visible string** becomes German (`Wunschliste`, `Sammlung`, `Einstellungen`, `Übernehmen`, `Abbrechen`, …). Hits that are identifiers, class names, comments or log tags stay. Check `WishlistScreen.kt`, `SetCompletionScreen.kt`, `DecksScreen.kt`, `DealsScreen.kt` and `SearchScreen.kt` in particular — they were not touched by the earlier tasks.

- [ ] **Step 4: Verify**

`./gradlew :app:compileDebugKotlin`, `./gradlew :app:testDebugUnitTest`, then re-run the grep from Step 3 and paste the (empty or identifier-only) result into the report.

- [ ] **Step 5: Install and hand over for the on-device pass**

`./gradlew :app:installDebug` (a device is connected). Report that the following still needs a human pass, because there is no UI test harness: Login → Start → Scan → Sheet → Übernehmen → Sammlung → Detail → back button all the way to the tab; tab switching keeps each tab's scroll position; back on Start leaves the app.

- [ ] **Step 6: Commit**

```bash
git add -A android/app/src/main/java
git commit -m "feat(android): card detail order, settings sections, German vocabulary sweep

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec coverage check (self-review)

| Spec C section (Android) | Task |
|---|---|
| §4 vocabulary | A6 (sweep) + each task for its own screen |
| §5.1 four tabs + FAB, no "Mehr", profile icon | A1 (tabs), A4 (profile icon on Start) |
| §5.2 Navigation Compose, routes, back stack per tab | A1 |
| §5.3 scan screen: header, status dot, sheet, always phone staging, no history | A3 |
| §5.4 login: e-mail/password, BuildConfig keys, Erweitert | A2 |
| §5.5 Sammlung › Karten: reveal search, filter sheet, chips, grid, FAB | A5 |
| §5.6 settings groups | A6 |
| §5.7 card detail order + heart | A6 |
| §5.8 Start: value card, quick actions, recently scanned, deals, set progress | A4 |

**Deliberate deviations (record them in the ledger):**
1. **No Normal/Speed mode segment** in the scan header. Spec C §5.3 mentions it, but Speed-Scan is Spec D's feature; a segment with one working option is dead UI. Spec D adds the segment together with the mode.
2. **Card, set and deck details stay nested** in their hosting screens instead of becoming their own routes. The spec lists routes for them; making them routable is a bigger refactor of three screens with no user-visible gain — the system back button already works because the hosting screen handles it. Revisit if a deep link is ever needed (Spec E wants `deck/{id}`).
3. **The bottom bar has three labels plus the raised Scan button**, not four: Start · Sammlung · ⦿ · Deals. Einstellungen lives behind the profile icon (spec §5.1), so a fourth label would be empty.
4. **`ScanStagingScreen` becomes `ScanStagingSheet`** rather than staying a full screen; the spec's Prüfen view is explicitly a sheet over the camera.
