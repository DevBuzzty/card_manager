package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.cloud.SetOption
import com.example.yugiohscanner.ml.ScanConfidence
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.AppColors
import com.example.yugiohscanner.ui.theme.LocalAppRoles
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

// One scanned-but-not-yet-committed card. Added to staging IMMEDIATELY on recognition (feels
// instant); its details + known printings are filled in asynchronously (loading=true meanwhile).
// Set/quantity are editable so a mis-recognised printing can be corrected before committing.
class ScanStagingEntry(val id: Long, val passcode: String) {
    var base by mutableStateOf<CardRow?>(null)
    var knownSets by mutableStateOf<List<SetOption>>(emptyList())
    var selectedSet by mutableStateOf<SetOption?>(null)
    var quantity by mutableIntStateOf(1)
    var loading by mutableStateOf(true)
    var edition by mutableStateOf("unknown")
    var condition by mutableStateOf("NM")
    // Additional printings of the SAME scanned card (e.g. you also have the English print), so you
    // can record them here instead of re-adding them from the collection later.
    val extraPrintings = mutableStateListOf<ExtraPrinting>()

    // Spec D3 Task 6 ("Stille Verbesserung"): the SetCodeMatch.MatchResult behind the current
    // `selectedSet`, kept around so a later, better-evidenced frame can be compared against it
    // (see SetCodeEvidence.shouldSilentlyImprove) instead of only against the SetOption itself,
    // which carries no distance/frame-count signal of its own.
    var codeMatch by mutableStateOf<SetCodeMatch.MatchResult?>(null)
    // Set the moment the user hand-corrects set, rarity, language or edition (SetPicker / CopyChip
    // below) -- freezes silent improvement for this entry from then on, so a deliberate correction
    // is never silently overwritten by a later automatic re-resolve.
    var userTouched by mutableStateOf(false)

    // Spec D3 Task 7 (traffic light): the ampel ScanScreen already computed (ScanConfidence
    // .fromEvidence, applied on every resolve and every silent improvement) -- this screen only
    // DISPLAYS it (dot colour + reason text), it never recomputes green/yellow/red itself. `null`
    // while the entry is still resolving (same window as `loading`).
    var confidence by mutableStateOf<ScanConfidence.Result?>(null)

    // Spec B2 Task 5 (Einsortier-Modus, Nachtrag §2): das Fach, in das der Nutzer die Karte
    // physisch bereits gesteckt hat, als sie erkannt wurde -- die Karte ist noch nicht in der
    // Sammlung, geht also ins Staging statt direkt hinein, aber das Fach rueckt beim Scannen
    // trotzdem sofort vor. Task 6/7 setzen diese drei beim Anlegen des Eintrags; "Alle uebernehmen"
    // unten reicht sie unveraendert an setCopyLocation() weiter. Alle drei null = keine Reservierung
    // (der normale Fall ausserhalb des Einsortier-Modus). Nicht persistiert, wie der Rest dieser
    // Klasse -- lebt nur in ScanCapture.stagingCards.
    var reservedContainerId by mutableStateOf<String?>(null)
    var reservedPage by mutableStateOf<Int?>(null)
    var reservedSlot by mutableStateOf<Int?>(null)
}

class ExtraPrinting {
    var selectedSet by mutableStateOf<SetOption?>(null)
    var quantity by mutableIntStateOf(1)
    var edition by mutableStateOf("unknown")
    var condition by mutableStateOf("NM")
}

