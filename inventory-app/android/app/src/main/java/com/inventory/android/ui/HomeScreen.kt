package com.inventory.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Button
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.ItemEntity
import com.inventory.android.data.PendingItemUpdateEntity
import com.inventory.android.data.Prefs
import com.inventory.android.sync.SyncScheduler
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t

@Composable
fun HomeScreen(
  repo: InventoryRepository,
  prefs: Prefs
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
  val conflictCount = remember { mutableStateOf(0) }
  val conflicts = remember { mutableStateOf<List<PendingItemUpdateEntity>>(emptyList()) }
  val showConflicts = remember { mutableStateOf(false) }

  // Item form dialog state
  val showItemForm = remember { mutableStateOf(false) }
  val editingItem = remember { mutableStateOf<ItemEntity?>(null) }
  val formName = remember { mutableStateOf("") }
  val formDescription = remember { mutableStateOf("") }
  val formQuantity = remember { mutableStateOf("1") }
  val formValue = remember { mutableStateOf("") }
  val formCategoryId = remember { mutableStateOf<Int?>(null) }
  val formLocationId = remember { mutableStateOf<Int?>(null) }
  val formBarcode = remember { mutableStateOf("") }
  val formBarcodeCorrupted = remember { mutableStateOf(false) }
  val formSerial = remember { mutableStateOf("") }
  val formPurchase = remember { mutableStateOf("") }
  val formWarranty = remember { mutableStateOf("") }
  val formPhoto = remember { mutableStateOf("") }
  val formSaving = remember { mutableStateOf(false) }

  // Delete confirmation state
  val deleteConfirmItem = remember { mutableStateOf<ItemEntity?>(null) }

  fun resetForm() {
    formName.value = ""
    formDescription.value = ""
    formQuantity.value = "1"
    formValue.value = ""
    formCategoryId.value = null
    formLocationId.value = null
    formBarcode.value = ""
    formBarcodeCorrupted.value = false
    formSerial.value = ""
    formPurchase.value = ""
    formWarranty.value = ""
    formPhoto.value = ""
    formSaving.value = false
    editingItem.value = null
  }

  fun openCreateForm() {
    resetForm()
    showItemForm.value = true
  }

  fun openEditForm(item: ItemEntity) {
    editingItem.value = item
    formName.value = item.name
    formDescription.value = item.description ?: ""
    formQuantity.value = item.quantity.toString()
    formValue.value = item.value?.toString() ?: ""
    formCategoryId.value = item.category_id
    formLocationId.value = item.location_id
    formBarcode.value = item.barcode ?: ""
    formBarcodeCorrupted.value = item.barcode_corrupted == 1
    formSerial.value = item.serial_number ?: ""
    formPurchase.value = item.purchase_date ?: ""
    formWarranty.value = item.warranty_info ?: ""
    formPhoto.value = item.photo_path ?: ""
    formSaving.value = false
    showItemForm.value = true
  }

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

  // Foreground presence: keep a lightweight connection status + flush scans quickly on reconnect.
  LaunchedEffect(Unit) {
    var lastOk: Boolean? = null
    while (isActive) {
      pendingScans.value = repo.pendingScanCount()
      pendingCreates.value = repo.pendingCreatesCount()
      conflictCount.value = repo.conflictCount()

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

  // Announce sync status changes for TalkBack
  val view = LocalView.current
  LaunchedEffect(status.value) {
    if (status.value.isNotBlank()) {
      view.announceForAccessibility(status.value)
    }
  }

  val q = search.value.trim().takeIf { it.isNotBlank() }?.let { "%$it%" }
  val itemsState = db.itemsDao().observeFiltered(q, selectedCategoryId.value, selectedLocationId.value)
    .collectAsState(initial = emptyList())

  val searchHasFocus = remember { mutableStateOf(false) }
  val searchExpanded = remember { mutableStateOf(false) }
  val suggestionsFlow = remember(q) { if (q == null) flowOf(emptyList()) else db.itemsDao().observeSearch(q) }
  val suggestions = suggestionsFlow.collectAsState(initial = emptyList())

  Box(modifier = Modifier.fillMaxSize()) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
      item {
        Text(t("home.title"), style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.padding(4.dp))

        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
          Button(onClick = { syncNow() }) { Text(t("home.sync")) }
          Spacer(Modifier.padding(8.dp))
          Text(t("home.status", "status" to status.value), style = MaterialTheme.typography.bodySmall)
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

        // Conflict banner
        if (conflictCount.value > 0) {
          Spacer(Modifier.padding(4.dp))
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .clickable {
                scope.launch {
                  conflicts.value = repo.listConflicts()
                  showConflicts.value = true
                }
              }
              .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
          ) {
            Icon(
              Icons.Filled.Warning,
              contentDescription = null,
              tint = MaterialTheme.colorScheme.error
            )
            Spacer(Modifier.padding(4.dp))
            Text(
              t("conflict.banner", "count" to conflictCount.value),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.error
            )
          }
        }

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

          Column(
            modifier = Modifier
              .fillMaxWidth()
              .padding(vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
          ) {
            Text(
              if (hasQuery || hasFilters) "\uD83D\uDD0D" else "\uD83D\uDCE6",
              style = MaterialTheme.typography.headlineLarge
            )
            Spacer(Modifier.padding(4.dp))
            Text(
              if (hasQuery || hasFilters) t("home.items.empty.heading.noMatch") else t("home.items.empty.heading.noItems"),
              style = MaterialTheme.typography.titleSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.padding(2.dp))
            Text(
              if (hasQuery || hasFilters) t("home.items.empty.noMatch") else t("home.items.empty.none"),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
          }
        }
      }

      items(itemsState.value, key = { it.item_id }) { it ->
        val itemDesc = "${it.name}, ${t("items.qtyFormat", "qty" to it.quantity)}"
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .semantics {
              contentDescription = itemDesc
              if (it.barcode_corrupted == 1) {
                stateDescription = I18n.t(context, "accessibility.corruptedBarcode")
              }
            }
            .clickable { openEditForm(it) }
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
              enabled = canAdjust,
              modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .semantics { contentDescription = I18n.t(context, "accessibility.decrementQty", mapOf("name" to it.name)) }
            ) { Text("-") }

            TextButton(
              onClick = {
                scope.launch {
                  repo.adjustItemQuantity(it.item_id, 1)
                  SyncScheduler.enqueueNow(context)
                }
              },
              enabled = canAdjust,
              modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .semantics { contentDescription = I18n.t(context, "accessibility.incrementQty", mapOf("name" to it.name)) }
            ) { Text("+") }

            Text(t("items.idFormat", "id" to it.item_id), style = MaterialTheme.typography.bodySmall)
          }
        }
      }

      // Bottom spacer so FAB doesn't cover last item
      item { Spacer(Modifier.padding(36.dp)) }
    }

    // FAB for adding a new item
    FloatingActionButton(
      onClick = { openCreateForm() },
      modifier = Modifier
        .align(Alignment.BottomEnd)
        .padding(16.dp)
        .semantics { contentDescription = I18n.t(context, "items.add") }
    ) {
      Icon(Icons.Filled.Add, contentDescription = t("items.add"))
    }
  }

  // Item create/edit form dialog
  if (showItemForm.value) {
    val isEdit = editingItem.value != null
    val categories = db.categoriesDao().observeAll().collectAsState(initial = emptyList())
    val locations = db.locationsDao().observeAll().collectAsState(initial = emptyList())

    AlertDialog(
      onDismissRequest = {
        if (!formSaving.value) {
          showItemForm.value = false
          resetForm()
        }
      },
      title = { Text(if (isEdit) t("items.edit") else t("items.add")) },
      text = {
        Column {
          OutlinedTextField(
            value = formName.value,
            onValueChange = { formName.value = it },
            label = { Text(t("item.field.name")) },
            modifier = Modifier.fillMaxWidth()
          )
          Spacer(Modifier.padding(4.dp))
          OutlinedTextField(
            value = formDescription.value,
            onValueChange = { formDescription.value = it },
            label = { Text(t("item.field.description")) },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2
          )
          Spacer(Modifier.padding(4.dp))

          Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
              modifier = Modifier.weight(1f),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
              TextButton(onClick = {
                val next = ((formQuantity.value.trim().toIntOrNull() ?: 1) - 1).coerceAtLeast(0)
                formQuantity.value = next.toString()
              }) { Text("-") }

              OutlinedTextField(
                value = formQuantity.value,
                onValueChange = { formQuantity.value = it },
                label = { Text(t("item.field.quantity")) },
                modifier = Modifier.weight(1f)
              )

              TextButton(onClick = {
                val next = ((formQuantity.value.trim().toIntOrNull() ?: 1) + 1).coerceAtLeast(0)
                formQuantity.value = next.toString()
              }) { Text("+") }
            }
            OutlinedTextField(
              value = formValue.value,
              onValueChange = { formValue.value = it },
              label = { Text(t("item.field.value")) },
              modifier = Modifier.weight(1f)
            )
          }

          Spacer(Modifier.padding(4.dp))
          Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val catName = formCategoryId.value?.let { id -> categories.value.firstOrNull { it.category_id == id }?.name } ?: ""
            OutlinedTextField(
              value = catName,
              onValueChange = { /* read-only */ },
              label = { Text(t("item.field.category")) },
              modifier = Modifier.weight(1f),
              readOnly = true
            )
            val locName = formLocationId.value?.let { id -> locations.value.firstOrNull { it.location_id == id }?.name } ?: ""
            OutlinedTextField(
              value = locName,
              onValueChange = { /* read-only */ },
              label = { Text(t("item.field.location")) },
              modifier = Modifier.weight(1f),
              readOnly = true
            )
          }
          Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = {
              val all = listOf<Int?>(null) + categories.value.map { it.category_id }
              val idx = all.indexOf(formCategoryId.value).coerceAtLeast(0)
              formCategoryId.value = all[(idx + 1) % all.size]
            }) { Text(t("filters.category.next")) }
            TextButton(onClick = {
              val all = listOf<Int?>(null) + locations.value.map { it.location_id }
              val idx = all.indexOf(formLocationId.value).coerceAtLeast(0)
              formLocationId.value = all[(idx + 1) % all.size]
            }) { Text(t("filters.location.next")) }
          }

          Spacer(Modifier.padding(4.dp))
          OutlinedTextField(
            value = formBarcode.value,
            onValueChange = { formBarcode.value = it },
            label = { Text(t("item.field.barcode")) },
            modifier = Modifier.fillMaxWidth(),
            enabled = !formBarcodeCorrupted.value
          )

          Spacer(Modifier.padding(4.dp))
          OutlinedTextField(
            value = formSerial.value,
            onValueChange = { formSerial.value = it },
            label = { Text(t("item.field.serialNumber")) },
            modifier = Modifier.fillMaxWidth()
          )
          Spacer(Modifier.padding(4.dp))
          OutlinedTextField(
            value = formPurchase.value,
            onValueChange = { formPurchase.value = it },
            label = { Text(t("item.field.purchaseDate")) },
            modifier = Modifier.fillMaxWidth()
          )
          Spacer(Modifier.padding(4.dp))
          OutlinedTextField(
            value = formWarranty.value,
            onValueChange = { formWarranty.value = it },
            label = { Text(t("item.field.warranty")) },
            modifier = Modifier.fillMaxWidth()
          )

          // Delete button for edit mode
          if (isEdit) {
            Spacer(Modifier.padding(8.dp))
            TextButton(
              onClick = { deleteConfirmItem.value = editingItem.value },
              modifier = Modifier.fillMaxWidth()
            ) {
              Text(
                t("common.delete"),
                color = MaterialTheme.colorScheme.error
              )
            }
          }
        }
      },
      confirmButton = {
        Button(
          onClick = {
            val nameVal = formName.value.trim()
            if (nameVal.isBlank()) {
              status.value = I18n.t(context, "validation.nameRequired")
              return@Button
            }
            formSaving.value = true
            scope.launch {
              val r = repo.submitItemForm(
                itemId = editingItem.value?.item_id,
                name = nameVal,
                description = formDescription.value.trim().takeIf { it.isNotBlank() },
                quantity = formQuantity.value.trim().toIntOrNull()?.coerceAtLeast(0) ?: 1,
                value = formValue.value.trim().toDoubleOrNull(),
                categoryId = formCategoryId.value,
                locationId = formLocationId.value,
                barcode = if (formBarcodeCorrupted.value) null else formBarcode.value.trim().takeIf { it.isNotBlank() },
                barcodeCorrupted = formBarcodeCorrupted.value,
                serialNumber = formSerial.value.trim().takeIf { it.isNotBlank() },
                purchaseDate = formPurchase.value.trim().takeIf { it.isNotBlank() },
                warrantyInfo = formWarranty.value.trim().takeIf { it.isNotBlank() },
                photoPath = formPhoto.value.trim().takeIf { it.isNotBlank() }
              )
              formSaving.value = false
              if (r.isSuccess) {
                val saved = r.getOrNull()
                status.value = I18n.t(context, "status.saved", mapOf("name" to (saved?.name ?: nameVal)))
                showItemForm.value = false
                resetForm()
                SyncScheduler.enqueueNow(context)
              } else {
                status.value = I18n.t(context, "status.saveFailed", mapOf("error" to (r.exceptionOrNull()?.message ?: "")))
              }
            }
          },
          enabled = !formSaving.value && formName.value.trim().isNotBlank()
        ) {
          Text(if (formSaving.value) t("status.saving") else t("common.save"))
        }
      },
      dismissButton = {
        TextButton(
          onClick = {
            showItemForm.value = false
            resetForm()
          }
        ) { Text(t("common.cancel")) }
      }
    )
  }

  // Delete confirmation dialog
  val itemToDelete = deleteConfirmItem.value
  if (itemToDelete != null) {
    AlertDialog(
      onDismissRequest = { deleteConfirmItem.value = null },
      title = { Text(t("item.delete.title")) },
      text = { Text(t("item.delete.confirm", "name" to itemToDelete.name)) },
      confirmButton = {
        Button(onClick = {
          scope.launch {
            val r = repo.deleteItem(itemToDelete.item_id)
            deleteConfirmItem.value = null
            showItemForm.value = false
            resetForm()
            if (r.isSuccess) {
              status.value = I18n.t(context, "item.delete.success", mapOf("name" to itemToDelete.name))
              SyncScheduler.enqueueNow(context)
            } else {
              status.value = I18n.t(context, "item.delete.failed", mapOf("error" to (r.exceptionOrNull()?.message ?: "")))
            }
          }
        }) {
          Text(t("common.delete"), color = MaterialTheme.colorScheme.onError)
        }
      },
      dismissButton = {
        TextButton(onClick = { deleteConfirmItem.value = null }) { Text(t("common.cancel")) }
      }
    )
  }

  // Conflict resolution dialog
  if (showConflicts.value && conflicts.value.isNotEmpty()) {
    val conflict = conflicts.value.first()
    AlertDialog(
      onDismissRequest = { showConflicts.value = false },
      title = { Text(t("conflict.title")) },
      text = {
        Column {
          Text(t("conflict.hint"), style = MaterialTheme.typography.bodySmall)
          Spacer(Modifier.padding(8.dp))
          Text(t("conflict.localVersion"), style = MaterialTheme.typography.labelMedium)
          Text("${conflict.name} (qty: ${conflict.quantity})", style = MaterialTheme.typography.bodySmall)
          Spacer(Modifier.padding(4.dp))
          Text(t("conflict.tapToResolve"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      },
      confirmButton = {
        Button(onClick = {
          scope.launch {
            repo.resolveConflict(conflict.client_id, keepMine = true)
            conflictCount.value = repo.conflictCount()
            conflicts.value = repo.listConflicts()
            if (conflicts.value.isEmpty()) showConflicts.value = false
            status.value = I18n.t(context, "conflict.resolved.keepMine")
            SyncScheduler.enqueueNow(context)
          }
        }) { Text(t("conflict.keepMine")) }
      },
      dismissButton = {
        Row {
          TextButton(onClick = {
            scope.launch {
              repo.resolveConflict(conflict.client_id, keepMine = false)
              conflictCount.value = repo.conflictCount()
              conflicts.value = repo.listConflicts()
              if (conflicts.value.isEmpty()) showConflicts.value = false
              status.value = I18n.t(context, "conflict.resolved.keepServer")
            }
          }) { Text(t("conflict.keepServer")) }
          TextButton(onClick = { showConflicts.value = false }) { Text(t("common.cancel")) }
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
    Box(modifier = Modifier.weight(1f)) {
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
    Box(modifier = Modifier.weight(1f)) {
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
