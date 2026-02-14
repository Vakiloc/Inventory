package com.inventory.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.dp
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.ItemEntity
import com.inventory.android.data.Prefs
import com.inventory.android.sync.SyncScheduler
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t

@Composable
fun HomeScreen(
  repo: InventoryRepository,
  prefs: Prefs,
  onGoPair: () -> Unit,
  onGoPairing: () -> Unit
) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val db = remember { AppDatabase.get(context) }

  val status = remember { mutableStateOf(I18n.t(context, "status.ready")) }
  val search = remember { mutableStateOf("") }

  val selectedCategoryId = remember { mutableStateOf<Int?>(null) }
  val selectedLocationId = remember { mutableStateOf<Int?>(null) }

  val connected = remember { mutableStateOf<Boolean?>(null) }
  val pendingScans = remember { mutableStateOf(0) }

  val bootstrapped = remember { mutableStateOf(false) }
  val lastSync = remember { mutableStateOf(0L) }
  val mode = remember { mutableStateOf<AppMode?>(null) }
  val pendingCreates = remember { mutableStateOf(0) }

  LaunchedEffect(Unit) {
    bootstrapped.value = prefs.bootstrappedFlow.first()
    lastSync.value = prefs.lastSyncMsFlow.first()
    mode.value = AppMode.fromRaw(prefs.appModeFlow.first())
  }

  fun syncNow() {
    scope.launch {
      status.value = I18n.t(context, "home.status.syncing")
      val r = repo.syncOnce()
      status.value = if (r.isSuccess) {
        val s = r.getOrNull()
        if (s?.itemsPulled ?: 0 > 0 || s?.scansApplied ?: 0 > 0) {
          I18n.t(
            context,
            "home.status.syncedCounts",
            mapOf(
              "items" to (s?.itemsPulled ?: 0),
              "applied" to (s?.scansApplied ?: 0)
            )
          )
        } else {
          I18n.t(context, "home.status.synced")
        }
      } else {
        I18n.t(
          context,
          "home.status.syncFailed",
          mapOf("error" to (r.exceptionOrNull()?.message ?: ""))
        )
      }

      bootstrapped.value = prefs.bootstrappedFlow.first()
      lastSync.value = prefs.lastSyncMsFlow.first()
      pendingScans.value = repo.pendingScanCount()
    }
  }

  fun clearPairing() {
    scope.launch {
      prefs.clearAll()
      status.value = I18n.t(context, "home.status.pairingCleared")
      SyncScheduler.cancelAll(context)
    }
  }

  fun goPair() {
    scope.launch {
      prefs.setAppMode(AppMode.Paired)
      onGoPair()
    }
  }

  // Foreground presence: keep a lightweight connection status + flush scans quickly on reconnect.
  LaunchedEffect(Unit) {
    var lastOk: Boolean? = null
    while (isActive) {
      pendingScans.value = repo.pendingScanCount()
      pendingCreates.value = repo.pendingCreatesCount()

      val ok = repo.pingDesktop().isSuccess
      connected.value = ok

      // If we came back online, enqueue a background sync.
      if (lastOk == false && ok) {
        if (pendingScans.value > 0 || pendingCreates.value > 0) {
          SyncScheduler.enqueueNow(context)
        }
      }
      lastOk = ok
      delay(10_000)
    }
  }

  val q = search.value.trim().takeIf { it.isNotBlank() }?.let { "%$it%" }
  val itemsState = db.itemsDao().observeFiltered(q, selectedCategoryId.value, selectedLocationId.value)
    .collectAsState(initial = emptyList())
  val selected = remember { mutableStateOf<ItemEntity?>(null) }

  val searchHasFocus = remember { mutableStateOf(false) }
  val searchExpanded = remember { mutableStateOf(false) }
  val suggestionsFlow = remember(q) { if (q == null) flowOf(emptyList()) else db.itemsDao().observeSearch(q) }
  val suggestions = suggestionsFlow.collectAsState(initial = emptyList())

  LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
    item {
      Text(t("home.title"), style = MaterialTheme.typography.headlineSmall)
      Spacer(Modifier.padding(4.dp))

      Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Button(onClick = { syncNow() }) { Text(t("home.sync")) }
        Spacer(Modifier.padding(8.dp))
        Text(t("home.status", "status" to status.value), style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.weight(1f))
        val m = mode.value
        if (m == AppMode.Paired) {
          TextButton(onClick = { onGoPairing() }) { Text(t("home.inventories")) }
          TextButton(onClick = { clearPairing() }) { Text(t("home.unpair")) }
        } else {
          TextButton(onClick = { goPair() }) { Text(t("home.pair")) }
        }
      }

      Spacer(Modifier.padding(4.dp))
      val c = connected.value
      Text(
        when (c) {
          true -> t(
            "home.connection.connected",
            "pendingScans" to pendingScans.value,
            "pendingCreates" to pendingCreates.value
          )
          false -> t(
            "home.connection.offline",
            "pendingScans" to pendingScans.value,
            "pendingCreates" to pendingCreates.value
          )
          null -> t(
            "home.connection.checking",
            "pendingScans" to pendingScans.value,
            "pendingCreates" to pendingCreates.value
          )
        },
        style = MaterialTheme.typography.bodySmall
      )

      Spacer(Modifier.padding(6.dp))
      Text(
        if (lastSync.value > 0) {
          t("home.lastSync", "date" to java.util.Date(lastSync.value))
        } else {
          t("home.notSyncedYet")
        },
        style = MaterialTheme.typography.bodySmall
      )

      Spacer(Modifier.padding(8.dp))

      Column {
        OutlinedTextField(
          value = search.value,
          onValueChange = {
            search.value = it
            if (searchHasFocus.value) searchExpanded.value = true
          },
          label = { Text(t("home.search")) },
          modifier = Modifier
            .fillMaxWidth()
            .onFocusChanged {
              searchHasFocus.value = it.isFocused
              if (!it.isFocused) searchExpanded.value = false
            }
        )

        DropdownMenu(
          expanded = searchExpanded.value && searchHasFocus.value && search.value.trim().isNotBlank() && suggestions.value.isNotEmpty(),
          onDismissRequest = { searchExpanded.value = false },
          modifier = Modifier.fillMaxWidth()
        ) {
          suggestions.value.take(8).forEach { it ->
            DropdownMenuItem(
              text = { Text(it.name) },
              onClick = {
                search.value = it.name
                searchExpanded.value = false
              }
            )
          }
        }
      }

      Spacer(Modifier.padding(8.dp))

      FiltersRow(
        db = db,
        selectedCategoryId = selectedCategoryId.value,
        onCategoryChange = { selectedCategoryId.value = it },
        selectedLocationId = selectedLocationId.value,
        onLocationChange = { selectedLocationId.value = it }
      )

      Spacer(Modifier.padding(8.dp))
      Text(t("home.items.title"), style = MaterialTheme.typography.titleMedium)
      Spacer(Modifier.padding(2.dp))
    }

    if (itemsState.value.isEmpty()) {
      item(key = "empty-items") {
        val hasQuery = q != null
        val hasFilters = selectedCategoryId.value != null || selectedLocationId.value != null
        val msg = if (hasQuery || hasFilters) {
          t("home.items.empty.noMatch")
        } else {
          t("home.items.empty.none")
        }
        Text(msg, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.padding(8.dp))
      }
    }

    items(itemsState.value, key = { it.item_id }) { it ->
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .clickable { selected.value = it }
          .padding(vertical = 10.dp, horizontal = 6.dp)
      ) {
        Column(modifier = Modifier.weight(1f)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            if (it.barcode_corrupted == 1) {
              Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = t("accessibility.corruptedBarcode"),
                tint = MaterialTheme.colorScheme.error
              )
              Spacer(Modifier.padding(4.dp))
            }
            Text(it.name, style = MaterialTheme.typography.bodyLarge)
          }
          Text(t("items.qtyFormat", "qty" to it.quantity), style = MaterialTheme.typography.bodySmall)
        }

        val canAdjust = mode.value == AppMode.LocalOnly || bootstrapped.value
        Row(verticalAlignment = Alignment.CenterVertically) {
          TextButton(
            onClick = {
              scope.launch {
                repo.adjustItemQuantity(it.item_id, -1)
                SyncScheduler.enqueueNow(context)
              }
            },
            enabled = canAdjust
          ) { Text("-") }

          TextButton(
            onClick = {
              scope.launch {
                repo.adjustItemQuantity(it.item_id, 1)
                SyncScheduler.enqueueNow(context)
              }
            },
            enabled = canAdjust
          ) { Text("+") }

          Text(t("items.idFormat", "id" to it.item_id), style = MaterialTheme.typography.bodySmall)
        }
      }
    }

    item(key = "scan-panel") {
      Spacer(Modifier.padding(12.dp))
      Text(t("home.scan.title"), style = MaterialTheme.typography.titleMedium)
      Text(t("home.scan.hint"), style = MaterialTheme.typography.bodySmall)
      Spacer(Modifier.padding(6.dp))
      ScanPanel(repo = repo, bootstrapped = bootstrapped, isLocalOnly = mode.value == AppMode.LocalOnly)
    }
  }

  val item = selected.value
  if (item != null) {
    AlertDialog(
      onDismissRequest = { selected.value = null },
      confirmButton = {
        TextButton(onClick = { selected.value = null }) { Text(t("common.close")) }
      },
      title = { Text(item.name) },
      text = {
        Column {
          val canAdjust = mode.value == AppMode.LocalOnly || bootstrapped.value
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t("item.detail.quantity", "qty" to item.quantity))
            Spacer(Modifier.padding(8.dp))
            TextButton(
              onClick = {
                scope.launch {
                  repo.adjustItemQuantity(item.item_id, -1)
                  SyncScheduler.enqueueNow(context)
                }
              },
              enabled = canAdjust
            ) { Text("-") }
            TextButton(
              onClick = {
                scope.launch {
                  repo.adjustItemQuantity(item.item_id, 1)
                  SyncScheduler.enqueueNow(context)
                }
              },
              enabled = canAdjust
            ) { Text("+") }
          }

          if (item.barcode_corrupted == 1) {
            Text(t("item.detail.barcodeCorrupted"))
          } else if (!item.barcode.isNullOrBlank()) {
            Text(t("item.detail.barcode", "barcode" to item.barcode))
          }
          if (!item.serial_number.isNullOrBlank()) Text(t("item.detail.serial", "serial" to item.serial_number))
          val desc = item.description
          if (!desc.isNullOrBlank()) {
            Spacer(Modifier.padding(4.dp))
            Text(desc)
          }
        }
      }
    )
  }
}

