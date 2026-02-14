package com.inventory.android

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.net.ApiService
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartRouteTest {
  private lateinit var db: AppDatabase
  private lateinit var prefs: Prefs

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    prefs = Prefs(context)
    runBlocking { prefs.clearAll() }

    db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun computeStartRoute_unpaired_goesToMode() = runBlocking {
    val repo = InventoryRepository(db, prefs) {
      throw UnsupportedOperationException("api not used")
    }
    assertEquals("mode", computeStartRoute(repo, prefs))
  }

  @Test
  fun computeStartRoute_paired_goesToHome() = runBlocking {
    prefs.setPairing("http://127.0.0.1:3000", "t")
    val repo = InventoryRepository(db, prefs) {
      throw UnsupportedOperationException("api not used")
    }
    assertEquals("home", computeStartRoute(repo, prefs))
  }
}
