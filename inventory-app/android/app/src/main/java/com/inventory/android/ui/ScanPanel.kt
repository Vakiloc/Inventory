package com.inventory.android.ui

import android.app.Activity
import android.Manifest
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.ItemIdName
import com.inventory.android.data.QueueScanResult
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t
import com.inventory.android.sync.SyncScheduler
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error

private enum class ScanFeedback {
  Waiting,
  Success,
  Failure,
}

private fun Context.findActivity(): Activity? {
  var ctx: Context = this
  while (ctx is ContextWrapper) {
    if (ctx is Activity) return ctx
    ctx = ctx.baseContext
  }
  return ctx as? Activity
}

private fun vibrateSuccess(context: Context) {
  try {
    val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
      vm.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    vibrator.vibrate(VibrationEffect.createOneShot(70, VibrationEffect.DEFAULT_AMPLITUDE))
  } catch (_: Throwable) {
    // ignore
  }
}

private fun vibrateFailure(context: Context) {
  try {
    val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
      vm.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    vibrator.vibrate(VibrationEffect.createOneShot(280, VibrationEffect.DEFAULT_AMPLITUDE))
  } catch (_: Throwable) {
    // ignore
  }
}

@Composable
private fun InlineScannerPreview(
  enabled: Boolean,
  frameColor: Color,
  onBarcode: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current

  val barcodeView = remember {
    DecoratedBarcodeView(context).apply {
      // We provide our own feedback UI.
      setStatusText("")
    }
  }

  // (Very small) throttle to avoid duplicate reads firing repeatedly.
  val lastCode = rememberSaveable { mutableStateOf("") }
  val lastAtMs = rememberSaveable { mutableStateOf(0L) }

  DisposableEffect(enabled) {
    if (enabled) {
      barcodeView.decodeContinuous(object : BarcodeCallback {
        override fun barcodeResult(result: BarcodeResult?) {
          val code = result?.text?.trim().orEmpty()
          if (code.isBlank()) return

          val now = System.currentTimeMillis()
          if (code == lastCode.value && (now - lastAtMs.value) < 1200L) return
          lastCode.value = code
          lastAtMs.value = now

          // Ensure we re-enter compose state on the view thread.
          barcodeView.post {
            // Briefly pause to avoid repeated reads while the barcode stays in view.
            try {
              barcodeView.pause()
            } catch (_: Throwable) {
              // ignore
            }

            onBarcode(code)

            // Resume shortly after so user can scan again.
            barcodeView.postDelayed({
              if (enabled) {
                try {
                  barcodeView.resume()
                } catch (_: Throwable) {
                  // ignore
                }
              }
            }, 700)
          }
        }

        override fun possibleResultPoints(resultPoints: MutableList<com.google.zxing.ResultPoint>?) {
          // ignore
        }
      })
      barcodeView.resume()
    } else {
      barcodeView.pause()
    }

    onDispose {
      barcodeView.pause()
      // Don't call barcodeView.barcodeView.stopDecoding(); pause is sufficient.
    }
  }

  val shape = MaterialTheme.shapes.medium

  val scannerDesc = if (enabled) I18n.t(context, "accessibility.scannerActive") else I18n.t(context, "scan.scannerDisabled")
  Box(
    modifier = modifier
      .semantics {
        contentDescription = scannerDesc
        liveRegion = LiveRegionMode.Polite
      }
      .border(width = 3.dp, color = frameColor, shape = shape)
      .background(MaterialTheme.colorScheme.surface, shape)
  ) {
    AndroidView(
      factory = { barcodeView },
      modifier = Modifier.fillMaxSize(),
      update = {
        // Ensure preview starts as soon as the view is attached.
        // Some devices won't show camera output until resume() is called after attach.
        try {
          if (enabled) it.resume() else it.pause()
        } catch (_: Throwable) {
          // ignore
        }
      }
    )

    if (!enabled) {
      Box(
        modifier = Modifier
          .fillMaxSize()
          .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f))
          .padding(12.dp),
        contentAlignment = Alignment.Center
      ) {
        Text(t("scan.scannerDisabled"), style = MaterialTheme.typography.bodyMedium)
      }
    }
  }
}

