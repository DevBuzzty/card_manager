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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.ml.ModelStore
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.SurfaceColor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

object Routes {
    const val START = "start"
    // Spec G1 §4.7: Unterseite von Start. Erstes Segment "start", damit die untere Leiste Start markiert.
    const val INSIGHTS = "start/insights"
    const val SCAN = "scan"
    const val DEALS = "deals"
    const val EINSTELLUNGEN = "einstellungen"
    const val SUCHE = "suche"
    const val SAMMLUNG = "sammlung/{segment}"
    fun sammlung(segment: String = "karten") = "sammlung/$segment"
    // Spec B2 §7.2: EIN aufgeschlagener Behaelter. Bewusst unter "sammlung/", damit die untere
    // Leiste die Sammlung weiter als gewaehlt zeigt (NavItem vergleicht das erste Segment) -- die
    // Seite gehoert dorthin, sie wird aus dem Binder-Reiter heraus geoeffnet. Drei Segmente, der
    // Reiter-Route "sammlung/{segment}" mit zweien kommt sie deshalb nicht in die Quere.
    const val BEHAELTER = "sammlung/binder/{containerId}"
    fun behaelter(containerId: String) = "sammlung/binder/$containerId"
    // Spec B2 §6: der Einsortier-Modus, eine Ebene unter dem aufgeschlagenen Ordner. Eigene Route
    // statt eines Zustands IN der Binder-Ansicht, damit die Kamera mit dem Zurueckgehen sicher
    // abgebaut wird und der Ordner darunter nicht die ganze Zeit mitlebt.
    const val EINSORTIEREN = "sammlung/binder/{containerId}/einsortieren"
    fun einsortieren(containerId: String) = "sammlung/binder/$containerId/einsortieren"
    // Der Rueckkanal des Einsortier-Modus: die zuletzt bearbeitete Seite, die die Binder-Ansicht
    // beim Zurueckkommen aufschlaegt (§6.6). Ueber den SavedStateHandle des VORHERIGEN Eintrags --
    // ein Rueckgabewert ueber den Navigationsstapel, wie ihn navigation-compose vorsieht.
    const val SEITE_NACH_EINSORTIEREN = "einsortiert_seite"
}

// Top-level destinations: the bottom bar switches between them and each keeps its own back stack.
// `route` is the navigation target, `match` the first path segment of the registered pattern —
// Sammlung navigates to "sammlung/karten" but is registered as "sammlung/{segment}", so the
// selected state has to compare prefixes, not whole routes.
private data class TopLevel(val route: String, val match: String, val label: String, val icon: ImageVector)
private val TOP_LEVEL = listOf(
    TopLevel(Routes.START, "start", "Start", Icons.Default.Home),
    TopLevel(Routes.sammlung(), "sammlung", "Sammlung", Icons.Default.Style),
    TopLevel(Routes.DEALS, "deals", "Deals", Icons.Default.Sell),
)

