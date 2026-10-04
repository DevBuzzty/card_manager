# Kamera-Bildschirm neu gestalten (Layout C) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Kamera-Bildschirm bekommt Layout C: oben nur ✕ · PC-Status · ⋯, großes Modus-Etikett, beschriftete Werkzeug-Chips über dem Auslöser bzw. Stapel-Zähler, Modus-Reiter ganz unten – ohne fest einprogrammierte Farben.

**Architecture:** Neue reine Logik `ScanOverlayLogik` (Texte, Sprachwechsel) mit JVM-Tests; neue Datei `ui/ScanOverlay.kt` mit rein darstellenden Composables und den einzigen Scrim-/Schriftfarb-Konstanten (dunkles Rollen-Set). `ScanScreen.kt` behält Kamera, Erkennung und Zustand und ersetzt Kopfzeile, Zähler, Auslöser-Position und Fußzeilen durch diese Bausteine. Ein JVM-Test verbietet harte Farben in beiden Dateien.

**Tech Stack:** Kotlin, Jetpack Compose (Material3), JUnit (JVM unit tests).

**Spec:** `docs/superpowers/specs/2026-10-04-kamera-bildschirm-design.md`

## Global Constraints

- UI-Texte und Kommentare auf Deutsch.
- Kartenrahmen-Geometrie unverändert (`aspectRatio(0.68f)`, `fillMaxWidth(0.8f)`, `padding(32.dp)`, `onGloballyPositioned { guideBounds = …; pushGuide() }`) – die Lichtschranke im Stapel-Modus misst daran.
- Alle Funktionen bleiben: Pinch-Zoom, Tipp-Fokus, Lichtschranke, Foto → Ergebnis-Seite, Passcode-Dialog, Staging-Sheet, Snackbars, Blitz, Berechtigungs-Hinweis, Fehler melden (Scan-Log + Toast „Fehler vermerkt“).
- Modi bleiben `"einzeln"`/`"stapel"` in `Prefs.setScanMode`; Wechsel nur per **Antippen** der Reiter (kein Wischen). Der Toast beim Moduswechsel entfällt.
- PC-Adresse: Schlüssel `ip_address` in `scanner_prefs` (dieselbe Quelle wie `SettingsScreen`).
- Kamera-Oberfläche nutzt immer das dunkle Rollen-Set `AppColors.dark` (Schlüssel `accent`, `accent-fg`, `good`, `text-muted`, …).
- Keine Hex-Werte und kein `Color.Yellow/Red/Green` in `ScanScreen.kt` und `ScanOverlay.kt`; Schwarz/Weiß nur als benannte Konstanten in `ScanOverlay.kt`.
- `ScanStagingSheet` und `SortIntoBinderScreen` werden nicht verändert.
- `android/local.properties` nie lesen oder ändern.
- Tests: `cd android && export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && ./gradlew testDebugUnitTest`; Build `./gradlew assembleRelease`.

## Review Focus

1. Sprachwechsel von JP zurück auf Auto (Ende der Liste) → wieder „🌐 Auto“. → Test in Task 1.
2. Eine einzige vorgemerkte Karte → „1 Karte vorgemerkt“ (Singular). → Test in Task 1.
3. Harte Farbe schleicht sich später wieder ein → Farbtest schlägt fehl. → Test in Task 3.
4. PC-Dialog mit leerer IP → „Verbinden“ deaktiviert, kein Absturz. → Logik-Test in Task 1 (`ipGueltig`).
5. Stapel-Modus: kein Auslöser, Zähler an seiner Stelle; Einzeln: kein Zähler. → Geräteabnahme Task 4 (Compose-Anordnung, nicht JVM-testbar).

---

