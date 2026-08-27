package com.example.yugiohscanner.ui

import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.SupabaseCloud
import kotlinx.coroutines.launch

@Composable
fun CloudLoginScreen(prefs: SharedPreferences, onReady: () -> Unit) {
    var url by remember { mutableStateOf(prefs.getString("supabase_url", "") ?: "") }
    var key by remember { mutableStateOf(prefs.getString("supabase_key", "") ?: "") }
    var email by remember { mutableStateOf(prefs.getString("supabase_email", "") ?: "") }
    var password by remember { mutableStateOf(prefs.getString("supabase_password", "") ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Cloud-Login", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(url, { url = it }, label = { Text("Project URL") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(key, { key = it }, label = { Text("anon key") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("E-Mail") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Passwort") }, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = {
            prefs.edit()
                .putString("supabase_url", url.trim()).putString("supabase_key", key.trim())
                .putString("supabase_email", email.trim()).putString("supabase_password", password)
                .apply()
            scope.launch {
                try { SupabaseCloud.init(prefs); SupabaseCloud.signIn(); onReady() }
                catch (e: Exception) { error = e.message }
            }
        }, modifier = Modifier.fillMaxWidth()) { Text("Verbinden") }
    }
}
