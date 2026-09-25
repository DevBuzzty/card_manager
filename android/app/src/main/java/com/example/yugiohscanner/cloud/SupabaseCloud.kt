package com.example.yugiohscanner.cloud

import android.content.SharedPreferences
import com.example.yugiohscanner.BuildConfig
import com.example.yugiohscanner.ml.OfflineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    private var prefs: SharedPreferences? = null

    // Offline-Start (26.09.2026): Konto des gespeicherten Stands, solange die Anmeldung an der Verbindung scheitert.
    // userId() liefert es, damit der Kaltstart-Zwischenspeicher passt; token() wirft mit klarer Offline-Meldung.
    @Volatile private var offlineAccount: String? = null
    private val _offline = MutableStateFlow(false)
    val offline: StateFlow<Boolean> = _offline.asStateFlow()

    // Zuletzt erfolgreich angemeldetes Konto und seine E-Mail (Grundlage für den Offline-Start).
    fun savedAccount(p: SharedPreferences): String? = p.getString("last_account_id", null)
    fun savedEmail(p: SharedPreferences): String? = p.getString("last_account_email", null)
    fun email(): String = email

    fun startOffline(account: String) { offlineAccount = account; _offline.value = true }

    // The project URL and the publishable key are build config (local.properties); the prefs only
    // override them when the user pointed the app at a different project under "Erweitert".
    private fun cfgUrl(prefs: SharedPreferences): String =
        (prefs.getString("supabase_url", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_URL)
            .trim().trimEnd('/').removeSuffix("/rest/v1")

    private fun cfgKey(prefs: SharedPreferences): String =
        (prefs.getString("supabase_key", "")?.takeIf { it.isNotBlank() } ?: BuildConfig.SUPABASE_KEY).trim()

    fun isConfigured(prefs: SharedPreferences): Boolean =
        cfgUrl(prefs).isNotBlank() && cfgKey(prefs).isNotBlank() &&
            !prefs.getString("supabase_email", "").isNullOrBlank()

    fun init(prefs: SharedPreferences) {
        this.prefs = prefs
        baseUrl = cfgUrl(prefs)
        apiKey = cfgKey(prefs)
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
            offlineAccount = null
            _offline.value = false
            jwtSubject(token)?.let { id -> prefs?.edit()?.putString("last_account_id", id)?.putString("last_account_email", email)?.apply() }
        }
    }

    // Drops the session: the live token AND the credentials it was minted from, so nothing can
    // keep writing to the account after "Abmelden". A later login re-fills them via init(prefs).
    fun signOut() {
        accessToken = null
        offlineAccount = null
        _offline.value = false
        email = ""
        password = ""
    }

    /**
     * Nutzer-ID des angemeldeten Kontos (JWT `sub`), `null` ohne Anmeldung. Schluessel des
     * Kaltstart-Zwischenspeichers -- ein gespeicherter Stand eines anderen Kontos wird nie gezeigt.
     */
    fun userId(): String? = accessToken?.let(::jwtSubject) ?: offlineAccount

    internal fun jwtSubject(token: String): String? = runCatching {
        val payload = token.split('.')[1]
        val json = String(java.util.Base64.getUrlDecoder().decode(payload.padEnd((payload.length + 3) / 4 * 4, '=')))
        JSONObject(json).optString("sub").takeIf { it.isNotBlank() }
    }.getOrNull()

    internal fun http(): OkHttpClient = client
    internal fun base(): String = baseUrl
    internal fun key(): String = apiKey
    internal fun token(): String = accessToken
        ?: throw RuntimeException(if (offlineAccount != null) OfflineStart.WRITE_OFFLINE else "Nicht eingeloggt")
}
