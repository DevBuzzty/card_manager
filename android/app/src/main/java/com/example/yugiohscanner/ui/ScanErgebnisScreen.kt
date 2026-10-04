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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CmPriceFile
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.EditionEvidence
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ml.ScanSprache
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Warn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate

/**
 * Spec 2026-10-04 §4 -- Ergebnis-Seite nach dem Einzelfoto (abgenommener Entwurf
 * "ergebnis-seite-detail"): Bild, Namen, Chips (Seltenheit, Auflage, Set-Code), grosser Preis,
 * "Du hast schon", alle Drucke mit dem eigenen markiert; unten "Naechste Karte" / "In Sammlung +".
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ScanErgebnisScreen(r: ResolvedScan, onWeiter: () -> Unit, onUebernehmen: (ResolvedScan) -> Unit) {
    BackHandler { onWeiter() }
    val pc = r.base.id
    val store by CollectionStore.state.collectAsState()
    val besitz = remember((store as? StoreState.Ready)?.cards, pc) {
        (store as? StoreState.Ready)?.cards?.filter { it.id == pc && !it.deleted && it.quantity > 0 } ?: emptyList()
    }
    var katalog by remember(pc) { mutableStateOf<CatalogCard?>(null) }
    LaunchedEffect(pc) { katalog = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(pc) }.getOrNull() } }
    val preise by CmPriceFile.stand.collectAsState()

    val drucke = remember(katalog, besitz, preise) {
        ScanErgebnis.drucke(r.knownSets, katalog?.printings ?: emptyList(), besitz) { id -> preise?.trend?.get(id) }
    }
    var auswahl by remember(r) {
        mutableStateOf(ScanErgebnis.startAuswahl(r.match.selected, ScanSprache.ersatzDruck(ScanSprache.fest, r.knownSets)))
    }
    var auflage by remember(r) { mutableStateOf(r.confidence.effectiveEdition) }
    var gewaehlt by remember(r) { mutableStateOf(false) }
    var auflageGewaehlt by remember(r) { mutableStateOf(false) }
    var auflageOffen by remember { mutableStateOf(false) }
    var grossesBild by remember { mutableStateOf(false) }

    val sicher = gewaehlt || r.confidence.light == ScanConfidence.Light.GREEN
    val auflageUnsicher = !auflageGewaehlt && (r.confidence.editionConfidence == EditionEvidence.Confidence.LOW || auflage == "unknown")
    val markiert = drucke.firstOrNull { ScanErgebnis.key(it.setCode, it.rarity, it.language) == auswahl }
    val kopf = ScanErgebnis.kopfPreis(drucke, auswahl, sicher, r.match.candidates)
    val bild = katalog?.image?.takeIf { it.isNotBlank() } ?: r.base.imageUrl
    val nameDe = katalog?.nameDe?.takeIf { it.isNotBlank() } ?: r.base.name ?: pc
    val nameEn = katalog?.nameEn?.takeIf { it.isNotBlank() && it != nameDe }

    Scaffold(
        bottomBar = {
            Surface(tonalElevation = 2.dp) {
                Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onWeiter, modifier = Modifier.weight(1f)) { Text("Nächste Karte") }
                    Button(onClick = {
                        val druck = markiert?.let { m ->
                            r.knownSets.firstOrNull { ScanErgebnis.key(it.setCode, it.rarity, it.language) == auswahl }
                                ?: SetOption(m.setCode, m.rarity, 0.0, m.language)
                        }
                        var conf = r.confidence.copy(effectiveEdition = auflage)
                        if (gewaehlt) conf = conf.copy(light = ScanConfidence.Light.GREEN, reason = null)
                        if (auflageGewaehlt) conf = conf.copy(editionConfidence = EditionEvidence.Confidence.HIGH)
                        onUebernehmen(ResolvedScan(r.base, r.knownSets, r.match.copy(selected = druck ?: r.match.selected), conf, r.readSetCode))
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
                val farbe = when (r.confidence.light) {
                    ScanConfidence.Light.GREEN -> Good
                    ScanConfidence.Light.YELLOW -> Warn
                    ScanConfidence.Light.RED -> MaterialTheme.colorScheme.error
                }
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (gewaehlt) Good else farbe))
                Spacer(Modifier.width(6.dp))
                Text(if (gewaehlt) "von dir gewählt" else r.confidence.reason ?: "sicher erkannt",
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
                                        onClick = { auflage = e; auflageGewaehlt = true; auflageOffen = false })
                                }
                            }
                        }
                        markiert?.let { Chip("${langFlag(it.language)} ${it.setCode}") }
                    }
                }
            }

            // 6. Hinweis bei Unsicherheit
            if (!sicher || markiert == null) {
                Spacer(Modifier.height(10.dp))
                Surface(color = Warn.copy(alpha = 0.15f), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(if (markiert == null) "Druck nicht erkannt – tippe unten deinen Druck an."
                        else "Mehrere Seltenheiten möglich – tippe unten deinen Druck an.",
                        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }

            // 4. Preisfeld
            Spacer(Modifier.height(12.dp))
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(DruckPreis.text(kopf), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    val low = markiert?.cm?.singleOrNull()?.let { preise?.low?.get(it) }
                    val zeile = buildList {
                        add(if (kopf is DruckPreis.Fest && kopf.ausSammlung) "dein Sammlungspreis" else "Cardmarket-Trend")
                        if (sicher && low != null) add("ab ${DruckPreis.text(DruckPreis.Fest(low, false))}")
                        ScanErgebnis.standText(preise?.datum, LocalDate.now())?.let { add(it) }
                        if (preise == null) add("Preise werden beim nächsten Netz geladen")
                    }.joinToString(" · ")
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
                        .clickable { auswahl = k; gewaehlt = true }
                        .padding(horizontal = 10.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${langFlag(d.language)} ${d.setCode}", fontWeight = if (istMeins) FontWeight.SemiBold else FontWeight.Normal)
                    Text(" · ${d.rarity}", color = Muted, style = MaterialTheme.typography.bodySmall)
                    if (d.anzahl > 0) Text("  du hast ${d.anzahl}", color = Good, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.weight(1f))
                    Text(DruckPreis.text(d.preis), fontWeight = if (istMeins) FontWeight.SemiBold else FontWeight.Normal)
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
