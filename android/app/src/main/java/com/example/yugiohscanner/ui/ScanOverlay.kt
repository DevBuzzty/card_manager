@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.example.yugiohscanner.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ui.theme.AppColors

/**
 * Spec 2026-10-04 Kamera-Bildschirm (Layout C) -- rein darstellende Bedienelemente ueber dem Kamerabild.
 * Die Kamera-Oberflaeche nutzt IMMER das dunkle Rollen-Set (stabiler Kontrast auf jedem Bild). Die
 * einzigen Schwarz-/Weiss-Werte des Bildschirms stehen hier in [ScanFarben].
 */
object ScanFarben {
    private val rollen = AppColors.dark
    val scrim = Color.Black.copy(alpha = 0.55f)
    val scrimStark = Color.Black.copy(alpha = 0.9f)
    val schrift = Color.White
    val blitz = Color.White
    val akzent: Color = rollen.getValue("accent")
    val akzentText: Color = rollen.getValue("accent-fg")
    val gut: Color = rollen.getValue("good")
    val gedimmt: Color = rollen.getValue("text-muted")
}

@Composable
fun ScanTopBar(verbunden: Boolean, onClose: () -> Unit, onPcTippen: () -> Unit, menue: @Composable () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth()
            .background(Brush.verticalGradient(listOf(ScanFarben.scrim, Color.Transparent)))
            .statusBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Schließen", tint = ScanFarben.schrift) }
        Surface(onClick = onPcTippen, shape = RoundedCornerShape(50), color = ScanFarben.scrim) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (verbunden) ScanFarben.gut else ScanFarben.gedimmt))
                Spacer(Modifier.width(6.dp))
                Text(ScanOverlayLogik.pcText(verbunden), color = ScanFarben.schrift, style = MaterialTheme.typography.labelLarge)
            }
        }
        Spacer(Modifier.weight(1f))
        menue()
    }
}

@Composable
fun MehrMenue(lampeAn: Boolean, onLampe: () -> Unit, onFehlerMelden: () -> Unit, onPcVerbindung: () -> Unit) {
    var offen by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { offen = true }, modifier = Modifier.background(ScanFarben.scrim, CircleShape)) {
            Icon(Icons.Default.MoreHoriz, "Weitere Funktionen", tint = ScanFarben.schrift)
        }
        DropdownMenu(expanded = offen, onDismissRequest = { offen = false }) {
            DropdownMenuItem(text = { Text(if (lampeAn) "Taschenlampe aus" else "Taschenlampe an") }, onClick = { offen = false; onLampe() })
            DropdownMenuItem(text = { Text("Fehler melden") }, onClick = { offen = false; onFehlerMelden() })
            DropdownMenuItem(text = { Text("PC-Verbindung …") }, onClick = { offen = false; onPcVerbindung() })
        }
    }
}

@Composable
fun ModusEtikett(modus: String, modifier: Modifier = Modifier) {
    Text(
        ScanOverlayLogik.modusEtikett(modus),
        color = ScanFarben.akzentText, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge,
        modifier = modifier.background(ScanFarben.akzent, RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 4.dp),
    )
}

@Composable
private fun WerkzeugChip(text: String, aktiv: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick, shape = RoundedCornerShape(50), color = ScanFarben.scrim,
        border = BorderStroke(1.dp, if (aktiv) ScanFarben.akzent else ScanFarben.gedimmt),
    ) {
        Text(text, color = ScanFarben.schrift, style = MaterialTheme.typography.labelLarge, maxLines = 1,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp))
    }
}

@Composable
fun WerkzeugChips(sprache: String?, fokusFest: Boolean, onSprache: () -> Unit, onFokus: () -> Unit, onCode: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        WerkzeugChip(ScanOverlayLogik.sprachText(sprache), aktiv = sprache != null, onClick = onSprache)
        WerkzeugChip(ScanOverlayLogik.fokusText(fokusFest), aktiv = fokusFest, onClick = onFokus)
        WerkzeugChip("⌨ Code", aktiv = false, onClick = onCode)
    }
}

@Composable
fun ScanLeiste(text: String, ampel: ScanConfidence.Light?, knopf: String?, onKnopf: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            .background(ScanFarben.scrim, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(ScanStagingLogic.dotColor(ampel, AppColors.dark)))
        Spacer(Modifier.width(8.dp))
        Text(text, color = ScanFarben.schrift, modifier = Modifier.weight(1f))
        if (knopf != null) {
            Button(onClick = onKnopf, colors = ButtonDefaults.buttonColors(containerColor = ScanFarben.akzent, contentColor = ScanFarben.akzentText)) { Text(knopf) }
        }
    }
}

@Composable
fun StapelZaehler(n: Int) {
    Column(
        Modifier.background(ScanFarben.scrim, RoundedCornerShape(16.dp))
            .border(2.dp, ScanFarben.akzent, RoundedCornerShape(16.dp))
            .padding(horizontal = 18.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(ScanOverlayLogik.zaehlerText(n), color = ScanFarben.schrift, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
        Text("Karten im Stapel", color = ScanFarben.schrift, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
fun Ausloeser(laeuft: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = !laeuft, shape = CircleShape, contentPadding = PaddingValues(0.dp),
        colors = ButtonDefaults.buttonColors(containerColor = ScanFarben.akzent, contentColor = ScanFarben.akzentText),
        border = BorderStroke(4.dp, ScanFarben.schrift),
        modifier = Modifier.size(84.dp),
    ) {
        if (laeuft) CircularProgressIndicator(color = ScanFarben.schrift, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
        else Icon(Icons.Default.PhotoCamera, contentDescription = "Foto aufnehmen", modifier = Modifier.size(40.dp))
    }
}

@Composable
fun ModusReiter(modus: String, onWahl: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        listOf("einzeln" to "EINZELN", "stapel" to "STAPEL").forEach { (wert, text) ->
            val aktiv = (modus == "stapel") == (wert == "stapel")
            Text(
                text,
                color = if (aktiv) ScanFarben.akzent else ScanFarben.gedimmt,
                fontWeight = if (aktiv) FontWeight.Bold else FontWeight.Normal,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.clip(RoundedCornerShape(50)).clickable { onWahl(wert) }.padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
    }
}

/** Normaler Dialog im App-Thema (nicht auf [ScanFarben]). IP-Schluessel wie in SettingsScreen: ip_address. */
@Composable
fun PcVerbindungDialog(verbunden: Boolean, ipStart: String, onVerbinden: (String) -> Unit, onTrennen: () -> Unit, onSchliessen: () -> Unit) {
    var ip by remember { mutableStateOf(ipStart) }
    AlertDialog(
        onDismissRequest = onSchliessen,
        title = { Text("PC-Verbindung") },
        text = {
            Column {
                Text(if (verbunden) "Verbunden mit $ipStart" else "Nicht verbunden", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = ip, onValueChange = { ip = it.trim() }, label = { Text("IP-Adresse") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(onClick = { onVerbinden(ip) }, enabled = ScanOverlayLogik.ipGueltig(ip)) { Text("Verbinden") }
        },
        dismissButton = {
            Row {
                if (verbunden) TextButton(onClick = onTrennen) { Text("Trennen") }
                TextButton(onClick = onSchliessen) { Text("Schließen") }
            }
        },
    )
}
