package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

/**
 * Spec §3.3: steht zwischen Anmeldung und App, bis Karten, Exemplare und Behaelter geladen sind.
 * Eine halb gefuellte App gibt es nicht -- scheitert das Laden, bleibt es bei Meldung und
 * "Erneut versuchen" (und "Abmelden", damit ein falsches Konto nicht festhaelt).
 */
@Composable
fun StartupLoadingScreen(state: StoreState, onRetry: () -> Unit, onLogout: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (state is StoreState.Failed) {
                Text("Sammlung konnte nicht geladen werden", style = MaterialTheme.typography.titleMedium, color = OnSurface)
                Spacer(Modifier.height(8.dp))
                Text(state.message, style = MaterialTheme.typography.bodySmall, color = ErrorColor, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                Button(onClick = onRetry) { Text("Erneut versuchen") }
                TextButton(onClick = onLogout) { Text("Abmelden", color = Muted) }
            } else {
                CircularProgressIndicator(color = Primary)
                Spacer(Modifier.height(16.dp))
                Text("Sammlung wird geladen …", style = MaterialTheme.typography.bodyMedium, color = OnSurface)
            }
        }
    }
}