@Composable
fun ScanPanel(repo: InventoryRepository, bootstrapped: MutableState<Boolean>, isLocalOnly: Boolean) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val db = remember { AppDatabase.get(context) }

  val hasCameraPermission = remember {
    mutableStateOf(
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    )
  }

  val showScanner = rememberSaveable { mutableStateOf(false) }
  val saveAsNew = rememberSaveable { mutableStateOf(false) }

  val chooseItems = remember { mutableStateOf(emptyList<ItemIdName>()) }
  val chooseBarcode = rememberSaveable { mutableStateOf("") }
  val chooseOpen = rememberSaveable { mutableStateOf(false) }
  val chooseAllowCreateNew = rememberSaveable { mutableStateOf(false) }

  val permissionLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.RequestPermission(),
    onResult = { granted -> hasCameraPermission.value = granted }
  )

  LaunchedEffect(showScanner.value) {
    if (showScanner.value && !hasCameraPermission.value) {
      permissionLauncher.launch(Manifest.permission.CAMERA)
    }
  }

  val status = rememberSaveable { mutableStateOf("") }
  val lastFeedback = rememberSaveable { mutableStateOf<ScanFeedback?>(null) }
  val feedbackSeq = rememberSaveable { mutableStateOf(0L) }
  val pendingResolveId = rememberSaveable { mutableStateOf<Int?>(null) }
  val corrupted = remember { mutableStateOf(emptyList<com.inventory.android.data.CorruptedBarcodeEntity>()) }

  LaunchedEffect(feedbackSeq.value) {
    val startedAt = feedbackSeq.value
    if (startedAt <= 0L) return@LaunchedEffect
    delay(1200)
    if (feedbackSeq.value == startedAt) {
      lastFeedback.value = null
      status.value = ""
    }
  }

  // Desktop-like item form (opened on unknown scans).
  val showForm = rememberSaveable { mutableStateOf(false) }
  val isSaving = rememberSaveable { mutableStateOf(false) }
  val formItemId = rememberSaveable { mutableStateOf<Int?>(null) }
  val formName = rememberSaveable { mutableStateOf("") }
  val formDesc = rememberSaveable { mutableStateOf("") }
  val formQty = rememberSaveable { mutableStateOf("1") }
  val formValue = rememberSaveable { mutableStateOf("") }
  val formBarcode = rememberSaveable { mutableStateOf("") }
  val formBarcodeCorrupted = rememberSaveable { mutableStateOf(false) }
  val formSerial = rememberSaveable { mutableStateOf("") }
  val formPurchase = rememberSaveable { mutableStateOf("") }
  val formWarranty = rememberSaveable { mutableStateOf("") }
  val formPhoto = rememberSaveable { mutableStateOf("") }

  val formCategoryId = rememberSaveable { mutableStateOf<Int?>(null) }
  val formLocationId = rememberSaveable { mutableStateOf<Int?>(null) }

  val showNewCategory = rememberSaveable { mutableStateOf(false) }
  val showNewLocation = rememberSaveable { mutableStateOf(false) }
  val newCategoryName = rememberSaveable { mutableStateOf("") }
  val newLocationName = rememberSaveable { mutableStateOf("") }

  // The barcode scan activity is already orientation-locked, but the add/edit form is a
  // Compose dialog. Lock rotation while the form is open to avoid scan/submit glitches.
  DisposableEffect(showForm.value) {
    val activity = context.findActivity() ?: return@DisposableEffect onDispose { }
    val prev = activity.requestedOrientation

    if (showForm.value) {
      try {
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LOCKED
      } catch (e: Exception) {
        // ignore
      }
    }

    onDispose {
      try {
        activity.requestedOrientation = prev
      } catch (e: Exception) {
        // ignore
      }
    }
  }

  fun openNewItemForm(prefillBarcode: String) {
    formItemId.value = null
    formName.value = ""
    formDesc.value = ""
    formQty.value = "1"
    formValue.value = ""
    formBarcode.value = prefillBarcode
    formBarcodeCorrupted.value = false
    formSerial.value = ""
    formPurchase.value = ""
    formWarranty.value = ""
    formPhoto.value = ""
    formCategoryId.value = null
    formLocationId.value = null
    showForm.value = true
  }

  fun refreshCorrupted() {
    scope.launch {
      corrupted.value = db.corruptedDao().unresolved(10)
    }
  }

  LaunchedEffect(Unit) {
    refreshCorrupted()
  }

  fun handleScan(code: String) {
    val trimmed = code.trim()
    if (trimmed.isBlank()) return

    scope.launch {
      lastFeedback.value = ScanFeedback.Waiting

      // Checkbox behavior: allow user to choose ANY item to increment, or create a new item.
      if (saveAsNew.value) {
        val all = db.itemsDao().listAll().map { ItemIdName(it.item_id, it.name) }
        chooseItems.value = all
        chooseBarcode.value = trimmed
        chooseAllowCreateNew.value = true
        chooseOpen.value = true
        status.value = I18n.t(context, "dialog.chooseItem.title")
        return@launch
      }

      // If user is resolving a corrupted entry, mark it resolved with the rescan result.
      val resolveId = pendingResolveId.value
      if (resolveId != null) {
        val res = repo.queueScanDelta(trimmed, 1)
        when (res) {
          is QueueScanResult.Queued -> {
            db.corruptedDao().markResolved(resolveId, trimmed)
            pendingResolveId.value = null
            status.value = res.item.name
            lastFeedback.value = ScanFeedback.Success
            vibrateSuccess(context)
            SyncScheduler.enqueueNow(context)
            feedbackSeq.value = System.currentTimeMillis()
          }
          QueueScanResult.Corrupted -> {
            status.value = I18n.t(context, "status.barcodeNotFound")
            pendingResolveId.value = null
            lastFeedback.value = ScanFeedback.Failure
            vibrateFailure(context)
            openNewItemForm(trimmed)
            feedbackSeq.value = System.currentTimeMillis()
          }
        }
        refreshCorrupted()
        return@launch
      }

      // Prefer explicit alternate-barcode mappings over primary barcode matches.
      val altId = db.barcodesDao().findItemIdByAltBarcode(trimmed)
      val matches = if (altId != null) {
        val it = db.itemsDao().getById(altId)
        if (it != null && it.deleted == 0) listOf(ItemIdName(it.item_id, it.name)) else emptyList()
      } else {
        db.itemsDao().listItemsByPrimaryBarcode(trimmed)
      }
      if (matches.isEmpty()) {
        openNewItemForm(trimmed)
        status.value = I18n.t(context, "scan.newBarcode")
        lastFeedback.value = ScanFeedback.Success
        vibrateSuccess(context)
        feedbackSeq.value = System.currentTimeMillis()
        return@launch
      }

      if (matches.size > 1) {
        chooseItems.value = matches
        chooseBarcode.value = trimmed
        chooseAllowCreateNew.value = false
        chooseOpen.value = true
        status.value = I18n.t(context, "dialog.chooseItem.title")
        return@launch
      }

      val chosen = matches[0]
      val res = repo.queueScanDeltaForItemId(chosen.item_id, trimmed, 1)
      when (res) {
        is QueueScanResult.Queued -> {
          status.value = res.item.name
          lastFeedback.value = ScanFeedback.Success
          vibrateSuccess(context)
          SyncScheduler.enqueueNow(context)
          feedbackSeq.value = System.currentTimeMillis()
        }
        QueueScanResult.Corrupted -> {
          status.value = I18n.t(context, "status.barcodeNotFound")
          lastFeedback.value = ScanFeedback.Failure
          vibrateFailure(context)
          openNewItemForm(trimmed)
          feedbackSeq.value = System.currentTimeMillis()
        }
      }
    }
  }

  Column {
    val canUseScanner = isLocalOnly || bootstrapped.value

    // Default UI: only show action buttons.
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Button(
        onClick = { showScanner.value = !showScanner.value },
        enabled = canUseScanner
      ) {
        Text(if (showScanner.value) t("scan.stop") else t("scan.start"))
      }

      Button(
        onClick = { openNewItemForm("") },
        enabled = canUseScanner
      ) {
        Text(t("items.add"))
      }
    }

    if (showScanner.value) {
      Spacer(Modifier.padding(6.dp))
      Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(
          checked = saveAsNew.value,
          onCheckedChange = { saveAsNew.value = it }
        )
        Spacer(Modifier.padding(4.dp))
        Text(t("scan.override"), style = MaterialTheme.typography.bodySmall)
      }
    }

    if (!canUseScanner) {
      Spacer(Modifier.padding(8.dp))
      Text(
        t("scan.initialSyncRequired"),
        style = MaterialTheme.typography.bodySmall
      )
      Text(t("scan.useSyncHint"), style = MaterialTheme.typography.bodySmall)
    }

    if (showScanner.value) {
      if (!hasCameraPermission.value) {
        Spacer(Modifier.padding(10.dp))
        Text(t("scan.cameraPermissionRequired"), style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.padding(8.dp))
        Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
          Text(t("scan.enableCamera"))
        }
      } else {
        val fb = lastFeedback.value
        val frameTarget = when (fb) {
          ScanFeedback.Success -> MaterialTheme.colorScheme.tertiaryContainer
          ScanFeedback.Waiting -> MaterialTheme.colorScheme.errorContainer
          ScanFeedback.Failure -> MaterialTheme.colorScheme.errorContainer
          null -> MaterialTheme.colorScheme.errorContainer
        }
        val frame = animateColorAsState(frameTarget, label = "scanFrame").value

        InlineScannerPreview(
          enabled = canUseScanner && hasCameraPermission.value && showScanner.value && !showForm.value,
          frameColor = frame,
          onBarcode = { handleScan(it) },
          modifier = Modifier
            .fillMaxWidth()
            .height(260.dp)
        )

        Spacer(Modifier.padding(8.dp))

        if (!status.value.isNullOrBlank()) {
          val target = when (fb) {
            ScanFeedback.Waiting -> MaterialTheme.colorScheme.errorContainer
            ScanFeedback.Success -> MaterialTheme.colorScheme.tertiaryContainer
            ScanFeedback.Failure -> MaterialTheme.colorScheme.errorContainer
            null -> MaterialTheme.colorScheme.surfaceVariant
          }
          val bg = animateColorAsState(target, label = "scanStatusBg").value

          Surface(
            color = bg,
            shape = MaterialTheme.shapes.small,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
          ) {
            Row(
              modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
              verticalAlignment = Alignment.CenterVertically
            ) {
              when (fb) {
                ScanFeedback.Waiting -> Icon(Icons.Filled.Error, contentDescription = t("scan.content.scanning"))
                ScanFeedback.Success -> Icon(Icons.Filled.CheckCircle, contentDescription = t("scan.content.success"))
                ScanFeedback.Failure -> Icon(Icons.Filled.Error, contentDescription = t("scan.content.failed"))
                null -> {}
              }
              if (fb != null) Spacer(Modifier.padding(4.dp))
              Text(status.value, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
      }
    }

    Spacer(Modifier.padding(10.dp))
  Text(t("corrupted.title"), style = MaterialTheme.typography.titleSmall)
  Text(t("corrupted.hint"), style = MaterialTheme.typography.bodySmall)

    // Bound height to avoid unbounded-measure crashes when hosted in a scrollable parent.
    LazyColumn(modifier = Modifier.heightIn(max = 220.dp)) {
      items(corrupted.value) { c ->
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
          Column(modifier = Modifier.weight(1f)) {
            Text(c.raw_barcode, style = MaterialTheme.typography.bodyMedium)
            Text(t("corrupted.countFormat", "count" to c.count), style = MaterialTheme.typography.bodySmall)
          }
          Button(onClick = {
            pendingResolveId.value = c.id
            status.value = I18n.t(context, "corrupted.rescanNow")
            lastFeedback.value = ScanFeedback.Waiting
          }) {
            Text(t("corrupted.rescan"))
          }
        }
      }
    }
  }

  if (showForm.value) {
    ItemFormDialog(
      db = db,
      repo = repo,
      title = if (formItemId.value == null) t("items.add") else t("items.edit"),
      name = formName,
      description = formDesc,
      quantity = formQty,
      value = formValue,
      categoryId = formCategoryId,
      locationId = formLocationId,
      barcode = formBarcode,
      barcodeCorrupted = formBarcodeCorrupted,
      serial = formSerial,
      purchase = formPurchase,
      warranty = formWarranty,
      photo = formPhoto,
      onDismiss = { showForm.value = false },
      saving = isSaving.value,
      onSave = {
        scope.launch {
          if (isSaving.value) return@launch

          val n = formName.value.trim()
          if (n.isBlank()) {
            status.value = I18n.t(context, "validation.nameRequired")
            lastFeedback.value = ScanFeedback.Failure
            vibrateFailure(context)
            feedbackSeq.value = System.currentTimeMillis()
            return@launch
          }

          isSaving.value = true
          val qty = formQty.value.toIntOrNull() ?: 1
          val valNum = formValue.value.trim().takeIf { it.isNotBlank() }?.toDoubleOrNull()
          val r = repo.submitItemForm(
            itemId = formItemId.value,
            name = n,
            description = formDesc.value,
            quantity = qty,
            value = valNum,
            categoryId = formCategoryId.value,
            locationId = formLocationId.value,
            barcode = formBarcode.value,
            barcodeCorrupted = formBarcodeCorrupted.value,
            serialNumber = formSerial.value,
            purchaseDate = formPurchase.value,
            warrantyInfo = formWarranty.value,
            photoPath = formPhoto.value
          )

          if (r.isSuccess) {
            status.value = I18n.t(context, "status.saved", mapOf("name" to (r.getOrNull()?.name ?: "")))
            showForm.value = false
          } else {
            status.value = I18n.t(context, "status.saveFailed", mapOf("error" to (r.exceptionOrNull()?.message ?: "")))
          }

          isSaving.value = false
        }
      }
    )
  }

  if (chooseOpen.value) {
    AlertDialog(
      onDismissRequest = { chooseOpen.value = false },
      confirmButton = {
        TextButton(onClick = { chooseOpen.value = false }) { Text(t("common.cancel")) }
      },
      title = { Text(t("dialog.selectItem.title")) },
      text = {
        Column {
          Text(t("dialog.selectItem.barcode", "barcode" to chooseBarcode.value), style = MaterialTheme.typography.bodySmall)
          Spacer(Modifier.padding(8.dp))

          LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
            if (chooseAllowCreateNew.value) {
              item {
                TextButton(
                  onClick = {
                    val barcode = chooseBarcode.value
                    chooseOpen.value = false
                    openNewItemForm(barcode)
                    status.value = I18n.t(context, "items.new")
                    lastFeedback.value = ScanFeedback.Success
                    vibrateSuccess(context)
                    feedbackSeq.value = System.currentTimeMillis()
                  }
                ) {
                  Text(t("dialog.selectItem.createNew"))
                }
              }
            }

            items(chooseItems.value) { it ->
              TextButton(
                onClick = {
                  val barcode = chooseBarcode.value
                  val isOverride = chooseAllowCreateNew.value
                  chooseOpen.value = false
                  scope.launch {
                    val res = repo.queueScanDeltaForItemId(it.item_id, barcode, 1, override = isOverride)
                    when (res) {
                      is QueueScanResult.Queued -> {
                        status.value = res.item.name
                        lastFeedback.value = ScanFeedback.Success
                        vibrateSuccess(context)
                        SyncScheduler.enqueueNow(context)
                      }
                      QueueScanResult.Corrupted -> {
                        status.value = I18n.t(context, "status.barcodeNotFound")
                        lastFeedback.value = ScanFeedback.Failure
                        vibrateFailure(context)
                        openNewItemForm(barcode)
                      }
                    }
                    feedbackSeq.value = System.currentTimeMillis()
                    refreshCorrupted()
                  }
                }
              ) {
                Text(it.name)
              }
            }
          }
        }
      }
    )
  }

  if (showNewCategory.value) {
    AlertDialog(
      onDismissRequest = { showNewCategory.value = false },
      title = { Text(t("categories.new")) },
      text = {
        OutlinedTextField(
          value = newCategoryName.value,
          onValueChange = { newCategoryName.value = it },
          label = { Text(t("item.field.name")) },
          modifier = Modifier.fillMaxWidth()
        )
      },
      confirmButton = {
        Button(onClick = {
          scope.launch {
            val n = newCategoryName.value.trim()
            if (n.isBlank()) return@launch
            val r = repo.createLocalCategory(n)
            if (r.isSuccess) {
              formCategoryId.value = r.getOrNull()?.category_id
              newCategoryName.value = ""
              showNewCategory.value = false
            }
          }
        }) { Text(t("common.create")) }
      },
      dismissButton = { TextButton(onClick = { showNewCategory.value = false }) { Text(t("common.cancel")) } }
    )
  }

  if (showNewLocation.value) {
    AlertDialog(
      onDismissRequest = { showNewLocation.value = false },
      title = { Text(t("locations.new")) },
      text = {
        OutlinedTextField(
          value = newLocationName.value,
          onValueChange = { newLocationName.value = it },
          label = { Text(t("item.field.name")) },
          modifier = Modifier.fillMaxWidth()
        )
      },
      confirmButton = {
        Button(onClick = {
          scope.launch {
            val n = newLocationName.value.trim()
            if (n.isBlank()) return@launch
            val r = repo.createLocalLocation(n, parentId = null)
            if (r.isSuccess) {
              formLocationId.value = r.getOrNull()?.location_id
              newLocationName.value = ""
              showNewLocation.value = false
            }
          }
        }) { Text(t("common.create")) }
      },
      dismissButton = { TextButton(onClick = { showNewLocation.value = false }) { Text(t("common.cancel")) } }
    )
  }
}

