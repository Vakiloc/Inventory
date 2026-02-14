package com.inventory.android

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityNavigationTest {
  @Before
  fun resetState() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    runBlocking {
      Prefs(context).clearAll()
    }
    AppDatabase.resetForTests(context)
  }

  @Test
  fun smoke_launchesMainActivity() {
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      scenario.moveToState(Lifecycle.State.CREATED)
    }
  }

  @Test
  fun navigationLogic_startRouteDependsOnPairing() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val prefs = Prefs(context)
    val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()

    try {
      val repo = InventoryRepository(db, prefs) { throw UnsupportedOperationException("api not used") }
      assertEquals("mode", computeStartRoute(repo, prefs))

      prefs.setPairing("http://127.0.0.1:3000", "test")
      assertEquals("home", computeStartRoute(repo, prefs))
    } finally {
      db.close()
    }
  }
}
