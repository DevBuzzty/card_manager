package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.SupabaseCloud
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

@Composable
fun CloudLoginScreen(prefs: SharedPreferences, onReady: () -> Unit) {
    var email by remember { mutableStateOf(prefs.getString("supabase_email", "") ?: "") }
    var password by remember { mutableStateOf(prefs.getString("supabase_password", "") ?: "") }
    var url by remember { mutableStateOf(prefs.getString("supabase_url", "") ?: "") }
    var key by remember { mutableStateOf(prefs.getString("supabase_key", "") ?: "") }
    var advanced by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MaterialTheme.colorScheme.primary,
        unfocusedBorderColor = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
        SpaceCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(24.dp)) {
                Text("Card Dex", style = MaterialTheme.typography.headlineMedium, color = OnSurface)
                Text("Yu-Gi-Oh! Sammlung · Wert · Deals", style = MaterialTheme.typography.bodySmall, color = Muted)
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(email, { email = it }, label = { Text("E-Mail") },
                    colors = fieldColors, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(password, { password = it }, label = { Text("Passwort") },
                    colors = fieldColors, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth())
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error)
                }
                Spacer(Modifier.height(16.dp))
                Button(enabled = !busy && email.isNotBlank() && password.isNotBlank(), onClick = {
                    val editor = prefs.edit()
                        .putString("supabase_email", email.trim())
                        .putString("supabase_password", password)
                    if (url.isNotBlank()) editor.putString("supabase_url", url.trim())
                    if (key.isNotBlank()) editor.putString("supabase_key", key.trim())
                    editor.apply()
                    busy = true
                    error = null
                    scope.launch {
                        try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); onReady() }
                        catch (e: Exception) { error = e.message }
                        finally { busy = false }
                    }
                }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "Anmelden…" else "Anmelden")
                }
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { advanced = !advanced }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (advanced) "Erweitert ausblenden" else "Erweitert")
                }
                if (advanced) {
                    Text("Nur nötig, um ein anderes Supabase-Projekt zu verwenden.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(url, { url = it }, label = { Text("Projekt-URL") },
                        colors = fieldColors, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(key, { key = it }, label = { Text("Anon Key") },
                        colors = fieldColors, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}