@Composable
private fun ItemFormDialog(
  db: AppDatabase,
  repo: InventoryRepository,
  title: String,
  name: MutableState<String>,
  description: MutableState<String>,
  quantity: MutableState<String>,
  value: MutableState<String>,
  categoryId: MutableState<Int?>,
  locationId: MutableState<Int?>,
  barcode: MutableState<String>,
  barcodeCorrupted: MutableState<Boolean>,
  serial: MutableState<String>,
  purchase: MutableState<String>,
  warranty: MutableState<String>,
  photo: MutableState<String>,
  onDismiss: () -> Unit,
  onSave: () -> Unit,
  saving: Boolean = false
) {
  val categories = db.categoriesDao().observeAll().collectAsState(initial = emptyList())
  val locations = db.locationsDao().observeAll().collectAsState(initial = emptyList())
  val scope = rememberCoroutineScope()

  val showNewCategory = rememberSaveable { mutableStateOf(false) }
  val showNewLocation = rememberSaveable { mutableStateOf(false) }
  val newCategoryName = rememberSaveable { mutableStateOf("") }
  val newLocationName = rememberSaveable { mutableStateOf("") }
  val showBarcodeScanner = rememberSaveable { mutableStateOf(false) }
  val formScanStatus = rememberSaveable { mutableStateOf("") }
  val formScanFeedback = rememberSaveable { mutableStateOf<ScanFeedback?>(null) }
  val formScanSeq = rememberSaveable { mutableStateOf(0L) }

  val context = LocalContext.current
  val hasCameraPermission = remember {
    mutableStateOf(
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    )
  }

  val permissionLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.RequestPermission(),
    onResult = { granted ->
      hasCameraPermission.value = granted
      formScanFeedback.value = if (granted) ScanFeedback.Waiting else ScanFeedback.Failure
      formScanStatus.value = if (granted) I18n.t(context, "scan.scanning") else I18n.t(context, "scan.cameraPermissionRequiredShort")
      if (!granted) vibrateFailure(context)
      formScanSeq.value = System.currentTimeMillis()
    }
  )

  LaunchedEffect(showBarcodeScanner.value) {
    if (showBarcodeScanner.value) {
      // Match main scan panel behavior: show waiting state as soon as user opens scanner.
      formScanFeedback.value = ScanFeedback.Waiting
      formScanStatus.value = I18n.t(context, "scan.scanning")
      formScanSeq.value = System.currentTimeMillis()

      if (!hasCameraPermission.value) {
        permissionLauncher.launch(Manifest.permission.CAMERA)
      }
    }
  }

  LaunchedEffect(formScanSeq.value) {
    val startedAt = formScanSeq.value
    if (startedAt <= 0L) return@LaunchedEffect
    delay(1200)
    if (formScanSeq.value == startedAt) {
      formScanFeedback.value = null
      formScanStatus.value = ""
    }
  }

  fun parseQty(): Int {
    return quantity.value.trim().toIntOrNull()?.coerceAtLeast(0) ?: 1
  }

  val nameFieldFocus = remember { FocusRequester() }

  LaunchedEffect(Unit) {
    nameFieldFocus.requestFocus()
  }

  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = {
      Column {
        OutlinedTextField(value = name.value, onValueChange = { name.value = it }, label = { Text(t("item.field.name")) }, modifier = Modifier.fillMaxWidth().focusRequester(nameFieldFocus))
        Spacer(Modifier.padding(4.dp))
        OutlinedTextField(value = description.value, onValueChange = { description.value = it }, label = { Text(t("item.field.description")) }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        Spacer(Modifier.padding(4.dp))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TextButton(onClick = {
              val next = (parseQty() - 1).coerceAtLeast(0)
              quantity.value = next.toString()
            }) { Text("-") }

            OutlinedTextField(
              value = quantity.value,
              onValueChange = { quantity.value = it },
              label = { Text(t("item.field.quantity")) },
              modifier = Modifier.weight(1f)
            )

            TextButton(onClick = {
              val next = (parseQty() + 1).coerceAtLeast(0)
              quantity.value = next.toString()
            }) { Text("+") }
          }
          OutlinedTextField(value = value.value, onValueChange = { value.value = it }, label = { Text(t("item.field.value")) }, modifier = Modifier.weight(1f))
        }

        Spacer(Modifier.padding(4.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          val catName = categoryId.value?.let { id -> categories.value.firstOrNull { it.category_id == id }?.name } ?: ""
          OutlinedTextField(
            value = catName,
            onValueChange = { /* read-only */ },
            label = { Text(t("item.field.category")) },
            modifier = Modifier.weight(1f),
            readOnly = true
          )
          val locName = locationId.value?.let { id -> locations.value.firstOrNull { it.location_id == id }?.name } ?: ""
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
            val idx = all.indexOf(categoryId.value).coerceAtLeast(0)
            categoryId.value = all[(idx + 1) % all.size]
          }) { Text(t("filters.category.next")) }
          TextButton(onClick = { showNewCategory.value = true }) { Text(t("categories.new")) }
          TextButton(onClick = {
            val all = listOf<Int?>(null) + locations.value.map { it.location_id }
            val idx = all.indexOf(locationId.value).coerceAtLeast(0)
            locationId.value = all[(idx + 1) % all.size]
          }) { Text(t("filters.location.next")) }
          TextButton(onClick = { showNewLocation.value = true }) { Text(t("locations.new")) }
        }

        Spacer(Modifier.padding(4.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          OutlinedTextField(
            value = barcode.value,
            onValueChange = { barcode.value = it },
            label = { Text(t("item.field.barcode")) },
            modifier = Modifier.weight(1f),
            enabled = !barcodeCorrupted.value
          )
          TextButton(onClick = { showBarcodeScanner.value = true }, enabled = !barcodeCorrupted.value) { Text(t("item.field.barcode.scan")) }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(
            checked = barcodeCorrupted.value,
            onCheckedChange = {
              barcodeCorrupted.value = it
              if (it) barcode.value = ""
            }
          )
          Spacer(Modifier.padding(4.dp))
          Text(t("item.field.barcode.corrupted"), style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.padding(4.dp))
        OutlinedTextField(value = serial.value, onValueChange = { serial.value = it }, label = { Text(t("item.field.serialNumber")) }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.padding(4.dp))
        OutlinedTextField(value = purchase.value, onValueChange = { purchase.value = it }, label = { Text(t("item.field.purchaseDate")) }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.padding(4.dp))
        OutlinedTextField(value = warranty.value, onValueChange = { warranty.value = it }, label = { Text(t("item.field.warranty")) }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.padding(4.dp))
        OutlinedTextField(value = photo.value, onValueChange = { photo.value = it }, label = { Text(t("item.field.photo")) }, modifier = Modifier.fillMaxWidth())
      }
    },
    confirmButton = {
      Button(onClick = onSave, enabled = !saving && name.value.trim().isNotBlank()) {
        Text(if (saving) t("status.saving") else t("common.save"))
      }
    },
    dismissButton = { TextButton(onClick = onDismiss) { Text(t("common.cancel")) } }
  )

  if (showBarcodeScanner.value) {
    AlertDialog(
      onDismissRequest = { showBarcodeScanner.value = false },
      title = { Text(t("scan.barcodeDialog.title")) },
      text = {
        Column {
          val fb = formScanFeedback.value
          val frameTarget = when (fb) {
            ScanFeedback.Success -> MaterialTheme.colorScheme.tertiaryContainer
            ScanFeedback.Waiting -> MaterialTheme.colorScheme.errorContainer
            ScanFeedback.Failure -> MaterialTheme.colorScheme.errorContainer
            null -> MaterialTheme.colorScheme.errorContainer
          }
          val frame = animateColorAsState(frameTarget, label = "formScanFrame").value

          if (!hasCameraPermission.value) {
            Text(t("scan.cameraPermissionRequired"), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.padding(6.dp))
            TextButton(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) { Text(t("scan.enableCamera")) }
          } else {
            InlineScannerPreview(
              enabled = true,
              frameColor = frame,
              onBarcode = { code ->
                barcode.value = code
                barcodeCorrupted.value = false

                formScanFeedback.value = ScanFeedback.Success
                formScanStatus.value = I18n.t(context, "scan.form.scanned")
                vibrateSuccess(context)
                formScanSeq.value = System.currentTimeMillis()
                showBarcodeScanner.value = false
              },
              modifier = Modifier.fillMaxWidth().height(220.dp)
            )
          }

          val status = formScanStatus.value
          if (status.isNotBlank() || fb != null) {
            Spacer(Modifier.padding(6.dp))
            val target = when (fb) {
              ScanFeedback.Waiting -> MaterialTheme.colorScheme.errorContainer
              ScanFeedback.Success -> MaterialTheme.colorScheme.tertiaryContainer
              ScanFeedback.Failure -> MaterialTheme.colorScheme.errorContainer
              null -> MaterialTheme.colorScheme.surfaceVariant
            }
            val bg = animateColorAsState(target, label = "formScanStatusBg").value
            Surface(color = bg, shape = MaterialTheme.shapes.small) {
              Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                when (fb) {
                  ScanFeedback.Waiting -> Icon(Icons.Filled.Error, contentDescription = t("scan.content.scanning"))
                  ScanFeedback.Success -> Icon(Icons.Filled.CheckCircle, contentDescription = t("scan.content.success"))
                  ScanFeedback.Failure -> Icon(Icons.Filled.Error, contentDescription = t("scan.content.failed"))
                  null -> {}
                }
                if (fb != null) Spacer(Modifier.padding(4.dp))
                Text(status.ifBlank { t("status.ready") }, style = MaterialTheme.typography.bodySmall)
              }
            }
          }
        }
      },
      confirmButton = {
        TextButton(onClick = { showBarcodeScanner.value = false }) { Text(t("common.close")) }
      }
    )
  }

  if (showNewCategory.value) {
    AlertDialog(
      onDismissRequest = { showNewCategory.value = false },
      title = { Text(t("categories.new")) },
      text = {
        OutlinedTextField(
          value = newCategoryName.value,
          onValueChange = { newCategoryName.value = it },
          label = { Text(t("item.field.name")) },
          modifier = Modifier.fillMaxWidth()
        )
      },
      confirmButton = {
        Button(onClick = {
          scope.launch {
            val n = newCategoryName.value.trim()
            if (n.isBlank()) return@launch
            val r = repo.createLocalCategory(n)
            if (r.isSuccess) {
              categoryId.value = r.getOrNull()?.category_id
              newCategoryName.value = ""
              showNewCategory.value = false
            }
          }
        }) { Text(t("common.create")) }
      },
      dismissButton = { TextButton(onClick = { showNewCategory.value = false }) { Text(t("common.cancel")) } }
    )
  }

  if (showNewLocation.value) {
    AlertDialog(
      onDismissRequest = { showNewLocation.value = false },
      title = { Text(t("locations.new")) },
      text = {
        OutlinedTextField(
          value = newLocationName.value,
          onValueChange = { newLocationName.value = it },
          label = { Text(t("item.field.name")) },
          modifier = Modifier.fillMaxWidth()
        )
      },
      confirmButton = {
        Button(onClick = {
          scope.launch {
            val n = newLocationName.value.trim()
            if (n.isBlank()) return@launch
            val r = repo.createLocalLocation(n, parentId = null)
            if (r.isSuccess) {
              locationId.value = r.getOrNull()?.location_id
              newLocationName.value = ""
              showNewLocation.value = false
            }
          }
        }) { Text(t("common.create")) }
      },
      dismissButton = { TextButton(onClick = { showNewLocation.value = false }) { Text(t("common.cancel")) } }
    )
  }
}
