package com.example.yugiohscanner.ui

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.tween
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.yugiohscanner.cloud.SetCodeMatch
import com.example.yugiohscanner.ml.ScanConfidence
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Spec B2 Task 1: die Erfassungslogik aus `ScanScreen` herausgeloest -- ein verhaltensgleicher
 * Umbau, keine neue Logik. Buendelt die Staging-Liste, `seen`, die Fortschrittsanzeige und die
 * vier Funktionen, die zuvor als lokale Funktionen in `ScanScreen` ineinandergriffen
 * (`stageScan`, `aggregateRepeat`, `sendScan`, `onCapture`).
 *
 * [socket], [connected] und [mode] werden als LAMBDA hineingereicht, nicht als Wert: alle drei
 * aendern sich waehrend der Lebensdauer dieser Klasse (Socket-Verbindung, PC-Status, Scan-Modus).
 * Ein einmal beim Erzeugen gelesener Wert wuerde einfrieren und mit jeder spaeteren Entscheidung
 * veralten -- in D4 fuehrte genau diese Falle (eine Entscheidung auf einem veralteten
 * Ladezustand) dazu, dass Seite und Fach eines Exemplars geloescht wurden.
 *
 * Kein ViewModel: `lifecycle-viewmodel-compose` ist nicht Teil dieses Projekts. Eine schlichte,
 * per `remember` gehaltene Klasse reicht.
 */
