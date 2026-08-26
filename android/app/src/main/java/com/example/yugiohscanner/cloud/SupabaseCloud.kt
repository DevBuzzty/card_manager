package com.example.yugiohscanner.cloud

import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

// Holds the Supabase connection config and the current access token, and talks to
// Supabase over plain REST (OkHttp). Config comes from `scanner_prefs`.
object SupabaseCloud {
    private val client = OkHttpClient()
    val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private var baseUrl: String = ""
    private var apiKey: String = ""
    private var email: String = ""
    private var password: String = ""
    @Volatile private var accessToken: String? = null

    fun isConfigured(prefs: SharedPreferences): Boolean =
        !prefs.getString("supabase_url", "").isNullOrBlank() &&
        !prefs.getString("supabase_key", "").isNullOrBlank() &&
        !prefs.getString("supabase_email", "").isNullOrBlank()

    fun init(prefs: SharedPreferences) {
        // Accept a URL with or without a trailing slash / /rest/v1 suffix.
        baseUrl = prefs.getString("supabase_url", "")!!.trim().trimEnd('/').removeSuffix("/rest/v1")
        apiKey = prefs.getString("supabase_key", "")!!.trim()
        email = prefs.getString("supabase_email", "")!!.trim()
        password = prefs.getString("supabase_password", "")!!
        accessToken = null
    }

    // Sign in with email/password; throws on failure.
    suspend fun signIn() = withContext(Dispatchers.IO) {
        val payload = JSONObject().put("email", email).put("password", password).toString()
        val req = Request.Builder()
            .url("$baseUrl/auth/v1/token?grant_type=password")
            .addHeader("apikey", apiKey)
            .post(payload.toRequestBody(jsonMedia))
            .build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("Login fehlgeschlagen (${resp.code}): $text")
            val token = JSONObject(text).optString("access_token")
            if (token.isBlank()) throw RuntimeException("Login: kein access_token erhalten")
            accessToken = token
        }
    }

    internal fun http(): OkHttpClient = client
    internal fun base(): String = baseUrl
    internal fun key(): String = apiKey
    internal fun token(): String = accessToken ?: throw RuntimeException("Nicht eingeloggt")
}