// Pure, testable half of the staging sheet's traffic-light display (Spec D3 Task 7) -- extracted
// so it doesn't need a Compose UI test, which this project has none of (same pattern as
// CardZones.zoneRect / CardLayout.isArtworkShaped in Spec D2). Both functions only MAP an already-
// decided ScanConfidence.Light to what this screen shows; neither re-derives green/yellow/red --
// that stays ScanConfidence's job alone (this task's own brief: "consume, do not re-derive").
object ScanStagingLogic {
    /**
     * "Nur unsichere" shows YELLOW and RED, hides GREEN. `light == null` (still resolving, no
     * ScanConfidence.Result yet) counts as unsafe too -- there is nothing green to promise about
     * an entry that hasn't finished resolving. When the switch is off, everything passes.
     */
    fun matchesUnsafeFilter(showOnlyUnsafe: Boolean, light: ScanConfidence.Light?): Boolean =
        !showOnlyUnsafe || light != ScanConfidence.Light.GREEN

    /** The traffic-light dot's colour -- only the three existing theme colours (the brief:
     *  "keine neuen Farben"). `null` (still resolving) is Muted, not a fourth ampel colour.
     *  Diese Funktion ist bewusst NICHT @Composable (ScanStagingLogicTest ruft sie aus einem
     *  reinen JVM-Test auf, ohne Komposition) -- deshalb ein `roles`-Parameter statt der
     *  Good/Warn/ErrorColor/Muted-Rollenlesungen. Vorgabe AppColors.light, damit der Test
     *  (ruft ohne zweites Argument auf) unveraendert bleibt; der Aufrufer in StagingRow uebergibt
     *  die gerade aktiven Rollen (Fixrunde 1, Punkt 6). */
    fun dotColor(light: ScanConfidence.Light?, roles: Map<String, Color> = AppColors.light): Color = when (light) {
        ScanConfidence.Light.GREEN -> roles.getValue("good")
        ScanConfidence.Light.YELLOW -> roles.getValue("warn")
        ScanConfidence.Light.RED -> roles.getValue("bad")
        null -> roles.getValue("text-muted")
    }

    /**
     * Spec B2 Task 5: welches der gerade fuer eine Karte angelegten Exemplare eine Einsortier-
     * Modus-Reservierung bekommt -- nur das ERSTE (Entscheidung 3 im Bericht: bei quantity > 1
     * passt nur eine Karte ins reservierte Fach, die uebrigen entstehen ohne Standort). `null`
     * wenn keines angelegt wurde (sollte nicht vorkommen, da addScanned mindestens eines erzeugt).
     */
    fun firstCopyForReservation(copyIds: List<String>): String? = copyIds.firstOrNull()
}

