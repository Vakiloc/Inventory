package com.inventory.android.data

import androidx.room.withTransaction
import com.inventory.android.net.ApiClient
import com.inventory.android.net.ApiService
import com.inventory.android.net.ApplyScansRequest
import com.inventory.android.net.CategoryUpsertRequestDto
import com.inventory.android.net.InventoryDto
import com.inventory.android.net.ItemUpsertRequestDto
import com.inventory.android.net.LocationUpsertRequestDto
import com.inventory.android.net.ScanEventDto
import kotlinx.coroutines.flow.first
import java.util.UUID

class InventoryRepository(
  private val db: AppDatabase,
  private val prefs: Prefs,
  private val apiServiceProvider: suspend () -> ApiService
) {

  private suspend fun nextNegativeId(currentMin: Int?): Int {
    val min = currentMin ?: 0
    return if (min >= 0) -1 else (min - 1)
  }

  suspend fun pendingCreatesCount(): Int {
    return db.pendingCategoryCreateDao().countPending() +
      db.pendingLocationCreateDao().countPending() +
      db.pendingItemCreateDao().countPending() +
      db.pendingItemUpdateDao().countPending()
  }

  constructor(
    db: AppDatabase,
    prefs: Prefs,
    apiClient: ApiClient
  ) : this(db, prefs, apiServiceProvider = { apiClient.createService() })

  suspend fun isPaired(): Boolean {
    val baseUrl = prefs.baseUrlFlow.first()
    val token = prefs.tokenFlow.first()
    return !baseUrl.isNullOrBlank() && !token.isNullOrBlank()
  }

  suspend fun bootstrapFromDesktop(): Result<Unit> {
    return runCatching {
      val api = apiServiceProvider()
      val snap = api.exportSnapshot()

      db.withTransaction {
        val cats = snap.categories.map { CategoryEntity(it.category_id, it.name) }
        val locs = snap.locations.map { LocationEntity(it.location_id, it.name, it.parent_id) }
        val items = snap.items.map {
          ItemEntity(
            item_id = it.item_id,
            name = it.name,
            description = it.description,
            quantity = it.quantity,
            barcode = it.barcode,
            barcode_corrupted = it.barcode_corrupted,
            category_id = it.category_id,
            location_id = it.location_id,
            purchase_date = it.purchase_date,
            warranty_info = it.warranty_info,
            value = it.value,
            serial_number = it.serial_number,
            photo_path = it.photo_path,
            deleted = it.deleted,
            last_modified = it.last_modified
          )
        }
        val barcodes = snap.item_barcodes.map { ItemBarcodeEntity(it.barcode, it.item_id, it.created_at) }

        db.categoriesDao().upsertAll(cats)
        db.locationsDao().upsertAll(locs)
        db.itemsDao().upsertAll(items)
        db.barcodesDao().upsertAll(barcodes)
      }

      val newestBarcode = db.barcodesDao().newest()?.created_at ?: 0L
      prefs.setBarcodeSinceMs(newestBarcode)

      val newestItemLm = snap.items.maxOfOrNull { it.last_modified } ?: 0L
      prefs.setItemsSinceMs(newestItemLm)

      prefs.setBootstrapped(true)
      prefs.setLastSyncMs(System.currentTimeMillis())
    }
  }

  suspend fun pingDesktop(): Result<Unit> {
    return runCatching {
      if (!isPaired()) throw IllegalStateException("Not paired")
      val api = apiServiceProvider()
      api.ping()
      // Verify token as well (ping is unauth)
      api.meta()
    }
  }

  suspend fun listDesktopInventories(): Result<List<InventoryDto>> {
    return runCatching {
      val api = apiServiceProvider()
      val resp = api.listInventories()
      resp.inventories
    }
  }

  suspend fun switchInventoryClearAndBootstrap(inventoryId: String?): Result<Unit> {
    return runCatching {
      if (!isPaired()) throw IllegalStateException("Not paired")
      prefs.setInventoryId(inventoryId)
      prefs.resetSyncState()

      // Switching inventories should start clean: clear local DB (including any pending queues).
      db.clearAllTables()

      val r = bootstrapFromDesktop()
      if (r.isFailure) throw (r.exceptionOrNull() ?: IllegalStateException("bootstrap_failed"))
    }
  }

  suspend fun appendLocalToInventory(inventoryId: String): Result<Unit> {
    return runCatching {
      if (!isPaired()) throw IllegalStateException("Not paired")
      // Keep local data/pending queues, but change the remote inventory context.
      prefs.setInventoryId(inventoryId)
      prefs.resetSyncState()

      val wasBootstrapped = prefs.bootstrappedFlow.first()

      val r1 = syncOnce()
      if (r1.isFailure) throw (r1.exceptionOrNull() ?: IllegalStateException("sync_failed"))

      // If we had to bootstrap, run sync again to flush pending creates/scans.
      if (!wasBootstrapped) {
        val r2 = syncOnce()
        if (r2.isFailure) throw (r2.exceptionOrNull() ?: IllegalStateException("sync_failed"))
      }
    }
  }

  suspend fun refreshItems(): Result<ItemRefreshResult> {
    return runCatching {
      val api = apiServiceProvider()
      val since = prefs.itemsSinceMsFlow.first()
      val resp = api.listItems(since = since, includeDeleted = 1)

      if (resp.items.isNotEmpty()) {
        val entities = resp.items.map {
          ItemEntity(
            item_id = it.item_id,
            name = it.name,
            description = it.description,
            quantity = it.quantity,
            barcode = it.barcode,
            barcode_corrupted = it.barcode_corrupted,
            category_id = it.category_id,
            location_id = it.location_id,
            purchase_date = it.purchase_date,
            warranty_info = it.warranty_info,
            value = it.value,
            serial_number = it.serial_number,
            photo_path = it.photo_path,
            deleted = it.deleted,
            last_modified = it.last_modified
          )
        }
        db.itemsDao().upsertAll(entities)
        val max = resp.items.maxOf { it.last_modified }
        prefs.setItemsSinceMs(max)
      }

      prefs.setLastSyncMs(System.currentTimeMillis())
      ItemRefreshResult(pulled = resp.items.size, deleted = resp.deleted.size)
    }
  }

  suspend fun submitItemForm(
    itemId: Int?,
    name: String,
    description: String?,
    quantity: Int,
    value: Double?,
    categoryId: Int?,
    locationId: Int?,
    barcode: String?,
    barcodeCorrupted: Boolean,
    serialNumber: String?,
    purchaseDate: String?,
    warrantyInfo: String?,
    photoPath: String?
  ): Result<ItemEntity> {
    return runCatching {
      val now = System.currentTimeMillis()

      val barcodeCorruptedInt = if (barcodeCorrupted) 1 else 0
      val normalizedBarcode = if (barcodeCorrupted) {
        null
      } else {
        barcode?.trim()?.takeIf { it.isNotBlank() }
      }

      val req = ItemUpsertRequestDto(
        name = name.trim(),
        description = description?.trim()?.takeIf { it.isNotBlank() },
        quantity = quantity.coerceAtLeast(0),
        barcode = normalizedBarcode,
        barcode_corrupted = barcodeCorruptedInt,
        category_id = categoryId,
        location_id = locationId,
        purchase_date = purchaseDate?.trim()?.takeIf { it.isNotBlank() },
        warranty_info = warrantyInfo?.trim()?.takeIf { it.isNotBlank() },
        value = value,
        serial_number = serialNumber?.trim()?.takeIf { it.isNotBlank() },
        photo_path = photoPath?.trim()?.takeIf { it.isNotBlank() },
        last_modified = now
      )

      val localOnly = AppMode.fromRaw(prefs.appModeFlow.first()) == AppMode.LocalOnly
      val tryServer = !localOnly && isPaired()

      if (tryServer) {
        try {
          val api = apiServiceProvider()

          val resp = if (itemId == null || itemId < 0) api.createItem(req) else api.updateItem(itemId, req)
          val it = resp.item

          val entity = ItemEntity(
            item_id = it.item_id,
            name = it.name,
            description = it.description,
            quantity = it.quantity,
            barcode = it.barcode,
            barcode_corrupted = it.barcode_corrupted,
            category_id = it.category_id,
            location_id = it.location_id,
            purchase_date = it.purchase_date,
            warranty_info = it.warranty_info,
            value = it.value,
            serial_number = it.serial_number,
            photo_path = it.photo_path,
            deleted = it.deleted,
            last_modified = it.last_modified
          )

          db.itemsDao().upsertAll(listOf(entity))
          prefs.setLastSyncMs(System.currentTimeMillis())
          return@runCatching entity
        } catch (_: Throwable) {
          // If server submit fails (offline/transient), fall back to local-first.
        }
      }

      // Local-first (LocalOnly mode or currently unpaired/offline): persist locally and queue for later.
      val tempId = when {
        itemId == null -> nextNegativeId(db.itemsDao().minId())
        else -> itemId
      }

      val entity = ItemEntity(
        item_id = tempId,
        name = req.name,
        description = req.description,
        quantity = req.quantity,
        barcode = req.barcode,
        barcode_corrupted = barcodeCorruptedInt,
        category_id = req.category_id,
        location_id = req.location_id,
        purchase_date = req.purchase_date,
        warranty_info = req.warranty_info,
        value = req.value,
        serial_number = req.serial_number,
        photo_path = req.photo_path,
        deleted = 0,
        last_modified = now
      )

      db.withTransaction {
        db.itemsDao().upsertAll(listOf(entity))

        if (tempId < 0) {
          db.pendingItemCreateDao().upsert(
            PendingItemCreateEntity(
              client_id = UUID.randomUUID().toString(),
              temp_item_id = tempId,
              name = entity.name,
              description = entity.description,
              quantity = entity.quantity,
              barcode = entity.barcode,
              barcode_corrupted = entity.barcode_corrupted,
              category_id = entity.category_id,
              location_id = entity.location_id,
              purchase_date = entity.purchase_date,
              warranty_info = entity.warranty_info,
              value = entity.value,
              serial_number = entity.serial_number,
              photo_path = entity.photo_path,
              last_modified = entity.last_modified,
              state = "pending",
              created_at = now,
              last_attempt_at = null
            )
          )
        } else {
          db.pendingItemUpdateDao().upsert(
            PendingItemUpdateEntity(
              client_id = UUID.randomUUID().toString(),
              item_id = tempId,
              name = entity.name,
              description = entity.description,
              quantity = entity.quantity,
              barcode = entity.barcode,
              barcode_corrupted = entity.barcode_corrupted,
              category_id = entity.category_id,
              location_id = entity.location_id,
              purchase_date = entity.purchase_date,
              warranty_info = entity.warranty_info,
              value = entity.value,
              serial_number = entity.serial_number,
              photo_path = entity.photo_path,
              last_modified = entity.last_modified,
              deleted = entity.deleted,
              state = "pending",
              created_at = now,
              last_attempt_at = null
            )
          )
        }
      }

      entity
    }
  }

  suspend fun createLocalCategory(name: String): Result<CategoryEntity> {
    return runCatching {
      val now = System.currentTimeMillis()
      val tempId = nextNegativeId(db.categoriesDao().minId())
      val entity = CategoryEntity(tempId, name.trim())
      db.withTransaction {
        db.categoriesDao().upsertOne(entity)
        db.pendingCategoryCreateDao().upsert(
          PendingCategoryCreateEntity(
            client_id = UUID.randomUUID().toString(),
            temp_category_id = tempId,
            name = entity.name,
            state = "pending",
            created_at = now,
            last_attempt_at = null
          )
        )
      }
      entity
    }
  }

  suspend fun createLocalLocation(name: String, parentId: Int? = null): Result<LocationEntity> {
    return runCatching {
      val now = System.currentTimeMillis()
      val tempId = nextNegativeId(db.locationsDao().minId())
      val entity = LocationEntity(tempId, name.trim(), parentId)
      db.withTransaction {
        db.locationsDao().upsertOne(entity)
        db.pendingLocationCreateDao().upsert(
          PendingLocationCreateEntity(
            client_id = UUID.randomUUID().toString(),
            temp_location_id = tempId,
            name = entity.name,
            parent_id = entity.parent_id,
            state = "pending",
            created_at = now,
            last_attempt_at = null
          )
        )
      }
      entity
    }
  }

  suspend fun refreshCategoriesAndLocations(): Result<Unit> {
    return runCatching {
      val api = apiServiceProvider()
      val cats = api.listCategories().categories
      val locs = api.listLocations().locations

      db.withTransaction {
        db.categoriesDao().upsertAll(cats.map { CategoryEntity(it.category_id, it.name) })
        db.locationsDao().upsertAll(locs.map { LocationEntity(it.location_id, it.name, it.parent_id) })
      }

      prefs.setLastSyncMs(System.currentTimeMillis())
    }
  }

  suspend fun applyPendingCategoryCreates(limit: Int = 50): Result<Int> {
    return runCatching {
      val api = apiServiceProvider()
      val pending = db.pendingCategoryCreateDao().listPending(limit)
      if (pending.isEmpty()) return@runCatching 0
      val now = System.currentTimeMillis()

      var sent = 0
      for (p in pending) {
        try {
          val resp = api.createCategory(CategoryUpsertRequestDto(name = p.name))
          val server = resp.category
          db.withTransaction {
            db.categoriesDao().upsertOne(CategoryEntity(server.category_id, server.name))
            db.itemsDao().remapCategoryId(p.temp_category_id, server.category_id)
            db.categoriesDao().deleteById(p.temp_category_id)
            db.pendingCategoryCreateDao().setState(p.client_id, "sent", now)
          }
          sent++
        } catch (e: Exception) {
          // On conflict or transient errors, try to resolve by matching an existing category.
          db.pendingCategoryCreateDao().setState(p.client_id, "error", now)
          try {
            val existing = api.listCategories().categories.firstOrNull { it.name.equals(p.name, ignoreCase = true) }
            if (existing != null) {
              db.withTransaction {
                db.categoriesDao().upsertOne(CategoryEntity(existing.category_id, existing.name))
                db.itemsDao().remapCategoryId(p.temp_category_id, existing.category_id)
                db.categoriesDao().deleteById(p.temp_category_id)
                db.pendingCategoryCreateDao().setState(p.client_id, "sent", now)
              }
              sent++
            }
          } catch (_: Exception) {
            // keep as error for retry
          }
        }
      }
      sent
    }
  }

  suspend fun applyPendingLocationCreates(limit: Int = 50): Result<Int> {
    return runCatching {
      val api = apiServiceProvider()
      val pending = db.pendingLocationCreateDao().listPending(limit)
      if (pending.isEmpty()) return@runCatching 0
      val now = System.currentTimeMillis()

      var sent = 0
      for (p in pending) {
        // If parent is still a temp negative ID, wait until it's remapped.
        val parentId = p.parent_id
        if (parentId != null && parentId < 0) {
          db.pendingLocationCreateDao().setState(p.client_id, "blocked", now)
          continue
        }

        try {
          val resp = api.createLocation(LocationUpsertRequestDto(name = p.name, parent_id = parentId))
          val server = resp.location

          db.withTransaction {
            db.locationsDao().upsertOne(LocationEntity(server.location_id, server.name, server.parent_id))
            db.itemsDao().remapLocationId(p.temp_location_id, server.location_id)
            db.locationsDao().remapParentId(p.temp_location_id, server.location_id)
            db.locationsDao().deleteById(p.temp_location_id)
            db.pendingLocationCreateDao().setState(p.client_id, "sent", now)
          }
          sent++
        } catch (e: Exception) {
          db.pendingLocationCreateDao().setState(p.client_id, "error", now)
          try {
            val existing = api.listLocations().locations.firstOrNull {
              it.name.equals(p.name, ignoreCase = true) && it.parent_id == parentId
            }
            if (existing != null) {
              db.withTransaction {
                db.locationsDao().upsertOne(LocationEntity(existing.location_id, existing.name, existing.parent_id))
                db.itemsDao().remapLocationId(p.temp_location_id, existing.location_id)
                db.locationsDao().remapParentId(p.temp_location_id, existing.location_id)
                db.locationsDao().deleteById(p.temp_location_id)
                db.pendingLocationCreateDao().setState(p.client_id, "sent", now)
              }
              sent++
            }
          } catch (_: Exception) {
            // keep as error for retry
          }
        }
      }
      sent
    }
  }

  suspend fun applyPendingItemCreates(limit: Int = 50): Result<Int> {
    return runCatching {
      val api = apiServiceProvider()
      val pending = db.pendingItemCreateDao().listPending(limit)
      if (pending.isEmpty()) return@runCatching 0
      val now = System.currentTimeMillis()

      var sent = 0
      for (p in pending) {
        val blocked = (p.category_id != null && p.category_id < 0) || (p.location_id != null && p.location_id < 0)
        if (blocked) {
          db.pendingItemCreateDao().setState(p.client_id, "blocked", now)
          continue
        }

        try {
          val req = ItemUpsertRequestDto(
            name = p.name,
            description = p.description,
            quantity = p.quantity,
            barcode = p.barcode,
            barcode_corrupted = p.barcode_corrupted,
            category_id = p.category_id,
            location_id = p.location_id,
            purchase_date = p.purchase_date,
            warranty_info = p.warranty_info,
            value = p.value,
            serial_number = p.serial_number,
            photo_path = p.photo_path,
            last_modified = p.last_modified
          )

          val resp = api.createItem(req)
          val it = resp.item

          val serverEntity = ItemEntity(
            item_id = it.item_id,
            name = it.name,
            description = it.description,
            quantity = it.quantity,
            barcode = it.barcode,
            barcode_corrupted = it.barcode_corrupted,
            category_id = it.category_id,
            location_id = it.location_id,
            purchase_date = it.purchase_date,
            warranty_info = it.warranty_info,
            value = it.value,
            serial_number = it.serial_number,
            photo_path = it.photo_path,
            deleted = it.deleted,
            last_modified = it.last_modified
          )

          db.withTransaction {
            db.itemsDao().upsertAll(listOf(serverEntity))
            db.itemsDao().deleteById(p.temp_item_id)
            db.pendingItemCreateDao().setState(p.client_id, "sent", now)
          }
          sent++
        } catch (e: Exception) {
          db.pendingItemCreateDao().setState(p.client_id, "error", now)
        }
      }

      sent
    }
  }

  suspend fun applyPendingItemUpdates(limit: Int = 50): Result<Int> {
    return runCatching {
      val api = apiServiceProvider()
      val pending = db.pendingItemUpdateDao().listPending(limit)
      if (pending.isEmpty()) return@runCatching 0
      val now = System.currentTimeMillis()

      var sent = 0
      for (p in pending) {
        val blocked = (p.category_id != null && p.category_id < 0) || (p.location_id != null && p.location_id < 0)
        if (blocked) {
          db.pendingItemUpdateDao().setState(p.client_id, "blocked", now)
          continue
        }

        try {
          val req = ItemUpsertRequestDto(
            name = p.name,
            description = p.description,
            quantity = p.quantity,
            barcode = p.barcode,
            barcode_corrupted = p.barcode_corrupted,
            category_id = p.category_id,
            location_id = p.location_id,
            purchase_date = p.purchase_date,
            warranty_info = p.warranty_info,
            value = p.value,
            serial_number = p.serial_number,
            photo_path = p.photo_path,
            last_modified = p.last_modified,
            deleted = p.deleted
          )

          val resp = api.updateItem(p.item_id, req)
          val it = resp.item

          val serverEntity = ItemEntity(
            item_id = it.item_id,
            name = it.name,
            description = it.description,
            quantity = it.quantity,
            barcode = it.barcode,
            barcode_corrupted = it.barcode_corrupted,
            category_id = it.category_id,
            location_id = it.location_id,
            purchase_date = it.purchase_date,
            warranty_info = it.warranty_info,
            value = it.value,
            serial_number = it.serial_number,
            photo_path = it.photo_path,
            deleted = it.deleted,
            last_modified = it.last_modified
          )

          db.withTransaction {
            db.itemsDao().upsertAll(listOf(serverEntity))
            db.pendingItemUpdateDao().setState(p.client_id, "sent", now)
          }
          sent++
        } catch (_: Exception) {
          db.pendingItemUpdateDao().setState(p.client_id, "error", now)
        }
      }

      sent
    }
  }

  suspend fun refreshBarcodeMappings(): Result<Unit> {
    return runCatching {
      val api = apiServiceProvider()
      val since = prefs.barcodeSinceMsFlow.first()
      val resp = api.listItemBarcodesSince(since)

      if (resp.barcodes.isNotEmpty()) {
        val entities = resp.barcodes.map { ItemBarcodeEntity(it.barcode, it.item_id, it.created_at) }
        db.barcodesDao().upsertAll(entities)
        val max = resp.barcodes.maxOf { it.created_at }
        prefs.setBarcodeSinceMs(max)
      }

      prefs.setLastSyncMs(System.currentTimeMillis())
    }
  }

  suspend fun syncOnce(): Result<SyncOnceResult> {
    return runCatching {
      val mode = AppMode.fromRaw(prefs.appModeFlow.first())
      if (mode == AppMode.LocalOnly) {
        return@runCatching SyncOnceResult(
          bootstrapped = prefs.bootstrappedFlow.first(),
          itemsPulled = 0,
          scansApplied = 0,
          scansDuplicates = 0,
          scansNotFound = 0
        )
      }

      if (!isPaired()) {
        throw IllegalStateException("Not paired")
      }

      val isBoot = prefs.bootstrappedFlow.first()
      if (!isBoot) {
        val r = bootstrapFromDesktop()
        if (r.isFailure) throw (r.exceptionOrNull() ?: IllegalStateException("bootstrap_failed"))
        return@runCatching SyncOnceResult(
          bootstrapped = true,
          itemsPulled = 0,
          scansApplied = 0,
          scansDuplicates = 0,
          scansNotFound = 0
        )
      }

      // Push local creates first so IDs resolve before item pull.
      val pushCats = applyPendingCategoryCreates()
      if (pushCats.isFailure) throw (pushCats.exceptionOrNull() ?: IllegalStateException("apply_categories_failed"))

      val pushLocs = applyPendingLocationCreates()
      if (pushLocs.isFailure) throw (pushLocs.exceptionOrNull() ?: IllegalStateException("apply_locations_failed"))

      val pushItems = applyPendingItemCreates()
      if (pushItems.isFailure) throw (pushItems.exceptionOrNull() ?: IllegalStateException("apply_items_failed"))

      val pushItemUpdates = applyPendingItemUpdates()
      if (pushItemUpdates.isFailure) throw (pushItemUpdates.exceptionOrNull() ?: IllegalStateException("apply_item_updates_failed"))

      val refreshCatsLocs = refreshCategoriesAndLocations()
      if (refreshCatsLocs.isFailure) throw (refreshCatsLocs.exceptionOrNull() ?: IllegalStateException("refresh_catslocs_failed"))

      val push = applyPendingScanEvents()
      if (push.isFailure) throw (push.exceptionOrNull() ?: IllegalStateException("apply_scans_failed"))
      val pullItems = refreshItems()
      if (pullItems.isFailure) throw (pullItems.exceptionOrNull() ?: IllegalStateException("refresh_items_failed"))
      val refreshBarcodes = refreshBarcodeMappings()
      if (refreshBarcodes.isFailure) throw (refreshBarcodes.exceptionOrNull() ?: IllegalStateException("refresh_barcodes_failed"))

      val pr = push.getOrNull()
      val ir = pullItems.getOrNull()

      SyncOnceResult(
        bootstrapped = true,
        itemsPulled = ir?.pulled ?: 0,
        scansApplied = pr?.applied ?: 0,
        scansDuplicates = pr?.duplicates ?: 0,
        scansNotFound = pr?.notFound ?: 0
      )
    }
  }

  suspend fun pendingScanCount(): Int {
    return db.pendingScanDao().countPending()
  }

  suspend fun queueScanDelta(barcode: String, delta: Int = 1): QueueScanResult {
    val now = System.currentTimeMillis()
    val trimmed = barcode.trim()

    // Prefer explicit alternate-barcode mappings over primary barcode matches.
    val itemId = db.itemsDao().findItemIdByAltBarcode(trimmed)
      ?: db.itemsDao().findItemIdByPrimaryBarcode(trimmed)

    if (itemId == null) {
      db.corruptedDao().bumpOrInsert(trimmed, now)
      return QueueScanResult.Corrupted
    }

    val item = db.itemsDao().getById(itemId)
    if (item == null || item.deleted == 1) {
      db.corruptedDao().bumpOrInsert(trimmed, now)
      return QueueScanResult.Corrupted
    }

    val nextQty = (item.quantity + delta).coerceAtLeast(0)
    db.itemsDao().setQuantity(itemId, nextQty, now)

    val ev = PendingScanEventEntity(
      event_id = UUID.randomUUID().toString(),
      barcode = trimmed,
      delta = delta,
      item_id = itemId,
      override = false,
      scanned_at = now,
      state = "pending",
      last_attempt_at = null
    )
    db.pendingScanDao().upsert(ev)

    return QueueScanResult.Queued(item.copy(quantity = nextQty, last_modified = now))
  }

  suspend fun queueScanDeltaForItemId(
    itemId: Int,
    scannedBarcode: String,
    delta: Int = 1,
    override: Boolean = false
  ): QueueScanResult {
    val now = System.currentTimeMillis()
    val trimmed = scannedBarcode.trim()

    val item = db.itemsDao().getById(itemId)
    if (item == null || item.deleted == 1) {
      if (trimmed.isNotEmpty()) db.corruptedDao().bumpOrInsert(trimmed, now)
      return QueueScanResult.Corrupted
    }

    val nextQty = (item.quantity + delta).coerceAtLeast(0)
    db.itemsDao().setQuantity(itemId, nextQty, now)

    if (override && trimmed.isNotBlank()) {
      // Reassign/pin this barcode to the chosen item locally so future scans resolve deterministically.
      db.barcodesDao().upsertAll(listOf(ItemBarcodeEntity(trimmed, itemId, now)))
    }

    val ev = PendingScanEventEntity(
      event_id = UUID.randomUUID().toString(),
      barcode = trimmed,
      delta = delta,
      item_id = itemId,
      override = override,
      scanned_at = now,
      state = "pending",
      last_attempt_at = null
    )
    db.pendingScanDao().upsert(ev)

    return QueueScanResult.Queued(item.copy(quantity = nextQty, last_modified = now))
  }

  suspend fun adjustItemQuantity(itemId: Int, delta: Int): Result<ItemEntity> {
    return runCatching {
      val now = System.currentTimeMillis()
      val item = db.itemsDao().getById(itemId) ?: throw IllegalStateException("not_found")
      if (item.deleted == 1) throw IllegalStateException("deleted")

      val nextQty = (item.quantity + delta).coerceAtLeast(0)

      // If there is a barcode, represent qty changes as scan events so it queues offline and
      // (critically) can still apply when barcodes are shared by including item_id.
      val code = item.barcode?.trim().orEmpty()
      if (code.isNotBlank()) {
        val r = queueScanDeltaForItemId(itemId, code, delta)
        if (r is QueueScanResult.Queued) return@runCatching r.item
        throw IllegalStateException("scan_queue_failed")
      }

      db.itemsDao().setQuantity(itemId, nextQty, now)

      db.pendingItemUpdateDao().upsert(
        PendingItemUpdateEntity(
          client_id = UUID.randomUUID().toString(),
          item_id = item.item_id,
          name = item.name,
          description = item.description,
          quantity = nextQty,
          barcode = item.barcode,
          barcode_corrupted = item.barcode_corrupted,
          category_id = item.category_id,
          location_id = item.location_id,
          purchase_date = item.purchase_date,
          warranty_info = item.warranty_info,
          value = item.value,
          serial_number = item.serial_number,
          photo_path = item.photo_path,
          last_modified = now,
          deleted = item.deleted,
          state = "pending",
          created_at = now,
          last_attempt_at = null
        )
      )

      item.copy(quantity = nextQty, last_modified = now)
    }
  }

  suspend fun applyPendingScanEvents(limit: Int = 200): Result<ApplyPendingResult> {
    return runCatching {
      val api = apiServiceProvider()
      val pending = db.pendingScanDao().listPending(limit)
      if (pending.isEmpty()) return@runCatching ApplyPendingResult(0, 0, 0)

      val req = ApplyScansRequest(
        events = pending.map {
          ScanEventDto(
            event_id = it.event_id,
            barcode = it.barcode,
            delta = it.delta,
            scanned_at = it.scanned_at,
            item_id = it.item_id,
            override = if (it.override) true else null
          )
        }
      )

      val resp = api.applyScans(req)
      var applied = 0
      var duplicates = 0
      var notFound = 0
      val now = System.currentTimeMillis()

      for (r in resp.results) {
        when (r.status) {
          "applied" -> {
            applied++
            db.pendingScanDao().setState(r.event_id, "sent", now)
            val item = r.item
            if (item != null) {
              db.itemsDao().upsertAll(
                listOf(
                  ItemEntity(
                    item_id = item.item_id,
                    name = item.name,
                    description = item.description,
                    quantity = item.quantity,
                    barcode = item.barcode,
                    barcode_corrupted = item.barcode_corrupted,
                    category_id = item.category_id,
                    location_id = item.location_id,
                    purchase_date = item.purchase_date,
                    warranty_info = item.warranty_info,
                    value = item.value,
                    serial_number = item.serial_number,
                    photo_path = item.photo_path,
                    deleted = item.deleted,
                    last_modified = item.last_modified
                  )
                )
              )
            }
          }

          "duplicate" -> {
            duplicates++
            db.pendingScanDao().setState(r.event_id, "sent", now)
          }

          "not_found" -> {
            notFound++
            db.pendingScanDao().setState(r.event_id, "not_found", now)
            // Treat as inconsistency: barcode isn't valid on server side.
            val code = pending.firstOrNull { it.event_id == r.event_id }?.barcode?.trim().orEmpty()
            if (code.isNotEmpty()) db.corruptedDao().bumpOrInsert(code, now)
          }

          else -> {
            db.pendingScanDao().setState(r.event_id, "error", now)
          }
        }
      }

      prefs.setLastSyncMs(System.currentTimeMillis())
      ApplyPendingResult(applied, duplicates, notFound)
    }
  }
}

sealed class QueueScanResult {
  data class Queued(val item: ItemEntity) : QueueScanResult()
  data object Corrupted : QueueScanResult()
}

data class ApplyPendingResult(
  val applied: Int,
  val duplicates: Int,
  val notFound: Int
)

data class ItemRefreshResult(
  val pulled: Int,
  val deleted: Int
)

data class SyncOnceResult(
  val bootstrapped: Boolean,
  val itemsPulled: Int,
  val scansApplied: Int,
  val scansDuplicates: Int,
  val scansNotFound: Int
)
