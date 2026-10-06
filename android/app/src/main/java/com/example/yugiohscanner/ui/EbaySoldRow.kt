package com.example.yugiohscanner.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.EbaySold
import com.example.yugiohscanner.cloud.EbaySoldRepository
import com.example.yugiohscanner.ml.openWebLink
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import kotlinx.coroutines.launch
import java.util.Locale

/** eBay „zuletzt verkauft" E1 §8 -- Gegenstück zu desktop/src/components/EbaySoldRow.jsx; Text aus EbaySold.line. */
@Composable
fun EbaySoldRow(card: CardRow, initialAccess: String) {
    val key = "${card.id}|${card.setCode}|${card.language}|${card.rarity}"
    var access by remember(key) { mutableStateOf(initialAccess) }
    var row by remember(key) { mutableStateOf<EbaySold.SoldRow?>(null) }
    var loaded by remember(key) { mutableStateOf(false) }
    var open by remember(key) { mutableStateOf(false) }
    var busy by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    LaunchedEffect(key) {
        runCatching { EbaySoldRepository.load(card) }.onSuccess { row = it }
        loaded = true
    }
    if (!loaded) return
    val sales = row?.sales.orEmpty()
    Column {
        Row {
            Text(EbaySold.line(access, row) + if (sales.isEmpty()) "" else if (open) " ▾" else " ▸",
                style = MaterialTheme.typography.bodySmall, color = Muted,
                modifier = Modifier.weight(1f).clickable(enabled = sales.isNotEmpty()) { open = !open })
            if (EbaySold.canCheck(access)) {
                TextButton(enabled = !busy, onClick = {
                    scope.launch {
                        busy = true; error = null
                        runCatching { EbaySoldRepository.check(card) }
                            .onSuccess { (a, e) -> access = a; error = e }
                            .onFailure { error = it.message ?: "eBay-Abruf fehlgeschlagen." }
                        runCatching { EbaySoldRepository.load(card) }.onSuccess { row = it }
                        busy = false
                    }
                }) { Text(if (busy) "prüfe …" else "jetzt bei eBay prüfen", style = MaterialTheme.typography.labelSmall) }
            }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        if (open) sales.forEach { s ->
            Row(Modifier.padding(start = 8.dp).clickable(enabled = s.url != null) { openWebLink(ctx, s.url) }) {
                val d = if (s.soldAt.length >= 10) "${s.soldAt.substring(8, 10)}.${s.soldAt.substring(5, 7)}." else "–"
                Text(d, style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
                Spacer(Modifier.width(6.dp))
                Text(String.format(Locale.GERMANY, "%,.2f €", s.price), style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
                Spacer(Modifier.width(6.dp))
                Text((if (s.first) "1. Aufl. " else "") + s.title, style = MaterialTheme.typography.labelSmall, color = Muted, maxLines = 1)
            }
        }
    }
}
