package com.inventory.android.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "inventory_prefs")

class Prefs(private val context: Context) {
  private object Keys {
    val baseUrl = stringPreferencesKey("base_url")
    val token = stringPreferencesKey("token")
    val inventoryId = stringPreferencesKey("inventory_id")
    val appMode = stringPreferencesKey("app_mode")
    val bootstrapped = booleanPreferencesKey("bootstrapped")
    val lastSyncMs = longPreferencesKey("last_sync_ms")
    val barcodeSinceMs = longPreferencesKey("barcode_since_ms")
    val itemsSinceMs = longPreferencesKey("items_since_ms")
    val locale = stringPreferencesKey("locale")
  }

  val baseUrlFlow: Flow<String?> = context.dataStore.data.map { it[Keys.baseUrl] }
  val tokenFlow: Flow<String?> = context.dataStore.data.map { it[Keys.token] }
  val inventoryIdFlow: Flow<String?> = context.dataStore.data.map { it[Keys.inventoryId] }
  val appModeFlow: Flow<String?> = context.dataStore.data.map { it[Keys.appMode] }
  val bootstrappedFlow: Flow<Boolean> = context.dataStore.data.map { it[Keys.bootstrapped] ?: false }
  val lastSyncMsFlow: Flow<Long> = context.dataStore.data.map { it[Keys.lastSyncMs] ?: 0L }
  val barcodeSinceMsFlow: Flow<Long> = context.dataStore.data.map { it[Keys.barcodeSinceMs] ?: 0L }
  val itemsSinceMsFlow: Flow<Long> = context.dataStore.data.map { it[Keys.itemsSinceMs] ?: 0L }
  val localeFlow: Flow<String?> = context.dataStore.data.map { it[Keys.locale] }

  suspend fun setLocale(locale: String?) {
    context.dataStore.edit {
      if (locale.isNullOrBlank()) it.remove(Keys.locale)
      else it[Keys.locale] = locale.trim().lowercase()
    }
  }

  suspend fun setPairing(baseUrl: String, token: String) {
    val rawBase = baseUrl.trim()
    val normalizedBase = if (rawBase.startsWith("http://") || rawBase.startsWith("https://")) {
      rawBase
    } else {
      "http://$rawBase"
    }

    context.dataStore.edit {
      it[Keys.baseUrl] = normalizedBase.removeSuffix("/")
      it[Keys.token] = token.trim()
    }
  }

  suspend fun setInventoryId(id: String?) {
    context.dataStore.edit {
      if (id.isNullOrBlank()) it.remove(Keys.inventoryId)
      else it[Keys.inventoryId] = id.trim()
    }
  }

  suspend fun resetSyncState() {
    context.dataStore.edit {
      it[Keys.bootstrapped] = false
      it[Keys.lastSyncMs] = 0L
      it[Keys.barcodeSinceMs] = 0L
      it[Keys.itemsSinceMs] = 0L
    }
  }

  suspend fun setAppMode(mode: AppMode) {
    context.dataStore.edit { it[Keys.appMode] = mode.raw }
  }

  suspend fun clearAppMode() {
    context.dataStore.edit { it.remove(Keys.appMode) }
  }

  suspend fun setBootstrapped(value: Boolean) {
    context.dataStore.edit { it[Keys.bootstrapped] = value }
  }

  suspend fun setLastSyncMs(value: Long) {
    context.dataStore.edit { it[Keys.lastSyncMs] = value }
  }

  suspend fun setBarcodeSinceMs(value: Long) {
    context.dataStore.edit { it[Keys.barcodeSinceMs] = value }
  }

  suspend fun setItemsSinceMs(value: Long) {
    context.dataStore.edit { it[Keys.itemsSinceMs] = value }
  }

  suspend fun clearAll() {
    context.dataStore.edit { it.clear() }
  }
}
