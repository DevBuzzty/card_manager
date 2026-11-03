package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CmPriceFile
import com.example.yugiohscanner.cloud.CmResolveRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ml.ScanSprache
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Warn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate

/**
 * Spec 2026-10-04 §4 -- Ergebnis-Seite nach dem Einzelfoto (abgenommener Entwurf
 * "ergebnis-seite-detail"): Bild, Namen, Chips (Seltenheit, Auflage, Set-Code), grosser Preis,
 * "Du hast schon", alle Drucke mit dem eigenen markiert; unten "Naechste Karte" / "In Sammlung +".
 * Spec 2026-11-03 §2/§3/§7: abgeleiteter Druck in der Liste, Kopfpreis mit Richtwert "ab …", Unterzeile mit Quelle,
 * Preisdatei-Retry beim Oeffnen. Der Richtwert geht nie in "In Sammlung +" (SetOption.price bleibt 0.0).
 * Spec 2026-11-03 §4.3/§4.4: kommen nach dem Oeffnen Netzdrucke nach ([ResolvedScan.verbessert]), rechnet die Seite mit
 * `aktuell` neu; eine getippte Auswahl und eine gewaehlte Auflage bleiben.
 * Spec 2026-11-03 §6/§7: Live-Suche (resolve-cm-product) fuer markierten Druck und Kandidaten, nur online und angemeldet;
 * "Preis wird gesucht …" bzw. "…" in der Zeile, danach rechnen Preise und Richtwert (`card.ab` vor Katalogwert) neu.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ScanErgebnisScreen(r: ResolvedScan, onWeiter: () -> Unit, onUebernehmen: (ResolvedScan) -> Unit) {
    BackHandler { onWeiter() }
    val pc = r.base.id
    val context = LocalContext.current
    val store by CollectionStore.state.collectAsState()
    val besitz = remember((store as? StoreState.Ready)?.cards, pc) {
        (store as? StoreState.Ready)?.cards?.filter { it.id == pc && !it.deleted && it.quantity > 0 } ?: emptyList()
    }
    var katalog by remember(pc) { mutableStateOf<CatalogCard?>(null) }
    var katalogGeladen by remember(pc) { mutableStateOf(false) }      // Spec 2026-11-03 §6.1: auch bei null oder Fehler
    var katalogStand by remember { mutableStateOf<String?>(null) }   // Baudatum des Katalogs (Stand des Richtwerts)
    LaunchedEffect(pc) {
        katalog = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(pc) }.getOrNull() }
        katalogGeladen = true
        katalogStand = withContext(Dispatchers.IO) { runCatching { CatalogRepository.builtAt() }.getOrNull() }
    }
    val preise by CmPriceFile.stand.collectAsState()
    val letzterFehler by CmPriceFile.letzterFehler.collectAsState()
    // Spec 2026-11-03 §3.5: Retry beim Oeffnen; tryLock und faellig verhindern doppelte oder unnoetige Downloads.
    LaunchedEffect(pc) { CmPriceFile.aktualisieren(context) }
    // Spec 2026-11-03 §4.3: Zustand nur beim Oeffnen mit neuem `r` zurueckgesetzt, nie durch `uebernimm`.
    var aktuell by remember(r) { mutableStateOf(r) }
    var zustand by remember(r) { mutableStateOf(ScanErgebnis.start(r, ScanSprache.fest)) }
    var nachladen by remember(r) { mutableStateOf(r.verbessert != null) }
    val auswahl = zustand.auswahl
    val gewaehlt = zustand.gewaehlt
    val auflage = zustand.auflage
    val auflageGewaehlt = zustand.auflageGewaehlt
    // Nachladen: keine eigene Frist; schliesst der Nutzer die Seite, endet nur das Warten (der Abruf fuellt den Cache).
    LaunchedEffect(r) {
        val d = r.verbessert ?: return@LaunchedEffect
        val neu = try { d.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
        nachladen = false
        if (neu != null) {
            aktuell = neu
            zustand = ScanErgebnis.nachUebernahme(zustand, neu, ScanSprache.fest)
        }
    }

    // Spec 2026-11-03 §6.3: Sitzungsspeicher der Live-Suche; `version` zaehlt Start und Ende jeder Anfrage.
    val liveVersion by CmResolveRepository.version.collectAsState()
    val liveStand = remember(pc, liveVersion) { CmResolveRepository.stand(pc) }
    val laeuft = remember(pc, liveVersion) { CmResolveRepository.laeuft(pc) }
    val liveFehlKeys = remember(pc, liveVersion) { CmResolveRepository.fehlgeschlagen(pc) }
    val trend: (Int) -> Double? = { id -> preise?.trend?.get(id) ?: liveStand.trend(id) }   // lokale Datei vor Live (§2.1)

    val drucke = remember(aktuell, katalog, besitz, preise, zustand.gewaehlterDruck, liveStand) {
        ScanErgebnis.drucke(aktuell.knownSets, katalog?.printings ?: emptyList(), besitz, trend,
            ScanErgebnis.zusatz(zustand.gewaehlterDruck, aktuell.match), liveStand.ergebnisse)
    }
    var auflageOffen by remember { mutableStateOf(false) }
    var grossesBild by remember { mutableStateOf(false) }

    val sicher = gewaehlt || aktuell.confidence.light == ScanConfidence.Light.GREEN
    val auflageUnsicher = !auflageGewaehlt && (aktuell.confidence.editionConfidence == EditionEvidence.Confidence.LOW || auflage == "unknown")
    val markiert = drucke.firstOrNull { ScanErgebnis.key(it.setCode, it.rarity, it.language) == auswahl }
    // Spec 2026-11-03 §7: kartenweiter Cardmarket-Wert nur als "ab …" im Kopf; tagesaktuelles `card.ab` vor dem Katalogwert.
    val richtwert = liveStand.ab?.takeIf { it > 0 }?.let { DruckPreis.Richtwert(it, ausKatalog = false) }
        ?: katalog?.cmPrice?.takeIf { it > 0 }?.let { DruckPreis.Richtwert(it, ausKatalog = true) }
    val kandidaten = ScanErgebnis.kandidaten(aktuell.match, auswahl)
    val kopf = ScanErgebnis.kopfPreis(drucke, auswahl, sicher, aktuell.match.selected == null, kandidaten, richtwert,
        ScanSprache.fest)

    // Spec 2026-11-03 §6.1: Live-Suche, sobald der Katalog-Lauf fertig ist. Laufende Schluessel zaehlen als bekannt, damit ein
    // neuer Bedarf (z. B. Tipp auf eine Zeile) nur die fehlenden fragt; die Anfrage selbst laeuft im Scope des Repositorys.
    val bedarf = ScanErgebnis.liveBedarf(drucke, auswahl, kandidaten, katalog != null,
        { k -> k in laeuft || CmResolveRepository.bekannt(pc, k) }, trend)
    val bedarfSchluessel = bedarf.joinToString(",") { ScanErgebnis.liveKey(it.setCode, it.rarity) }
    LaunchedEffect(pc, katalogGeladen, bedarfSchluessel) {
        if (!katalogGeladen || bedarf.isEmpty() || CmResolveRepository.gesperrt(pc)) return@LaunchedEffect
        if (!SupabaseCloud.angemeldet() || !CmResolveRepository.online(context)) return@LaunchedEffect
        val d = CmResolveRepository.anfragen(pc, katalog?.nameEn, bedarf.map { it.setCode to it.rarity })
        try { d.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
        // liveStand folgt ueber `version` (auch wenn dieses Warten vorher abgebrochen wurde)
    }
    val sucht = ScanErgebnis.sucht(drucke, auswahl, kandidaten, laeuft)
    val liveFehler = ScanErgebnis.liveFehler(drucke, auswahl, kandidaten, liveFehlKeys) { k -> CmResolveRepository.bekannt(pc, k) }
    val hinweis = ScanErgebnis.hinweis(markiert, sicher, gewaehlt)
    val bild = katalog?.image?.takeIf { it.isNotBlank() } ?: aktuell.base.imageUrl
    val nameDe = katalog?.nameDe?.takeIf { it.isNotBlank() } ?: aktuell.base.name ?: pc
    val nameEn = katalog?.nameEn?.takeIf { it.isNotBlank() && it != nameDe }

    Scaffold(
        bottomBar = {
            Surface(tonalElevation = 2.dp) {
                Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onWeiter, modifier = Modifier.weight(1f)) { Text("Nächste Karte") }
                    Button(onClick = {
                        onUebernehmen(ScanErgebnis.uebernahme(aktuell, markiert, auswahl, gewaehlt, auflage, auflageGewaehlt))
                    }, modifier = Modifier.weight(1f)) { Text("In Sammlung +") }
                }
            }
        },
    ) { innen ->
        Column(Modifier.padding(innen).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp)) {
            // 1. Leiste
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("‹ Kamera", color = Muted, modifier = Modifier.clickable(onClick = onWeiter).padding(vertical = 4.dp))
                Spacer(Modifier.weight(1f))
                val farbe = when (aktuell.confidence.light) {
                    ScanConfidence.Light.GREEN -> Good
                    ScanConfidence.Light.YELLOW -> Warn
                    ScanConfidence.Light.RED -> MaterialTheme.colorScheme.error
                }
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (gewaehlt) Good else farbe))
                Spacer(Modifier.width(6.dp))
                Text(if (gewaehlt) "von dir gewählt" else aktuell.confidence.reason ?: "sicher erkannt",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            Spacer(Modifier.height(12.dp))

            // 2.+3. Bild, Namen, Chips
            Row {
                AsyncImage(model = bild, contentDescription = nameDe,
                    modifier = Modifier.width(110.dp).height(160.dp).clip(RoundedCornerShape(6.dp)).clickable { grossesBild = true })
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(nameDe, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    nameEn?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Muted) }
                    Spacer(Modifier.height(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip(markiert?.rarity?.let { if (sicher) it else "$it?" } ?: "Seltenheit?", akzent = sicher && markiert != null, warn = !sicher || markiert == null)
                        Box {
                            Chip((Valuation.EDITION_LABELS[auflage] ?: auflage) + if (auflageUnsicher) "? ▾" else " ▾",
                                warn = auflageUnsicher, onClick = { auflageOffen = true })
                            DropdownMenu(expanded = auflageOffen, onDismissRequest = { auflageOffen = false }) {
                                Valuation.EDITIONS.forEach { e ->
                                    DropdownMenuItem(text = { Text(Valuation.EDITION_LABELS[e] ?: e) },
                                        onClick = { zustand = zustand.copy(auflage = e, auflageGewaehlt = true); auflageOffen = false })
                                }
                            }
                        }
                        markiert?.let { Chip("${langFlag(it.language)} ${it.setCode}") }
                    }
                }
            }

            // 6. Hinweis bei Unsicherheit oder abgeleitetem Druck (Spec 2026-11-03 §2.3, auch bei GRUEN)
            hinweis?.let { text ->
                Spacer(Modifier.height(10.dp))
                Surface(color = Warn.copy(alpha = 0.15f), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }

            // 4. Preisfeld
            Spacer(Modifier.height(12.dp))
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    val istRichtwert = kopf is DruckPreis.Richtwert
                    Text(DruckPreis.text(kopf), style = MaterialTheme.typography.titleLarge,
                        fontWeight = if (istRichtwert) FontWeight.Normal else FontWeight.Bold,
                        color = if (istRichtwert) Muted else androidx.compose.ui.graphics.Color.Unspecified)
                    val (low, standDatum) = ScanErgebnis.lowUndStand(kopf, markiert, sicher, preise,
                        katalogStand, liveStand::low, liveStand.priceDate)
                    val zeile = ScanErgebnis.unterzeile(kopf, sicher, ScanErgebnis.abgeleitet(markiert, sicher, gewaehlt), low, standDatum,
                        LocalDate.now(), sucht = sucht, nachladen = nachladen, preiseFehlen = preise == null, letzterFehler = letzterFehler,
                        liveFehler = liveFehler)
                    Text(zeile, style = MaterialTheme.typography.bodySmall, color = Muted)
                }
            }

            // 5. Besitz
            val gesamt = besitz.sumOf { it.quantity }
            if (gesamt > 0) {
                Spacer(Modifier.height(8.dp))
                Surface(color = Good.copy(alpha = 0.12f), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Text("Du hast schon ${gesamt}×" + (markiert?.takeIf { it.anzahl > 0 }?.let { " (davon ${it.anzahl}× dieser Druck)" } ?: ""),
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }

            // 7. Alle Drucke
            Spacer(Modifier.height(16.dp))
            SectionHeader("Alle Drucke")
            Spacer(Modifier.height(6.dp))
            drucke.forEach { d ->
                val k = ScanErgebnis.key(d.setCode, d.rarity, d.language)
                val istMeins = k == auswahl
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                        .then(if (istMeins) Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.10f))
                            .border(1.5.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp)) else Modifier)
                        .clickable { zustand = ScanErgebnis.beimTippen(zustand, d) }
                        .padding(horizontal = 10.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${langFlag(d.language)} ${d.setCode}", fontWeight = if (istMeins) FontWeight.SemiBold else FontWeight.Normal)
                    Text(" · ${d.rarity}", color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (d.abgeleitet) Text(" · abgeleitet", color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (d.anzahl > 0) Text("  du hast ${d.anzahl}", color = Good, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.weight(1f))
                    Text(ScanErgebnis.zeilenText(d, laeuft), fontWeight = if (istMeins) FontWeight.SemiBold else FontWeight.Normal)
                }
            }

            // 8. Preisverlauf (nur eigener Druck) und Kartentext
            markiert?.eigeneZeile?.let { eigen ->
                Spacer(Modifier.height(16.dp)); SectionHeader("Preisverlauf"); Spacer(Modifier.height(6.dp))
                PriceHistoryChart(eigen)
            }
            katalog?.descDe?.takeIf { it.isNotBlank() }?.let { text ->
                Spacer(Modifier.height(16.dp)); SectionHeader("Karte"); Spacer(Modifier.height(6.dp))
                katalog?.type?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Muted) }
                Text(text, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (grossesBild) {
        Dialog(onDismissRequest = { grossesBild = false }) {
            AsyncImage(model = bild, contentDescription = nameDe,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { grossesBild = false })
        }
    }
}

@Composable
private fun Chip(text: String, akzent: Boolean = false, warn: Boolean = false, onClick: (() -> Unit)? = null) {
    val bg = when {
        akzent -> MaterialTheme.colorScheme.primary
        warn -> Warn.copy(alpha = 0.18f)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val fg = if (akzent) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Surface(color = bg, shape = RoundedCornerShape(999.dp),
        border = if (akzent) null else androidx.compose.foundation.BorderStroke(1.dp, if (warn) Warn else MaterialTheme.colorScheme.outline),
        modifier = if (onClick != null) Modifier.clip(RoundedCornerShape(999.dp)).clickable(onClick = onClick) else Modifier) {
        Text(text, color = fg, style = MaterialTheme.typography.labelSmall, fontWeight = if (akzent) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp))
    }
}
