package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.ml.SaleFlow
import com.example.yugiohscanner.ui.theme.ErrorColor

/**
 * Spec I §5.2 Punkt 6 -- Fehlermeldung als Zeile an der Stelle, an der sie entsteht, mit einer Handlung,
 * die sie behebt (SaleFlow.validateSale/validateListing liefern Text und Abhilfe). Gegenstueck zu
 * desktop/src/components/FieldErrors.jsx.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FieldErrors(errors: List<SaleFlow.FieldError>, onFix: (SaleFlow.Fix) -> Unit) {
    if (errors.isEmpty()) return
    Column {
        errors.forEach { e ->
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.Center) {
                Text(e.text, color = ErrorColor, style = MaterialTheme.typography.bodySmall, modifier = androidx.compose.ui.Modifier.align(Alignment.CenterVertically))
                e.fix?.let { fix -> TextButton(onClick = { onFix(fix) }) { Text(fix.label) } }
            }
        }
    }
}
