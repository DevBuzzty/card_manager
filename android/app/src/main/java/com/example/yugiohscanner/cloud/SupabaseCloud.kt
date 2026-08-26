package com.example.yugiohscanner.cloud

import android.content.SharedPreferences
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.Postgrest

object SupabaseCloud {
    private var supabase: SupabaseClient? = null
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
        supabase = createSupabaseClient(url, key) {
            install(Auth)
            install(Postgrest)
        }
    }

    suspend fun signIn() {
        supabase!!.auth.signInWith(Email) {
            this.email = SupabaseCloud.email
            this.password = SupabaseCloud.password
        }
    }

    fun client(): SupabaseClient = supabase!!
}
