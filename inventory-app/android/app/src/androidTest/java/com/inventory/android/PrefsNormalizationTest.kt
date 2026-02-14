package com.inventory.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.Prefs
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PrefsNormalizationTest {
  @Before
  fun clear() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    runBlocking { Prefs(context).clearAll() }
  }

  @Test
  fun setPairing_prependsHttpWhenMissingScheme() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val prefs = Prefs(context)

    prefs.setPairing("192.168.1.10:3000", "t")
    assertEquals("http://192.168.1.10:3000", prefs.baseUrlFlow.first())
  }
}
