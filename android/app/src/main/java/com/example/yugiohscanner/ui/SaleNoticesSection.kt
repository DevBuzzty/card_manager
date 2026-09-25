package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.EbayRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SaleNotices
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Warn
import kotlinx.coroutines.launch

private const val DISMISS_ERROR = "Wegtippen braucht die Cloud-Verbindung – bitte später erneut."

/**
 * Spec H3b §7.6 (H3b2) -- offene eBay-Hinweise mit „Erledigt“. Start (`full = false`): Karte nur bei offenen Hinweisen,
 * höchstens drei, „Alle“ öffnet die Angebote. Angebote (`full = true`): Banner mit allen Hinweisen.
 * Wegtippen nimmt den Hinweis sofort aus dem Zwischenspeicher (Muster PriceAlertsSection); scheitert es, wird neu geladen.
 */
@Composable
fun SaleNoticesSection(full: Boolean, onOpenAll: (() -> Unit)?) {
    val cacheState by SideStores.saleNotices.state.collectAsState()
    LaunchedEffect(Unit) { SideStores.saleNotices.refreshIfStale() }
    val notices = cacheState.value
    if (notices.isNullOrEmpty()) return
    val scope = rememberCoroutineScope()
    var actionError by remember { mutableStateOf<String?>(null) }
    val shown = if (full) notices else notices.take(3)

    val body: @Composable ColumnScope.() -> Unit = {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (full) Text(SaleNotices.title(notices.size), color = Muted, style = MaterialTheme.typography.labelSmall)
            else SectionHeader(SaleNotices.title(notices.size))
            Spacer(Modifier.weight(1f))
            if (onOpenAll != null) {
                Text("Alle", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.clickable { onOpenAll() }.padding(4.dp))
            }
        }
        actionError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor) }
        shown.forEachIndexed { i, n ->
            if (i > 0) HorizontalDivider(color = Line)
            NoticeRow(n) {
                SideStores.saleNotices.update { list -> list.filterNot { it.noticeId == n.noticeId } }
                scope.launch {
                    try { EbayRepository.dismissNotice(n.noticeId); actionError = null }
                    catch (e: Exception) { actionError = DISMISS_ERROR; SideStores.saleNotices.refresh() }
                }
            }
        }
    }
    if (full) {
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp).border(1.dp, Warn.copy(alpha = 0.4f), RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp), content = body)
    } else {
        SpaceCard(Modifier.fillMaxWidth()) { Column(Modifier.fillMaxWidth().padding(16.dp), content = body) }
    }
}

@Composable
private fun NoticeRow(n: SaleNotices.Notice, onDismiss: () -> Unit) {
    val l = SaleNotices.label(n.kind)
    val tint = when (l.tone) { "bad" -> ErrorColor.copy(alpha = 0.2f); "warn" -> Warn.copy(alpha = 0.15f); else -> null }
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val chip = Modifier.clip(RoundedCornerShape(4.dp))
        Text(l.label, color = OnSurface, style = MaterialTheme.typography.labelSmall,
            modifier = (if (tint != null) chip.background(tint) else chip.border(1.dp, Line, RoundedCornerShape(4.dp)))
                .padding(horizontal = 6.dp, vertical = 2.dp))
        Text(n.text, color = OnSurface, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        TextButton(onClick = onDismiss) { Text("Erledigt") }
    }
}

/** Marke „Gebühren vorläufig“ (Verkaufsliste und -detail), Ton wie die übrigen Marken. */
@Composable
fun FeesProvisionalBadge(text: String) {
    Text(text, color = OnSurface, style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Warn.copy(alpha = 0.15f)).padding(horizontal = 6.dp, vertical = 1.dp))
}
