package com.inventory.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.i18n.t
import kotlinx.coroutines.flow.first

@Composable
fun ScanScreen(
  repo: InventoryRepository,
  prefs: Prefs
) {
  val context = LocalContext.current
  val bootstrapped = remember { mutableStateOf(false) }
  val mode = remember { mutableStateOf<AppMode?>(null) }

  LaunchedEffect(Unit) {
    bootstrapped.value = prefs.bootstrappedFlow.first()
    mode.value = AppMode.fromRaw(prefs.appModeFlow.first())
  }

  Column(
    modifier = Modifier.fillMaxSize().padding(16.dp)
  ) {
    Text(t("home.scan.title"), style = MaterialTheme.typography.headlineSmall)
    Text(t("home.scan.hint"), style = MaterialTheme.typography.bodySmall)
    Spacer(Modifier.padding(8.dp))
    ScanPanel(
      repo = repo,
      bootstrapped = bootstrapped,
      isLocalOnly = mode.value == AppMode.LocalOnly
    )
  }
}
