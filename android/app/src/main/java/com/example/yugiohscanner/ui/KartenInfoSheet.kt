package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CatalogCard
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.PrintingRepository
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ml.SalesMath
import com.example.yugiohscanner.ui.components.RarityChip
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * Karten-Info im Fotomodus (Nutzerentscheid 21.09.2026): ein Blatt ueber dem Scanner fuer die
 * zuletzt fotografierte Karte -- auch eine, die (noch) nicht in der Sammlung liegt. Deshalb nicht
 * [CardDetailScreen]: der schliesst sich, sobald die Karte keinen eigenen Druck hat.
 *
 * Reihenfolge wie vom Nutzer festgelegt: oben die Preise je Druck mit der eigenen Anzahl daneben,
 * dann der Preisverlauf, ganz unten Kartentext und Werte.
 */
@Composable
fun KartenInfoSheet(passcode: String) {
    val ctx = LocalContext.current
    val store by CollectionStore.state.collectAsState()
    val besitz = remember((store as? StoreState.Ready)?.cards, passcode) {
        (store as? StoreState.Ready)?.cards?.filter { it.id == passcode && !it.deleted && it.quantity > 0 } ?: emptyList()
    }
    var katalog by remember(passcode) { mutableStateOf<CatalogCard?>(null) }
    var drucke by remember(passcode) { mutableStateOf<List<SetOption>?>(null) }
    var fehler by remember(passcode) { mutableStateOf<String?>(null) }

    LaunchedEffect(passcode) {
        katalog = withContext(Dispatchers.IO) { runCatching { CatalogRepository.card(passcode) }.getOrNull() }
        // Dieselbe Druckliste wie der Scan selbst (Katalog, sonst Plattenspeicher, sonst Netz) --
        // nach dem Foto liegt sie meist schon im Plattenspeicher.
        drucke = try {
            withContext(Dispatchers.IO) { PrintingRepository.fetchAllSets(passcode) }
        } catch (e: Exception) {
            fehler = e.message; emptyList()
        }
    }

    val zeilen = remember(drucke, besitz) { KartenInfo.preiszeilen(drucke ?: emptyList(), besitz) }
    val name = katalog?.nameDe?.takeIf { it.isNotBlank() } ?: besitz.firstOrNull()?.name ?: passcode

    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        Text(name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("%08d".format(passcode.toIntOrNull() ?: 0), fontFamily = MonoFontFamily,
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))

        // --- Preise je Druck ------------------------------------------------------------------
        SectionHeader("Preise je Druck")
        katalog?.cmPrice?.let {
            Text("Cardmarket-Trend der Karte: ${eur(it)}", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(6.dp))
        }
        when {
            drucke == null -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp)); Text("Lade Drucke …")
            }
            zeilen.isEmpty() -> Text(fehler?.let { "Drucke nicht ladbar: $it" } ?: "Keine Drucke bekannt",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> zeilen.forEach { z ->
                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${langFlag(z.language)} ${z.setCode}", fontFamily = MonoFontFamily,
                            style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(150.dp))
                        Box(Modifier.weight(1f)) { RarityChip(z.rarity) }
                        if (z.anzahl > 0) {
                            Text("du hast ${z.anzahl}", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 6.dp))
                        }
                        Text(preisText(z), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                    }
                    // Task 13: Preisvorschlag je Druck -- ohne Zustandsfaktor, weil die Karten-Info
                    // je Druck zeigt, nicht je Exemplar (anders als die Verkaufsliste/Karten-Detail).
                    if (z.anzahl > 0 && z.waehrung == KartenInfo.Waehrung.EUR) {
                        val vorschlag = Prefs.saleSuggestion(ctx, SalesMath.toCents(z.preis))
                        Text(if (vorschlag != null) "Vorschlag ${SalesMath.euroCentsText(vorschlag)} (je NM-Exemplar)" else "Vorschlag –",
                            style = MaterialTheme.typography.labelSmall, color = Muted)
                    }
                }
            }
        }
        if (zeilen.any { it.waehrung == KartenInfo.Waehrung.USD }) {
            Text("≈ \$ = US-Richtwert von YGOPRODeck. Euro je Rarity gibt es für Drucke in deiner Sammlung.",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        // --- Preisverlauf ---------------------------------------------------------------------
        Spacer(Modifier.height(16.dp))
        SectionHeader("Preisverlauf")
        if (besitz.isEmpty()) {
            Text("Nur für Drucke in deiner Sammlung.", color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
        } else {
            besitz.forEach { v ->
                Text("${langFlag(v.language)} ${v.setCode} · ${v.rarity ?: ""}", style = MaterialTheme.typography.bodySmall)
                PriceHistoryChart(v)
                Spacer(Modifier.height(8.dp))
            }
        }

        // --- Kartentext und Werte -------------------------------------------------------------
        Spacer(Modifier.height(16.dp))
        SectionHeader("Karte")
        val bild = katalog?.image ?: besitz.firstOrNull()?.imageUrl
        Row {
            if (bild != null) {
                AsyncImage(model = bild, contentDescription = name, modifier = Modifier.width(110.dp))
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                katalog?.type?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                val werte = listOfNotNull(
                    katalog?.level?.let { "Stufe $it" },
                    katalog?.atk?.let { "ATK $it" },
                    katalog?.def?.let { "DEF $it" },
                    katalog?.attribute, katalog?.race,
                ).joinToString(" · ")
                if (werte.isNotBlank()) Text(werte, style = MaterialTheme.typography.bodySmall)
            }
        }
        katalog?.descDe?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun eur(v: Double) = String.format(Locale.GERMANY, "%,.2f €", v)

private fun preisText(z: KartenInfo.Zeile): String = when (z.waehrung) {
    KartenInfo.Waehrung.EUR -> eur(z.preis ?: 0.0)
    KartenInfo.Waehrung.USD -> String.format(Locale.GERMANY, "≈ %,.2f \$", z.preis ?: 0.0)
    null -> "–"
}
