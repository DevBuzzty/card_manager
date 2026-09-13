package com.example.yugiohscanner.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll

/**
 * Spec §8: Nach unten ziehen loest `onRefresh` aus; der Kreisel bleibt, bis es fertig ist.
 * Material3 1.2.1 bringt dafuer nur Zustand und Behaelter mit (experimentell); `PullToRefreshBox`
 * gibt es erst spaeter -- deshalb dieser eigene Name, damit ein spaeteres Anheben nicht kollidiert.
 * Greift nur ueber scrollbarem Inhalt (verschachteltes Scrollen).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshableBox(onRefresh: suspend () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val state = rememberPullToRefreshState()
    val currentOnRefresh by rememberUpdatedState(onRefresh)
    if (state.isRefreshing) {
        LaunchedEffect(Unit) {
            try { currentOnRefresh() } finally { state.endRefresh() }
        }
    }
    Box(modifier.nestedScroll(state.nestedScrollConnection)) {
        content()
        PullToRefreshContainer(state = state, modifier = Modifier.align(Alignment.TopCenter))
    }
}
