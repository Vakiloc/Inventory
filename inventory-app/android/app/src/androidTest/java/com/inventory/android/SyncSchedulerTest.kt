package com.inventory.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.inventory.android.sync.SyncScheduler
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncSchedulerTest {
  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    WorkManagerTestInitHelper.initializeTestWorkManager(context)
  }

  @Test
  fun schedulePeriodic_enqueuesUniqueWork() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    SyncScheduler.schedulePeriodic(context)

    val infos = WorkManager.getInstance(context)
      .getWorkInfosForUniqueWork("inventory-sync-periodic")
      .get()

    assertTrue(infos.isNotEmpty())
    assertTrue(infos.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING })
  }
}
