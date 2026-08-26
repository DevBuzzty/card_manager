package com.example.yugiohscanner.cloud

import android.content.SharedPreferences
import io.github.jan.supabase.createSupabaseClient
// NOTE: supabase-kt 2.6.0 ships the Auth plugin under artifact "auth-kt" but the package name
// has historically stayed "io.github.jan.supabase.gotrue" (renamed from the old gotrue-kt module).
// If these three imports don't resolve, try "io.github.jan.supabase.auth.*" instead (Auth / auth / providers.builtin.Email).
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.builtin.Email
import io.github.jan.supabase.postgrest.Postgrest

object SupabaseCloud {
    private var client: io.github.jan.supabase.SupabaseClient? = null
    private var email: String = ""
    private var password: String = ""

    fun isConfigured(prefs: SharedPreferences): Boolean =
        !prefs.getString("supabase_url", "").isNullOrBlank() &&
        !prefs.getString("supabase_key", "").isNullOrBlank() &&
        !prefs.getString("supabase_email", "").isNullOrBlank()

    fun init(prefs: SharedPreferences) {
        val url = prefs.getString("supabase_url", "")!!.trim()
        val key = prefs.getString("supabase_key", "")!!.trim()
        email = prefs.getString("supabase_email", "")!!.trim()
        password = prefs.getString("supabase_password", "")!!
        client = createSupabaseClient(url, key) {
            install(Auth)
            install(Postgrest)
        }
    }

    suspend fun signIn() {
        // NOTE: signature of Auth.signInWith is version-sensitive; some versions expect
        // signInWith(Email) { email = ...; password = ... } as below, others use a builder
        // taking a lambda on a dedicated receiver. If this doesn't resolve, let Android
        // Studio's autocomplete on `client!!.auth.signInWith(Email)` show the exact shape.
        client!!.auth.signInWith(Email) { this.email = SupabaseCloud.email; this.password = SupabaseCloud.password }
    }

    fun db(): Postgrest = client!!.pluginManager.getPlugin(Postgrest)
}