### Task 1: Reine Logik `ScanOverlayLogik`

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanOverlayLogik.kt`
- Test: `android/app/src/test/java/com/example/yugiohscanner/ScanOverlayLogikTest.kt`

**Interfaces:**
- Produces: `object ScanOverlayLogik { fun pcText(verbunden: Boolean): String; fun sprachText(fest: String?): String; fun naechsteSprache(aktuell: String?): String?; fun modusEtikett(modus: String): String; fun fokusText(fest: Boolean): String; fun vorgemerktText(n: Int): String; fun gesendetText(n: Int): String; fun zaehlerText(n: Int): String; fun ipGueltig(ip: String): Boolean }`

- [ ] **Step 1: Failing test** – `ScanOverlayLogikTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ui.ScanOverlayLogik
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanOverlayLogikTest {
    @Test fun `pcText`() {
        assertEquals("PC verbunden", ScanOverlayLogik.pcText(true))
        assertEquals("nur Handy", ScanOverlayLogik.pcText(false))
    }

    @Test fun `sprachText - Auto oder Flagge mit Code`() {
        assertEquals("🌐 Auto", ScanOverlayLogik.sprachText(null))
        assertEquals("🇩🇪 DE", ScanOverlayLogik.sprachText("DE"))
    }

    @Test fun `naechsteSprache - Auto DE EN KR JP und zurueck auf Auto`() {
        assertEquals("DE", ScanOverlayLogik.naechsteSprache(null))
        assertEquals("EN", ScanOverlayLogik.naechsteSprache("DE"))
        assertEquals("KR", ScanOverlayLogik.naechsteSprache("EN"))
        assertEquals("JP", ScanOverlayLogik.naechsteSprache("KR"))
        assertNull(ScanOverlayLogik.naechsteSprache("JP"))
    }

    @Test fun `modusEtikett und fokusText`() {
        assertEquals("EINZELN", ScanOverlayLogik.modusEtikett("einzeln"))
        assertEquals("STAPEL", ScanOverlayLogik.modusEtikett("stapel"))
        assertEquals("EINZELN", ScanOverlayLogik.modusEtikett("irgendwas"))
        assertEquals("◎ Fokus", ScanOverlayLogik.fokusText(false))
        assertEquals("◎ Fokus fest", ScanOverlayLogik.fokusText(true))
    }

    @Test fun `Leisten- und Zaehlertexte mit Einzahl`() {
        assertEquals("1 Karte vorgemerkt", ScanOverlayLogik.vorgemerktText(1))
        assertEquals("3 Karten vorgemerkt", ScanOverlayLogik.vorgemerktText(3))
        assertEquals("27 an den PC gesendet", ScanOverlayLogik.gesendetText(27))
        assertEquals("+0", ScanOverlayLogik.zaehlerText(0))
        assertEquals("+27", ScanOverlayLogik.zaehlerText(27))
    }

    @Test fun `ipGueltig - leer oder Leerzeichen ist ungueltig`() {
        assertFalse(ScanOverlayLogik.ipGueltig(""))
        assertFalse(ScanOverlayLogik.ipGueltig("   "))
        assertTrue(ScanOverlayLogik.ipGueltig("192.168.0.20"))
    }
}
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*ScanOverlayLogikTest*"`
Expected: FAIL – `ScanOverlayLogik` unbekannt.

- [ ] **Step 3: `ScanOverlayLogik.kt`**

```kotlin
package com.example.yugiohscanner.ui

import com.example.yugiohscanner.ml.ScanSprache

/** Spec 2026-10-04 Kamera-Bildschirm -- Texte und Umschaltlogik der Bedienelemente (Compose-frei, getestet). */
object ScanOverlayLogik {
    fun pcText(verbunden: Boolean) = if (verbunden) "PC verbunden" else "nur Handy"

    fun sprachText(fest: String?) = fest?.let { "${langFlag(it)} $it" } ?: "🌐 Auto"

    /** Auto -> DE -> EN -> KR -> JP -> Auto (Reihenfolge aus ScanSprache.OPTIONEN). */
    fun naechsteSprache(aktuell: String?): String? {
        val o = ScanSprache.OPTIONEN
        return o[(o.indexOf(aktuell) + 1) % o.size]
    }

    fun modusEtikett(modus: String) = if (modus == "stapel") "STAPEL" else "EINZELN"

    fun fokusText(fest: Boolean) = if (fest) "◎ Fokus fest" else "◎ Fokus"

    fun vorgemerktText(n: Int) = if (n == 1) "1 Karte vorgemerkt" else "$n Karten vorgemerkt"

    fun gesendetText(n: Int) = "$n an den PC gesendet"

    fun zaehlerText(n: Int) = "+$n"

    fun ipGueltig(ip: String) = ip.isNotBlank()
}
```

- [ ] **Step 4: Tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*ScanOverlayLogikTest*"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanOverlayLogik.kt android/app/src/test/java/com/example/yugiohscanner/ScanOverlayLogikTest.kt
git commit -m "feat(android): Texte und Sprachwechsel der Kamera-Bedienelemente"
```

---

### Task 2: Bausteine `ScanOverlay.kt` (rein darstellend)

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanOverlay.kt`

