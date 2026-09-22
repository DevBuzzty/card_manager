package com.example.yugiohscanner.ml

import android.content.Context
import android.content.Intent
import android.net.Uri

/** Abschluss-Fix Minor 3+4: nur http(s)-Links (Groß/Klein egal, getrimmt) gelten als Web-Link. */
private val WEB = Regex("^https?://\\S",RegexOption.IGNORE_CASE)
fun isWebLink(url: String?): Boolean = url != null && WEB.containsMatchIn(url.trim())

/** Öffnet [url] per ACTION_VIEW, aber nur, wenn [isWebLink]; sonst oder bei Fehlschlag false. */
fun openWebLink(ctx: Context, url: String?): Boolean {
    if (!isWebLink(url)) return false
    return runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url!!.trim()))) }.isSuccess
}
