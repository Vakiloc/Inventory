package com.inventory.android.i18n

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.InputStreamReader
import java.util.Locale
import androidx.compose.runtime.staticCompositionLocalOf

object I18n {
  private val gson = Gson()
  private val cache = mutableMapOf<String, Map<String, String>>()

  fun systemLocale(): String = Locale.getDefault().language.lowercase()

  private fun normalizeLocale(locale: String?): String {
    val raw = (locale ?: "").trim()
    if (raw.isBlank()) return "en"
    return raw.split('-', '_').firstOrNull()?.lowercase() ?: "en"
  }

  private fun loadBundle(context: Context, locale: String): Map<String, String> {
    val loc = normalizeLocale(locale)
    cache[loc]?.let { return it }

    fun tryLoad(path: String): Map<String, String>? {
      return try {
        context.assets.open(path).use { input ->
          val reader = InputStreamReader(input, Charsets.UTF_8)
          val type = object : TypeToken<Map<String, String>>() {}.type
          gson.fromJson<Map<String, String>>(reader, type)
        }
      } catch (_: Throwable) {
        null
      }
    }

    val bundle = tryLoad("i18n/$loc.json")
      ?: tryLoad("i18n/en.json")
      ?: emptyMap()

    cache[loc] = bundle
    return bundle
  }

  private fun format(template: String, params: Map<String, Any?>): String {
    var out = template
    for ((k, v) in params) {
      out = out.replace("{$k}", v?.toString() ?: "")
    }
    return out
  }

  fun t(
    context: Context,
    key: String,
    params: Map<String, Any?> = emptyMap(),
    localeOverride: String? = null
  ): String {
    val k = key.trim()
    if (k.isBlank()) return ""

    val loc = normalizeLocale(localeOverride ?: systemLocale())
    val bundle = loadBundle(context, loc)
    val en = loadBundle(context, "en")

    val msg = bundle[k] ?: en[k] ?: k
    return format(msg, params)
  }
}

// App-level locale override for Compose.
// If this is null, we fall back to the device locale.
val LocalAppLocale = staticCompositionLocalOf<String?> { null }

@Composable
fun t(key: String, vararg params: Pair<String, Any?>): String {
  val context = LocalContext.current
  val locale = LocalAppLocale.current
  val paramMap = remember(params) { params.toMap() }
  return remember(key, paramMap, locale) { I18n.t(context, key, paramMap, localeOverride = locale) }
}