@Composable
fun AppNav() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("scanner_prefs", Context.MODE_PRIVATE) }
    val nav = rememberNavController()
    var cloudReady by remember { mutableStateOf(false) }
    // Spec §3.3/§9.7: mit gespeicherten Zugangsdaten steht beim Start der Ladebildschirm, nie der
    // Login -- auch wenn die automatische Anmeldung scheitert (Flugmodus); dann "Erneut versuchen".
    var autoLoginRunning by remember { mutableStateOf(SupabaseCloud.isConfigured(prefs)) }
    var autoLoginError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val storeState by CollectionStore.state.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    // Jeder Einstieg in ein (anderes) Konto und jedes Abmelden: ALLE Speicher leeren, sonst zeigte
    // z. B. die Wunschliste noch das alte Konto.
    fun resetSession() {
        CollectionStore.clear()
        SideStores.clearAll()
    }

    suspend fun autoLogin() {
        autoLoginRunning = true
        autoLoginError = null
        try {
            SupabaseCloud.init(prefs); SupabaseCloud.signIn(); cloudReady = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            autoLoginError = e.message ?: "Anmeldung fehlgeschlagen"
        } finally {
            autoLoginRunning = false
        }
    }

    LaunchedEffect(Unit) {
        if (SupabaseCloud.isConfigured(prefs)) autoLogin()
    }
    // Top-level so it runs once per app start, not once per tab switch. Works before login: the
    // catalog table/bucket are public and this never touches SupabaseCloud's session state.
    LaunchedEffect(Unit) {
        CatalogSync.checkAndUpdate(context)
        ModelStore.checkAndUpdate(context)
    }

    // Spec §3.4: solange die App sichtbar ist, alle 10 s ein Abgleich; im Hintergrund keiner.
    // repeatOnLifecycle startet den Block beim Zurueckkommen neu -- das ist der sofortige Abgleich.
    LaunchedEffect(cloudReady) {
        if (!cloudReady) return@LaunchedEffect
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                CollectionStore.requestSync()
                delay(10_000)
            }
        }
    }
    // Spec §3.3: nach der Anmeldung erst laden. Der Speicher startet das Laden in seinem eigenen
    // Bereich -- ein Wechsel dieses Effekts bricht es nicht ab.
    LaunchedEffect(cloudReady, storeState is StoreState.Empty) {
        if (cloudReady && CollectionStore.state.value is StoreState.Empty) CollectionStore.startInitialLoad()
    }
    // Ladebildschirm auch, solange die automatische Anmeldung laeuft oder gescheitert ist.
    val autoLoginPending = !cloudReady && (autoLoginRunning || autoLoginError != null)
    if (autoLoginPending || (cloudReady && storeState !is StoreState.Ready)) {
        StartupLoadingScreen(
            state = if (cloudReady) storeState else autoLoginError?.let { StoreState.Failed(it) } ?: StoreState.Loading,
            onRetry = {
                if (cloudReady) {
                    CollectionStore.startInitialLoad()
                } else {
                    // Sofort Loading zeigen, damit ein zweiter Tipp keinen zweiten Versuch startet.
                    autoLoginRunning = true
                    autoLoginError = null
                    scope.launch { autoLogin() }
                }
            },
            onLogout = {
                prefs.edit().putString("supabase_password", "").apply()
                SupabaseCloud.signOut()
                resetSession()
                autoLoginError = null
                cloudReady = false
            },
        )
        return
    }

    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    // Spec §3.4: jeder Wechsel der Destination fordert einen Abgleich an; die Seite zeigt sofort den
    // Speicherstand.
    LaunchedEffect(route) { CollectionStore.requestSync() }
    // The camera owns the whole screen; every other destination keeps the bar. Der Einsortier-Modus
    // (Spec B2 §6) ist ebenfalls eine Kamera und bekommt denselben ganzen Schirm.
    val showBar = route != Routes.SCAN && route != Routes.EINSORTIEREN

    Scaffold(bottomBar = { if (showBar) AppBottomBar(nav) }) { padding ->
        NavHost(
            navController = nav,
            startDestination = Routes.START,
            modifier = Modifier.padding(if (showBar) padding else PaddingValues(0.dp)),
        ) {
            composable(Routes.START) {
                if (cloudReady) StartScreen(
                    onOpenSammlung = { nav.navigateTop(Routes.sammlung()) },
                    onOpenScan = { nav.navigate(Routes.SCAN) { launchSingleTop = true } },
                    onOpenDeals = { nav.navigateTop(Routes.DEALS) },
                    onOpenEinstellungen = { nav.navigate(Routes.EINSTELLUNGEN) },
                    // Spec B1 Task 10: der Zähler "Nicht einsortiert" springt gezielt in den
                    // Binder-Reiter der Sammlung, nicht in den Standard-Reiter "Karten".
                    onOpenBinder = { nav.navigateTop(Routes.sammlung("binder")) },
                    onOpenInsights = { nav.navigate(Routes.INSIGHTS) { launchSingleTop = true } },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(Routes.INSIGHTS) {
                if (cloudReady) InsightsScreen(onBack = { nav.popBackStack() })
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(
                Routes.SAMMLUNG,
                arguments = listOf(navArgument("segment") { type = NavType.StringType; defaultValue = "karten" }),
            ) { backStackEntry ->
                if (cloudReady) SammlungScreen(
                    segment = backStackEntry.arguments?.getString("segment") ?: "karten",
                    onSegment = { nav.navigate(Routes.sammlung(it)) { popUpTo(Routes.SAMMLUNG) { inclusive = true } } },
                    onOpenSuche = { nav.navigate(Routes.SUCHE) },
                    onOpenBehaelter = { nav.navigate(Routes.behaelter(it)) },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(
                Routes.BEHAELTER,
                arguments = listOf(navArgument("containerId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val id = backStackEntry.arguments?.getString("containerId").orEmpty()
                // Die Seite, auf der der Einsortier-Modus aufgehoert hat -- null, solange keiner
                // gelaufen ist. Als Fluss gelesen, damit die Ansicht auch dann davon erfaehrt,
                // wenn sie beim Zurueckkommen gar nicht neu zusammengesetzt wird.
                val seite by backStackEntry.savedStateHandle
                    .getStateFlow<Int?>(Routes.SEITE_NACH_EINSORTIEREN, null).collectAsState()
                if (cloudReady) BinderPageScreen(
                    containerId = id,
                    onBack = { nav.popBackStack() },
                    onEinsortieren = { nav.navigate(Routes.einsortieren(id)) },
                    seiteNachEinsortieren = seite,
                    onSeiteAufgeschlagen = {
                        backStackEntry.savedStateHandle[Routes.SEITE_NACH_EINSORTIEREN] = null
                    },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(
                Routes.EINSORTIEREN,
                arguments = listOf(navArgument("containerId") { type = NavType.StringType }),
            ) { backStackEntry ->
                if (cloudReady) SortIntoBinderScreen(
                    containerId = backStackEntry.arguments?.getString("containerId").orEmpty(),
                    onDone = { page ->
                        // Erst den Rueckkanal setzen, dann zurueckgehen: der Eintrag, an dem der
                        // Wert haengt, ist der der Binder-Ansicht und lebt weiter. Bei `null` --
                        // Abbruch oder Ladefehler, es wurde nichts einsortiert -- bleibt der Kanal
                        // unberuehrt, damit die Binder-Ansicht stehenbleibt, wo sie war.
                        if (page != null) {
                            nav.previousBackStackEntry
                                ?.savedStateHandle?.set(Routes.SEITE_NACH_EINSORTIEREN, page)
                        }
                        // Der Modus hat Standorte geschrieben; Scan-Uebernahmen darin ebenfalls (Spec §7.4).
                        CollectionStore.requestSync()
                        nav.popBackStack()
                    },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(Routes.SCAN) {
                if (cloudReady) ScanScreen(onClose = { nav.popBackStack() })
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(Routes.DEALS) {
                if (cloudReady) DealsScreen() else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(Routes.EINSTELLUNGEN) {
                SettingsScreen(prefs, onBack = { nav.popBackStack() }) {
                    SupabaseCloud.signOut(); resetSession(); cloudReady = false; nav.popBackStack()
                }
            }
            composable(Routes.SUCHE) {
                if (cloudReady) SearchScreen(onClose = { nav.popBackStack() }, onAdded = { CollectionStore.requestSync() })
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
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
                .background(Primary).clickable { nav.navigate(Routes.SCAN) { launchSingleTop = true } },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.CameraAlt, "Scannen", tint = Color.White, modifier = Modifier.size(28.dp)) }
    }
}

@Composable
private fun NavItem(modifier: Modifier, item: TopLevel, current: androidx.navigation.NavDestination?, nav: NavHostController) {
    val selected = current?.hierarchy?.any { it.route?.substringBefore('/') == item.match } == true
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
