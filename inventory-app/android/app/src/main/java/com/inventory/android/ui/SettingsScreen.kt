package com.inventory.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t
import com.inventory.android.net.InventoryDto
import com.inventory.android.sync.SyncScheduler
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
  repo: InventoryRepository,
  prefs: Prefs,
  onGoPair: () -> Unit
) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current

  val status = remember { mutableStateOf(I18n.t(context, "status.ready")) }
  val inventories = remember { mutableStateOf<List<InventoryDto>>(emptyList()) }
  val mode = remember { mutableStateOf<AppMode?>(null) }

  val localePref = prefs.localeFlow.collectAsState(initial = null)
  val currentLocale = (localePref.value?.trim()?.takeIf { it.isNotBlank() } ?: java.util.Locale.getDefault().language).lowercase()

  val activeInventoryId = prefs.inventoryIdFlow.collectAsState(initial = null)
  val baseUrl = prefs.baseUrlFlow.collectAsState(initial = null)

  LaunchedEffect(Unit) {
    mode.value = AppMode.fromRaw(prefs.appModeFlow.first())
  }

  fun refresh() {
    scope.launch {
      status.value = I18n.t(context, "pairing.status.loading")
      val r = repo.listDesktopInventories()
      status.value = if (r.isSuccess) {
        inventories.value = r.getOrNull() ?: emptyList()
        I18n.t(context, "pairing.status.loaded")
      } else {
        I18n.t(
          context,
          "pairing.status.loadFailed",
          mapOf("error" to (r.exceptionOrNull()?.message ?: ""))
        )
      }
    }
  }

  fun clearPairing() {
    scope.launch {
      prefs.clearAll()
      SyncScheduler.cancelAll(context)
      status.value = I18n.t(context, "home.status.pairingCleared")
    }
  }

  LaunchedEffect(Unit) {
    if (mode.value == AppMode.Paired) refresh()
  }

  Column(
    modifier = Modifier.fillMaxSize().padding(16.dp),
    verticalArrangement = Arrangement.Top,
    horizontalAlignment = Alignment.Start
  ) {
    Text(t("pairing.title"), style = MaterialTheme.typography.headlineSmall)
    Spacer(Modifier.padding(8.dp))

    // Language
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("EN", style = MaterialTheme.typography.bodySmall)
      TextButton(onClick = { scope.launch { prefs.setLocale("en") } }, enabled = currentLocale != "en") { Text("English") }
      Spacer(Modifier.padding(4.dp))
      Text("ES", style = MaterialTheme.typography.bodySmall)
      TextButton(onClick = { scope.launch { prefs.setLocale("es") } }, enabled = currentLocale != "es") { Text("Español") }
    }

    Spacer(Modifier.padding(4.dp))
    HorizontalDivider()
    Spacer(Modifier.padding(8.dp))

    // Connection status
    val desktopLabel = baseUrl.value ?: t("pairing.desktop.notPaired")
    Text(t("pairing.desktop", "baseUrl" to desktopLabel), style = MaterialTheme.typography.bodySmall)
    Text(t("pairing.status", "status" to status.value), style = MaterialTheme.typography.bodySmall)

    Spacer(Modifier.padding(8.dp))

    // Actions
    val m = mode.value
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      if (m == AppMode.Paired) {
        Button(onClick = { refresh() }) { Text(t("pairing.button.refresh")) }
        Spacer(Modifier.padding(6.dp))
        TextButton(onClick = { clearPairing() }) { Text(t("home.unpair")) }
      } else {
        Button(onClick = {
          scope.launch {
            prefs.setAppMode(AppMode.Paired)
            onGoPair()
          }
        }) { Text(t("home.pair")) }
      }
    }

    if (m == AppMode.Paired) {
      Spacer(Modifier.padding(10.dp))
      HorizontalDivider()
      Spacer(Modifier.padding(8.dp))

      Text(t("pairing.selectInventory"), style = MaterialTheme.typography.titleMedium)
      Spacer(Modifier.padding(4.dp))
      val current = activeInventoryId.value ?: t("pairing.current.desktopActive")
      Text(
        t("pairing.current", "current" to current),
        style = MaterialTheme.typography.bodySmall
      )
      Spacer(Modifier.padding(6.dp))

      LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f, fill = true)) {
        items(inventories.value) { inv ->
          Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
          ) {
            Column(modifier = Modifier.weight(1f)) {
              Text(inv.name)
              Text(inv.id, style = MaterialTheme.typography.bodySmall)
            }

            Button(onClick = {
              scope.launch {
                status.value = I18n.t(context, "pairing.status.switching")
                val r = repo.switchInventoryClearAndBootstrap(inv.id)
                status.value = if (r.isSuccess) {
                  I18n.t(context, "pairing.status.switched")
                } else {
                  I18n.t(
                    context,
                    "pairing.status.switchFailed",
                    mapOf("error" to (r.exceptionOrNull()?.message ?: ""))
                  )
                }
                if (r.isSuccess) {
                  SyncScheduler.enqueueNow(context)
                }
              }
            }) { Text(t("pairing.button.switch")) }

            Spacer(Modifier.padding(4.dp))

            Button(onClick = {
              scope.launch {
                status.value = I18n.t(context, "pairing.status.appending")
                val r = repo.appendLocalToInventory(inv.id)
                status.value = if (r.isSuccess) {
                  I18n.t(context, "pairing.status.appended")
                } else {
                  I18n.t(
                    context,
                    "pairing.status.appendFailed",
                    mapOf("error" to (r.exceptionOrNull()?.message ?: ""))
                  )
                }
                if (r.isSuccess) {
                  SyncScheduler.enqueueNow(context)
                }
              }
            }) { Text(t("pairing.button.append")) }
          }
        }
      }
    }
  }
}