**Interfaces:**
- Consumes: `ScanOverlayLogik` (Task 1), `AppColors.dark` (`ui/theme/Color.kt`, `Map<String, Color>`), `ScanStagingLogic.dotColor(light, roles)` (bestehend), `ScanConfidence.Light`.
- Produces (alle `@Composable`, Paket `com.example.yugiohscanner.ui`):
  - `object ScanFarben { val scrim: Color; val scrimStark: Color; val schrift: Color; val blitz: Color; val akzent: Color; val akzentText: Color; val gut: Color; val gedimmt: Color }`
  - `ScanTopBar(verbunden: Boolean, onClose: () -> Unit, onPcTippen: () -> Unit, menue: @Composable () -> Unit, modifier: Modifier = Modifier)`
  - `MehrMenue(lampeAn: Boolean, onLampe: () -> Unit, onFehlerMelden: () -> Unit, onPcVerbindung: () -> Unit)` – enthält ⋯-Knopf + DropdownMenu
  - `ModusEtikett(modus: String, modifier: Modifier = Modifier)`
  - `WerkzeugChips(sprache: String?, fokusFest: Boolean, onSprache: () -> Unit, onFokus: () -> Unit, onCode: () -> Unit)`
  - `ScanLeiste(text: String, ampel: ScanConfidence.Light?, knopf: String?, onKnopf: () -> Unit)`
  - `StapelZaehler(n: Int)`
  - `Ausloeser(laeuft: Boolean, onClick: () -> Unit)`
  - `ModusReiter(modus: String, onWahl: (String) -> Unit)`
  - `PcVerbindungDialog(verbunden: Boolean, ipStart: String, onVerbinden: (String) -> Unit, onTrennen: () -> Unit, onSchliessen: () -> Unit)`

