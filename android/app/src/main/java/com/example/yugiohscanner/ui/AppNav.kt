package com.example.yugiohscanner.ui

import android.content.Context
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Style
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import com.example.yugiohscanner.ml.ForegroundTick
import com.example.yugiohscanner.ml.ModelStore
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import com.example.yugiohscanner.ui.theme.SurfaceColor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

object Routes {
    const val START = "start"
    // Spec G1 §4.7: Unterseite von Start. Erstes Segment "start", damit die untere Leiste Start markiert.
    // Spec G2 §7: Reiter als optionales Argument, damit "Alle" auf der Alarm-Karte direkt "Alarme" oeffnet.
    const val INSIGHTS = "start/insights?tab={tab}"
    fun insights(tab: String = "bewegungen") = "start/insights?tab=$tab"
    const val SCAN = "scan"
    const val DEALS = "deals"
    // Abnahme I1: Einstellungen und Decks erreicht man ueber Start (Spec I §3.2) -- erstes Segment "start"
    // wie bei INSIGHTS, damit die untere Leiste dort Start markiert und ein Tipp darauf zurueckfuehrt.
    const val EINSTELLUNGEN = "start/einstellungen"
    const val SUCHE = "suche"
    // Spec G3 §8: Suche in der Sealed-Produktliste. Unter "sammlung/", damit die untere Leiste Sammlung
    // markiert; drei Segmente mit "sealed" als zweitem kollidieren weder mit "sammlung/{segment}" noch mit
    // "sammlung/binder/{containerId}".
    const val SEALED_SUCHE = "sammlung/sealed/suche"
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
    // Spec I §5.3: eigener Bereich "Verkaufen" mit vier Stationen, Reihenfolge NavTabellen.VERKAUFEN.
    const val VERKAUFEN = "verkaufen/{segment}"
    fun verkaufen(segment: String = "kandidaten") = "verkaufen/$segment"
    // Spec I §7: Decks ueber eine Start-Kachel statt eines Sammlung-Reiters.
    const val DECKS = "start/decks"
}

// Spec I §3 -- die Tabellen stehen in docs/fixtures/design/nav.json; NavTabellenTest haelt beide Seiten gleich.
object NavTabellen {
    val LEISTE = listOf("start" to "Start", "sammlung" to "Sammlung", "verkaufen" to "Verkaufen", "deals" to "Deals")
    val SAMMLUNG = listOf("karten" to "Karten", "binder" to "Binder", "sets" to "Sets", "wunschliste" to "Wunschliste", "sealed" to "Sealed")
    val VERKAUFEN = listOf("kandidaten" to "Kandidaten", "zum-verkauf" to "Zum Verkauf", "angebote" to "Angebote", "verkaeufe" to "Verkäufe")
    // Spec I §3.2: diese Bereiche erreicht man am Handy ueber Start (Kachel bzw. Knopf), nicht ueber die Leiste.
    val UEBER_START = listOf("decks", "insights", "einstellungen")
}

// Top-level destinations: the bottom bar switches between them and each keeps its own back stack.
// `route` is the navigation target, `match` the first path segment of the registered pattern —
// Sammlung navigates to "sammlung/karten" but is registered as "sammlung/{segment}", so the
// selected state has to compare prefixes, not whole routes.
// `root` ist das registrierte Muster der Wurzel des Bereichs -- ein erneuter Tipp auf das gewaehlte Ziel
// kehrt dorthin zurueck (Abnahme I1: aus den Einstellungen fuehrte "Start" sonst wieder in die Einstellungen).
private data class TopLevel(val route: String, val match: String, val label: String, val icon: ImageVector, val root: String)
// Abschlussreview C5: Reihenfolge und Beschriftung kommen aus NavTabellen.LEISTE (nav.json-Zwilling),
// hier stehen nur Ziel und Symbol je Schluessel -- keine zweite Beschriftungsliste.
private val TOP_LEVEL = NavTabellen.LEISTE.map { (key, label) ->
    when (key) {
        "start" -> TopLevel(Routes.START, key, label, Icons.Default.Home, Routes.START)
        "sammlung" -> TopLevel(Routes.sammlung(), key, label, Icons.Default.Style, Routes.SAMMLUNG)
        "verkaufen" -> TopLevel(Routes.verkaufen(), key, label, Icons.Default.Payments, Routes.VERKAUFEN)
        "deals" -> TopLevel(Routes.DEALS, key, label, Icons.Default.Sell, Routes.DEALS)
        else -> error("Unbekanntes Ziel der unteren Leiste: $key")
    }
}