class ScanCapture(
    private val context: Context,
    private val scope: CoroutineScope,
    private val snackbar: SnackbarHostState,
    private val flash: Animatable<Float, AnimationVector1D>,
    private val socket: () -> Socket?,
    private val connected: () -> Boolean,
    private val mode: () -> String,
) {
    // Phone-side scan staging — a scan always lands here; a connected desktop additionally gets a
    // mirror of the scan (see onConfirmed in ScanScreen).
    val stagingCards = mutableStateListOf<ScanStagingEntry>()

    // Passcodes already captured this session (phone-staged OR sent to desktop). Dedup so panning
    // over a card captures it once and re-detections don't spam. Committed passcodes are dropped
    // again when a batch is taken over. Concurrent: the analyzer thread adds while the main thread
    // adds (manual entry) and removes.
    val seen: MutableSet<String> = ConcurrentHashMap.newKeySet()

    // Spec D4 §6.3: Fortschrittsanzeige bei verbundenem PC. `sentCount` zaehlt gesendete Karten
    // seit Scannerstart und wird von der Freigabe NICHT verringert -- es ist eine Fortschritts-,
    // keine Bestandsanzeige. `lastLight` ist die Ampel des zuletzt gesendeten Scans.
    var sentCount by mutableIntStateOf(0)
        private set
    var lastLight by mutableStateOf<ScanConfidence.Light?>(null)
        private set

    // Continuous scanning: each newly-seen card is captured automatically (screen blinks) — no
    // per-card Reset/Prüfen. `evidence` is this card's set-code candidates, voted per zone across
    // every frame it was visible (see SetCodeEvidence.setCodeCandidates / ZoneVote). The set code
    // is resolved from it by constrained matching against the card's known printings, not by
    // trusting a single clean OCR token.
    // Shared by autonomous ML detection (onConfirmed in ScanScreen) and manual passcode entry:
    // stage the card locally, then resolve its base data + set code, reporting failures via the
    // snackbar (the success path stays silent — the flash, sound and footer counter already
    // report it).
    // [framesEvidence] is one entry per SEPARATE frame (see SetCodeMatch.best's own doc on why
    // that's not the same list as [evidence]) — defaults to [evidence] for callers (manual entry)
    // that have no real per-frame breakdown to offer.
    // [editionTexts] is Spec D3 Task 7's addition: one EDITION-zone-text entry per frame (see
    // SetCodeEvidence.editionTexts), for the traffic light's edition signal. Defaults to empty for
    // callers (manual entry) that never OCR a zone at all — ScanConfidence.fromEvidence then
    // reports `edition = unknown`, the honest answer for "never looked".
    // [reservedContainer]/[reservedPage]/[reservedSlot] sind Spec B2 Task 5's Fach-Reservierung:
    // gesetzt nur vom Einsortier-Modus (siehe [stageLocally]), sonst null wie bisher. Sie werden
    // NACH dem `apply` gesetzt, nicht darin -- innerhalb von `apply` verdeckt der Empfaenger die
    // gleichnamigen Parameter, und `reservedPage = reservedPage` schriebe das Feld auf sich selbst.
    private fun stageScan(
        pc: String, evidence: List<String>, framesEvidence: List<String> = evidence,
        editionTexts: List<String> = emptyList(),
        reservedContainer: String? = null, reservedPage: Int? = null, reservedSlot: Int? = null,
    ): ScanStagingEntry {
        scope.launch { flash.snapTo(0.8f); flash.animateTo(0f, animationSpec = tween(300)) }
        val entry = ScanStagingEntry(System.nanoTime(), pc).apply {
            edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
            condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
        }
        entry.reservedContainerId = reservedContainer
        entry.reservedPage = reservedPage
        entry.reservedSlot = reservedSlot
        stagingCards.add(entry)
        scope.launch {
            try {
                val r = ScanResolver.resolve(
                    pc, evidence, framesEvidence, editionTexts,
                    com.example.yugiohscanner.Prefs.defaultEdition(context),
                )
                if (r == null) {
                    stagingCards.remove(entry); seen.remove(pc)   // eine spaetere Wiederholung erlauben
                    snackbar.showSnackbar("Karte $pc nicht gefunden")
                    return@launch
                }
                entry.base = r.base
                entry.knownSets = r.knownSets
                // .codeMatch bleibt liegen, damit eine spaetere, besser belegte Aufnahme sich damit
                // vergleichen kann (D3 Task 6, SetCodeEvidence.shouldSilentlyImprove) -- gegen die
                // SetOption allein ginge das nicht, sie traegt weder Distanz noch Frameanzahl.
                entry.codeMatch = r.match
                entry.selectedSet = r.match.selected
                entry.confidence = r.confidence
                entry.edition = r.confidence.effectiveEdition
                entry.loading = false
            } catch (e: Exception) {
                entry.loading = false
                snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
            }
        }
        return entry
    }

    /**
     * Spec B2 Task 7: der EINSORTIER-MODUS legt eine Karte ins Handy-Staging, die (noch) nicht in
     * der Sammlung ist -- mit dem Fach, in dem sie physisch bereits liegt (die Reservierung aus
     * Task 5). Ein schmaler, ausdruecklich benannter Einstieg neben [onCapture], und zwar aus zwei
     * Gruenden, die beide bindend sind:
     *
     * 1. **Er geht am Sendeweg vorbei.** [onCapture] prueft `connected()` und schickt den Scan bei
     *    verbundenem PC dorthin ([sendScan]). Der Einsortier-Modus stagt IMMER LOKAL und spiegelt
     *    nichts (Nachtrag §3, siehe den Kopfkommentar von `SortIntoBinderScreen`) -- deshalb hier
     *    direkt auf [stageScan], den lokalen Weg, ohne die Verbindungsfrage ueberhaupt zu stellen.
     * 2. **Er fasst [seen] nicht an.** Im Einsortier-Modus dedupliziert allein `BoxTracker`, eine
     *    Karte je Anwesenheit vor der Kamera. Zwei Exemplare derselben Karte gehen dort
     *    nacheinander in zwei verschiedene Faecher -- [seen] wuerde das zweite verschlucken.
     *
     * Es ist dieselbe Staging-Liste, derselbe Eintragstyp und derselbe Aufloeser wie sonst auch;
     * neu ist nur, dass der Eintrag ZURUECKGEGEBEN wird, damit der Aufrufer ihn wiedererkennt
     * (Rueckgaengig entfernt ihn ueber Identitaet).
     */
    fun stageLocally(
        pc: String, evidence: List<String>, framesEvidence: List<String>, editionTexts: List<String>,
        reservedContainer: String?, reservedPage: Int?, reservedSlot: Int?,
    ): ScanStagingEntry =
        stageScan(pc, evidence, framesEvidence, editionTexts, reservedContainer, reservedPage, reservedSlot)

    // Spec D4 §4: ein WIEDERHOLTES Erkennen derselben Karte im Modus "stapel". Kein Netz, kein
    // Katalog -- `entry.knownSets` steht bereits, `SetCodeMatch.best` laeuft direkt dagegen.
    // Wohin gebucht wird, entscheidet ScanAggregator (rein und getestet); hier wird nur gebucht.
    private fun aggregateRepeat(pc: String, evidence: List<String>, framesEvidence: List<String>, editionTexts: List<String>) {
        val entry = stagingCards.lastOrNull { it.passcode == pc } ?: run {
            // Review-Befund 2: der Eintrag kann fehlen, weil der Nutzer die ganze Karte im
            // Pruefen-Blatt geloescht hat -- ihr Passcode steht aber weiterhin in `seen`. Stiller
            // Ausstieg wuerde die Karte fuer den Rest der Sitzung kommentarlos unscannbar machen,
            // der schlechteste aller Ausgaenge. Stattdessen wie eine neue Erfassung behandeln.
            // (Nicht `onCapture` -- als Methode einer Klasse waere der gegenseitige Aufruf jetzt
            // technisch moeglich, aber ein verhaltensgleicher Umbau aendert den Kontrollfluss
            // nicht: der direkte Aufruf von `stageScan` bleibt bewusst bestehen, siehe `sendScan`
            // weiter unten fuer denselben Punkt.)
            // Fix M1: `editionTexts` wird durchgereicht statt durch `emptyList()` ersetzt -- sonst
            // loest dieser Rueckfall die Karte mit leerer Editions-Beleglage auf (edition =
            // unknown), waehrend derselbe Passcode ueber den `stageScan`-Zweig direkt daneben sie
            // mitbekommen haette.
            stageScan(pc, evidence, framesEvidence, editionTexts)
            return
        }
        // Anderes Aufblitzen als bei einer Neuaufnahme (die blitzt mit 0.8f), damit ein "+1"
        // im Sucher nicht wie eine neue Karte aussieht.
        scope.launch { flash.snapTo(0.45f); flash.animateTo(0f, animationSpec = tween(300)) }

        // Fix-Durchlauf 2, Restbefund: `SetCodeMatch.best` bleibt hier auf dem Analyzer-Hintergrund-
        // thread -- es liest nur `entry.knownSets`, das nach dem ersten Aufloesen nicht mehr
        // veraendert wird (siehe stageScan), und ist ein reiner Vergleich ueber eine kurze Liste
        // (kein Netz, keine Datenbank), verursacht auf dem Hauptthread also keine spuerbare
        // Blockade -- waere er aber trotzdem noetig gewesen.
        val match = SetCodeMatch.best(evidence, entry.knownSets, framesEvidence)
        val name = entry.base?.name ?: pc
        // Review-Befund 3: `entry.quantity++`/`--` und das ExtraPrinting-Aequivalent sind
        // Lesen-Aendern-Schreiben auf einem Feld, das der QtyStepper im Pruefen-Blatt (Hauptthread)
        // ebenfalls beschreibt -- diese Funktion selbst laeuft auf dem Analyzer-Hintergrundthread.
        // `scope` ist ein rememberCoroutineScope (Main); Buchung UND Ruecknahme laufen deshalb
        // beide hier drin, in Reihenfolge: erst buchen, dann die Snackbar mit der Folgemenge.
        scope.launch {
            // Fix-Durchlauf 2: der Eintrag kann inzwischen aus `stagingCards` verschwunden sein
            // (der Nutzer hat die ganze Karte im Pruefen-Blatt geloescht) -- dann darf gar nicht
            // erst gebucht werden. Dieselbe Identitaetspruefung wie bei der Ruecknahme unten.
            if (stagingCards.none { it === entry }) return@launch
            // Fix-Durchlauf 2 (Restfenster aus Fix-Durchlauf 1): `ScanAggregator.target(...)` --
            // und die von ihm gelesenen `entry.selectedSet`/`entry.extraPrintings` -- werden ERST
            // HIER ermittelt, im selben Hauptthread-Block wie die Benutzung direkt darunter, statt
            // vorher auf dem Analyzer-Hintergrundthread. Zwischen einer vorherigen Berechnung und
            // dieser Benutzung liegt ein Dispatch-Wechsel; in genau diesem Fenster kann das
            // Pruefen-Blatt eine Zusatzzeile oder die ganze Karte loeschen (es haelt weder Kamera
            // noch Analyzer an) und der Index von `target` traefe dann daneben. Kein Index
            // ueberlebt einen Threadwechsel -- dieselbe Regel wie Review-Befund 1, nur mit kuerzerem
            // Fenster.
            val target = ScanAggregator.target(
                primary = entry.selectedSet,
                extras = entry.extraPrintings.map { it.selectedSet },
                scanned = match.selected,
            )
            // Review-Befund 1: das Ziel wird HIER, sofort beim Buchen, zum OBJEKT aufgeloest, nicht
            // zum Index -- der Index kann zwischen Buchen und Rueckgaengig veralten (das
            // Pruefen-Blatt kann waehrenddessen eine Zusatzzeile oder die ganze Karte loeschen; das
            // Sheet haelt weder Kamera noch Analyzer an). `bookedExtra` haelt das getroffene bzw.
            // neu angelegte ExtraPrinting-Objekt fest; die Ruecknahme unten prueft per Identitaet
            // (===), ob es das noch gibt, statt es erneut zu indizieren.
            var bookedExtra: ExtraPrinting? = null
            var isNewExtra = false
            val menge = when (target) {
                is ScanAggregator.Target.Primary -> {
                    entry.quantity++
                    entry.quantity
                }
                is ScanAggregator.Target.Extra -> {
                    val ep = entry.extraPrintings[target.index]
                    ep.quantity++
                    bookedExtra = ep
                    ep.quantity
                }
                is ScanAggregator.Target.NewExtra -> {
                    val ep = ExtraPrinting().apply {
                        selectedSet = target.set
                        edition = com.example.yugiohscanner.Prefs.defaultEdition(context)
                        condition = com.example.yugiohscanner.Prefs.defaultCondition(context)
                    }
                    entry.extraPrintings.add(ep)
                    bookedExtra = ep
                    isNewExtra = true
                    1
                }
            }
            val r = snackbar.showSnackbar(
                message = "$name ×$menge", actionLabel = "rückgängig",
                duration = SnackbarDuration.Short,
            )
            if (r != SnackbarResult.ActionPerformed) return@launch
            when (target) {
                is ScanAggregator.Target.Primary ->
                    // `entry` selbst kann der Nutzer inzwischen aus der Liste geloescht haben.
                    if (stagingCards.any { it === entry }) entry.quantity--
                is ScanAggregator.Target.Extra, is ScanAggregator.Target.NewExtra -> {
                    val ep = bookedExtra ?: return@launch
                    // Ist die Zeile weg, hat der Nutzer sie selbst geloescht: Ruecknahme tut dann
                    // nichts und wirft nicht.
                    if (entry.extraPrintings.any { it === ep }) {
                        if (isNewExtra) entry.extraPrintings.remove(ep) else ep.quantity--
                    }
                }
            }
        }
    }

    // Spec D4 §6: fuehrt der PC das Staging, legt das Handy KEINEN Eintrag an -- es loest auf und
    // sendet. Erste Sichtung wie Wiederholung gehen denselben Weg; zusammengefasst wird am PC (§5).
    //
    // [isRepeat] dient nur der Rueckmeldung (§7) und dem Rueckfall, wenn die Verbindung waehrend
    // der Aufloesung wegbricht -- es geht selbst NICHT auf die Leitung. Der aktuelle `scanMode`
    // dagegen schon (siehe `sendScanToDesktop`, Spec-Fix I2): die urspruengliche Annahme, im Modus
    // "einzeln" koenne beim PC nie eine Wiederholung ankommen, war falsch -- `seen` unten haelt
    // eine Wiederholung nur ab, solange DIESER Scanner offen bleibt; ein Schliessen/Wiederoeffnen
    // loescht `seen`, waehrend die Staging-Liste des PCs bestehen bleibt. Der PC muss deshalb
    // selbst wissen, ob er zusammenfassen darf.
    //
    // Beschraenkung, die entfaellt: als lokale Funktionen konnten sich `stageScan`/`aggregateRepeat`
    // und `onCapture` nicht gegenseitig aufrufen, deshalb faellt diese Funktion unten direkt auf
    // die beiden anderen zurueck statt ueber `onCapture` zu gehen. Als Methoden dieser Klasse waere
    // der Aufruf ueber `onCapture` jetzt moeglich -- er bleibt trotzdem bewusst aussen vor: ein
    // verhaltensgleicher Umbau restrukturiert den Kontrollfluss nicht.
    private fun sendScan(
        pc: String, evidence: List<String>, framesEvidence: List<String>,
        editionTexts: List<String>, isRepeat: Boolean,
    ) {
        scope.launch {
            flash.snapTo(if (isRepeat) 0.45f else 0.8f)
            flash.animateTo(0f, animationSpec = tween(300))
        }
        scope.launch {
            try {
                val r = ScanResolver.resolve(
                    pc, evidence, framesEvidence, editionTexts,
                    com.example.yugiohscanner.Prefs.defaultEdition(context),
                )
                if (r == null) {
                    seen.remove(pc)   // eine spaetere Wiederholung erlauben
                    snackbar.showSnackbar("Karte $pc nicht gefunden")
                    return@launch
                }
                val s = socket()
                if (s == null || !connected()) {
                    // Die Verbindung ist waehrend der Aufloesung weggebrochen. Die Karte darf
                    // nicht verschwinden: sie kommt ins Handy-Staging, wohin sie ohne PC gehoert.
                    // Eine Wiederholung wird nur dann gebucht, wenn es ueberhaupt einen Eintrag
                    // gibt -- die frueheren Kopien liegen ja beim PC. Sonst wird sie ein eigener
                    // Eintrag, damit diese eine Karte nicht still verlorengeht.
                    if (isRepeat && stagingCards.any { it.passcode == pc }) {
                        aggregateRepeat(pc, evidence, framesEvidence, editionTexts)
                    } else {
                        stageScan(pc, evidence, framesEvidence, editionTexts)
                    }
                    return@launch
                }
                sendScanToDesktop(s, pc, r, mode())
                sentCount++
                lastLight = r.confidence.light
                if (isRepeat) {
                    // §7: bei verbundenem PC ist die Meldung NUR informativ -- kein Knopf.
                    // Korrigiert wird am PC, wo der Eintrag mit seinen +/--Knoepfen sichtbar in
                    // der Liste steht. Die neue Menge steht bewusst NICHT hier: sie zaehlt am PC,
                    // das Handy kennt sie nicht und darf sie nicht erfinden.
                    snackbar.showSnackbar("${r.base.name} nochmal an den PC")
                }
            } catch (e: Exception) {
                seen.remove(pc)
                snackbar.showSnackbar("Fehler beim Laden: ${e.message}")
            }
        }
    }

    // Der einzige Einstieg fuer eine erfasste Karte -- autonome Erkennung wie manuelle Eingabe.
    // Spec D4 §3: im Modus "einzeln" faengt `seen` jede Wiederholung ab (heutiges Verhalten);
    // im Modus "stapel" wird sie zusammengefasst.
    fun onCapture(pc: String, evidence: List<String>, frames: List<String>, editionTexts: List<String>) {
        val isRepeat = !seen.add(pc)
        if (isRepeat && mode() != "stapel") return
        if (connected()) {
            // §6: kein Handy-Staging. Erste Sichtung wie gewollte Wiederholung gehen an den PC,
            // der sie nach derselben Regel zusammenfasst (§5). `scanMode` reist als eigenes Feld
            // mit (siehe `sendScanToDesktop`, Spec-Fix I2) -- der PC braucht es, um im Modus
            // "einzeln" eine Wiederholung zu verwerfen statt sie zu buchen.
            sendScan(pc, evidence, frames, editionTexts, isRepeat)
        } else if (isRepeat) {
            aggregateRepeat(pc, evidence, frames, editionTexts)
        } else {
            stageScan(pc, evidence, frames, editionTexts)
        }
    }

    // Spec D4 §6.4 (staging_released vom PC) und die Sheet-Bestaetigung (onCommitted) teilen sich
    // denselben Zweck: eine Karte darf wieder gescannt werden, sobald sie anderswo uebernommen
    // oder verworfen wurde.
    fun forget(passcodes: Collection<String>) {
        seen.removeAll(passcodes.toSet())
    }
}

