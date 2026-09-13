package com.example.yugiohscanner.ml

/**
 * Wie viel muss die Behaelterliste nach einem Schreibvorgang neu laden?
 *
 * Die Frage steht hier und NUR hier. Verstreute `if`s in der Oberflaeche waren in Spec B1 zweimal
 * die Ursache echten Datenverlusts; und "zu wenig neu laden" ist genau dieselbe Art Fehler wie
 * "zu viel selbst entscheiden" -- der Bildschirm zeigt dann stumm einen Stand, den der Server
 * nicht mehr hat.
 *
 * Die Regel folgt dem, was `ContainersRepository.save()` TATSAECHLICH schreibt, nicht der Frage,
 * was sich aus Sicht des Nutzers geaendert hat. `save()` raeumt Seite und Fach aller Exemplare des
 * Behaelters, sobald die NEUE Art keine Faecher hat -- unabhaengig von der bisherigen Art. Das ist
 * auch der Weg, auf dem ein halb gescheiterter Artwechsel (Faecher geraeumt, Upsert abgebrochen)
 * beim zweiten Versuch mit derselben Art erst fertig wird; eine Regel "nur bei Artwechsel" saehe
 * genau diesen Fall nicht.
 *
 * Fall fuer Fall:
 * - **Neu angelegt**: der Behaelter hat noch keine Exemplare, auch das Raeumen trifft keine Zeile.
 *   Nur die Behaelter.
 * - **Neue Art ohne Faecher** (Box, Deckbox), bestehender Behaelter: `save()` raeumt -> alles.
 * - **Bisherige Art unbekannt** (bestehender Behaelter, aber nicht in der geladenen Liste): die
 *   Regel kann nichts ausschliessen -> alles. Nicht mit "neu" verwechseln, das ist ein eigener
 *   Parameter.
 * - **Art geaendert zu Ordner** (Box -> Ordner): raeumt heute nichts, wird aber trotzdem voll
 *   nachgeladen -- die sichere Seite; wer `save()` spaeter umdreht, muss hier nicht nachziehen.
 * - **Ordner bleibt Ordner** (umbenannt, Fachzahl 4 <-> 9 <-> 12): `save()` raeumt nichts; welche
 *   Exemplare in einem darstellbaren Fach liegen, rechnet `BinderGrid` aus den geladenen Zeilen.
 *   Nur die Behaelter.
 * - **Geloescht**: `ContainersRepository.delete()` raeumt den Behaelter aus allen Exemplaren -> alles.
 */
object ReloadScope {

    enum class Scope {
        /** Nur `ContainersRepository.list()` -- ein Aufruf ueber eine Handvoll Zeilen. */
        CONTAINERS_ONLY,

        /** Behaelter, Karten UND Exemplare. */
        EVERYTHING,
    }

    /**
     * Nach `ContainersRepository.save()`. `isNew`: der Behaelter wurde gerade angelegt.
     * `previousKind`: seine Art VOR dem Speichern, `null` wenn unbekannt (bei `isNew` ignoriert).
     */
    fun afterSave(isNew: Boolean, previousKind: String?, newKind: String): Scope = when {
        isNew -> Scope.CONTAINERS_ONLY
        newKind != "binder" -> Scope.EVERYTHING
        previousKind == null -> Scope.EVERYTHING
        previousKind != newKind -> Scope.EVERYTHING
        else -> Scope.CONTAINERS_ONLY
    }

    /** Nach `ContainersRepository.delete()` -- raeumt die Standorte der Exemplare mit. */
    fun afterDelete(): Scope = Scope.EVERYTHING
}