@Composable
fun ScanStagingSheet(
    entries: SnapshotStateList<ScanStagingEntry>,
    // Drei Listen, in dieser Reihenfolge:
    //
    // 1. Die VOLLSTAENDIG uebernommenen Eintraege -- angelegt UND, falls ein Fach reserviert war,
    //    mit gesetztem Standort. Die Kamera laeuft hinter dem Blatt weiter, der Aufrufer darf
    //    also nur genau diese vergessen. Die EINTRAEGE, nicht ihre Passcodes (Task 7, Fixrunde
    //    1): der Einsortier-Modus muss "uebernommen" von "weggetippt" und "nicht aufgeloest"
    //    unterscheiden koennen, und das geht nur ueber Identitaet -- zwei Eintraege koennen
    //    denselben Passcode tragen. Wer nur die Passcodes braucht, bildet sie selbst ab.
    // 2. Die Eintraege, deren Karte angelegt wurde, deren reserviertes Fach aber NICHT geschrieben
    //    werden konnte (Abschluss-Fixwelle, Minor 4). Sie sind in der Sammlung -- der Aufrufer
    //    muss sie genauso vergessen wie (1) --, liegen dort aber ohne Standort unter "Nicht
    //    einsortiert". Wer sie zu (1) zaehlt, meldet dem Nutzer spaeter ein Fach, das nie
    //    geschrieben wurde; wer sie ganz weglaesst, laesst sie im Blatt stehen und legt sie beim
    //    naechsten Durchgang ein zweites Mal an.
    // 3. Die Standort-Hinweise dieses Durchgangs (Spec B2 Task 5, Fixrunde 1). Der Aufrufer MUSS
    //    das Blatt offen lassen, solange sie nicht leer ist -- `error` unten lebt in dieser
    //    Komposition, ein sofortiges Schliessen wuerde den Hinweis ungezeichnet wegwerfen. Ein
    //    Hinweis, der von selbst verschwindet (Schnipsel), waere hier zu wenig: physischer und
    //    digitaler Zustand laufen auseinander, das muss der Nutzer wegtippen, nicht verpassen.
    onCommitted: (List<ScanStagingEntry>, List<ScanStagingEntry>, List<String>) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var committing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showOnlyUnsafe by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        Text("Prüfen & übernehmen", style = MaterialTheme.typography.titleLarge, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 4.dp, bottom = 8.dp))
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 12.dp))
        }

        if (entries.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                Text("Keine gescannten Karten. Tippe auf den Scannen-Button.",
                    color = Muted, style = MaterialTheme.typography.bodyMedium)
            }
            return@Column
        }

        // "Nur unsichere" (yellow + red). Pure display filter (ScanStagingLogic.matchesUnsafeFilter)
        // -- it never touches `entries` itself, only what the LazyColumn below shows. "Übernehmen"
        // below always iterates the full `entries`, filter or no filter, per the plan: a filter
        // must never accidentally skip cards on commit.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Nur unsichere", style = MaterialTheme.typography.bodyMedium, color = OnSurface,
                modifier = Modifier.weight(1f))
            Switch(checked = showOnlyUnsafe, onCheckedChange = { showOnlyUnsafe = it })
        }

        val visible = entries.filter { ScanStagingLogic.matchesUnsafeFilter(showOnlyUnsafe, it.confidence?.light) }
        if (showOnlyUnsafe && visible.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                Text("Keine unsicheren Karten – alles Grün.",
                    color = Muted, style = MaterialTheme.typography.bodyMedium)
            }
        }

        LazyColumn(
            Modifier.weight(1f).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 8.dp),
        ) {
            items(visible, key = { it.id }) { entry ->
                StagingRow(entry, onDelete = { entries.remove(entry) })
            }
        }

        Button(
            onClick = {
                committing = true
                scope.launch {
                    // Only the entries actually written are removed; ones still resolving (and
                    // anything the camera adds while this runs) stay in the sheet. Iterates the
                    // FULL `entries`, not `visible` -- see the filter's own comment above.
                    // Zwei Listen statt einer (Abschluss-Fixwelle, Minor 4): `committed` sind die
                    // VOLLSTAENDIG uebernommenen Eintraege, `ohneStandort` die, deren Karte zwar
                    // angelegt wurde, deren reserviertes Fach aber nicht geschrieben werden konnte.
                    // Beide stehen danach in der Sammlung und verlassen deshalb das Blatt; nur
                    // `committed` darf der Aufrufer als "hat sein Fach" behandeln.
                    val committed = mutableListOf<ScanStagingEntry>()
                    val ohneStandort = mutableListOf<ScanStagingEntry>()
                    // Sichtbare Hinweise fuer Reservierungen, die beim Uebernehmen nicht gesetzt
                    // werden konnten (Entscheidung 1 im Bericht) -- gesammelt statt sofort in
                    // `error` geschrieben, damit ein einzelner Hinweis nicht vom `error = null`
                    // einer spaeter erfolgreichen Karte im selben Durchgang ueberschrieben wird.
                    // Ausserhalb des try, damit der catch unten sie ANHAENGEN statt ersetzen kann.
                    val locationWarnings = mutableListOf<String>()
                    try {
                        for (e in entries.toList()) {
                            val b = e.base ?: continue // still resolving — skip
                            val s = e.selectedSet
                            val copyIds = CollectionRepository.addScanned(
                                b,
                                setCode = s?.setCode ?: "Unknown",
                                rarity = s?.rarity ?: "",
                                language = s?.language ?: "DE",
                                edition = e.edition, condition = e.condition,
                                count = e.quantity,
                            )
                            // Ab HIER ist der Eintrag angelegt (Nachtrag zur Abschluss-Fixwelle, die
                            // dieselbe Luecke eine Stufe hoeher schloss). Was danach noch schiefgeht,
                            // darf ihn nicht im Blatt stehen lassen: der naechste Druck auf "Alle
                            // uebernehmen" legte ihn sonst ein ZWEITES Mal an -- doppelte Exemplare,
                            // falscher Bestand, falscher Wert --, und im Einsortier-Modus zwingt der
                            // "Fertig"-Riegel den Nutzer zu genau diesem zweiten Versuch. Darum das
                            // per-Eintrag-`finally`: es sortiert den Eintrag in JEDEM Fall in eine
                            // der beiden Listen.
                            //
                            // Die beiden Listen behalten dabei ihre alte Bedeutung, es kommt keine
                            // dritte dazu: `committed` heisst weiterhin "angelegt UND reserviertes
                            // Fach geschrieben" (daran haengt Rueckgaengig, das dem Fach sonst
                            // Falsches nachsagt), `ohneStandort` "angelegt, Fach nicht geschrieben".
                            // Ein Fehlschlag an den zusaetzlichen Printings betrifft ANDERE Karten
                            // (Entscheidung 2: sie bekommen nie die Reservierung) und aendert an
                            // dieser Einordnung nichts -- er wird gemeldet, nicht verschluckt.
                            var standortFehlte = false
                            try {
                                // Einsortier-Modus-Reservierung (Spec B2 Task 5): ueber DENSELBEN Weg wie
                                // jede andere Standortzuweisung -- setCopyLocation, das Seite/Fach bei
                                // Nicht-Bindern selbst verwirft. Kein zweiter Schreibweg, keine zweite
                                // Pruefung hier (siehe B1 Task 6, wo genau das zu Datenverlust fuehrte).
                                // Entscheidung 3: nur das erste angelegte Exemplar bekommt sie.
                                val reservedCopyId = ScanStagingLogic.firstCopyForReservation(copyIds)
                                if (e.reservedContainerId != null && reservedCopyId != null) {
                                    try {
                                        CollectionRepository.setCopyLocation(
                                            reservedCopyId, e.reservedContainerId, e.reservedPage, e.reservedSlot,
                                        )
                                    } catch (ex: Exception) {
                                        // Entscheidung 1: das Uebernehmen laeuft ueber ALLE Eintraege in
                                        // einem Durchgang -- ein Wurf hier risse den ganzen Stapel mit.
                                        // Die Karte ist wichtiger als ihr Platz: sie bleibt angelegt, nur
                                        // ohne Standort (taucht in "Nicht einsortiert" auf), und der
                                        // Nutzer bekommt einen sichtbaren Hinweis statt eines stillen
                                        // Fehlschlags oder einer verschluckten Ausnahme.
                                        //
                                        // Abschluss-Fixwelle, Minor 4: der Eintrag wandert deshalb in
                                        // `ohneStandort` statt in `committed` -- er IST uebernommen,
                                        // aber ohne Fach, und der Aufrufer darf ihm spaeter keines
                                        // nachsagen. Dieser eigene catch bleibt: er unterscheidet den
                                        // Fach-Fehlschlag vom Rest, den der aeussere catch traegt.
                                        standortFehlte = true
                                        locationWarnings.add(
                                            "${b.name ?: b.id}: Standort nicht gesetzt (${ex.message ?: "unbekannter Fehler"})",
                                        )
                                    }
                                }
                                // Commit each extra printing the user added (skip ones left unpicked).
                                // Entscheidung 2: extraPrintings bekommen NIE die Reservierung -- reserviert
                                // ist ein einzelnes physisches Fach, die zusaetzlichen Printings sind andere
                                // Karten, die der Nutzer bei der Gelegenheit miterfasst.
                                for (ep in e.extraPrintings) {
                                    val es = ep.selectedSet ?: continue
                                    CollectionRepository.addScanned(
                                        b, es.setCode, es.rarity, es.language, ep.edition, ep.condition, ep.quantity,
                                    )
                                }
                            } catch (ex: Exception) {
                                // Der Standort hat seinen eigenen catch darueber, also bleiben hier die
                                // zusaetzlichen Printings -- der einzige Schritt nach dem Anlegen, der
                                // noch ans Netz geht. Gemeldet wird beides getrennt: der Nutzer soll
                                // WISSEN, dass die Hauptkarte drin ist und ein Beidruck fehlt, statt es
                                // an einem falschen Bestand zu merken.
                                locationWarnings.add(
                                    "${b.name ?: b.id}: übernommen, zusätzliche Printings unvollständig " +
                                        "(${ex.message ?: "unbekannter Fehler"})",
                                )
                            } finally {
                                if (standortFehlte) ohneStandort.add(e) else committed.add(e)
                            }
                        }
                    } catch (ex: Exception) {
                        // Anhaengen statt ersetzen: scheitert ein spaeterer Eintrag am Netz, darf
                        // das die schon gesammelten Standort-Hinweise nicht verschlucken. Die
                        // Meldung wird unten mit ihnen zusammen gezeichnet.
                        locationWarnings.add(ex.message ?: "Übernehmen fehlgeschlagen")
                    } finally {
                        // Abschluss-Fixwelle, Important 1: was ANGELEGT ist, verlaesst die Liste und
                        // erreicht den Aufrufer IMMER -- auch wenn ein spaeterer Eintrag scheitert.
                        // Standen diese drei Zeilen im try, blieben die schon angelegten Karten nach
                        // einem Abriss mitten im Durchgang im Blatt stehen; der naechste Druck auf
                        // "Alle uebernehmen" legte sie ein ZWEITES Mal an, und die Reservierung
                        // landete auf dem neuen Exemplar -- doppelte Exemplare, zwei Karten in einem
                        // Fach, ohne jeden Hinweis. Im Einsortier-Modus ist das der Regelweg: dort
                        // kommt der Nutzer ohne geleertes Blatt gar nicht mehr hinaus.
                        entries.removeAll(committed)
                        entries.removeAll(ohneStandort)
                        error = if (locationWarnings.isEmpty()) null else locationWarnings.joinToString("\n")
                        // Der Aufrufer schliesst das Blatt nur bei leerer Hinweisliste -- sonst
                        // bliebe `error` (ein remember-Zustand DIESER Komposition) im selben
                        // Snapshot wie showSheet = false und wuerde nie gezeichnet.
                        onCommitted(committed.toList(), ohneStandort.toList(), locationWarnings.toList())
                        committing = false
                    }
                }
            },
            enabled = !committing && entries.isNotEmpty(),
            modifier = Modifier.fillMaxWidth().padding(12.dp),
        ) { Text(if (committing) "Übernehme…" else "Alle übernehmen (${entries.size})") }
    }
}