@Composable
private fun FiltersRow(
  db: AppDatabase,
  selectedCategoryId: Int?,
  onCategoryChange: (Int?) -> Unit,
  selectedLocationId: Int?,
  onLocationChange: (Int?) -> Unit
) {
  val categories = db.categoriesDao().observeAll().collectAsState(initial = emptyList())
  val locations = db.locationsDao().observeAll().collectAsState(initial = emptyList())

  val catExpanded = remember { mutableStateOf(false) }
  val locExpanded = remember { mutableStateOf(false) }

  Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    androidx.compose.foundation.layout.Box(modifier = Modifier.weight(1f)) {
      OutlinedTextField(
        value = selectedCategoryId?.let { id -> categories.value.firstOrNull { it.category_id == id }?.name } ?: t("filters.category.all"),
        onValueChange = { /* read-only */ },
        label = { Text(t("filters.category.label")) },
        modifier = Modifier
          .fillMaxWidth()
          .clickable { catExpanded.value = true },
        readOnly = true
      )

      DropdownMenu(
        expanded = catExpanded.value,
        onDismissRequest = { catExpanded.value = false },
        modifier = Modifier.fillMaxWidth()
      ) {
        DropdownMenuItem(
          text = { Text(t("filters.category.all")) },
          onClick = {
            catExpanded.value = false
            onCategoryChange(null)
          }
        )
        categories.value.forEach { c ->
          DropdownMenuItem(
            text = { Text(c.name) },
            onClick = {
              catExpanded.value = false
              onCategoryChange(c.category_id)
            }
          )
        }
      }
    }
    Spacer(Modifier.padding(6.dp))
    androidx.compose.foundation.layout.Box(modifier = Modifier.weight(1f)) {
      OutlinedTextField(
        value = selectedLocationId?.let { id -> locations.value.firstOrNull { it.location_id == id }?.name } ?: t("filters.location.all"),
        onValueChange = { /* read-only */ },
        label = { Text(t("filters.location.label")) },
        modifier = Modifier
          .fillMaxWidth()
          .clickable { locExpanded.value = true },
        readOnly = true
      )

      DropdownMenu(
        expanded = locExpanded.value,
        onDismissRequest = { locExpanded.value = false },
        modifier = Modifier.fillMaxWidth()
      ) {
        DropdownMenuItem(
          text = { Text(t("filters.location.all")) },
          onClick = {
            locExpanded.value = false
            onLocationChange(null)
          }
        )
        locations.value.forEach { l ->
          DropdownMenuItem(
            text = { Text(l.name) },
            onClick = {
              locExpanded.value = false
              onLocationChange(l.location_id)
            }
          )
        }
      }
    }
  }
}
