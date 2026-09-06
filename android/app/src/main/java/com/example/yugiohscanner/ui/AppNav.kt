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
import com.example.yugiohscanner.cloud.CatalogSync
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.ml.ModelStore
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

    LaunchedEffect(Unit) {
        if (SupabaseCloud.isConfigured(prefs)) {
            try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); cloudReady = true } catch (_: Exception) {}
        }
    }
    // Top-level so it runs once per app start, not once per tab switch. Works before login: the
    // catalog table/bucket are public and this never touches SupabaseCloud's session state.
    LaunchedEffect(Unit) {
        CatalogSync.checkAndUpdate(context)
        ModelStore.checkAndUpdate(context)
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
            composable(Routes.START) {
                if (cloudReady) StartScreen(
                    onOpenSammlung = { nav.navigateTop(Routes.sammlung()) },
                    onOpenScan = { nav.navigate(Routes.SCAN) { launchSingleTop = true } },
                    onOpenDeals = { nav.navigateTop(Routes.DEALS) },
                    onOpenEinstellungen = { nav.navigate(Routes.EINSTELLUNGEN) },
                ) else CloudLoginScreen(prefs) { cloudReady = true }
            }
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
            composable(Routes.SCAN) {
                if (cloudReady) ScanScreen(onClose = { nav.popBackStack() })
                else CloudLoginScreen(prefs) { cloudReady = true }
            }
            composable(Routes.DEALS) {
                if (cloudReady) DealsScreen() else CloudLoginScreen(prefs) { cloudReady = true }
            }
            composable(Routes.EINSTELLUNGEN) {
                SettingsScreen(prefs, onBack = { nav.popBackStack() }) {
                    SupabaseCloud.signOut(); cloudReady = false; nav.popBackStack()
                }
            }
            composable(Routes.SUCHE) {
                if (cloudReady) SearchScreen(onClose = { nav.popBackStack() }, onAdded = {})
                else CloudLoginScreen(prefs) { cloudReady = true }
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