- [ ] **Step 1: Datei anlegen**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
        Surface(
            onClick = onPcTippen, shape = RoundedCornerShape(50), color = ScanFarben.scrim,
        ) {
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
```

Hinweise: `border` braucht den Import `androidx.compose.foundation.border`. `Surface(onClick = …)` ist in Material3 je nach Version `@ExperimentalMaterial3Api` – dann `@OptIn(ExperimentalMaterial3Api::class)` an die betroffenen Funktionen. `ScanStagingLogic.dotColor` erwartet laut Bestand `(ScanConfidence.Light?, Map<String, Color>)` – Signatur in `ui/ScanStagingScreen.kt` prüfen und ggf. anpassen. Der `PcVerbindungDialog` liegt bewusst NICHT auf `ScanFarben`: er ist ein normaler Dialog im App-Thema.

- [ ] **Step 2: Kompilieren**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL (Bausteine noch ungenutzt).

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanOverlay.kt
git commit -m "feat(android): Bausteine des neuen Kamera-Bildschirms (Layout C)"
```

---

### Task 3: `ScanScreen` umbauen + Farbtest

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt` (Erkennungsrahmen ~L723-757, Stapel-Zähler ~L777-786, Auslöser ~L790-805, Kopfzeile ~L808-925, Fußzeile ~L931-961, Passcode-Dialog-Hintergrund ~L997, Blitz ~L1070, SnackbarHost ~L1074; neuer Zustand + Dialog)
- Test: `android/app/src/test/java/com/example/yugiohscanner/ScanFarbenTest.kt`

**Interfaces:**
- Consumes: alles aus Task 1 und 2; im Bestand: `connectSocket(ip: String)` (Lambda in `ScanScreen`, ~L154), `socket`, `isConnected`, `prefs`, `scanMode`, `capture.sentCount`, `capture.lastLight`, `capture.stagingCards`, `showSheet`, `showManualEntry`, `isFlashOn`, `isFocusLocked`, `cameraControl`, `letztesBild`, `stapelCount`, `fotoAusloesen`, `fotoLaeuft`.

- [ ] **Step 1: Failing test** – `ScanFarbenTest.kt` (liest die Quelltexte, analog zum Desktop-Test `noLegacyColors`):

```kotlin
package com.example.yugiohscanner

import org.junit.Assert.assertTrue
import org.junit.Test

/** Spec 2026-10-04 Kamera-Bildschirm §6: keine fest einprogrammierten Farben auf dem Kamera-Bildschirm. */
class ScanFarbenTest {
    private val pfad = "android/app/src/main/java/com/example/yugiohscanner/ui/"
    private val verboten = listOf("Color(0x", "Color.Yellow", "Color.Red", "Color.Green", "Color.rgb(", "Color.argb(")

    @Test fun `ScanScreen ohne harte Farben, auch ohne Schwarz und Weiss`() {
        val src = Fixtures.text(pfad + "ScanScreen.kt")
        for (v in verboten + listOf("Color.Black", "Color.White")) assertTrue("ScanScreen.kt enthaelt $v", v !in src)
    }

    @Test fun `ScanOverlay ohne harte Farben, Schwarz und Weiss nur in ScanFarben`() {
        val src = Fixtures.text(pfad + "ScanOverlay.kt").replace("\r\n", "\n")   // Windows-Zeilenenden
        for (v in verboten) assertTrue("ScanOverlay.kt enthaelt $v", v !in src)
        val ausserhalb = src.substringAfter("object ScanFarben").substringAfter("\n}\n")
        assertTrue("Schwarz/Weiss ausserhalb von ScanFarben", "Color.Black" !in ausserhalb && "Color.White" !in ausserhalb)
    }
}
```

(`Fixtures.text` sucht den Pfad aufwärts vom Arbeitsverzeichnis – findet so auch Quelltexte relativ zur Repo-Wurzel.)

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd android && ./gradlew testDebugUnitTest --tests "*ScanFarbenTest*"`
Expected: FAIL – `ScanScreen.kt enthaelt Color(0x` (u. a.).

- [ ] **Step 3: Erkennungsrahmen** – im `Canvas` (~L740) `color = Color(0xFF00FF66)` → `color = ScanFarben.gut`, und die Text-Paint-Farbe `color = android.graphics.Color.rgb(0, 255, 102)` → `color = ScanFarben.gut.toArgb()` (Import `androidx.compose.ui.graphics.toArgb`).

- [ ] **Step 4: Alte Kopfzeile, Stapel-Zähler, Auslöser und Fußzeile entfernen** – die Blöcke „Stapel-Zaehler“ (~L777-786), „Auslöser des Fotomodus“ (~L788-805), „Header“ (~L807-925, inkl. des `var scanSprache by remember …` darin) und „Fusszeile“ (~L927-961, `if ((isConnected && capture.sentCount > 0) || capture.stagingCards.isNotEmpty()) { Column … }`) löschen. Den Kartenrahmen-Block („Overlay“ mit „Card Frame“) **unverändert lassen**.

- [ ] **Step 5: Neuer Zustand** – bei den übrigen `var … by remember` (~L206-216) ergänzen:

```kotlin
    // Spec 2026-10-04 Kamera-Bildschirm: Sprach-Chip (Speicher wie bisher in ScanSprache) und PC-Dialog.
    var scanSprache by remember { mutableStateOf(com.example.yugiohscanner.ml.ScanSprache.fest) }
    var zeigePcDialog by remember { mutableStateOf(false) }
```

- [ ] **Step 6: Neue Bedienelemente** – an der Stelle der gelöschten Kopfzeile (nach dem Kartenrahmen-Block, vor `if (showSheet)`) einfügen:

```kotlin
        // Spec 2026-10-04 Kamera-Bildschirm, Layout C: oben nur ✕ · PC · ⋯.
        ScanTopBar(
            verbunden = isConnected,
            onClose = onClose,
            onPcTippen = { zeigePcDialog = true },
            menue = {
                MehrMenue(
                    lampeAn = isFlashOn,
                    onLampe = { isFlashOn = !isFlashOn; cameraControl?.enableTorch(isFlashOn) },
                    onFehlerMelden = {
                        val bild = letztesBild.get()
                        val foto = bild?.let { com.example.yugiohscanner.ml.ScanLog.photo(it, "meldung-${System.currentTimeMillis()}") }
                        com.example.yugiohscanner.ml.ScanLog.line("MELDUNG", "Nutzer meldet Fehler, zaehler=$stapelCount foto=$foto")
                        Toast.makeText(context, "Fehler vermerkt", Toast.LENGTH_SHORT).show()
                    },
                    onPcVerbindung = { zeigePcDialog = true },
                )
            },
            modifier = Modifier.align(Alignment.TopCenter),
        )

        // Grosses Modus-Etikett ueber dem Kartenrahmen.
        ModusEtikett(scanMode, Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 64.dp))

        // Unten, alles in Daumenreichweite: Leiste, Werkzeuge, Ausloeser bzw. Stapel-Zaehler, Modus-Reiter.
        Column(
            Modifier.fillMaxWidth().align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Gesendet (mit PC) und Vorgemerkt (Handy) sind unabhaengig und koennen beide stehen (Spec D4 §6.3).
            if (isConnected && capture.sentCount > 0) {
                ScanLeiste(ScanOverlayLogik.gesendetText(capture.sentCount), capture.lastLight, knopf = null, onKnopf = {})
            }
            if (capture.stagingCards.isNotEmpty()) {
                ScanLeiste(
                    ScanOverlayLogik.vorgemerktText(capture.stagingCards.size), null,
                    knopf = "Prüfen (${capture.stagingCards.size})", onKnopf = { showSheet = true },
                )
            }
            WerkzeugChips(
                sprache = scanSprache,
                fokusFest = isFocusLocked,
                onSprache = {
                    val next = ScanOverlayLogik.naechsteSprache(scanSprache)
                    com.example.yugiohscanner.ml.ScanSprache.fest = next
                    scanSprache = next
                },
                onFokus = {
                    cameraControl?.cancelFocusAndMetering()
                    if (isFocusLocked) {
                        isFocusLocked = false
                        Toast.makeText(context, "Dauer-Autofokus", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(context, "Fokussiere…", Toast.LENGTH_SHORT).show()
                    }
                },
                onCode = { showManualEntry = true },
            )
            if (scanMode == "stapel") StapelZaehler(stapelCount) else Ausloeser(fotoLaeuft, fotoAusloesen)
            ModusReiter(scanMode) { neu ->
                if (neu != scanMode) {
                    scanMode = neu
                    com.example.yugiohscanner.Prefs.setScanMode(context, neu)
                }
            }
        }

        if (zeigePcDialog) {
            PcVerbindungDialog(
                verbunden = isConnected,
                ipStart = prefs.getString("ip_address", "") ?: "",
                onVerbinden = { ip ->
                    prefs.edit().putString("ip_address", ip).apply()
                    socket?.disconnect()
                    socket = null
                    connectSocket(ip)
                    zeigePcDialog = false
                },
                onTrennen = {
                    socket?.disconnect()
                    socket = null
                    isConnected = false
                    zeigePcDialog = false
                },
                onSchliessen = { zeigePcDialog = false },
            )
        }
```

Prüfen: Die bisherige Fokus-Logik rief `cancelFocusAndMetering()` in beiden Zweigen auf – oben gleich. Der Moduswechsel hatte bisher Seiteneffekte nur über `scanMode`/Prefs (Analyse-Pipeline reagiert auf `scanMode`, ~L474-516) – keine weiteren Aufrufe nötig; falls der alte Umschalter noch etwas anderes tat (im gelöschten Block nachsehen), hier übernehmen.

- [ ] **Step 7: Restliche Farben** – Passcode-Dialog-Hintergrund `.background(Color.Black.copy(alpha = 0.9f))` → `.background(ScanFarben.scrimStark)`; Blitz `Color.White.copy(alpha = flash.value)` → `ScanFarben.blitz.copy(alpha = flash.value)`; jede weitere Fundstelle von `Color.White`/`Color.Black` in `ScanScreen.kt` (z. B. Berechtigungs-Hinweis, Spinner) auf `ScanFarben.schrift`/`ScanFarben.scrim` bzw. die App-Thema-Farben umstellen. Ungenutzte Imports (Icons `Layers`, `LooksOne`, `Flag`, `FlashOn`, `FlashOff`, `CenterFocusStrong`, `CenterFocusWeak`, `Keyboard`, ggf. `Color`) entfernen.

- [ ] **Step 8: Snackbars nach oben** – `SnackbarHost` (~L1074) von unten nach oben unter die Kopfzeile, damit er die untere Bedienspalte nicht verdeckt:

```kotlin
        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 104.dp),
        )
```

- [ ] **Step 9: Tests und Build**

Run: `cd android && ./gradlew testDebugUnitTest assembleRelease`
Expected: BUILD SUCCESSFUL, `ScanFarbenTest` grün, alle übrigen Tests grün.

- [ ] **Step 10: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ScanScreen.kt android/app/src/test/java/com/example/yugiohscanner/ScanFarbenTest.kt
git commit -m "feat(android): Kamera-Bildschirm in Layout C, ohne harte Farben"
```

---

### Task 4: Abnahme am Gerät (mit dem Nutzer)

**Files:** keine.

- [ ] **Step 1:** APK bauen und installieren (`cd android && ./gradlew assembleRelease && adb install -r app/build/outputs/apk/release/app-release.apk`), App starten, `adb logcat -b crash -d` leer.
- [ ] **Step 2: Abnahme** (Spec §9): beide Modi (Reiter antippen; Etikett und Auslöser/Zähler wechseln), Sprache durchschalten bis zurück auf „🌐 Auto“, Fokus fest/lösen, „⌨ Code“ öffnet Passcode-Dialog, ⋯-Menü (Lampe an/aus, Fehler melden → Toast, PC-Verbindung → Dialog), PC verbinden/trennen (Chip zeigt „PC verbunden“/„nur Handy“), Stapel-Lauf (Zähler zählt, Erkennungsrahmen grün, Lichtschranke zählt wie vorher), Foto → Ergebnis-Seite, „Prüfen (n)“ öffnet die Liste, helles und dunkles App-Thema.
- [ ] **Step 3:** Merge nach bestandener Abnahme auf Nutzerwunsch.
