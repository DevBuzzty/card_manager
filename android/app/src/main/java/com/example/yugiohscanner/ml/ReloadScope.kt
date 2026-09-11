package com.example.yugiohscanner.ml

/**
 * Wie viel muss die Behaelterliste nach einem Schreibvorgang neu laden?
 *
 * Die Frage steht hier und NUR hier. Verstreute `if`s in der Oberflaeche waren in Spec B1 zweimal
 * die Ursache echten Datenverlusts; und "zu wenig neu laden" ist genau dieselbe Art Fehler wie
 * "zu viel selbst entscheiden" -- der Bildschirm zeigt dann stumm einen Stand, den der Server
 * nicht mehr hat.
 *
 * Die Regel, und ihre Begruendung Fall fuer Fall:
 * - **Neu angelegt oder umbenannt**: weder Karten noch Exemplare aendern sich. Nur die Behaelter.
 * - **Fachzahl geaendert** (4 <-> 9 <-> 12): `ContainersRepository.save()` raeumt dabei nichts;
 *   welche Exemplare in einem darstellbaren Fach liegen, rechnet `BinderGrid` aus den bereits
 *   geladenen Zeilen. Also ebenfalls nur die Behaelter.
 * - **Art geaendert** (Ordner -> Box): `ContainersRepository.save()` raeumt Seite und Fach ALLER
 *   Exemplare dieses Behaelters. Die Exemplare aendern sich -> alles.
 * - **Geloescht**: `ContainersRepository.delete()` raeumt zusaetzlich den Behaelter selbst aus
 *   allen Exemplaren. Die Exemplare aendern sich -> alles.
 *
 * Die Artaenderung wird bewusst in BEIDE Richtungen voll nachgeladen, obwohl heute nur der Weg
 * WEG von "binder" tatsaechlich raeumt (`save()` raeumt, wenn die neue Art keine Faecher hat).
 * Das ist die sichere Seite derselben Regel: wer sie spaeter umdreht, soll nicht zusaetzlich
 * daran denken muessen, hier nachzuziehen.
 */
object ReloadScope {

    enum class Scope {
        /** Nur `ContainersRepository.list()` -- ein Aufruf ueber eine Handvoll Zeilen. */
        CONTAINERS_ONLY,

        /** Behaelter, Karten UND Exemplare. */
        EVERYTHING,
    }

    /**
     * Nach `ContainersRepository.save()`. `previousKind` ist die Art, die der Behaelter VOR dem
     * Speichern hatte, oder `null`, wenn er gerade erst angelegt wurde.
     */
    fun afterSave(previousKind: String?, newKind: String): Scope =
        if (previousKind != null && previousKind != newKind) Scope.EVERYTHING else Scope.CONTAINERS_ONLY

    /** Nach `ContainersRepository.delete()` -- raeumt die Standorte der Exemplare mit. */
    fun afterDelete(): Scope = Scope.EVERYTHING
}