// Spec D3 Task 8, jetzt aus ResolvedScan statt aus einem Staging-Eintrag (Spec D4 §6.2): spiegelt
// die auf dem Handy BEREITS GEFAELLTE Entscheidung an den PC -- Set-Code, Rarity, Sprache, Edition,
// Ampel und deutscher Grund woertlich -- damit der PC dieselbe Vorauswahl zeigt, statt die
// Kandidaten selbst gegen eine Karte zu matchen, deren Bandtext er nie gesehen hat.
// Ein aelterer PC-Stand ignoriert die Felder, die er nicht kennt.
//
// Spec-Fix I2: dazu `mode` ("einzeln"/"stapel", woertlich wie am Handy). Die urspruengliche
// Annahme -- der PC brauche kein Modus-Feld, weil das Handy im Modus "einzeln" nie eine
// Wiederholung schickt -- ist widerlegt: `seen` (ScanCapture) lebt nur, solange der Scanner offen
// ist, die Staging-Liste des PCs ueberlebt ein Schliessen/Wiederoeffnen. Ohne das Feld zaehlte
// Modus "einzeln" bei verbundenem PC doppelt. Ein aelterer PC ignoriert auch dieses Feld.
private fun sendScanToDesktop(socket: Socket, pc: String, r: ResolvedScan, mode: String) {
    val data = JSONObject().put("passcode", pc)
    r.match.selected?.let {
        data.put("setCode", it.setCode)
        data.put("rarity", it.rarity)
        data.put("language", it.language)
    }
    if (r.match.candidates.isNotEmpty()) {
        data.put("setCodeCandidates", JSONArray(r.match.candidates.map { it.setCode }))
    }
    data.put("edition", r.confidence.effectiveEdition)
    data.put("editionConfidence", r.confidence.editionConfidence.name.lowercase(Locale.ROOT))
    data.put("confidence", r.confidence.light.name.lowercase(Locale.ROOT))
    data.put("reason", r.confidence.reason ?: JSONObject.NULL)
    data.put("mode", mode)
    socket.emit("card_scanned", data)
}
