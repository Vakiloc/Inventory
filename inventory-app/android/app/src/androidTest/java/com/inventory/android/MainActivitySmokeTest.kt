package com.inventory.android

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivitySmokeTest {
  @Test
  fun mainActivity_launches() {
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      // Some connected devices/emulators may keep the scenario STOPPED (e.g. locked screen).
      // This is still a useful smoke test: the activity must launch without crashing.
      scenario.moveToState(Lifecycle.State.CREATED)
    }
  }
}
