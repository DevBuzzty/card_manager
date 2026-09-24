package com.example.yugiohscanner.ui

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Spec I §5.2 Punkt 4 -- eine app-weite Hinweis-/Rueckgaengig-Leiste (SnackbarHost in AppNav): bleibt sichtbar,
 * auch wenn das Blatt, das sie ausloest, sich schliesst; sechs Sekunden, eine zur Zeit (eine neue ersetzt die
 * alte). Gegenstueck zu desktop/src/components/Toast.jsx.
 */
object AppSnackbar {
    const val MS = 6_000L
    val hostState = SnackbarHostState()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var current: Job? = null

    fun show(text: String, actionLabel: String? = null, action: (suspend () -> Unit)? = null) {
        current?.cancel()
        hostState.currentSnackbarData?.dismiss()
        current = scope.launch {
            // Compose kennt nur Short/Long/Indefinite -- Indefinite plus eigener Zeitgeber ergibt genau sechs Sekunden.
            val result = withTimeoutOrNull(MS) {
                hostState.showSnackbar(text, actionLabel = actionLabel, withDismissAction = true, duration = SnackbarDuration.Indefinite)
            }
            if (result == SnackbarResult.ActionPerformed) action?.invoke()
        }
    }
}

/** Spec I §5.2 Punkt 5 -- "Angebot ansehen"/"Verkaufsliste ansehen" aus einem Blatt heraus: AppNav fuehrt den Sprung aus. */
object NavRequests {
    private val _flow = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val flow: SharedFlow<String> = _flow.asSharedFlow()
    fun open(route: String) { _flow.tryEmit(route) }
}

/**
 * Spec I §5.2 Punkt 3 -- "Sofort sichtbar": die Verkaufs-Vormerkung gilt in der Anzeige ab dem Tippen. Die
 * Ueberlagerung haelt copyId -> Wert, bis der Abgleich den echten Stand liefert (clear) oder das Schreiben
 * scheitert (clear, der alte Zustand erscheint wieder). Reine Anzeige -- geschrieben wird nur ueber
 * CollectionRepository.setForSale.
 */
object PendingForSale {
    private val _state = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val state: StateFlow<Map<String, Boolean>> = _state.asStateFlow()

    fun set(copyIds: Collection<String>, value: Boolean) { _state.value = _state.value + copyIds.associateWith { value } }
    fun clear(copyIds: Collection<String>) { _state.value = _state.value - copyIds.toSet() }
}
