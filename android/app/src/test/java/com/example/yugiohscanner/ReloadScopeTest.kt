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
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave(null, "binder"))
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave(null, "box"))
    }

    @Test fun `Umbenennen laesst die Art unveraendert`() {
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave("binder", "binder"))
    }

    @Test fun `Fachzahl aendern ist kein Artwechsel`() {
        // 4 -> 9 Faecher: save() raeumt nichts, und welche Exemplare in einem darstellbaren Fach
        // liegen, rechnet BinderGrid aus den bereits geladenen Zeilen.
        assertEquals(ReloadScope.Scope.CONTAINERS_ONLY, ReloadScope.afterSave("binder", "binder"))
    }

    @Test fun `Art aendern raeumt Seite und Fach, also alles neu laden`() {
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave("binder", "box"))
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave("binder", "deckbox"))
    }

    @Test fun `auch der Rueckweg zur Ordnerart laedt alles neu`() {
        // Heute raeumt nur der Weg WEG von "binder" tatsaechlich. Die Regel bleibt trotzdem
        // symmetrisch -- die sichere Seite, siehe ReloadScope.
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterSave("box", "binder"))
    }

    @Test fun `Loeschen raeumt die Standorte, also alles neu laden`() {
        assertEquals(ReloadScope.Scope.EVERYTHING, ReloadScope.afterDelete())
    }
}
