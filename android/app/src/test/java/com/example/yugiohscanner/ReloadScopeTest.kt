package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ReloadScope
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Regel, wie viel die Behaelterliste nach einem Schreibvorgang neu laden muss. Sie steht an
 * EINER Stelle, weil verstreute Entscheidungen dieser Art in Spec B1 zweimal Datenverlust
 * verursacht haben -- und weil "zu wenig neu laden" denselben Schaden anrichtet: der Bildschirm
 * zeigt stumm einen Stand, den der Server nicht mehr hat.
 */
class ReloadScopeTest {

    @Test fun `ein neuer Behaelter aendert keine Exemplare`() {
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave(true, null, "binder"))
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave(true, null, "box"))
    }

    @Test fun `Ordner bleibt Ordner - umbenannt oder andere Fachzahl`() {
        // save() raeumt nichts, und welche Exemplare in einem darstellbaren Fach liegen, rechnet
        // BinderGrid aus den bereits geladenen Zeilen.
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave(false, "binder", "binder"))
    }

    @Test fun `Art aendern raeumt Seite und Fach, also alles neu laden`() {
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave(false, "binder", "box"))
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave(false, "binder", "deckbox"))
    }

    @Test fun `auch der Rueckweg zur Ordnerart laedt alles neu`() {
        // Heute raeumt nur eine Art ohne Faecher tatsaechlich. Die sichere Seite, siehe ReloadScope.
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave(false, "box", "binder"))
    }

    @Test fun `Box bleibt Box - save raeumt trotzdem, also alles neu laden`() {
        // save() raeumt nach der NEUEN Art. So wird ein halb gescheiterter Wechsel Ordner -> Box
        // beim zweiten Versuch fertig -- und genau dann aendern sich Exemplare.
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave(false, "box", "box"))
    }

    @Test fun `unbekannte bisherige Art ist nicht dasselbe wie neu`() {
        // Bestehender Behaelter, der nicht in der geladenen Liste stand.
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave(false, null, "binder"))
    }

    @Test fun `Loeschen raeumt die Standorte, also alles neu laden`() {
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterDelete())
    }
}
