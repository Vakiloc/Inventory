package com.inventory.android.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.net.ApiClient
import kotlinx.coroutines.flow.first
import java.io.IOException

class SyncWorker(
  appContext: Context,
  params: WorkerParameters
) : CoroutineWorker(appContext, params) {

  override suspend fun doWork(): Result {
    val prefs = Prefs(applicationContext)
    val db = AppDatabase.get(applicationContext)

    val apiClient = ApiClient(
      context = applicationContext,
      baseUrlProvider = { prefs.baseUrlFlow.first() },
      tokenProvider = { prefs.tokenFlow.first() },
      inventoryIdProvider = { prefs.inventoryIdFlow.first() },
      localeProvider = { prefs.localeFlow.first() }
    )

    val repo = InventoryRepository(db, prefs, apiClient)

    val mode = AppMode.fromRaw(prefs.appModeFlow.first())
    if (mode == AppMode.LocalOnly) return Result.success()

    val paired = repo.isPaired()
    if (!paired) return Result.success()

    return try {
      // If auth is broken, fail fast (no point retrying forever)
      val health = repo.pingDesktop()
      if (health.isFailure) {
        val msg = health.exceptionOrNull()?.message?.lowercase() ?: ""
        if (msg.contains("unauthorized") || msg.contains("401")) return Result.failure()
        return Result.retry()
      }

      val r = repo.syncOnce()
      if (r.isSuccess) Result.success() else Result.retry()
    } catch (e: Exception) {
      if (e is IOException) return Result.retry()
      val msg = e.message?.lowercase() ?: ""
      if (msg.contains("unauthorized") || msg.contains("401")) return Result.failure()
      Result.retry()
    }
  }
}