@Composable
private fun StagingRow(entry: ScanStagingEntry, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Traffic-light dot (Spec D3 Task 7): DISPLAYS entry.confidence, computed
                // upstream by ScanConfidence via ScanScreen -- see ScanStagingLogic.dotColor.
                Box(
                    Modifier.size(10.dp).clip(CircleShape)
                        .background(ScanStagingLogic.dotColor(entry.confidence?.light, LocalAppRoles.current)),
                )
                Spacer(Modifier.width(8.dp))
                AsyncImage(model = entry.base?.imageUrl, contentDescription = entry.base?.name,
                    modifier = Modifier.width(48.dp).height(70.dp).clip(RoundedCornerShape(6.dp)))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(entry.base?.name ?: "Passcode ${entry.passcode}",
                        style = MaterialTheme.typography.titleMedium, color = OnSurface, maxLines = 2)
                    if (entry.loading) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.width(12.dp).height(12.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(6.dp))
                            Text("lädt…", style = MaterialTheme.typography.labelSmall, color = Muted)
                        }
                    } else {
                        Text(entry.passcode, style = MaterialTheme.typography.labelSmall,
                            fontFamily = MonoFontFamily, color = Muted)
                        // Reason as a subtitle -- read straight off ScanConfidence (German
                        // already), never paraphrased here. `null` exactly for GREEN (see
                        // ScanConfidence.Result's own doc), so nothing renders for a green card.
                        entry.confidence?.reason?.let { reason ->
                            Text(reason, style = MaterialTheme.typography.labelSmall, color = Muted, maxLines = 1)
                        }
                    }
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, "Entfernen", tint = MaterialTheme.colorScheme.error)
                }
            }
            Spacer(Modifier.height(8.dp))
            // Primary printing. Any hand edit here (set/rarity/language via SetPicker, edition via
            // CopyChip) marks the entry `userTouched`, so silent improvement stops updating it.
            Row(verticalAlignment = Alignment.CenterVertically) {
                SetPicker(
                    entry.knownSets, entry.selectedSet,
                    { entry.userTouched = true; entry.selectedSet = it },
                    Modifier.weight(1f),
                )
                Spacer(Modifier.width(6.dp))
                CopyChip(entry.edition, entry.condition) { e, c ->
                    if (e != entry.edition) entry.userTouched = true
                    entry.edition = e; entry.condition = c
                }
                Spacer(Modifier.width(8.dp))
                QtyStepper(entry.quantity) { entry.quantity = it }
            }
            // Extra printings of the same card.
            entry.extraPrintings.forEach { ep ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SetPicker(entry.knownSets, ep.selectedSet, { ep.selectedSet = it }, Modifier.weight(1f))
                    Spacer(Modifier.width(6.dp))
                    CopyChip(ep.edition, ep.condition) { e, c -> ep.edition = e; ep.condition = c }
                    Spacer(Modifier.width(8.dp))
                    QtyStepper(ep.quantity) { ep.quantity = it }
                    IconButton(onClick = { entry.extraPrintings.remove(ep) }) {
                        Icon(Icons.Default.Delete, "Entfernen", tint = Muted)
                    }
                }
            }
            TextButton(onClick = { entry.extraPrintings.add(ExtraPrinting().apply { edition = entry.edition; condition = entry.condition }) }) {
                Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(4.dp))
                Text("Weitere Druckvariante", color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun QtyStepper(qty: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { if (qty > 1) onChange(qty - 1) }) {
            Icon(Icons.Default.Remove, "−", tint = MaterialTheme.colorScheme.primary)
        }
        Text("$qty", fontFamily = MonoFontFamily, color = OnSurface)
        IconButton(onClick = { onChange(qty + 1) }) {
            Icon(Icons.Default.Add, "+", tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun SetPicker(
    knownSets: List<SetOption>,
    current: SetOption?,
    onSelect: (SetOption?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val label = current?.let { "${langFlag(it.language)} ${it.setCode} · ${it.rarity}" } ?: "Unbekannt (bitte wählen)"

    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().clickable(enabled = knownSets.isNotEmpty()) { expanded = true }
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium,
                color = if (current != null) OnSurface else Muted, modifier = Modifier.weight(1f))
            Icon(Icons.Default.ArrowDropDown, "Auswählen", tint = Muted)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("Unbekannt") },
                onClick = { onSelect(null); expanded = false },
            )
            knownSets.forEachIndexed { i, s ->
                // Thin divider between the language groups (DE | EN | JP).
                if (i > 0 && knownSets[i - 1].language != s.language) HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("${langFlag(s.language)} ${s.setCode} · ${s.rarity}") },
                    onClick = { onSelect(s); expanded = false },
                )
            }
        }
    }
}