@Composable
fun AppNav(onThemeChange: (String) -> Unit) {
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
    // Performance (Vorladen): erst true, wenn nach dem Laden der Sammlung die Anzeigen einmal
    // vorgerechnet sind -- bis dahin bleibt der Ladebildschirm stehen, danach oeffnet jeder Reiter sofort.
    var warm by remember { mutableStateOf(false) }

    // Jeder Einstieg in ein (anderes) Konto und jedes Abmelden: ALLE Speicher leeren, sonst zeigte
    // z. B. die Wunschliste noch das alte Konto.
    fun resetSession() {
        CollectionStore.clear()
        SideStores.clearAll()
        SnapshotWrites.clear()
        DealsScrape.clear()
        warm = false
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
    // Spec G2 §7: beim selben Eintritt die Preis-Alarme nachladen (nicht bei Seitenwechseln).
    // Ziele mit den Treffern zusammen, weil die Cloud dort "armed" aendert (sonst zeigt das Handy
    // "ausgeloest" erst nach einem Kaltstart).
    LaunchedEffect(cloudReady) {
        if (!cloudReady) return@LaunchedEffect
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            ForegroundTick.run(
                onEnter = {
                    SideStores.priceAlertEvents.refresh()
                    SideStores.priceAlertTargets.refresh()
                    SideStores.sealedItems.refresh()   // Spec G3 §8
                },
                tick = { CollectionStore.requestSync() },
            )
        }
    }
    // Spec §3.3: nach der Anmeldung erst laden. Der Speicher startet das Laden in seinem eigenen
    // Bereich -- ein Wechsel dieses Effekts bricht es nicht ab.
    LaunchedEffect(cloudReady, storeState is StoreState.Empty) {
        if (cloudReady && CollectionStore.state.value is StoreState.Empty) CollectionStore.startInitialLoad()
    }
    // Performance (Vorladen): die kleinen Listen aller Reiter laden parallel zur Sammlung, statt erst
    // beim ersten Oeffnen des jeweiligen Reiters.
    LaunchedEffect(cloudReady) {
        if (cloudReady) Preload.startSideStores()
    }
    // Sobald die Sammlung da ist: Anzeigen vorrechnen (abseits des Hauptthreads), kurz auf die
    // Nebenlisten warten, dann den Ladebildschirm freigeben.
    LaunchedEffect(cloudReady, storeState is StoreState.Ready) {
        if (cloudReady && storeState is StoreState.Ready && !warm) {
            Preload.warmUp(context)
            warm = true
        }
    }
    // Ladebildschirm auch, solange die automatische Anmeldung laeuft oder gescheitert ist.
    val autoLoginPending = !cloudReady && (autoLoginRunning || autoLoginError != null)
    if (autoLoginPending || (cloudReady && (storeState !is StoreState.Ready || !warm))) {
        StartupLoadingScreen(
            state = if (cloudReady) (if (storeState is StoreState.Ready) StoreState.Loading else storeState)
                else autoLoginError?.let { StoreState.Failed(it) } ?: StoreState.Loading,
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
    // Spec E2 §6: geteilter Text fuehrt zu den Decks -- erst hier, nach Login und Laden (der Text wartet im Postfach);
    // DecksScreen nimmt ihn heraus und oeffnet die Import-Vorschau.
    val sharedDeckText by DeckImportInbox.text.collectAsState()
    // Spec I §7: Decks zog auf eine eigene Route (Routes.DECKS) um, keine Sammlung-Unterseite mehr.
    LaunchedEffect(sharedDeckText != null, cloudReady) {
        if (sharedDeckText != null && cloudReady) {
            nav.navigate(Routes.DECKS) {
                popUpTo(nav.graph.findStartDestination().id) { saveState = false }
                launchSingleTop = true
            }
        }
    }

    Scaffold(bottomBar = { if (showBar) AppBottomBar(nav) }) { padding ->
        NavHost(
            navController = nav,
            startDestination = Routes.START,
            modifier = Modifier.padding(if (showBar) padding else PaddingValues(0.dp)),
            // Performance: ohne die Standard-Ueberblendung (700 ms), in der beide Seiten zugleich
            // gezeichnet werden -- ein Reiterwechsel ist sofort da.
            enterTransition = { EnterTransition.None },
            exitTransition = { ExitTransition.None },
            popEnterTransition = { EnterTransition.None },
            popExitTransition = { ExitTransition.None },
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
                    onOpenInsights = { nav.navigate(Routes.insights()) { launchSingleTop = true } },
                    onOpenAlerts = { nav.navigate(Routes.insights("alarme")) { launchSingleTop = true } },
                    // Spec I §5.3/§7: springen jetzt direkt in den passenden Verkaufen-Reiter bzw. zu Decks.
                    // Abschlussreview C2: ohne restoreState -- sonst oeffnet der gespeicherte Verkaufen-Stapel
                    // mit dem zuletzt gewaehlten Reiter statt des angetippten.
                    onOpenForSale = { nav.navigateTopFresh(Routes.verkaufen("zum-verkauf")) },
                    onOpenDuplicates = { nav.navigateTopFresh(Routes.verkaufen("kandidaten")) },
                    onOpenListings = { nav.navigateTopFresh(Routes.verkaufen("angebote")) },
                    onOpenDecks = { nav.navigate(Routes.DECKS) { launchSingleTop = true } },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(
                Routes.INSIGHTS,
                arguments = listOf(navArgument("tab") { type = NavType.StringType; defaultValue = "bewegungen" }),
            ) { backStackEntry ->
                val tab = backStackEntry.arguments?.getString("tab") ?: "bewegungen"
                // Spec I Fixrunde 1: Verkäufe leben nur noch unter Verkaufen -- ein alter Verweis auf
                // den frueheren Insights-Reiter leitet um, statt einen leeren Reiter zu zeigen.
                if (tab == "verkaeufe") {
                    LaunchedEffect(Unit) {
                        nav.navigate(Routes.verkaufen("verkaeufe")) { popUpTo(Routes.INSIGHTS) { inclusive = true } }
                    }
                } else if (cloudReady) InsightsScreen(
                    initialTab = tab,
                    onBack = { nav.popBackStack() },
                )
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
                    onOpenScan = { nav.navigate(Routes.SCAN) { launchSingleTop = true } },
                    onOpenSealedSuche = { nav.navigate(Routes.SEALED_SUCHE) },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(
                Routes.VERKAUFEN,
                arguments = listOf(navArgument("segment") { type = NavType.StringType; defaultValue = "kandidaten" }),
            ) { backStackEntry ->
                if (cloudReady) VerkaufenScreen(
                    segment = backStackEntry.arguments?.getString("segment") ?: "kandidaten",
                    onSegment = { nav.navigate(Routes.verkaufen(it)) { popUpTo(Routes.VERKAUFEN) { inclusive = true } } },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(Routes.DECKS) {
                // Spec I Fixrunde 1: dieselbe Wisch-Aktualisierung, die vorher SammlungScreen fuer den
                // Decks-Reiter lieferte (RefreshableBox von aussen, wie zuvor -- unveraendert gegenueber
                // Task 9, nur der Aufrufort zog von SammlungScreen hierher um).
                if (cloudReady) RefreshableBox(onRefresh = {
                    SideStores.decks.refreshAndWait()
                    SideStores.allDeckCards.refreshAndWait()
                    CollectionStore.awaitSync()
                }) { DecksScreen() }
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
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
                SettingsScreen(prefs, onBack = { nav.popBackStack() }, onTheme = onThemeChange) {
                    SupabaseCloud.signOut(); resetSession(); cloudReady = false; nav.popBackStack()
                }
            }
            composable(Routes.SUCHE) {
                if (cloudReady) SearchScreen(onClose = { nav.popBackStack() }, onAdded = { CollectionStore.requestSync() })
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
            composable(Routes.SEALED_SUCHE) {
                if (cloudReady) SealedSearchScreen(onClose = { nav.popBackStack() })
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

// Abschlussreview C2: ein Bereich gezielt in einem bestimmten Reiter oeffnen (Start-Kacheln) -- der
// gespeicherte Zustand des Bereichs wird dabei bewusst nicht wiederhergestellt.
private fun NavHostController.navigateTopFresh(route: String) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = false }
    launchSingleTop = true
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
                Spacer(Modifier.weight(0.6f))                              // Luecke unter dem Scan-Knopf
                NavItem(Modifier.weight(1f), TOP_LEVEL[2], current, nav)   // Verkaufen
                NavItem(Modifier.weight(1f), TOP_LEVEL[3], current, nav)   // Deals
            }
        }
        Box(
            Modifier.align(Alignment.TopCenter).size(60.dp).clip(CircleShape)
                .background(Primary).clickable { nav.navigate(Routes.SCAN) { launchSingleTop = true } },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.CameraAlt, "Scannen", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(28.dp)) }
    }
}

@Composable
private fun NavItem(modifier: Modifier, item: TopLevel, current: androidx.navigation.NavDestination?, nav: NavHostController) {
    val selected = current?.hierarchy?.any { it.route?.substringBefore('/') == item.match } == true
    val tint = if (selected) Primary else Muted
    Column(
        modifier.fillMaxHeight().clickable {
            // Gewaehlt: zurueck an die Wurzel des Bereichs (Unterseiten schliessen, Reiter bleibt).
            if (selected) nav.popBackStack(item.root, inclusive = false) else nav.navigateTop(item.route)
        },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(item.icon, item.label, tint = tint, modifier = Modifier.size(24.dp))
        // Spec I §5.1: vier Ziele auf 360 dp -- maxLines = 1 statt Umbruch/Abschneiden ("Verkaufen" ist das laengste Wort).
        Text(item.label, color = tint, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}
