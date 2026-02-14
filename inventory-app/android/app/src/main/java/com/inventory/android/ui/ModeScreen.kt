package com.inventory.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.Prefs
import com.inventory.android.sync.SyncScheduler
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t
import kotlinx.coroutines.launch

@Composable
fun ModeScreen(
  prefs: Prefs,
  onGoPair: () -> Unit,
  onGoHome: () -> Unit
) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val status = remember { mutableStateOf<String?>(null) }

  fun startLocalOnly() {
    scope.launch {
      status.value = I18n.t(context, "mode.status.startingLocal")
      prefs.clearAll()
      prefs.setAppMode(AppMode.LocalOnly)
      // Reset any existing on-device DB so the user starts clean.
      AppDatabase.resetForTests(context)
      // Make sure background sync isn't running.
      SyncScheduler.cancelAll(context)
      status.value = null
      onGoHome()
    }
  }

  fun startPaired() {
    scope.launch {
      prefs.setAppMode(AppMode.Paired)
      status.value = null
      onGoPair()
    }
  }

  Column(
    modifier = Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Text(t("mode.title"), style = MaterialTheme.typography.headlineSmall)
    Spacer(Modifier.padding(6.dp))
    Text(t("mode.subtitle"), style = MaterialTheme.typography.bodyMedium)

    if (status.value != null) {
      Spacer(Modifier.padding(10.dp))
      Text(status.value!!, style = MaterialTheme.typography.bodySmall)
    }

    Spacer(Modifier.padding(18.dp))

    Button(onClick = { startPaired() }, modifier = Modifier.fillMaxWidth()) {
      Text(t("mode.scanAccessCode"))
    }

    Spacer(Modifier.padding(10.dp))

    OutlinedButton(onClick = { startLocalOnly() }, modifier = Modifier.fillMaxWidth()) {
      Text(t("mode.localOnly"))
    }

    Spacer(Modifier.padding(10.dp))
    Text(
      t("mode.localOnlyHint"),
      style = MaterialTheme.typography.bodySmall
    )
  }
}
