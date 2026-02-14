package com.inventory.android.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
  private const val UNIQUE_PERIODIC = "inventory-sync-periodic"
  private const val UNIQUE_ONEOFF = "inventory-sync-oneoff"

  fun schedulePeriodic(context: Context) {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()

    val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
      .setConstraints(constraints)
      .build()

    WorkManager.getInstance(context)
      .enqueueUniquePeriodicWork(UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
  }

  fun enqueueNow(context: Context) {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()

    val req = OneTimeWorkRequestBuilder<SyncWorker>()
      .setConstraints(constraints)
      .build()

    WorkManager.getInstance(context)
      .enqueueUniqueWork(UNIQUE_ONEOFF, ExistingWorkPolicy.REPLACE, req)
  }

  fun cancelAll(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_ONEOFF)
    WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC)
  }
}
